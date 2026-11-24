import { z } from "zod";
import type { PersonaCode } from "../db/schema";
import { buildPersonaTemplate, type PersonaTemplate } from "./template";

/**
 * Demo e-mail account seeding (task T02.2). Pure planning + orchestration: all I/O goes
 * through the injected `SeedAdmin`. Nothing here reads process.env, the network or the disk.
 *
 * Safety properties (all covered by tests/demo/seed-*.test.ts):
 * - Error messages and reports never contain an e-mail, a password, a token or a key.
 * - Existing users are reused; their password is never changed. Users are never deleted.
 * - Default is a dry-run; writes need `apply: true`.
 */

/** Fixed mapping: SEED_USER_1 -> student, SEED_USER_2 -> worker, SEED_USER_3 -> at_risk. */
export const SEED_PERSONA_ORDER = ["student", "worker", "at_risk"] as const satisfies readonly PersonaCode[];
export const SEED_SLOTS = [1, 2, 3] as const;
export type SeedSlot = (typeof SEED_SLOTS)[number];

export const MIN_PASSWORD_LENGTH = 12;
// Supabase Auth (bcrypt) rejects passwords longer than 72 bytes.
export const MAX_PASSWORD_LENGTH = 72;

export type SeedEnv = Readonly<Record<string, string | undefined>>;

export type SeedErrorCode =
  | "invalid_configuration"
  | "gate_apply_not_allowed"
  | "admin_failure";

export interface SeedIssue {
  readonly variable: string;
  readonly reason: "missing" | "invalid_email" | "duplicate_email" | "weak_password" | "duplicate_password";
}

/** Typed failure. `message` is built from variable NAMES and reason codes only. */
export class SeedError extends Error {
  readonly code: SeedErrorCode;
  readonly issues: readonly SeedIssue[];
  constructor(code: SeedErrorCode, detail: string, issues: readonly SeedIssue[] = []) {
    super(`${code}: ${detail}`);
    this.name = "SeedError";
    this.code = code;
    this.issues = issues;
  }
}

export interface SeedAccount {
  readonly slot: SeedSlot;
  readonly personaCode: PersonaCode;
  /** Normalised (trimmed, lower-cased). */
  readonly email: string;
  /** Non-enumerable so JSON.stringify / console.log of an account cannot leak it. */
  readonly password: string;
}

export interface SeedPlan {
  readonly accounts: readonly SeedAccount[];
}

const emailSchema = z.string().trim().max(254).pipe(z.email());
const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

function nonBlank(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function makeAccount(slot: SeedSlot, personaCode: PersonaCode, email: string, password: string): SeedAccount {
  const account = { slot, personaCode, email } as { slot: SeedSlot; personaCode: PersonaCode; email: string };
  Object.defineProperty(account, "password", { value: password, enumerable: false });
  return account as SeedAccount;
}

/** Validates SEED_USER_{1..3}_{EMAIL,PASSWORD}. Throws SeedError("invalid_configuration"). */
export function planSeed(env: SeedEnv): SeedPlan {
  const issues: SeedIssue[] = [];
  const parsed: { slot: SeedSlot; emailVar: string; passwordVar: string; email?: string; password?: string }[] = [];

  for (const slot of SEED_SLOTS) {
    const emailVar = `SEED_USER_${slot}_EMAIL`;
    const passwordVar = `SEED_USER_${slot}_PASSWORD`;
    const entry: (typeof parsed)[number] = { slot, emailVar, passwordVar };

    const rawEmail = env[emailVar];
    if (!nonBlank(rawEmail)) {
      issues.push({ variable: emailVar, reason: "missing" });
    } else {
      const result = emailSchema.safeParse(rawEmail);
      if (result.success) entry.email = result.data.toLowerCase();
      else issues.push({ variable: emailVar, reason: "invalid_email" });
    }

    const rawPassword = env[passwordVar];
    if (!nonBlank(rawPassword)) {
      issues.push({ variable: passwordVar, reason: "missing" });
    } else if (passwordSchema.safeParse(rawPassword).success) {
      entry.password = rawPassword;
    } else {
      issues.push({ variable: passwordVar, reason: "weak_password" });
    }
    parsed.push(entry);
  }

  const seenEmails = new Map<string, true>();
  const seenPasswords = new Map<string, true>();
  for (const entry of parsed) {
    if (entry.email !== undefined) {
      if (seenEmails.has(entry.email)) issues.push({ variable: entry.emailVar, reason: "duplicate_email" });
      seenEmails.set(entry.email, true);
    }
    if (entry.password !== undefined) {
      if (seenPasswords.has(entry.password)) issues.push({ variable: entry.passwordVar, reason: "duplicate_password" });
      seenPasswords.set(entry.password, true);
    }
  }

  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.variable} (${i.reason})`).join(", ");
    throw new SeedError("invalid_configuration", detail, issues);
  }

  const accounts = parsed.map((entry) => {
    const personaCode = SEED_PERSONA_ORDER[entry.slot - 1]!;
    return makeAccount(entry.slot, personaCode, entry.email!, entry.password!);
  });
  return { accounts };
}

/** `alice@mail.example.com` -> `a***@m***.com`. Never returns the full address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const head = domain.slice(0, 1) || "*";
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 1)}***@${head}***${tld}`;
}

/** Supabase project ref from `https://<ref>.supabase.co`; null for anything else (e.g. localhost). */
export function parseProjectRef(url: string | undefined): string | null {
  if (!nonBlank(url)) return null;
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  const suffix = ".supabase.co";
  if (!host.endsWith(suffix)) return null;
  const ref = host.slice(0, -suffix.length);
  return /^[a-z0-9]{8,32}$/.test(ref) ? ref : null;
}

/**
 * Gate for real writes. Requires SEED_ALLOWED_PROJECT_REF and SEED_CONFIRM_PROJECT_REF to both
 * equal the ref parsed from NEXT_PUBLIC_SUPABASE_URL. Returns the ref; refs are not secret.
 */
export function assertApplyAllowed(env: SeedEnv): string {
  const urlRef = parseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!urlRef) {
    throw new SeedError("gate_apply_not_allowed", "NEXT_PUBLIC_SUPABASE_URL is not a hosted Supabase project URL");
  }
  const allowed = env.SEED_ALLOWED_PROJECT_REF?.trim().toLowerCase();
  const confirm = env.SEED_CONFIRM_PROJECT_REF?.trim().toLowerCase();
  if (!allowed) throw new SeedError("gate_apply_not_allowed", "SEED_ALLOWED_PROJECT_REF is not set");
  if (!confirm) throw new SeedError("gate_apply_not_allowed", "SEED_CONFIRM_PROJECT_REF is not set");
  if (allowed !== urlRef) {
    throw new SeedError("gate_apply_not_allowed", "SEED_ALLOWED_PROJECT_REF does not match NEXT_PUBLIC_SUPABASE_URL");
  }
  if (confirm !== urlRef) {
    throw new SeedError("gate_apply_not_allowed", "SEED_CONFIRM_PROJECT_REF does not match NEXT_PUBLIC_SUPABASE_URL");
  }
  return urlRef;
}

/** Injected admin interface. The real Supabase adapter lives next to the CLI. */
export interface SeedAdmin {
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  /** Must create a confirmed user (`email_confirm: true`). */
  createUser(input: { email: string; password: string; emailConfirm: true }): Promise<{ id: string }>;
  findProfile(userId: string): Promise<{ isDemo: boolean; personaCode: PersonaCode | null } | null>;
  /** Calls `reset_user_to_persona` for the raw user id (script-only wrapper). */
  callResetRpc(
    userId: string,
    input: { template: PersonaTemplate; idempotencyKey: string },
  ): Promise<{ applied: boolean; replay: boolean }>;
}

export interface SeedOptions {
  /** false (default) = dry-run: no createUser, no RPC. */
  readonly apply?: boolean;
  /** Re-clone even if the account already has the same demo persona. Never overrides non-demo profiles. */
  readonly force?: boolean;
  /**
   * Whether read-only lookups (find user / profile) may be performed. Defaults to `apply`.
   * A dry-run that must stay fully offline sets this to false.
   */
  readonly lookup?: boolean;
}

export type SeedUserAction = "create" | "reuse" | "create_or_reuse";
export type SeedCloneAction = "clone" | "skip" | "blocked" | "clone_unless_seeded";
export type SeedStatus = "planned" | "done" | "skipped" | "blocked";

export interface SeedReportEntry {
  readonly slot: SeedSlot;
  readonly personaCode: PersonaCode;
  readonly maskedEmail: string;
  readonly userAction: SeedUserAction;
  readonly cloneAction: SeedCloneAction;
  readonly status: SeedStatus;
  /** Present when the user exists (reused or created). User ids are not secrets. */
  readonly userId?: string;
  readonly reason?: "already_seeded" | "persona_mismatch" | "not_demo_profile";
  readonly replay?: boolean;
}

export interface SeedReport {
  readonly mode: "dry-run" | "apply";
  readonly entries: readonly SeedReportEntry[];
}

export function seedIdempotencyKey(personaCode: PersonaCode, userId: string, force: boolean, now: Date): string {
  const base = `seed:${personaCode}:${userId}:v1`;
  // A forced re-clone needs a fresh key, otherwise the SQL function would report a replay.
  return force ? `${base}:force:${now.getTime()}` : base;
}

type CloneDecision =
  | { action: "clone" }
  | { action: "skip"; reason: "already_seeded" }
  | { action: "blocked"; reason: "persona_mismatch" | "not_demo_profile" };

function decideClone(
  profile: { isDemo: boolean; personaCode: PersonaCode | null } | null,
  personaCode: PersonaCode,
  force: boolean,
): CloneDecision {
  if (!profile) return { action: "clone" };
  if (!profile.isDemo) return { action: "blocked", reason: "not_demo_profile" };
  if (profile.personaCode === personaCode) return force ? { action: "clone" } : { action: "skip", reason: "already_seeded" };
  return force ? { action: "clone" } : { action: "blocked", reason: "persona_mismatch" };
}

function wrapAdminFailure(step: string, error: unknown): SeedError {
  // Only a coarse name: provider messages can echo e-mail addresses.
  const name = error instanceof Error ? error.name : "unknown";
  return new SeedError("admin_failure", `${step} failed (${name})`);
}

export async function runSeed(deps: SeedAdmin, plan: SeedPlan, now: Date, opts: SeedOptions = {}): Promise<SeedReport> {
  const apply = opts.apply === true;
  const force = opts.force === true;
  const lookup = opts.lookup ?? apply;
  const entries: SeedReportEntry[] = [];

  for (const account of plan.accounts) {
    const base = { slot: account.slot, personaCode: account.personaCode, maskedEmail: maskEmail(account.email) };

    if (!lookup) {
      entries.push({ ...base, userAction: "create_or_reuse", cloneAction: "clone_unless_seeded", status: "planned" });
      continue;
    }

    let existing: { id: string } | null;
    try {
      existing = await deps.findUserByEmail(account.email);
    } catch (error) {
      throw wrapAdminFailure("findUserByEmail", error);
    }

    let userId: string | undefined = existing?.id;
    const userAction: SeedUserAction = existing ? "reuse" : "create";

    if (!existing && apply) {
      try {
        userId = (await deps.createUser({ email: account.email, password: account.password, emailConfirm: true })).id;
      } catch (error) {
        throw wrapAdminFailure("createUser", error);
      }
    }

    let profile: { isDemo: boolean; personaCode: PersonaCode | null } | null = null;
    if (userId) {
      try {
        profile = await deps.findProfile(userId);
      } catch (error) {
        throw wrapAdminFailure("findProfile", error);
      }
    }
    const decision = decideClone(profile, account.personaCode, force);
    const withId = userId ? { userId } : {};

    if (decision.action === "skip") {
      entries.push({ ...base, ...withId, userAction, cloneAction: "skip", status: "skipped", reason: decision.reason });
      continue;
    }
    if (decision.action === "blocked") {
      entries.push({ ...base, ...withId, userAction, cloneAction: "blocked", status: "blocked", reason: decision.reason });
      continue;
    }
    if (!apply || !userId) {
      entries.push({ ...base, ...withId, userAction, cloneAction: "clone", status: "planned" });
      continue;
    }

    const template = buildPersonaTemplate(account.personaCode, now);
    let outcome: { applied: boolean; replay: boolean };
    try {
      outcome = await deps.callResetRpc(userId, {
        template,
        idempotencyKey: seedIdempotencyKey(account.personaCode, userId, force, now),
      });
    } catch (error) {
      throw wrapAdminFailure("reset_user_to_persona", error);
    }
    entries.push({ ...base, userId, userAction, cloneAction: "clone", status: "done", replay: outcome.replay });
  }

  return { mode: apply ? "apply" : "dry-run", entries };
}

/** Human-readable report lines. Contains masked e-mails and persona names only. */
export function formatReport(report: SeedReport): string[] {
  const changed = report.entries.some((e) => e.userAction === "create" || (e.status === "done" && !e.replay));
  const header =
    report.mode === "dry-run"
      ? "DRY-RUN: nothing was written."
      : changed
        ? "APPLY: changes were made."
        : "APPLY: nothing to change (all accounts already exist and are seeded).";
  const lines = [header];
  for (const e of report.entries) {
    const user =
      e.userAction === "create_or_reuse"
        ? "create user or reuse existing (lookup needs --apply)"
        : e.userAction === "create"
          ? e.status === "planned"
            ? "WOULD create user"
            : "created user"
          : "reuse existing user (password untouched)";
    const clone =
      e.cloneAction === "clone_unless_seeded"
        ? "clone persona unless already seeded"
        : e.cloneAction === "clone"
          ? e.status === "done"
            ? `cloned persona${e.replay ? " (replay, no change)" : ""}`
            : "WOULD clone persona"
          : e.cloneAction === "skip"
            ? "skip clone (already seeded)"
            : `BLOCKED (${e.reason ?? "unknown"}), no data touched`;
    const id = e.userId && report.mode === "apply" ? ` id=${e.userId}` : "";
    lines.push(`  [${e.slot}] ${e.maskedEmail} -> ${e.personaCode}: ${user}; ${clone}${id}`);
  }
  return lines;
}
