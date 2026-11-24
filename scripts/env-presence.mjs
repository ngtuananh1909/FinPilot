#!/usr/bin/env node
// Reports which known configuration variables are SET or UNSET. Never prints values.
// Run through npm so Node itself loads .env.local:  npm run env:check
const NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "AI_PROVIDER",
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL",
  "AI_VISION_MODEL",
  "SEED_USER_1_EMAIL",
  "SEED_USER_1_PASSWORD",
  "SEED_USER_2_EMAIL",
  "SEED_USER_2_PASSWORD",
  "SEED_USER_3_EMAIL",
  "SEED_USER_3_PASSWORD",
];
const isSet = (name) => typeof process.env[name] === "string" && process.env[name].trim() !== "";
for (const name of NAMES) console.log(`${name}=${isSet(name) ? "SET" : "UNSET"}`);

// Non-secret derived fact: the project ref in the public URL (it is already public in the browser bundle).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(url.trim());
console.log(`SUPABASE_PROJECT_REF=${match ? match[1] : "UNKNOWN"}`);
