import { MAX_TOOL_STEPS_CEILING } from "./config";
import type { AIProvider } from "./provider";
import type { ChatMessage, ChatUsage, ToolCallRequest, ToolDefinition } from "./transport";

/** Result a tool handler returns to the loop. `data` must be JSON-serialisable (no bigint). */
export type ToolOutcome =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: string };

export interface ExecutedToolCall {
  readonly name: string;
  /** Parsed arguments (or null if they were not valid JSON). */
  readonly args: unknown;
  readonly outcome: ToolOutcome;
  readonly cached: boolean;
  readonly step: number;
}

export interface ToolLoopResult {
  readonly status: "answered" | "tool_steps_exhausted" | "empty_answer";
  /** Final model text; null when the step limit was hit before an answer. Never fabricated. */
  readonly finalText: string | null;
  readonly toolCalls: readonly ExecutedToolCall[];
  readonly usage: ChatUsage;
  readonly steps: number;
}

export interface ToolLoopInput {
  readonly provider: AIProvider;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly executeTool: (name: string, args: unknown) => Promise<ToolOutcome>;
  readonly maxSteps: number;
}

const MAX_TOOL_RESULT_CHARS = 12_000;

function serialiseOutcome(outcome: ToolOutcome): string {
  const text = JSON.stringify(outcome.ok ? { ok: true, data: outcome.data } : { ok: false, error: outcome.error });
  return text.length <= MAX_TOOL_RESULT_CHARS
    ? text
    : JSON.stringify({ ok: false, error: "tool_result_too_large" });
}

/**
 * Bounded tool-calling loop. Each step sends the conversation; if the model requests tools,
 * they run through `executeTool` (which validates arguments and derives the owner itself) and
 * their results are appended as `role: "tool"` messages. Stops at the first plain answer or
 * after `maxSteps` model calls (capped at 4). Identical repeated calls reuse the first result.
 */
export async function runToolLoop(input: ToolLoopInput): Promise<ToolLoopResult> {
  const maxSteps = Math.min(Math.max(1, Math.trunc(input.maxSteps) || 1), MAX_TOOL_STEPS_CEILING);
  const knownTools = new Set(input.tools.map((t) => t.function.name));
  const messages: ChatMessage[] = [...input.messages];
  const executed: ExecutedToolCall[] = [];
  const cache = new Map<string, ToolOutcome>();
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (let step = 1; step <= maxSteps; step += 1) {
    const result = await input.provider.chatWithTools({ messages }, input.tools);
    usage.promptTokens += result.usage.promptTokens;
    usage.completionTokens += result.usage.completionTokens;
    usage.totalTokens += result.usage.totalTokens;

    if (result.toolCalls.length === 0) {
      const text = result.content?.trim() ?? "";
      if (text.length === 0) return { status: "empty_answer", finalText: null, toolCalls: executed, usage, steps: step };
      return { status: "answered", finalText: text, toolCalls: executed, usage, steps: step };
    }

    const calls: ToolCallRequest[] = result.toolCalls.slice(0, 8);
    messages.push({ role: "assistant", content: result.content, tool_calls: calls });
    for (const call of calls) {
      const name = call.function.name;
      let args: unknown = null;
      let outcome: ToolOutcome;
      let cached = false;
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = null;
      }
      if (!knownTools.has(name)) {
        outcome = { ok: false, error: "unknown_tool" };
      } else if (args === null || typeof args !== "object" || Array.isArray(args)) {
        outcome = { ok: false, error: "invalid_arguments" };
      } else {
        const key = `${name}:${JSON.stringify(args)}`;
        const hit = cache.get(key);
        if (hit) {
          outcome = hit;
          cached = true;
        } else {
          try {
            outcome = await input.executeTool(name, args);
          } catch {
            outcome = { ok: false, error: "tool_failed" };
          }
          cache.set(key, outcome);
        }
      }
      executed.push({ name, args, outcome, cached, step });
      messages.push({ role: "tool", tool_call_id: call.id, content: serialiseOutcome(outcome) });
    }
  }
  return { status: "tool_steps_exhausted", finalText: null, toolCalls: executed, usage, steps: maxSteps };
}
