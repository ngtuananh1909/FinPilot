import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OwnerContext } from "@/lib/auth/owner-context";
import type { LocalDate } from "@/lib/finance";
import { DbError } from "../../errors";
import { instantSchema, localDateSchema, parseInput, uuidSchema } from "../../inputs";
import { AI_PROPOSAL_KINDS, AI_PROPOSAL_STATUSES, type DbJson } from "../../schema";
import { ownerIdOf, throwIfError } from "../shared";
import { assertServerRuntime } from "./guard";

type FromClient = Pick<SupabaseClient, "from">;

export interface AiUsage {
  usageDate: LocalDate;
  chatCalls: number;
  scanCalls: number;
}

const usageRow = z.object({ chat_calls: z.number().int().min(0), scan_calls: z.number().int().min(0) });

/** Reads the caller's counters for an Asia/Ho_Chi_Minh date (zeros when no row yet). */
export async function getAiUsage(client: FromClient, owner: OwnerContext, usageDate: LocalDate): Promise<AiUsage> {
  assertServerRuntime();
  const userId = ownerIdOf(owner);
  const date = parseInput(localDateSchema, usageDate);
  const { data, error } = await client
    .from("ai_usage_daily")
    .select("chat_calls,scan_calls")
    .eq("user_id", userId)
    .eq("usage_date", date)
    .maybeSingle();
  throwIfError(error);
  if (!data) return { usageDate: date, chatCalls: 0, scanCalls: 0 };
  const row = usageRow.safeParse(data);
  if (!row.success) throw new DbError("db_row_invalid", { safeDetails: { table: "ai_usage_daily", rule: "shape" } });
  return { usageDate: date, chatCalls: row.data.chat_calls, scanCalls: row.data.scan_calls };
}

const jsonObject = z.record(z.string(), z.unknown());
const proposalCreateSchema = z
  .object({
    kind: z.enum(AI_PROPOSAL_KINDS),
    payload: jsonObject,
    baseline: jsonObject.optional(),
    conversationId: uuidSchema.nullable().optional(),
    expiresAt: instantSchema,
  })
  .strict();

const proposalRow = z.object({
  id: z.uuid(),
  kind: z.enum(AI_PROPOSAL_KINDS),
  status: z.enum(AI_PROPOSAL_STATUSES),
  payload: jsonObject,
  baseline: jsonObject,
  expires_at: z.string(),
  created_at: z.string(),
});
const PROPOSAL_COLUMNS = "id,kind,status,payload,baseline,expires_at,created_at";

export interface ProposalRecord {
  id: string;
  kind: (typeof AI_PROPOSAL_KINDS)[number];
  status: (typeof AI_PROPOSAL_STATUSES)[number];
  payload: Record<string, unknown>;
  baseline: Record<string, unknown>;
  expiresAt: Date;
  createdAt: Date;
}

function mapProposal(row: unknown): ProposalRecord {
  const parsed = proposalRow.safeParse(row);
  const expiresAt = parsed.success ? new Date(parsed.data.expires_at) : null;
  const createdAt = parsed.success ? new Date(parsed.data.created_at) : null;
  if (!parsed.success || !Number.isFinite(expiresAt?.getTime()) || !Number.isFinite(createdAt?.getTime())) {
    throw new DbError("db_row_invalid", { safeDetails: { table: "ai_proposals", rule: "shape" } });
  }
  return {
    id: parsed.data.id,
    kind: parsed.data.kind,
    status: parsed.data.status,
    payload: parsed.data.payload,
    baseline: parsed.data.baseline,
    expiresAt: expiresAt!,
    createdAt: createdAt!,
  };
}

/**
 * Stores a PENDING proposal for the caller. This changes no user data. Approval (a separate
 * explicit user confirmation that applies the change once) is a later task.
 */
export async function createAiProposal(client: FromClient, owner: OwnerContext, input: unknown): Promise<ProposalRecord> {
  assertServerRuntime();
  const userId = ownerIdOf(owner);
  const f = parseInput(proposalCreateSchema, input);
  const { data, error } = await client
    .from("ai_proposals")
    .insert({
      user_id: userId,
      conversation_id: f.conversationId ?? null,
      kind: f.kind,
      payload: f.payload as DbJson,
      baseline: (f.baseline ?? {}) as DbJson,
      status: "pending",
      expires_at: f.expiresAt.toISOString(),
    })
    .select(PROPOSAL_COLUMNS)
    .single();
  throwIfError(error);
  return mapProposal(data);
}

/** The caller's pending proposals, newest first (bounded to 20). */
export async function listPendingAiProposals(client: FromClient, owner: OwnerContext): Promise<ProposalRecord[]> {
  assertServerRuntime();
  const userId = ownerIdOf(owner);
  const { data, error } = await client
    .from("ai_proposals")
    .select(PROPOSAL_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);
  throwIfError(error);
  return (data ?? []).map(mapProposal);
}
