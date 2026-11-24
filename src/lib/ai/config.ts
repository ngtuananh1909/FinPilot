import { getAiConfigStatus, getServerEnv, type AiProvider, type ServerEnv } from "@/lib/config/server-env";
import { AppError } from "@/lib/errors";

/** Hard ceiling from docs/07: a chat request never runs more than 4 tool steps. */
export const MAX_TOOL_STEPS_CEILING = 4;

export interface AiRuntimeConfig {
  readonly provider: AiProvider;
  /** Normalised, always ends with "/". */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly visionModel: string;
  readonly timeoutMs: number;
  readonly maxToolSteps: number;
  /** Sent as OpenRouter attribution headers only. */
  readonly appUrl: string | null;
}

export function normaliseBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"))) {
    throw new AppError("ai_not_configured", { safeDetails: { variable: "AI_BASE_URL", rule: "https_required" } });
  }
  url.search = "";
  url.hash = "";
  return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
}

/**
 * Resolves the active provider configuration. Missing variables raise `ai_not_configured`
 * (503) listing variable NAMES only. No model, URL or key is ever defaulted in code.
 */
export function getAiRuntimeConfig(env: ServerEnv = getServerEnv(), appUrl: string | null = null): AiRuntimeConfig {
  const status = getAiConfigStatus(env);
  if (!status.configured) {
    throw new AppError("ai_not_configured", { safeDetails: { missing: status.missing.join(",") } });
  }
  let baseUrl: string;
  try {
    baseUrl = normaliseBaseUrl(status.baseUrl);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("ai_not_configured", { safeDetails: { variable: "AI_BASE_URL", rule: "invalid_url" } });
  }
  return {
    provider: status.provider,
    baseUrl,
    apiKey: status.apiKey,
    model: status.model,
    visionModel: status.visionModel,
    timeoutMs: status.timeoutMs,
    maxToolSteps: Math.min(Math.max(1, status.maxToolSteps), MAX_TOOL_STEPS_CEILING),
    appUrl,
  };
}

/** Non-throwing variant for UI state: true when every AI variable is present. */
export function isAiConfigured(env: ServerEnv = getServerEnv()): boolean {
  return getAiConfigStatus(env).configured;
}
