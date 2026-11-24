import { z } from "zod";
import { blankToUndefined, optionalString, parseEnv, type EnvSource } from "./env-core";

// Server-only guard without extra dependencies: secrets must never reach a browser bundle.
if (typeof window !== "undefined") {
  throw new Error("server-env must not be imported in browser code.");
}

const intWithDefault = (def: number, min: number, max?: number) => {
  let n = z.coerce.number().int().min(min);
  if (max !== undefined) n = n.max(max);
  return z.preprocess(blankToUndefined, n.default(def));
};

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: optionalString(),
  AI_PROVIDER: z.preprocess(blankToUndefined, z.enum(["gemini", "openrouter"]).optional()),
  AI_BASE_URL: z.preprocess(blankToUndefined, z.url().optional()),
  AI_API_KEY: optionalString(),
  AI_MODEL: optionalString(),
  AI_VISION_MODEL: optionalString(),
  AI_TIMEOUT_MS: intWithDefault(20_000, 1),
  AI_MAX_TOOL_STEPS: intWithDefault(4, 1, 4),
  GUEST_CHAT_DAILY_LIMIT: intWithDefault(20, 0),
  GUEST_SCAN_DAILY_LIMIT: intWithDefault(5, 0),
  RECEIPT_MAX_BYTES: intWithDefault(5_242_880, 1),
  CSV_MAX_BYTES: intWithDefault(2_097_152, 1),
});

export type ServerEnv = z.output<typeof serverSchema>;

/** Validated server env. AI_* and the service-role key are optional at this stage. */
export function getServerEnv(source: EnvSource = process.env): ServerEnv {
  return parseEnv("server", serverSchema, source);
}

export type AiProvider = "gemini" | "openrouter";

export type AiConfigStatus =
  | {
      readonly configured: true;
      readonly provider: AiProvider;
      readonly baseUrl: string;
      readonly apiKey: string;
      readonly model: string;
      readonly visionModel: string;
      readonly timeoutMs: number;
      readonly maxToolSteps: number;
    }
  | { readonly configured: false; readonly missing: readonly string[] };

/** Reports whether AI can be used. `missing` lists variable names only, never values. */
export function getAiConfigStatus(env: ServerEnv = getServerEnv()): AiConfigStatus {
  const missing: string[] = [];
  if (!env.AI_PROVIDER) missing.push("AI_PROVIDER");
  if (!env.AI_BASE_URL) missing.push("AI_BASE_URL");
  if (!env.AI_API_KEY) missing.push("AI_API_KEY");
  if (!env.AI_MODEL) missing.push("AI_MODEL");
  if (!env.AI_VISION_MODEL) missing.push("AI_VISION_MODEL");
  if (
    missing.length > 0 ||
    !env.AI_PROVIDER ||
    !env.AI_BASE_URL ||
    !env.AI_API_KEY ||
    !env.AI_MODEL ||
    !env.AI_VISION_MODEL
  ) {
    return { configured: false, missing };
  }
  return {
    configured: true,
    provider: env.AI_PROVIDER,
    baseUrl: env.AI_BASE_URL,
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL,
    visionModel: env.AI_VISION_MODEL,
    timeoutMs: env.AI_TIMEOUT_MS,
    maxToolSteps: env.AI_MAX_TOOL_STEPS,
  };
}
