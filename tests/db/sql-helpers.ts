import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (rel: string): string => fileURLToPath(new URL(`../../${rel}`, import.meta.url));

export const PATHS = {
  base: "supabase/migrations/202611230001_finpilot_initial.sql",
  // Moved from supabase/proposed/ to supabase/migrations/ for the G2-approved push.
  // File content is byte-identical to the reviewed draft (sha256 1c2bc21b...4fd01).
  proposed: "supabase/migrations/202611230002_finpilot_hardening.sql",
  rollback: "supabase/proposed/202611230002_finpilot_hardening.rollback.sql",
  migrationsDir: "supabase/migrations",
  // Migration 0003 moved to supabase/migrations/ for the G2-approved push (docs/18).
  // Content byte-identical to the reviewed draft (sha256 a058be50...f59). Rollback stays in proposed/.
  proposed0003: "supabase/migrations/202611230003_finpilot_profile_protection_and_csv_commit.sql",
  rollback0003: "supabase/proposed/202611230003_finpilot_profile_protection_and_csv_commit_rollback.sql",
} as const;

export function absolute(rel: string): string {
  return root(rel);
}

export function readRepoFile(rel: string): string {
  return readFileSync(root(rel), "utf8");
}

/** Removes `-- line` and block comments. The migrations contain no comment markers in strings. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

export interface SqlFunction {
  name: string;
  /** Full statement text from `create` to the closing `$$;`. */
  text: string;
  /** Text between the opening `$$` and the closing `$$`. */
  body: string;
  /** Text between the function name and the opening `$$` (signature + attributes). */
  header: string;
}

/** Extracts `create [or replace] function public.x(...) ... $$ body $$;` statements. */
export function extractFunctions(sqlWithoutComments: string): SqlFunction[] {
  const re = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([\s\S]*?)\bas\s+\$\$([\s\S]*?)\$\$;/gi;
  const result: SqlFunction[] = [];
  for (const m of sqlWithoutComments.matchAll(re)) {
    result.push({
      name: m[1] ?? "",
      text: m[0],
      header: m[2] ?? "",
      body: m[3] ?? "",
    });
  }
  return result;
}

export function functionPrivileges(sql: string, fn: string): { revoked: Set<string>; granted: string[] } {
  const revoked = new Set<string>();
  const granted: string[] = [];
  const revokeRe = new RegExp(
    `revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+from\\s+(\\w+)\\s*;`,
    "gi",
  );
  for (const m of sql.matchAll(revokeRe)) revoked.add((m[1] ?? "").toLowerCase());
  const grantRe = new RegExp(
    `grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+to\\s+([\\w,\\s]+?)\\s*;`,
    "gi",
  );
  for (const m of sql.matchAll(grantRe)) {
    for (const role of (m[1] ?? "").split(",")) granted.push(role.trim().toLowerCase());
  }
  return { revoked, granted };
}

export interface SqlTable {
  name: string;
  block: string;
}

export function extractTables(sqlWithoutComments: string): SqlTable[] {
  const re = /create\s+table\s+if\s+not\s+exists\s+public\.(\w+)\s*\(([\s\S]*?)\n\);/gi;
  return [...sqlWithoutComments.matchAll(re)].map((m) => ({ name: m[1] ?? "", block: m[2] ?? "" }));
}

export function rlsEnabledTables(sqlWithoutComments: string): Set<string> {
  const re = /alter\s+table\s+public\.(\w+)\s+enable\s+row\s+level\s+security\s*;/gi;
  return new Set([...sqlWithoutComments.matchAll(re)].map((m) => m[1] ?? ""));
}

/** Statements that start with the given keyword, up to the terminating semicolon. */
export function statementsStartingWith(sqlWithoutComments: string, pattern: RegExp): string[] {
  return [...sqlWithoutComments.matchAll(pattern)].map((m) => m[0]);
}
