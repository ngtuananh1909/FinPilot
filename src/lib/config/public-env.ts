import { z } from "zod";
import { blankToUndefined, parseEnv, type EnvSource } from "./env-core";

const requiredString = z.preprocess(blankToUndefined, z.string());

const publicSchema = z.object({
  // Supabase clients need the project ORIGIN. A common copy-paste mistake is the REST endpoint
  // (`https://<ref>.supabase.co/rest/v1/`), which makes every auth/rest call 404. Keep only the
  // origin; reject non-https URLs so a typo cannot downgrade the transport.
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(
    blankToUndefined,
    z
      .url()
      .refine((u) => new URL(u).protocol === "https:", "https_required")
      .transform((u) => new URL(u).origin),
  ),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: requiredString,
  NEXT_PUBLIC_APP_URL: z.preprocess(blankToUndefined, z.url().default("http://localhost:3000")),
});

export type PublicEnv = z.output<typeof publicSchema>;

/**
 * Next.js only inlines `process.env.NEXT_PUBLIC_*` when referenced statically,
 * so the default source lists each key explicitly. Safe for client and server.
 */
function defaultPublicSource(): EnvSource {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
}

/** Validated public env. Throws EnvValidationError (keys only, no values). */
export function getPublicEnv(source: EnvSource = defaultPublicSource()): PublicEnv {
  return parseEnv("public", publicSchema, source);
}
