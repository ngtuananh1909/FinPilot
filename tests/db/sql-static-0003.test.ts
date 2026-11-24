import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PATHS,
  absolute,
  extractFunctions,
  functionPrivileges,
  readRepoFile,
  stripSqlComments,
} from "./sql-helpers";

/**
 * STATIC checks for the PROPOSED migration 202611230003 (profile column protection and the
 * atomic CSV commit). They parse SQL text and never connect to a database. Behaviour is
 * covered by the skipped live suite (rls.live.test.ts) and by the local throwaway-container
 * smoke test recorded in docs/14-sql-review.md.
 */
const raw = readRepoFile(PATHS.proposed0003);
const rollbackRaw = readRepoFile(PATHS.rollback0003);
const sql = stripSqlComments(raw);
const rollback = stripSqlComments(rollbackRaw);
const functions = extractFunctions(sql);
const fn = (name: string) => functions.find((f) => f.name === name);
const commit = fn("commit_csv_import");
const guard = fn("protect_profile_columns");

describe("0003 placement and header", () => {
  it("migration sits in supabase/migrations; its rollback never does", () => {
    expect(PATHS.proposed0003.startsWith("supabase/migrations/")).toBe(true);
    expect(PATHS.rollback0003.startsWith("supabase/proposed/")).toBe(true);
    expect(existsSync(absolute(PATHS.proposed0003))).toBe(true);
    expect(existsSync(absolute(PATHS.rollback0003))).toBe(true);
    const applied = readdirSync(absolute(PATHS.migrationsDir));
    expect(applied.filter((f) => f.includes("rollback"))).toEqual([]);
    expect(applied.filter((f) => f.endsWith(".sql")).sort()).toEqual([
      "202611230001_finpilot_initial.sql",
      "202611230002_finpilot_hardening.sql",
      "202611230003_finpilot_profile_protection_and_csv_commit.sql",
    ]);
  });

  it("carries the PROPOSED - NOT APPLIED header in both files", () => {
    expect(raw.slice(0, 200)).toContain("PROPOSED - NOT APPLIED - requires G2 approval");
    expect(rollbackRaw.slice(0, 200)).toContain("PROPOSED - NOT APPLIED - requires G2 approval");
  });

  it("has no stray backslash before ; or ) (tool-writing artefact)", () => {
    expect(raw).not.toMatch(/\\[;)]/);
    expect(rollbackRaw).not.toMatch(/\\[;)]/);
  });

  it("defines exactly the expected functions", () => {
    expect(functions.map((f) => f.name).sort()).toEqual(["commit_csv_import", "protect_profile_columns"]);
  });
});

describe("0003 leaves RLS, policies, table privileges and base objects alone", () => {
  it("does not touch RLS, policies, table grants/revokes, tables, columns or constraints", () => {
    expect(sql).not.toMatch(/\brow\s+level\s+security\b/i);
    expect(sql).not.toMatch(/\bcreate\s+policy\b/i);
    expect(sql).not.toMatch(/\balter\s+policy\b/i);
    expect(sql).not.toMatch(/\bcreate\s+table\b/i);
    expect(sql).not.toMatch(/\balter\s+table\b/i);
    expect(sql).not.toMatch(/\balter\s+function\b/i);
    expect(sql).not.toMatch(/\b(?:grant|revoke)\b[^;]*\bon\s+(?:table\s+)?public\.(?!\w+\s*\()/i);
  });

  it("only grants EXECUTE on its own functions, to service_role", () => {
    const grants = [...sql.matchAll(/\bgrant\b[^;]*;/gi)].map((m) => m[0].replace(/\s+/g, " "));
    expect(grants).toEqual([
      "grant execute on function public.protect_profile_columns() to service_role;",
      "grant execute on function public.commit_csv_import(uuid,text,text,jsonb,integer) to service_role;",
    ]);
    expect(sql).not.toMatch(/\bto\s+[^;]*\b(anon|authenticated|public)\b[^;]*;\s*$/im);
  });
});

describe("0003 destructive statements", () => {
  it("has no drop, truncate, delete or update statement in the migration", () => {
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/\bupdate\s+public\./i);
    expect(sql).not.toMatch(/\bcascade\b/i);
  });

  it("rollback drops only the two triggers and two functions it created, and deletes no rows", () => {
    const dropped = [...rollback.matchAll(/\bdrop\s+(\w+)\s+(?:if\s+exists\s+)?([\w.]+)/gi)].map(
      (m) => `${(m[1] ?? "").toLowerCase()} ${m[2]}`,
    );
    expect(dropped.sort()).toEqual(
      [
        "function public.commit_csv_import",
        "function public.protect_profile_columns",
        "trigger financial_profiles_protect_columns_insert",
        "trigger financial_profiles_protect_columns_update",
      ].sort(),
    );
    expect(rollback).not.toMatch(/\bdelete\b/i);
    expect(rollback).not.toMatch(/\btruncate\b/i);
    expect(rollback).not.toMatch(/\bdrop\s+table\b/i);
    expect(rollback).not.toMatch(/\bcascade\b/i);
    expect(rollback).not.toMatch(/\balter\b/i);
  });
});

describe("protect_profile_columns trigger", () => {
  it("is SECURITY INVOKER with an empty search_path", () => {
    expect(guard).toBeDefined();
    expect(guard?.header).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(guard?.header).not.toMatch(/security\s+definer/i);
    expect(guard?.header).toMatch(/returns\s+trigger/i);
  });

  it("keys on current_user (PostgREST set local role), never session_user", () => {
    expect(guard?.body).toMatch(/current_user\s+in\s*\(\s*'authenticated'\s*,\s*'anon'\s*\)/i);
    expect(guard?.body).not.toMatch(/session_user/i);
  });

  it("covers user_id, persona_code and is_demo on update using IS DISTINCT FROM", () => {
    const body = guard?.body ?? "";
    for (const col of ["user_id", "persona_code", "is_demo"]) {
      expect(body, col).toMatch(new RegExp(`new\\.${col}\\s+is\\s+distinct\\s+from\\s+old\\.${col}`, "i"));
    }
  });

  it("allows client inserts only with persona_code null and is_demo false", () => {
    const body = guard?.body ?? "";
    expect(body).toMatch(/new\.persona_code\s+is\s+not\s+null/i);
    expect(body).toMatch(/new\.is_demo\s+is\s+distinct\s+from\s+false/i);
  });

  it("raises 42501 and always returns NEW", () => {
    const body = guard?.body ?? "";
    const raises = [...body.matchAll(/raise\s+exception[\s\S]*?;/gi)].map((m) => m[0]);
    expect(raises).toHaveLength(2);
    for (const r of raises) expect(r).toMatch(/errcode\s*=\s*'42501'/);
    expect(body).toMatch(/return\s+new\s*;/i);
  });

  it("is revoked from public/anon/authenticated and granted to service_role only", () => {
    const { revoked, granted } = functionPrivileges(sql, "protect_profile_columns");
    for (const r of ["public", "anon", "authenticated"]) expect(revoked.has(r), r).toBe(true);
    expect([...new Set(granted)]).toEqual(["service_role"]);
  });

  it("is attached as BEFORE INSERT and BEFORE UPDATE row triggers on financial_profiles", () => {
    expect(sql).toMatch(
      /create\s+trigger\s+financial_profiles_protect_columns_insert\s+before\s+insert\s+on\s+public\.financial_profiles\s+for\s+each\s+row\s+execute\s+function\s+public\.protect_profile_columns\(\)/i,
    );
    expect(sql).toMatch(
      /create\s+trigger\s+financial_profiles_protect_columns_update\s+before\s+update\s+on\s+public\.financial_profiles\s+for\s+each\s+row\s+execute\s+function\s+public\.protect_profile_columns\(\)/i,
    );
    // Plain BEFORE UPDATE (no `update of <cols>`), so no column list can go stale.
    expect(sql).not.toMatch(/before\s+update\s+of\b/i);
  });

  it("does not create the triggers twice when re-run (guarded by pg_trigger lookups)", () => {
    expect(sql.match(/from pg_trigger/gi)?.length).toBe(2);
  });
});

describe("commit_csv_import", () => {
  const body = commit?.body ?? "";

  it("is SECURITY DEFINER with an empty search_path and the documented signature", () => {
    expect(commit).toBeDefined();
    expect(commit?.header).toMatch(/security\s+definer/i);
    expect(commit?.header).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(commit?.header).toMatch(
      /p_user_id\s+uuid,\s*p_idempotency_key\s+text,\s*p_filename\s+text,\s*p_rows\s+jsonb,\s*p_rejected_count\s+integer\s*\)\s*returns\s+jsonb/i,
    );
  });

  it("revokes from public/anon/authenticated and grants execute to service_role only", () => {
    const { revoked, granted } = functionPrivileges(sql, "commit_csv_import");
    for (const r of ["public", "anon", "authenticated"]) expect(revoked.has(r), r).toBe(true);
    expect([...new Set(granted)]).toEqual(["service_role"]);
  });

  it("takes the per-user advisory lock (same key as reset) before any read or write of user tables", () => {
    const lock = "pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0))";
    expect(body).toContain(lock);
    const lockAt = body.indexOf(lock);
    const firstTableUse = body.search(/\b(?:from|into)\s+(?:public|auth)\./i);
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(firstTableUse);
    expect(body.indexOf(lock)).toBeLessThan(body.search(/\binsert\s+into\b/i));
  });

  it("uses only fully qualified relations", () => {
    const unqualified = [
      ...body.matchAll(/\b(?:from|join|update|insert\s+into|delete\s+from)\s+(?!public\.|auth\.|pg_catalog\.)(\w+)\b(?!\s*\()/gi),
    ].map((m) => m[1] ?? "");
    expect(unqualified).toEqual([]);
  });

  it("replays an existing (user, key) batch before validating or inserting", () => {
    const replayAt = body.search(/'replayed',\s*true/);
    const insertBatchAt = body.search(/insert\s+into\s+public\.import_batches/i);
    const insertTxAt = body.search(/insert\s+into\s+public\.transactions/i);
    expect(replayAt).toBeGreaterThan(-1);
    expect(replayAt).toBeLessThan(insertBatchAt);
    expect(insertBatchAt).toBeLessThan(insertTxAt);
    expect(body).toMatch(/on\s+conflict\s*\(user_id,\s*idempotency_key\)\s+do\s+nothing/i);
  });

  it("only touches user tables through p_user_id: filtered reads, owner-valued inserts, no update/delete", () => {
    expect(body).not.toMatch(/\bdelete\b/i);
    expect(body).not.toMatch(/\bupdate\b/i);
    expect(body).not.toMatch(/\btruncate\b/i);
    expect(body).not.toMatch(/\bdrop\b/i);

    // Every select from a public/auth table is filtered by the owner id.
    const selects = [...body.matchAll(/select\s[^;]*?from\s+(public|auth)\.(\w+)[^;]*?;/gi)];
    expect(selects.length).toBeGreaterThanOrEqual(2);
    for (const s of selects) {
      expect(s[0], s[0]).toMatch(/(?:user_id|\bid)\s*=\s*p_user_id/);
    }

    // Writes: exactly import_batches and transactions, both carrying p_user_id first.
    const writes = [...body.matchAll(/insert\s+into\s+(public\.\w+)\s*\(\s*user_id/gi)].map((m) => m[1]);
    expect(writes).toEqual(["public.import_batches", "public.transactions"]);
    expect([...body.matchAll(/insert\s+into\s+public\.\w+/gi)]).toHaveLength(2);
    expect(body).toMatch(/values\s*\(\s*p_user_id,/i);
    expect(body).toMatch(/select\s+p_user_id,/i);

    // Row JSON can never choose the owner, source or batch: those keys are rejected.
    expect(body).toMatch(/k not in \('occurred_at','kind','amount_vnd','category','merchant','description','fingerprint'\)/);
    expect(body).not.toMatch(/e->>'user_id'/);
    expect(body).not.toMatch(/e->>'source'/);
    expect(body).not.toMatch(/e->>'import_batch_id'/);
  });

  it("inserts source 'csv' with the new batch id and the fingerprint", () => {
    const tx = /insert\s+into\s+public\.transactions[\s\S]*?from\s+jsonb_array_elements\(p_rows\)\s+e\s*;/i.exec(body)?.[0] ?? "";
    expect(tx).toContain("'csv'");
    expect(tx).toContain("v_batch.id");
    expect(tx).toContain("e->>'fingerprint'");
    expect(tx).toContain("public.parse_safe_vnd(e->>'amount_vnd')");
  });

  it("validates the arguments and rows strictly (bounds, kinds, amount, lengths, ISO with offset)", () => {
    expect(body).toMatch(/v_count\s*<\s*1\s+or\s+v_count\s*>\s*5000/);
    expect(body).toMatch(/jsonb_typeof\(p_rows\)\s+is\s+distinct\s+from\s+'array'/);
    expect(body).toContain("not in ('income','expense','excluded')");
    expect(body).toMatch(/coalesce\(public\.parse_safe_vnd\(e->>'amount_vnd'\),\s*0\)\s*<\s*1/);
    expect(body).toMatch(/length\(btrim\(coalesce\(e->>'category',\s*''\)\)\)\s*>\s*50/);
    expect(body).toMatch(/length\(coalesce\(e->>'merchant',\s*''\)\)\s*>\s*200/);
    expect(body).toMatch(/length\(coalesce\(e->>'description',\s*''\)\)\s*>\s*500/);
    expect(body).toMatch(/length\(e->>'fingerprint'\)\s*>\s*128/);
    expect(body).toMatch(/\(Z\|\[\+-\]\\d\{2\}:\?\\d\{2\}\)\$/);
    expect(body).toMatch(/length\(p_idempotency_key\)\s*>\s*128/);
    expect(body).toMatch(/length\(p_filename\)\s*>\s*255/);
    expect(body).toMatch(/p_rejected_count\s*<\s*0\s+or\s+p_rejected_count\s*>\s*5000/);
    expect(body).toMatch(/inserted row count mismatch/);
  });

  it("returns replayed, batch_id, accepted_count, rejected_count and status", () => {
    for (const key of ["replayed", "batch_id", "accepted_count", "rejected_count", "status"]) {
      expect([...body.matchAll(new RegExp(`'${key}'`, "g"))].length, key).toBeGreaterThanOrEqual(2);
    }
  });

  it("avoids words that the qualified-name scan would misread inside messages", () => {
    const messages = [...body.matchAll(/raise\s+exception\s+'([^']*)'/gi)].map((m) => m[1] ?? "");
    expect(messages.length).toBeGreaterThan(8);
    for (const m of messages) expect(m, m).not.toMatch(/\b(from|join|update|into)\b/i);
  });
});
