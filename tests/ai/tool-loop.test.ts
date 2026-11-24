import { describe, expect, it } from "vitest";
import type { AIProvider } from "@/lib/ai/provider";
import { runToolLoop, type ToolOutcome } from "@/lib/ai/tool-loop";
import type { ChatCompletionResult, ChatMessage, ToolDefinition } from "@/lib/ai/transport";

const tool = (name: string): ToolDefinition => ({ type: "function", function: { name, description: name, parameters: { type: "object" } } });
const TOOLS = [tool("forecast_cashflow"), tool("get_savings_goal")];
const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
const text = (content: string): ChatCompletionResult => ({ content, toolCalls: [], finishReason: "stop", usage });
const calls = (...c: Array<[string, string]>): ChatCompletionResult => ({
  content: null,
  toolCalls: c.map(([name, args], i) => ({ id: `c${i}`, type: "function", function: { name, arguments: args } })),
  finishReason: "tool_calls",
  usage,
});

function scripted(responses: ChatCompletionResult[]) {
  const seen: ChatMessage[][] = [];
  const provider: AIProvider = {
    chatWithTools: async ({ messages }) => {
      seen.push([...messages]);
      const next = responses.shift();
      if (!next) throw new Error("no more scripted responses");
      return next;
    },
    extractReceipt: async () => {
      throw new Error("unused");
    },
    checkCapabilities: async () => ({ tools: true, vision: true }),
  };
  return { provider, seen };
}

const base = [{ role: "user", content: "Tôi có đủ tiền đóng trọ không?" }] as ChatMessage[];

describe("runToolLoop", () => {
  it("answers directly when no tool is requested", async () => {
    const { provider } = scripted([text("Chào bạn")]);
    const r = await runToolLoop({ provider, messages: base, tools: TOOLS, executeTool: async () => ({ ok: true, data: 1 }), maxSteps: 4 });
    expect(r).toMatchObject({ status: "answered", finalText: "Chào bạn", steps: 1, toolCalls: [] });
  });

  it("executes a tool, feeds the result back as role tool, then answers", async () => {
    const { provider, seen } = scripted([calls(["forecast_cashflow", "{}"]), text("Theo dự báo 45 ngày...")]);
    const executed: string[] = [];
    const r = await runToolLoop({
      provider,
      messages: base,
      tools: TOOLS,
      executeTool: async (name) => {
        executed.push(name);
        return { ok: true, data: { minimumVnd: "150000" } };
      },
      maxSteps: 4,
    });
    expect(r.status).toBe("answered");
    expect(executed).toEqual(["forecast_cashflow"]);
    const second = seen[1]!;
    expect(second.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ id: "c0" }] });
    expect(second.at(-1)).toEqual({ role: "tool", tool_call_id: "c0", content: JSON.stringify({ ok: true, data: { minimumVnd: "150000" } }) });
    expect(r.toolCalls[0]).toMatchObject({ name: "forecast_cashflow", cached: false, step: 1 });
    expect(r.usage.totalTokens).toBe(4);
  });

  it("echoes the provider's tool-call metadata (thought signature) back unchanged on the next step", async () => {
    const withSig: ChatCompletionResult = {
      content: null,
      toolCalls: [{ id: "c0", type: "function", function: { name: "forecast_cashflow", arguments: "{}" }, extra_content: { google: { thought_signature: "sig-1" } } }],
      finishReason: "tool_calls",
      usage,
    };
    const { provider, seen } = scripted([withSig, text("ok")]);
    await runToolLoop({ provider, messages: base, tools: TOOLS, executeTool: async () => ({ ok: true, data: 1 }), maxSteps: 4 });
    const assistant = seen[1]!.find((m) => m.role === "assistant") as { tool_calls: Array<{ extra_content?: unknown }> };
    expect(assistant.tool_calls[0]!.extra_content).toEqual({ google: { thought_signature: "sig-1" } });
  });

  it("returns errors to the model for unknown tools and invalid JSON args without executing them", async () => {
    const { provider } = scripted([calls(["drop_tables", "{}"], ["forecast_cashflow", "{not json"], ["get_savings_goal", "[1]"]), text("ok")]);
    let executions = 0;
    const r = await runToolLoop({
      provider,
      messages: base,
      tools: TOOLS,
      executeTool: async () => {
        executions += 1;
        return { ok: true, data: null };
      },
      maxSteps: 4,
    });
    expect(executions).toBe(0);
    expect(r.toolCalls.map((c) => c.outcome)).toEqual([
      { ok: false, error: "unknown_tool" },
      { ok: false, error: "invalid_arguments" },
      { ok: false, error: "invalid_arguments" },
    ]);
  });

  it("serves an identical repeated call from the per-loop cache", async () => {
    const { provider } = scripted([calls(["forecast_cashflow", "{}"]), calls(["forecast_cashflow", "{}"]), text("done")]);
    let executions = 0;
    const r = await runToolLoop({
      provider,
      messages: base,
      tools: TOOLS,
      executeTool: async () => {
        executions += 1;
        return { ok: true, data: 42 };
      },
      maxSteps: 4,
    });
    expect(executions).toBe(1);
    expect(r.toolCalls.map((c) => c.cached)).toEqual([false, true]);
  });

  it("stops after maxSteps with tool_steps_exhausted and NO fabricated answer", async () => {
    const loopForever = Array.from({ length: 10 }, (_, i) => calls(["get_savings_goal", JSON.stringify({ i })]));
    const { provider, seen } = scripted(loopForever);
    const r = await runToolLoop({ provider, messages: base, tools: TOOLS, executeTool: async () => ({ ok: true, data: 0 }), maxSteps: 3 });
    expect(r).toMatchObject({ status: "tool_steps_exhausted", finalText: null, steps: 3 });
    expect(seen).toHaveLength(3);
  });

  it("caps maxSteps at 4 even when asked for more", async () => {
    const { provider, seen } = scripted(Array.from({ length: 10 }, (_, i) => calls(["get_savings_goal", JSON.stringify({ i })])));
    await runToolLoop({ provider, messages: base, tools: TOOLS, executeTool: async () => ({ ok: true, data: 0 }), maxSteps: 99 });
    expect(seen).toHaveLength(4);
  });

  it("reports an empty model answer instead of inventing one", async () => {
    const { provider } = scripted([text("   ")]);
    const r = await runToolLoop({ provider, messages: base, tools: TOOLS, executeTool: async () => ({ ok: true, data: 0 }), maxSteps: 4 });
    expect(r).toMatchObject({ status: "empty_answer", finalText: null });
  });

  it("turns a throwing tool into a tool_failed result", async () => {
    const { provider } = scripted([calls(["forecast_cashflow", "{}"]), text("x")]);
    const r = await runToolLoop({
      provider,
      messages: base,
      tools: TOOLS,
      executeTool: async (): Promise<ToolOutcome> => {
        throw new Error("db down");
      },
      maxSteps: 4,
    });
    expect(r.toolCalls[0]!.outcome).toEqual({ ok: false, error: "tool_failed" });
  });

  it("propagates provider errors (the route decides quota handling)", async () => {
    const provider: AIProvider = {
      chatWithTools: async () => {
        throw new Error("provider down");
      },
      extractReceipt: async () => {
        throw new Error("unused");
      },
      checkCapabilities: async () => ({ tools: false, vision: false }),
    };
    await expect(runToolLoop({ provider, messages: base, tools: TOOLS, executeTool: async () => ({ ok: true, data: 0 }), maxSteps: 2 })).rejects.toThrow(
      "provider down",
    );
  });
});
