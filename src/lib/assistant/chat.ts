import { z } from "zod";
import type { OwnerContext } from "@/lib/auth/owner-context";
import type { AiRuntimeConfig } from "@/lib/ai/config";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/ai/policy";
import { createProvider, type AIProvider } from "@/lib/ai/provider";
import { runToolLoop, type ExecutedToolCall } from "@/lib/ai/tool-loop";
import type { ChatMessage } from "@/lib/ai/transport";
import { ALL_TOOLS } from "@/lib/ai/tools/definitions";
import { createToolExecutor } from "@/lib/ai/tools/registry";
import { parseInput, uuidSchema } from "@/lib/db/inputs";
import type { DbClient } from "@/lib/db/repositories/shared";
import {
  HISTORY_FOR_CONTEXT,
  appendMessages,
  createConversation,
  getConversation,
  listMessages,
} from "@/lib/db/repositories/server-only/ai-chat";
import { getAiUsage } from "@/lib/db/repositories/server-only/ai-data";
import { quotaLimitFor, withAiQuota } from "@/lib/db/repositories/server-only/quota";
import type { RpcClient } from "@/lib/db/repositories/server-only/rpc";
import type { DbJson } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { localDateOf } from "@/lib/finance";
import { createProposalFromTool, type ProposalDto } from "./proposals";
import { MAX_QUESTION_CHARS } from "./question";

export const chatBodySchema = z
  .object({
    message: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
    conversationId: uuidSchema.optional(),
  })
  .strict();

export interface ChatDeps {
  /** Caller's RLS client. */
  readonly client: DbClient;
  /** Service-role client, created after requireOwner(): quota RPCs, message and proposal writes. */
  readonly admin: DbClient & RpcClient;
  readonly config: AiRuntimeConfig;
  /** Injectable for tests; defaults to the real HTTP provider. */
  readonly provider?: AIProvider;
}

/** Evidence shown under an answer: which tool ran, with what, and its typed result. */
export interface ToolEvidenceDto {
  name: string;
  args: unknown;
  ok: boolean;
  error: string | null;
  result: unknown;
  cached: boolean;
}

export interface QuotaDto {
  kind: "chat";
  limit: number;
  used: number;
  remaining: number;
  usageDate: string;
}

export interface ChatResponseDto {
  conversationId: string;
  status: "answered" | "tool_steps_exhausted" | "empty_answer";
  answer: string;
  toolCalls: ToolEvidenceDto[];
  proposals: ProposalDto[];
  quota: QuotaDto;
}

const NO_ANSWER: Record<"tool_steps_exhausted" | "empty_answer", string> = {
  tool_steps_exhausted:
    "Trợ lý chưa hoàn tất câu trả lời trong giới hạn số bước tra cứu. Bạn có thể hỏi cụ thể hơn (ví dụ một khoản chi hoặc một ngày) rồi thử lại.",
  empty_answer: "Trợ lý không trả về nội dung. Vui lòng thử lại.",
};

const evidence = (c: ExecutedToolCall): ToolEvidenceDto => ({
  name: c.name,
  args: c.args,
  ok: c.outcome.ok,
  error: c.outcome.ok ? null : c.outcome.error,
  result: c.outcome.ok ? c.outcome.data : null,
  cached: c.cached,
});

export async function readChatQuota(client: DbClient, owner: OwnerContext, now: Date): Promise<QuotaDto> {
  const limit = quotaLimitFor("chat");
  const usageDate = localDateOf(now);
  const usage = await getAiUsage(client, owner, usageDate);
  return { kind: "chat", limit, used: usage.chatCalls, remaining: Math.max(0, limit - usage.chatCalls), usageDate };
}

/**
 * One user turn. The owner comes from the verified session; the body only carries the text and
 * an optional conversation id (checked for ownership). Exactly one quota unit is reserved for
 * the whole turn (tool calls inside it are free), released on a definitive pre-result provider
 * failure and kept on an ambiguous timeout. Nothing is persisted when the AI call fails.
 */
export async function runAssistantChat(deps: ChatDeps, owner: OwnerContext, body: unknown, now: Date): Promise<ChatResponseDto> {
  const input = parseInput(chatBodySchema, body);

  let conversationId: string | null = null;
  let history: ChatMessage[] = [];
  if (input.conversationId) {
    const conv = await getConversation(deps.client, owner, input.conversationId);
    if (!conv) throw new AppError("not_found", { userMessage: "Không tìm thấy cuộc trò chuyện này." });
    conversationId = conv.id;
    const recent = await listMessages(deps.client, owner, conv.id, HISTORY_FOR_CONTEXT);
    history = recent.map((m): ChatMessage => (m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content }));
  }

  const provider = deps.provider ?? createProvider(deps.config);
  const proposals: ProposalDto[] = [];

  const result = await withAiQuota(
    owner,
    "chat",
    async () => {
      // Generic title until an answer exists, so a failed call leaves no message text behind.
      if (!conversationId) conversationId = (await createConversation(deps.admin, owner, "")).id;
      const convId = conversationId;
      const executeTool = createToolExecutor({ client: deps.client, owner, now }, (name, args) =>
        createProposalFromTool({ client: deps.client, admin: deps.admin }, owner, now, convId, name, args, proposals),
      );
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: `${ASSISTANT_SYSTEM_PROMPT}\nHôm nay (giờ Việt Nam): ${localDateOf(now)}.`,
        },
        ...history,
        { role: "user", content: input.message },
      ];
      return runToolLoop({ provider, messages, tools: ALL_TOOLS, executeTool, maxSteps: deps.config.maxToolSteps });
    },
    { client: deps.admin },
  );

  const convId = conversationId as unknown as string;
  const isNewConversation = !input.conversationId;
  const answer = result.status === "answered" && result.finalText ? result.finalText : NO_ANSWER[result.status as keyof typeof NO_ANSWER];
  const toolCalls = result.toolCalls.map(evidence);
  await appendMessages(deps.admin, owner, convId, [
    { role: "user", content: input.message },
    {
      role: "assistant",
      content: answer,
      toolResult: { status: result.status, toolCalls, proposalIds: proposals.map((p) => p.id) } as unknown as DbJson,
    },
  ], isNewConversation ? { titleFromMessage: input.message } : {});

  return {
    conversationId: convId,
    status: result.status,
    answer,
    toolCalls,
    proposals,
    quota: await readChatQuota(deps.client, owner, now),
  };
}
