import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PATHS,
  absolute,
  extractFunctions,
  extractTables,
  functionPrivileges,
  readRepoFile,
  rlsEnabledTables,
  stripSqlComments,
} from "./sql-helpers";

/**
 * STATIC checks only: they parse SQL text and never connect to any database.
 * They do NOT prove database behaviour (see tests/db/rls.live.test.ts, which is BLOCKED
 * until a G2-approved target exists).
 */
const baseRaw = readRepoFile(PATHS.base);
const proposedRaw = readRepoFile(PATHS.proposed);
const rollbackRaw = readRepoFile(PATHS.rollback);
const base = stripSqlComments(baseRaw);
const proposed = stripSqlComments(proposedRaw);
const rollback = stripSqlComments(rollbackRaw);

const SAFE_INT = "9007199254740991";
const CLIENT_WRITABLE = [
  "financial_profiles",
  "import_batches",
  "recurring_items",
  "transactions",
  "savings_goals",
];
const SERVER_WRITE_ONLY = ["ai_conversations", "ai_messages", "ai_proposals", "ai_usage_daily"];

describe("proposed migration placement and header", () => {
  it("hardening migration sits in supabase/migrations; the rollback script never does", () => {
    expect(PATHS.proposed.startsWith("supabase/migrations/")).toBe(true);
    expect(PATHS.rollback.startsWith("supabase/proposed/")).toBe(true);
    expect(existsSync(absolute(PATHS.proposed))).toBe(true);
    expect(existsSync(absolute(PATHS.rollback))).toBe(true);
    const migrationFiles = readdirSync(absolute(PATHS.migrationsDir));
    expect(migrationFiles).not.toContain("202611230002_finpilot_hardening.rollback.sql");
    expect(migrationFiles.filter((f) => f.endsWith(".sql")).sort()).toEqual([
      "202611230001_finpilot_initial.sql",
      "202611230002_finpilot_hardening.sql",
      "202611230003_finpilot_profile_protection_and_csv_commit.sql",
    ]);
  });

  it("carries the PROPOSED - NOT APPLIED header in both files", () => {
    expect(proposedRaw.slice(0, 400)).toContain("PROPOSED - NOT APPLIED - requires G2 approval");
    expect(rollbackRaw.slice(0, 400)).toContain("PROPOSED - NOT APPLIED - requires G2 approval");
  });

  it("leaves the base migration untouched in content terms (still the candidate create-only file)", () => {
    expect(baseRaw).toContain("create table if not exists public.financial_profiles");
    expect(baseRaw).toContain("on delete set null (recurring_item_id)");
  });
});

describe("row level security", () => {
  it("enables RLS on every table created by the base migration", () => {
    const rls = rlsEnabledTables(base);
    const tables = extractTables(base).map((t) => t.name);
    expect(tables.length).toBe(9);
    for (const t of tables) expect(rls.has(t), `RLS missing on ${t}`).toBe(true);
  });

  it("enables RLS on every table created by the proposed migration", () => {
    const rls = rlsEnabledTables(proposed);
    const tables = extractTables(proposed).map((t) => t.name);
    expect(tables.sort()).toEqual(["ai_quota_reservations", "reset_log"]);
    for (const t of tables) expect(rls.has(t), `RLS missing on ${t}`).toBe(true);
  });

  it("gives reset_log no client policy and no client grant", () => {
    expect(proposed).not.toMatch(/create\s+policy\s+\w+\s+on\s+public\.reset_log/i);
    expect(proposed).toMatch(/revoke\s+all\s+on\s+public\.reset_log\s+from\s+authenticated/i);
    expect(proposed).toMatch(/revoke\s+all\s+on\s+public\.reset_log\s+from\s+anon/i);
    expect(proposed).not.toMatch(/grant[^;]*public\.reset_log[^;]*\sto\s+(authenticated|anon|public)\b/i);
  });

  it("allows only a select-own policy and a select grant on ai_quota_reservations for clients", () => {
    const policies = [...proposed.matchAll(/create\s+policy\s+(\w+)\s+on\s+public\.ai_quota_reservations\s+for\s+(\w+)/gi)];
    expect(policies.map((p) => (p[2] ?? "").toLowerCase())).toEqual(["select"]);
    expect(proposed).toMatch(/using\s*\(\s*\(select auth\.uid\(\)\)\s*=\s*user_id\s*\)/i);
    expect(proposed).toMatch(/grant\s+select\s+on\s+public\.ai_quota_reservations\s+to\s+authenticated\s*;/i);
  });

  it("base migration exposes only select policies on server-written AI tables", () => {
    for (const t of SERVER_WRITE_ONLY) {
      const kinds = [...base.matchAll(new RegExp(`create\\s+policy\\s+\\w+\\s+on\\s+public\\.${t}\\s+for\\s+(\\w+)`, "gi"))];
      expect(kinds.map((k) => (k[1] ?? "").toLowerCase()), t).toEqual(["select"]);
    }
  });

  it("proposed migration revokes client write privileges on server-written tables", () => {
    const m = /revoke\s+insert,\s*update,\s*delete,\s*truncate,\s*references,\s*trigger\s+on\s+([\s\S]*?)\s+from\s+authenticated\s*;/i.exec(proposed);
    expect(m).not.toBeNull();
    for (const t of SERVER_WRITE_ONLY) expect(m?.[1]).toContain(`public.${t}`);
    const clientRevoke = /revoke\s+truncate,\s*references,\s*trigger\s+on\s+([\s\S]*?)\s+from\s+authenticated\s*;/i.exec(proposed);
    for (const t of CLIENT_WRITABLE) expect(clientRevoke?.[1]).toContain(`public.${t}`);
  });
});

describe("privileged functions", () => {
  const functions = extractFunctions(proposed);
  const baseFunctions = extractFunctions(base);

  it("defines the expected function set", () => {
    expect(functions.map((f) => f.name).sort()).toEqual(
      [
        "set_updated_at",
        "consume_ai_quota",
        "reserve_ai_quota",
        "release_ai_quota",
        "commit_ai_quota",
        "bootstrap_profile",
        "parse_safe_vnd",
        "reset_user_to_persona",
      ].sort(),
    );
  });

  it("sets search_path to empty in every function (base and proposed)", () => {
    for (const f of [...baseFunctions, ...functions]) {
      expect(f.header, f.name).toMatch(/set\s+search_path\s*=\s*''/i);
    }
  });

  it("revokes from public/anon/authenticated and grants execute to service_role only", () => {
    for (const f of [...baseFunctions, ...functions]) {
      const { revoked, granted } = functionPrivileges(f.name === "consume_ai_quota" ? baseRaw + proposed : proposed, f.name);
      for (const r of ["public", "anon", "authenticated"]) {
        expect(revoked.has(r), `${f.name} missing revoke from ${r}`).toBe(true);
      }
      expect([...new Set(granted)], f.name).toEqual(["service_role"]);
    }
  });

  it("uses fully qualified relation names inside SECURITY DEFINER bodies", () => {
    const definers = functions.filter((f) => /security\s+definer/i.test(f.header));
    expect(definers.length).toBeGreaterThanOrEqual(6);
    for (const f of definers) {
      const unqualified = [
        ...f.body.matchAll(/\b(?:from|join|update|insert\s+into|delete\s+from)\s+(?!public\.|auth\.|pg_catalog\.)(\w+)\b(?!\s*\()/gi),
      ]
        .map((m) => m[1] ?? "")
        // `on conflict ... do update set` and aliases of set-returning functions are fine.
        .filter((n) => n.toLowerCase() !== "set");
      expect(unqualified, `${f.name} has unqualified relations`).toEqual([]);
    }
  });

  it("marks every service-only function as owned by the migration role (no ALTER FUNCTION OWNER)", () => {
    expect(proposed).not.toMatch(/alter\s+function[^;]*owner\s+to/i);
  });

  it("never grants anything to anon or public, and grants to authenticated only the reservation select", () => {
    expect(proposed).not.toMatch(/\bgrant\b[^;]*\bto\s+[^;]*\banon\b/i);
    expect(proposed).not.toMatch(/\bgrant\b[^;]*\bto\s+[^;]*\bpublic\b/i);
    const toAuthenticated = [...proposed.matchAll(/\bgrant\b[^;]*\bto\s+authenticated\b[^;]*;/gi)].map((m) => m[0].replace(/\s+/g, " "));
    expect(toAuthenticated).toEqual(["grant select on public.ai_quota_reservations to authenticated;"]);
  });
});

describe("destructive statements", () => {
  it("proposed migration has no drop table, truncate or non-constraint drop", () => {
    expect(proposed).not.toMatch(/\bdrop\s+table\b/i);
    expect(proposed).not.toMatch(/\btruncate\s+(table\s+)?public\./i);
    const drops = [...proposed.matchAll(/\bdrop\s+(\w+)\s+([\w.]+)/gi)].map((m) => `${m[1]} ${m[2]}`.toLowerCase());
    expect(drops).toEqual(["constraint transactions_owner_recurring_fk"]);
  });

  it("every delete in the proposed migration is scoped to the owner id", () => {
    const deletes = [...proposed.matchAll(/\bdelete\s+from\s+[^;]*;/gi)].map((m) => m[0]);
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) expect(d, d).toMatch(/where\s+user_id\s*=\s*p_user_id\s*;/i);
  });

  it("deletes happen only inside reset_user_to_persona and only on the documented tables", () => {
    const fns = extractFunctions(proposed);
    const outside = proposed.replace(fns.find((f) => f.name === "reset_user_to_persona")?.text ?? "", "");
    expect(outside).not.toMatch(/\bdelete\s+from\b/i);
    const reset = fns.find((f) => f.name === "reset_user_to_persona");
    const targets = [...(reset?.body ?? "").matchAll(/\bdelete\s+from\s+public\.(\w+)/gi)].map((m) => m[1]);
    expect(targets).toEqual([
      "ai_messages",
      "ai_proposals",
      "ai_conversations",
      "transactions",
      "recurring_items",
      "import_batches",
      "savings_goals",
    ]);
  });

  it("reset_user_to_persona never references quota tables and writes only to documented tables", () => {
    const reset = extractFunctions(proposed).find((f) => f.name === "reset_user_to_persona");
    expect(reset).toBeDefined();
    const body = reset?.body ?? "";
    expect(body).not.toMatch(/ai_usage_daily/i);
    expect(body).not.toMatch(/ai_quota_reservations/i);
    const writes = [...body.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+(public\.\w+)/gi)].map((m) => m[1]);
    const allowed = new Set([
      "public.reset_log",
      "public.ai_messages",
      "public.ai_proposals",
      "public.ai_conversations",
      "public.transactions",
      "public.recurring_items",
      "public.import_batches",
      "public.savings_goals",
      "public.financial_profiles",
    ]);
    for (const w of writes) expect(allowed.has(w ?? ""), `unexpected write target ${w}`).toBe(true);
  });

  it("reset_user_to_persona serialises per user and records idempotency in the same function", () => {
    const body = extractFunctions(proposed).find((f) => f.name === "reset_user_to_persona")?.body ?? "";
    expect(body).toContain("pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0))");
    expect(body).toContain("public.reset_log");
    expect(body).toMatch(/> 500/);
    expect(body).toContain("jsonb_object_keys(p_template)");
    // The lock must be taken before any write.
    expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(body.search(/\binsert\s+into\b/i));
  });

  it("rollback file only drops objects created by the migration and deletes no rows", () => {
    expect(rollback).not.toMatch(/\bdelete\s+from\b/i);
    expect(rollback).not.toMatch(/\btruncate\b/i);
    expect(rollback).not.toMatch(/\bcascade\b/i);
    const dropped = [...rollback.matchAll(/\bdrop\s+(table|function|trigger|index|constraint)\s+(?:if\s+exists\s+)?([\w.]+)/gi)].map(
      (m) => `${(m[1] ?? "").toLowerCase()} ${m[2]}`,
    );
    const allowedTables = ["public.ai_quota_reservations", "public.reset_log"];
    for (const d of dropped.filter((x) => x.startsWith("table "))) {
      expect(allowedTables).toContain(d.slice("table ".length));
    }
    expect(rollback).toMatch(/on\s+delete\s+set\s+null\s*\(recurring_item_id\)/i);
    expect(rollback).toMatch(/create\s+or\s+replace\s+function\s+public\.consume_ai_quota/i);
  });
});

describe("updated_at triggers", () => {
  it("has a trigger for every base table with an updated_at column", () => {
    const withUpdatedAt = extractTables(base)
      .filter((t) => /\bupdated_at\b/.test(t.block))
      .map((t) => t.name);
    expect(withUpdatedAt.sort()).toEqual(
      ["ai_conversations", "financial_profiles", "recurring_items", "savings_goals", "transactions"].sort(),
    );
    for (const t of withUpdatedAt) {
      expect(proposed, t).toMatch(
        new RegExp(`create\\s+trigger\\s+${t}_set_updated_at\\s+before\\s+update\\s+on\\s+public\\.${t}\\s+for\\s+each\\s+row\\s+execute\\s+function\\s+public\\.set_updated_at\\(\\)`, "i"),
      );
      expect(rollback, t).toContain(`drop trigger if exists ${t}_set_updated_at on public.${t}`);
    }
  });
});

describe("recurring FK fix", () => {
  it("re-adds transactions_owner_recurring_fk with ON DELETE NO ACTION and no set null", () => {
    const m = /add\s+constraint\s+transactions_owner_recurring_fk[\s\S]*?;/i.exec(proposed);
    expect(m?.[0]).toMatch(/foreign\s+key\s*\(user_id,\s*recurring_item_id\)/i);
    expect(m?.[0]).toMatch(/on\s+delete\s+no\s+action/i);
    expect(m?.[0]).not.toMatch(/set\s+null/i);
    expect(proposed).toMatch(/confdeltype/i);
  });
});

describe("sanity constraints and indexes", () => {
  it("bounds every bigint VND column of the base schema by the JS safe-integer limit", () => {
    for (const table of extractTables(base)) {
      const cols = [...table.block.matchAll(/^\s*(\w+)\s+bigint\b/gim)].map((m) => m[1] ?? "");
      if (cols.length === 0) continue;
      const rows = [...proposed.matchAll(new RegExp(`\\('${table.name}',\\s*'\\w+',\\s*\\$c\\$([\\s\\S]*?)\\$c\\$\\)`, "g"))]
        .map((m) => m[1] ?? "")
        .join("\n");
      for (const c of cols) {
        expect(rows, `${table.name}.${c} lacks a bound`).toMatch(new RegExp(`\\b${c}\\b[^\\n]*${SAFE_INT}`));
      }
    }
    expect(proposed).toContain(SAFE_INT);
  });

  it("adds non-empty trimmed label checks and a non-unique fingerprint index", () => {
    expect(proposed).toMatch(/btrim\(label\)\s*<>\s*''/);
    expect(proposed).toMatch(/btrim\(name\)\s*<>\s*''/);
    expect(proposed).toMatch(/btrim\(display_name\)\s*<>\s*''/);
    const idx = /create\s+(unique\s+)?index\s+if\s+not\s+exists\s+transactions_owner_fingerprint_idx[\s\S]*?;/i.exec(proposed);
    expect(idx).not.toBeNull();
    expect(idx?.[1]).toBeUndefined();
    expect(idx?.[0]).toMatch(/\(user_id,\s*fingerprint\)/i);
  });
});

describe("quota functions", () => {
  const fns = extractFunctions(proposed);
  const get = (n: string): string => fns.find((f) => f.name === n)?.body ?? "";

  it("consume_ai_quota is guarded against NULL kind and limit", () => {
    const body = get("consume_ai_quota");
    expect(body).toMatch(/p_kind is null/i);
    expect(body).toMatch(/p_limit is null/i);
  });

  it("reserve_ai_quota is request-id idempotent, owner-checked and atomic", () => {
    const body = get("reserve_ai_quota");
    expect(body).toContain("pg_advisory_xact_lock");
    expect(body).toMatch(/v_existing\.user_id\s*<>\s*p_user_id/);
    expect(body).toContain("public.ai_usage_daily.chat_calls < p_limit");
    expect(body).toContain("public.ai_usage_daily.scan_calls < p_limit");
    expect(body).toMatch(/insert into public\.ai_quota_reservations/i);
  });

  it("release_ai_quota is owner-scoped, single-shot and decrements the reservation's own date", () => {
    const body = get("release_ai_quota");
    expect(body).toMatch(/r\.user_id\s*=\s*p_user_id/);
    expect(body).toMatch(/r\.status\s*=\s*'reserved'/);
    expect(body).toMatch(/u\.usage_date\s*=\s*v_usage_date/);
    expect(body).not.toMatch(/\bnow\(\)/i);
    expect(body).not.toMatch(/\bcurrent_date\b/i);
  });

  it("commit_ai_quota only transitions reserved rows owned by the caller", () => {
    const body = get("commit_ai_quota");
    expect(body).toMatch(/r\.user_id\s*=\s*p_user_id/);
    expect(body).toMatch(/r\.status\s*=\s*'reserved'/);
  });

  it("reservation table stores the Vietnam usage date and constrained kind/status", () => {
    expect(proposed).toMatch(/usage_date date not null/i);
    expect(proposed).toMatch(/kind in \('chat','scan'\)/i);
    expect(proposed).toMatch(/status in \('reserved','released','committed'\)/i);
    expect(proposed).toMatch(/request_id uuid primary key/i);
    expect(get("reserve_ai_quota")).toContain("'Asia/Ho_Chi_Minh'");
  });
});
