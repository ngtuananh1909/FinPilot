import { z } from "zod";
import { assertOwnerContext, type OwnerContext } from "@/lib/auth/owner-context";
import { AppError } from "@/lib/errors";
import { parseInput } from "@/lib/db/inputs";
import { getProfile } from "@/lib/db/repositories/profile";
import type { DbClient } from "@/lib/db/repositories/shared";
import { resetUserToPersona, type RpcClient } from "@/lib/db/repositories/server-only";
import { PERSONA_CODES, type PersonaCode } from "@/lib/db/schema";
import { buildPersonaTemplate } from "./template";

/** `userClient` runs as the signed-in user (RLS). `adminClient` is service-role: RPCs only. */
export interface DemoDeps {
  userClient: DbClient;
  adminClient: RpcClient;
}

// SQL allows 128 chars; leave room for the "start:" / "reset:" prefix.
const idempotencyKey = z.string().trim().min(8).max(120);

const startSchema = z
  .object({
    personaCode: z.enum(PERSONA_CODES),
    idempotencyKey,
    /** Must be true to replace data of a guest who already has a persona. */
    confirmReplace: z.boolean().optional(),
  })
  .strict();

const resetSchema = z
  .object({
    confirm: z.literal(true),
    idempotencyKey,
    /** Only anonymous guests may switch persona; demo accounts keep their own. */
    personaCode: z.enum(PERSONA_CODES).optional(),
  })
  .strict();

export type DemoStartResult =
  | { status: "started" | "replaced"; personaCode: PersonaCode; replay: boolean }
  | { status: "existing"; personaCode: PersonaCode | null };

export interface DemoResetResult {
  status: "reset";
  personaCode: PersonaCode;
  replay: boolean;
}

/**
 * Starts a Guest Demo for the verified anonymous caller by cloning a persona template into
 * the caller's own rows. A guest that already has data is never replaced silently: the
 * result is `existing` until the caller repeats the request with `confirmReplace: true`.
 */
export async function startGuestDemo(
  deps: DemoDeps,
  owner: OwnerContext,
  input: unknown,
  now: Date,
): Promise<DemoStartResult> {
  assertOwnerContext(owner);
  if (!owner.isAnonymous) throw new AppError("forbidden");
  const request = parseInput(startSchema, input);

  const profile = await getProfile(deps.userClient, owner);
  if (profile && !profile.isDemo) throw new AppError("forbidden");
  if (profile && request.confirmReplace !== true) {
    return { status: "existing", personaCode: profile.personaCode };
  }

  const template = buildPersonaTemplate(request.personaCode, now);
  const outcome = await resetUserToPersona(deps.adminClient, owner, {
    template,
    idempotencyKey: `start:${request.idempotencyKey}`,
  });
  return {
    status: profile ? "replaced" : "started",
    personaCode: request.personaCode,
    replay: outcome.replay,
  };
}

/**
 * Manual reset of the caller's OWN demo data (guests and the sample email accounts).
 * Requires explicit confirmation. Real accounts (profile.is_demo = false) can never be
 * reset here, so a real user's data cannot be wiped through this path.
 */
export async function resetDemoData(
  deps: DemoDeps,
  owner: OwnerContext,
  input: unknown,
  now: Date,
): Promise<DemoResetResult> {
  assertOwnerContext(owner);
  const request = parseInput(resetSchema, input);

  const profile = await getProfile(deps.userClient, owner);
  if (!profile) throw new AppError("not_found");
  if (!profile.isDemo) throw new AppError("forbidden");

  const personaCode = owner.isAnonymous ? (request.personaCode ?? profile.personaCode) : profile.personaCode;
  if (!personaCode) throw new AppError("validation_failed");
  if (!owner.isAnonymous && request.personaCode && request.personaCode !== profile.personaCode) {
    throw new AppError("forbidden");
  }

  const template = buildPersonaTemplate(personaCode, now);
  const outcome = await resetUserToPersona(deps.adminClient, owner, {
    template,
    idempotencyKey: `reset:${request.idempotencyKey}`,
  });
  return { status: "reset", personaCode, replay: outcome.replay };
}
