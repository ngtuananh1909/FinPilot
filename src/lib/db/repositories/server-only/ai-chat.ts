import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OwnerContext } from "@/lib/auth/owner-context";
import { DbError } from "../../errors";
import { parseInput, uuidSchema } from "../../inputs";
import type { DbJson } from "../../schema";
import { ownerIdOf, throwIfError } from "../shared";
import { assertServerRuntime } from "./guard";

/**
 * Conversation storage. Clients may only SELECT these tables (RLS + grants), so every WRITE
 * here takes the service-role client, created by the route AFTER requireOwner(). Every row is
 * written with `user_id = owner.userId`; reads use the caller's RLS client and are also
 * filtered by user_id. Message history is kept short to minimise retained private data.
 */

type FromClient = Pick<SupabaseClient, "from">;

export const MAX_MESSAGE_CHARS = 4000;
export const HISTORY_FOR_CONTEXT = 12;

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResult: unknown;
  createdAt: string;
}

const conversationRow = z.object({ id: z.uuid(), title: z.string(), created_at: z.string(), updated_at: z.string() });
const messageRow = z.object({
  id: z.uuid(),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
  tool_result: z.unknown().optional(),
  created_at: z.string(),
});

const mapConversation = (row: unknown): ConversationRecord => {
  const r = conversationRow.safeParse(row);
  if (!r.success) throw new DbError("db_row_invalid", { safeDetails: { table: "ai_conversations", rule: "shape" } });
  return { id: r.data.id, title: r.data.title, createdAt: r.data.created_at, updatedAt: r.data.updated_at };
};

const titleFrom = (message: string): string => {
  const t = message.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "Cuộc trò chuyện";
};

export async function createConversation(admin: FromClient, owner: OwnerContext, firstMessage: string): Promise<ConversationRecord> {
  assertServerRuntime();
  const userId = ownerIdOf(owner);
  const { data, error } = await admin
    .from("ai_conversations")
    .insert({ user_id: userId, title: titleFrom(firstMessage) })
    .select("id,title,created_at,updated_at")
    .single();
  throwIfError(error);
  return mapConversation(data);
}

/** Null when the id does not exist OR belongs to someone else (no existence leak). */
export async function getConversation(client: FromClient, owner: OwnerContext, id: unknown): Promise<ConversationRecord | null> {
  const userId = ownerIdOf(owner);
  const conversationId = parseInput(uuidSchema, id);
  const { data, error } = await client
    .from("ai_conversations")
    .select("id,title,created_at,updated_at")
    .eq("user_id", userId)
    .eq("id", conversationId)
    .maybeSingle();
  throwIfError(error);
  return data ? mapConversation(data) : null;
}

export async function listConversations(client: FromClient, owner: OwnerContext, limit = 20): Promise<ConversationRecord[]> {
  const userId = ownerIdOf(owner);
  const { data, error } = await client
    .from("ai_conversations")
    .select("id,title,created_at,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 50));
  throwIfError(error);
  return (data ?? []).map(mapConversation);
}

/** Most recent messages, returned oldest-first. Only user/assistant turns are exposed. */
export async function listMessages(
  client: FromClient,
  owner: OwnerContext,
  conversationId: string,
  limit = 50,
): Promise<MessageRecord[]> {
  const userId = ownerIdOf(owner);
  const id = parseInput(uuidSchema, conversationId);
  const { data, error } = await client
    .from("ai_messages")
    .select("id,role,content,tool_result,created_at")
    .eq("user_id", userId)
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 100));
  throwIfError(error);
  const rows: MessageRecord[] = [];
  for (const raw of data ?? []) {
    const r = messageRow.safeParse(raw);
    if (!r.success) throw new DbError("db_row_invalid", { safeDetails: { table: "ai_messages", rule: "shape" } });
    if (r.data.role === "tool") continue;
    rows.push({ id: r.data.id, role: r.data.role, content: r.data.content, toolResult: r.data.tool_result ?? null, createdAt: r.data.created_at });
  }
  return rows.reverse();
}

export interface NewMessage {
  role: "user" | "assistant";
  content: string;
  toolResult?: DbJson | null;
}

/** Appends messages (service role) and bumps the conversation's updated_at. */
export async function appendMessages(
  admin: FromClient,
  owner: OwnerContext,
  conversationId: string,
  messages: readonly NewMessage[],
  opts: { titleFromMessage?: string } = {},
): Promise<void> {
  assertServerRuntime();
  const userId = ownerIdOf(owner);
  const id = parseInput(uuidSchema, conversationId);
  if (messages.length === 0) return;
  const base = Date.now();
  const rows = messages.map((m, i) => ({
    user_id: userId,
    conversation_id: id,
    role: m.role,
    content: m.content.slice(0, MAX_MESSAGE_CHARS),
    tool_result: m.toolResult ?? null,
    // Strictly increasing timestamps keep ordering stable within one request.
    created_at: new Date(base + i).toISOString(),
  }));
  const { error } = await admin.from("ai_messages").insert(rows);
  throwIfError(error);
  const touch = await admin
    .from("ai_conversations")
    .update({
      updated_at: new Date(base + messages.length).toISOString(),
      ...(opts.titleFromMessage ? { title: titleFrom(opts.titleFromMessage) } : {}),
    })
    .eq("user_id", userId)
    .eq("id", id);
  throwIfError(touch.error);
}
