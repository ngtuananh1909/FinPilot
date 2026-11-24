#!/usr/bin/env node
// Scans the built client bundle (.next/static) for server secrets. Node loads .env.local via
// --env-file-if-exists; values are compared in memory and NEVER printed. Run after `npm run build`.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = ".next/static";
if (!existsSync(DIR)) {
  console.log("BLOCKED: no build output; run npm run build first");
  process.exit(3);
}
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(DIR);

const checks = {
  name_SUPABASE_SERVICE_ROLE_KEY: "SUPABASE_SERVICE_ROLE_KEY",
  name_AI_API_KEY: "AI_API_KEY",
};
const secretValues = {
  value_SUPABASE_SERVICE_ROLE_KEY: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
  value_AI_API_KEY: (process.env.AI_API_KEY ?? "").trim(),
};
let leaked = false;
const report = {};
for (const label of Object.keys(checks)) report[label] = false;
for (const [label, value] of Object.entries(secretValues)) report[label] = value.length >= 8 ? false : "not_set";
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const [label, needle] of Object.entries(checks)) if (text.includes(needle)) report[label] = true;
  for (const [label, value] of Object.entries(secretValues)) if (value.length >= 8 && text.includes(value)) report[label] = true;
}
for (const [label, found] of Object.entries(report)) {
  console.log(`${label}_in_client_bundle=${found}`);
  if (found === true) leaked = true;
}
console.log(`files_scanned=${files.length}`);
process.exit(leaked ? 1 : 0);
