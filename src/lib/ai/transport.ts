import { z } from "zod";
import type { AiRuntimeConfig } from "./config";
import { ProviderAmbiguousError, ProviderPreResultError } from "./errors";

/**
 * One OpenAI-compatible chat-completions transport for Gemini (its documented
 * OpenAI-compatible endpoint) and OpenRouter. Plain fetch, no vendor SDK, non-streaming.
 *
 * Error policy (drives withAiQuota):
 *  - 400/401/403/404/422 and "model does not support tools/images" -> ProviderPreResultError
 *    (definitive rejection, nothing produced, quota released).
 *  - 429 -> ProviderPreResultError("rate_limited"): the provider refused the request.
 *  - 503 -> ProviderPreResultError("provider_overloaded"): an explicit "UNAVAILABLE / high demand"
 *    refusal, nothing was generated. This is the ONLY retried case: at most one retry, after
 *    OVERLOAD_RETRY_DELAY_MS, and only if the timeout budget allows it.
 *  - timeout, network failure, other 5xx, oversized/truncated/invalid body -> ProviderAmbiguousError
 *    (the call may have been processed and billed: quota kept, no retry).
 *  - Gemini thinking models spend output tokens on reasoning before answering, so the output cap
 *    is generous (unused tokens are not billed) and Gemini requests ask for low reasoning effort.
 * The API key and Authorization header never appear in thrown errors or logs.
 */

export const MAX_RESPONSE_BYTES = 1_048_576;
export const MAX_OUTPUT_TOKENS = 4_096;
export const OVERLOAD_RETRY_DELAY_MS = 1_500;
export const PROVIDER_ERROR_TEXT_CAP = 200;

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ToolCallRequest {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
  /**
   * Opaque provider metadata that must be echoed back unchanged on the next request. Gemini 3+
   * puts the required `thought_signature` here; without it the follow-up call fails with 400.
   * Never shown to users or logged; bounded in size.
   */
  readonly extra_content?: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCallRequest[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly responseFormatJson?: boolean;
  readonly maxTokens?: number;
}

export interface ChatUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ChatCompletionResult {
  readonly content: string | null;
  readonly toolCalls: readonly ToolCallRequest[];
  readonly finishReason: string | null;
  readonly usage: ChatUsage;
}

export const MAX_EXTRA_CONTENT_CHARS = 16_384;

const toolCallSchema = z.object({
  id: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  function: z.object({ name: z.string().min(1).max(64), arguments: z.string().max(20_000).optional().nullable() }),
  extra_content: z.record(z.string(), z.unknown()).optional().nullable(),
});

const contentSchema = z.union([
  z.string(),
  z.null(),
  z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()),
]);

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: contentSchema.optional(),
          tool_calls: z.array(toolCallSchema).max(16).optional().nullable(),
        }),
        finish_reason: z.string().optional().nullable(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().min(0).optional(),
      completion_tokens: z.number().int().min(0).optional(),
      total_tokens: z.number().int().min(0).optional(),
    })
    .optional()
    .nullable(),
});

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Removes the key (and any Bearer token echo) from text that may come from the provider. */
export function redact(text: string, secret: string): string {
  let out = text;
  if (secret.length >= 4) out = out.split(secret).join("[redacted]");
  return out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]").slice(0, PROVIDER_ERROR_TEXT_CAP);
}

const UNSUPPORTED = /(does not support|not support(ed)?|unsupported).{0,40}(tool|function|image|vision|multimodal)|(tool|function|image|vision).{0,40}(not support|unsupported)/i;

async function readCapped(response: Response, cap: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderAmbiguousError({ reason: "invalid_response", cause: new Error("response_too_large") });
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function headersFor(config: AiRuntimeConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${config.apiKey}`,
  };
  if (config.provider === "openrouter") {
    headers["x-title"] = "FinPilot AI";
    if (config.appUrl) headers["http-referer"] = config.appUrl;
  }
  return headers;
}

function contentToText(content: z.infer<typeof contentSchema> | undefined): string | null {
  if (content === undefined || content === null) return null;
  if (typeof content === "string") return content;
  const text = content.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
  return text.length > 0 ? text : null;
}

export async function createChatCompletion(
  config: AiRuntimeConfig,
  request: ChatCompletionRequest,
  fetchImpl: FetchLike = fetch,
): Promise<ChatCompletionResult> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: 0.2,
    max_tokens: Math.min(request.maxTokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
    stream: false,
  };
  if (config.provider === "gemini") body.reasoning_effort = "low";
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
    body.tool_choice = "auto";
  }
  if (request.responseFormatJson) body.response_format = { type: "json_object" };

  const deadline = Date.now() + config.timeoutMs;
  try {
    return await attempt(config, body, fetchImpl, config.timeoutMs);
  } catch (error) {
    const remaining = deadline - Date.now() - OVERLOAD_RETRY_DELAY_MS;
    if (!(error instanceof ProviderPreResultError) || error.reason !== "provider_overloaded" || remaining < 2_000) throw error;
    await new Promise((resolve) => setTimeout(resolve, OVERLOAD_RETRY_DELAY_MS));
    return attempt(config, body, fetchImpl, remaining);
  }
}

async function attempt(
  config: AiRuntimeConfig,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<ChatCompletionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  let text: string;
  try {
    try {
      response = await fetchImpl(`${config.baseUrl}chat/completions`, {
        method: "POST",
        headers: headersFor(config),
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
    } catch (cause) {
      const timedOut = controller.signal.aborted;
      throw new ProviderAmbiguousError({
        reason: timedOut ? "ambiguous_timeout" : "network",
        cause: new Error(redact(cause instanceof Error ? cause.message : "fetch_failed", config.apiKey)),
      });
    }
    try {
      text = await readCapped(response, MAX_RESPONSE_BYTES);
    } catch (cause) {
      if (cause instanceof ProviderAmbiguousError) throw cause;
      throw new ProviderAmbiguousError({ reason: controller.signal.aborted ? "ambiguous_timeout" : "network" });
    }
  } finally {
    clearTimeout(timer);
  }

  const status = response.status;
  if (status === 429) throw new ProviderPreResultError("rate_limited", { providerStatus: status });
  if (status === 503) throw new ProviderPreResultError("provider_overloaded", { providerStatus: status });
  if (status >= 500) throw new ProviderAmbiguousError({ reason: "server_error", providerStatus: status });
  if (status >= 400) {
    const hint = redact(text, config.apiKey);
    if (UNSUPPORTED.test(hint)) {
      throw new ProviderPreResultError("unsupported_capability", { providerStatus: status, cause: new Error(hint) });
    }
    throw new ProviderPreResultError(status === 401 || status === 403 ? "invalid_config" : "provider_rejected", {
      providerStatus: status,
      cause: new Error(hint),
    });
  }
  if (status < 200 || status >= 300) throw new ProviderAmbiguousError({ reason: "invalid_response", providerStatus: status });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderAmbiguousError({ reason: "invalid_response" });
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw new ProviderAmbiguousError({ reason: "invalid_response" });

  const choice = parsed.data.choices[0]!;
  const toolCalls: ToolCallRequest[] = (choice.message.tool_calls ?? []).map((call, index) => {
    const extra = call.extra_content ?? null;
    if (extra && JSON.stringify(extra).length > MAX_EXTRA_CONTENT_CHARS) {
      throw new ProviderAmbiguousError({ reason: "invalid_response", cause: new Error("extra_content_too_large") });
    }
    return {
      id: call.id && call.id.length > 0 && call.id.length <= 100 ? call.id : `call_${index + 1}`,
      type: "function",
      function: { name: call.function.name, arguments: call.function.arguments ?? "{}" },
      ...(extra ? { extra_content: extra } : {}),
    };
  });
  const usage = parsed.data.usage ?? {};
  return {
    content: contentToText(choice.message.content),
    toolCalls,
    finishReason: choice.finish_reason ?? null,
    usage: {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
    },
  };
}
