#!/usr/bin/env node
// Runs the LIVE RLS/RPC/quota suites against the ONE approved Supabase project.
// Node loads .env.local itself (npm script uses --env-file-if-exists); values are never printed.
// Approved under G2 (owner, 2026-11-24): throwaway anonymous users, cleanup by created id only.
import { spawnSync } from "node:child_process";

const APPROVED_REF = "llrxhefrqnjdwlmxozul";
const need = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = need.filter((n) => !(process.env[n] ?? "").trim());
if (missing.length > 0) {
  console.error(`BLOCKED: missing ${missing.join(", ")} (names only)`);
  process.exit(3);
}

let origin;
try {
  origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL.trim()).origin;
} catch {
  console.error("BLOCKED: NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
  process.exit(3);
}
if (origin !== `https://${APPROVED_REF}.supabase.co`) {
  console.error("Refusing to run: configured Supabase project is not the approved ref");
  process.exit(4);
}

const files = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ["tests/db/rls.live.test.ts", "tests/db/rls-0003.live.test.ts"];

const env = {
  ...process.env,
  RLS_TEST_ENABLED: "1",
  RLS_TEST_MIGRATION_0003: "1",
  RLS_TEST_ALLOWED_PROJECT_REF: APPROVED_REF,
  RLS_TEST_SUPABASE_URL: origin,
  RLS_TEST_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim(),
  RLS_TEST_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
};

console.log(`Running live suites against ${APPROVED_REF}: ${files.join(", ")}`);
const result = spawnSync("npx", ["vitest", "run", "--reporter=verbose", ...files], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
