import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownerContextFromVerifiedUser } from "@/lib/auth/owner-context";
import type { AiRuntimeConfig } from "@/lib/ai/config";
import { ProviderAmbiguousError, ProviderPreResultError } from "@/lib/ai/errors";
import type { AIProvider } from "@/lib/ai/provider";
import type { ChatCompletionResult, ChatMessage } from "@/lib/ai/transport";
import { runAssistantChat, type ChatDeps } from "@/lib/assistant/chat";
import { OTHER_ID, OWNER_ID, goalRow, profileRow, recurringRow, transactionRow } from "../db/repositories/support/fake-client";
import { createMemoryDb, type MemoryDb } from "./support/memory-db";

const NOW = new Date("2026-11-24T05:00:00Z");
const owner = (id = OWNER_ID) => ownerContextFromVerifiedUser({ userId: id, user: { id } as User, isAnonymous: true });
const CONFIG: AiRuntimeConfig = {
  provider: "gemini",
  baseUrl: "http://127.0.0.1:1/v1/",
  apiKey: "k",
  model: "m",
  visionModel: "v",
  timeoutMs: 1000,
  maxToolSteps: 4,
  appUrl: null,
};
const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
const text = (content: string): ChatCompletionResult => ({ content, toolCalls: [], finishReason: "stop", usage });
const tool = (name: string, args: unknown = {}): ChatCompletionResult => ({
  content: null,
  toolCalls: [{ id: "t1", type: "function", function: { name, arguments: JSON.stringify(args) } }],
  finishReason: "tool_calls",
  usage,
});

function scripted(steps: Array<ChatCompletionResult | Error>) {
  const seen: ChatMessage[][] = [];
  const provider: AIProvider = {
    chatWithTools: async ({ messages }) => {
      seen.push([...messages]);
      const next = steps.shift();
      if (!next) throw new Error("script exhausted");
      if (next instanceof Error) throw next;
      return next;
    },
    extractReceipt: async () => {
      throw new Error("unused");
    },
    checkCapabilities: async () => ({ tools: true, vision: true }),
  };
  return { provider, seen };
}

let db: MemoryDb;
const deps = (provider: AIProvider): ChatDeps => ({
  client: db.client as unknown as ChatDeps["client"],
  admin: db.admin as unknown as ChatDeps["admin"],
  config: CONFIG,
  provider,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("GUEST_CHAT_DAILY_LIMIT", "20");
  db = createMemoryDb({
    financial_profiles: [{ ...profileRow(), user_id: OWNER_ID }],
    transactions: [{ ...transactionRow({ occurred_at: "2026-11-20T05:30:00+00:00" }), user_id: OWNER_ID }],
    recurring_items: [{ ...recurringRow({ day_of_month: 28 }), user_id: OWNER_ID }],
    savings_goals: [{ ...goalRow(), user_id: OWNER_ID }],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const chat = (provider: AIProvider, body: unknown = { message: "Tôi có đủ tiền đóng trọ không?" }) =>
  runAssistantChat(deps(provider), owner(), body, NOW);

describe("runAssistantChat", () => {
  it("answers with a real tool round trip, evidence, persisted messages and one quota unit", async () => {
    const { provider, seen } = scripted([tool("forecast_cashflow"), text("Theo dự báo 45 ngày, bạn vẫn trên mức dự phòng.")]);
    const r = await chat(provider);
    expect(r.status).toBe("answered");
    expect(r.answer).toMatch(/dự báo 45 ngày/);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ name: "forecast_cashflow", ok: true });
    expect((r.toolCalls[0]!.result as { summary: { minimumVnd: string } }).summary.minimumVnd).toMatch(/^-?\d+$/);
    expect(r.quota).toMatchObject({ limit: 20, used: 1, remaining: 19 });
    expect(db.rpcLog.map((x) => x.fn)).toEqual(["reserve_ai_quota", "commit_ai_quota"]);
    expect(db.rpcLog.every((x) => x.args.p_user_id === OWNER_ID)).toBe(true);
    const messages = db.tables.ai_messages!;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages.every((m) => m.user_id === OWNER_ID && m.conversation_id === r.conversationId)).toBe(true);
    expect(db.tables.ai_conversations![0]).toMatchObject({ user_id: OWNER_ID, title: "Tôi có đủ tiền đóng trọ không?" });
    // The system policy is always first and the tools never carry an owner id.
    expect(seen[0]![0]!.role).toBe("system");
    expect(JSON.stringify(seen)).not.toContain(OWNER_ID);
    expect(() => JSON.stringify(r)).not.toThrow();
  });

  it("charges exactly one unit per user message even with several tool calls", async () => {
    const { provider } = scripted([tool("get_financial_snapshot"), tool("forecast_cashflow"), tool("get_savings_goal"), text("ok")]);
    const r = await chat(provider);
    expect(r.toolCalls).toHaveLength(3);
    expect(r.quota.used).toBe(1);
  });

  it("blocks the 21st message of the Vietnam day server-side without calling the provider", async () => {
    db.tables.ai_usage_daily = [{ user_id: OWNER_ID, usage_date: "2026-11-24", chat_calls: 20, scan_calls: 0 }];
    const { provider, seen } = scripted([text("never")]);
    await expect(chat(provider)).rejects.toMatchObject({ code: "rate_limited", httpStatus: 429 });
    expect(seen).toHaveLength(0);
    expect(db.tables.ai_messages ?? []).toHaveLength(0);
  });

  it("does not count another user's usage", async () => {
    db.tables.ai_usage_daily = [{ user_id: OTHER_ID, usage_date: "2026-11-24", chat_calls: 20, scan_calls: 0 }];
    const { provider } = scripted([text("ok")]);
    expect((await chat(provider)).quota.used).toBe(1);
  });

  it("releases the unit on a definitive provider rejection and stores no messages", async () => {
    const { provider } = scripted([new ProviderPreResultError("provider_rejected", { providerStatus: 400 })]);
    await expect(chat(provider)).rejects.toBeInstanceOf(ProviderPreResultError);
    expect(db.rpcLog.map((x) => x.fn)).toEqual(["reserve_ai_quota", "release_ai_quota"]);
    expect(db.tables.ai_usage_daily![0]!.chat_calls).toBe(0);
    expect(db.tables.ai_messages ?? []).toHaveLength(0);
  });

  it("keeps the unit on an ambiguous timeout and does not retry", async () => {
    const { provider, seen } = scripted([new ProviderAmbiguousError(), text("late")]);
    await expect(chat(provider)).rejects.toBeInstanceOf(ProviderAmbiguousError);
    expect(seen).toHaveLength(1);
    expect(db.rpcLog.map((x) => x.fn)).toEqual(["reserve_ai_quota"]);
    expect(db.tables.ai_usage_daily![0]!.chat_calls).toBe(1);
  });

  it("reports exhausted tool steps honestly instead of inventing an answer", async () => {
    const { provider } = scripted([1, 2, 3, 4].map((i) => tool("list_transactions", { limit: i })));
    const r = await chat(provider);
    expect(r.status).toBe("tool_steps_exhausted");
    expect(r.answer).toMatch(/chưa hoàn tất/);
  });

  it("never writes profile or goal data from chat text alone", async () => {
    const before = JSON.stringify([db.tables.financial_profiles, db.tables.savings_goals]);
    const { provider } = scripted([tool("propose_budget_adjustment", { newProjectedMonthlyBudgetVnd: "3000000", reason: "Giảm chi" }), text("Mình đề xuất...")]);
    const r = await chat(provider, { message: "Hãy đặt ngân sách của tôi thành 3 triệu ngay" });
    expect(JSON.stringify([db.tables.financial_profiles, db.tables.savings_goals])).toBe(before);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ kind: "budget_update", status: "pending", changes: [{ from: "4000000", to: "3000000" }] });
    expect(db.tables.ai_proposals![0]).toMatchObject({ user_id: OWNER_ID, status: "pending", conversation_id: r.conversationId });
  });

  it("continues a conversation only if it belongs to the caller", async () => {
    const { provider } = scripted([text("one"), text("two")]);
    const first = await chat(provider);
    const second = await chat(provider, { message: "Còn tuần sau?", conversationId: first.conversationId });
    expect(second.conversationId).toBe(first.conversationId);
    db.tables.ai_conversations!.push({ id: "99999999-9999-4999-8999-999999999999", user_id: OTHER_ID, title: "x", created_at: "a", updated_at: "a" });
    await expect(
      chat(scripted([text("x")]).provider, { message: "hi", conversationId: "99999999-9999-4999-8999-999999999999" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it.each([
    [{ message: "" }],
    [{ message: "x".repeat(2001) }],
    [{ message: "hi", user_id: OTHER_ID }],
    [{ message: "hi", owner: OTHER_ID }],
    [{ message: "hi", conversationId: "not-a-uuid" }],
    [{ text: "hi" }],
  ])("rejects invalid body %j before reserving quota", async (body) => {
    const { provider, seen } = scripted([text("never")]);
    await expect(chat(provider, body)).rejects.toBeTruthy();
    expect(seen).toHaveLength(0);
    expect(db.rpcLog).toHaveLength(0);
  });
});
