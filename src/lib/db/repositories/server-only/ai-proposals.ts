import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OwnerContext } from "@/lib/auth/owner-context";
import { DbError } from "../../errors";
import { parseInput, uuidSchema } from "../../inputs";
import { AI_PROPOSAL_KINDS, AI_PROPOSAL_STATUSES } from "../../schema";
import { ownerIdOf, throwIfError } from "../shared";
import { assertServerRuntime } from "./guard";

/**
 * Proposal lifecycle (service role only: clients have SELECT on ai_proposals, no writes).
 * Every status change is a CONDITIONAL update `where user_id = owner and status = 'pending'`,
 * so a proposal can leave the pending state exactly once even under concurrent requests.
 */

type FromClient = Pick<SupabaseClient, "from">;

const COLUMNS = "id,kind,status,payload,baseline,expires_at,created_at,resolved_at,conversation_id";
const row = z.object({
  id: z.uuid(),
  kind: z.enum(AI_PROPOSAL_KINDS),
  status: z.enum(AI_PROPOSAL_STATUSES),
  payload: z.record(z.string(), z.unknown()),
  baseline: z.record(z.string(), z.unknown()),
  expires_at: z.string(),
  created_at: z.string(),
  resolved_at: z.string().nullable().optional(),
  conversation_id: z.string().nullable().optional(),
});

export interface StoredProposal {
  id: string;
  kind: (typeof AI_PROPOSAL_KINDS)[number];
  status: (typeof AI_PROPOSAL_STATUSES)[number];
  payload: Record<string, unknown>;
  baseline: Record<string, unknown>;
  expiresAt: Date;
  createdAt: Date;
  resolvedAt: Date | null;
  conversationId: string | null;
}

function map(raw: unknown): StoredProposal {
  const r = row.safeParse(raw);
  const expiresAt = r.success ? new Date(r.data.expires_at) : null;
  if (!r.success || !Number.isFinite(expiresAt?.getTime())) {
    throw new DbError("db_row_invalid", { safeDetails: { table: "ai_proposals", rule: "shape" } });
  }
  return {
    id: r.data.id,
    kind: r.data.kind,
    status: r.data.status,
    payload: r.data.payload,
    baseline: r.data.baseline,
    expiresAt: expiresAt!,
    createdAt: new Date(r.data.created_at),
    resolvedAt: r.data.resolved_at ? new Date(r.data.resolved_at) : null,
    conversationId: r.data.conversation_id ?? null,
  };
}

/** Null when missing or owned by someone else (same answer, no existence leak). */
export async function getProposal(client: FromClient, owner: OwnerContext, id: unknown): Promise<StoredProposal | null> {
  const userId = ownerIdOf(owner);
  const proposalId = parseInput(uuidSchema, id);
  const { data, error } = await client.from("ai_proposals").select(COLUMNS).eq("user_id", userId).eq("id", proposalId).maybeSingle();
  throwIfError(error);
  return data ? map(data) : null;
}

export async function listProposalsForConversation(
  client: FromClient,
  owner: OwnerContext,
  conversationId: string,
): Promise<StoredProposal[]> {
  const userId = ownerIdOf(owner);
  const id = parseInput(uuidSchema, conversationId);
  const { data, error } = await client
    .from("ai_proposals")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(50);
  throwIfError(error);
  return (data ?? []).map(map);
}

/**
 * pending -> `to`, only if still pending (and, for approval, not expired at `now`).
 * Returns the updated proposal, or null if another request already resolved it / it expired.
 */
export async function transitionPendingProposal(
  admin: FromClient,
  owner: OwnerContext,
  id: string,
  to: "approved" | "rejected" | "expired",
  now: Date,
  opts: { requireNotExpired: boolean },
): Promise<StoredProposal | null> {
  assertServerRuntime();
  const userId = ownerIdOf(owner);
  const proposalId = parseInput(uuidSchema, id);
  let q = admin
    .from("ai_proposals")
    .update({ status: to, resolved_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("id", proposalId)
    .eq("status", "pending");
  if (opts.requireNotExpired) q = q.gt("expires_at", now.toISOString());
  const { data, error } = await q.select(COLUMNS).maybeSingle();
  throwIfError(error);
  return data ? map(data) : null;
}

/** approved -> expired: used when the apply step found the record changed (stale baseline). */
export async function markApprovedProposalStale(admin: FromClient, owner: OwnerContext, id: string, now: Date): Promise<void> {
  assertServerRuntime();
  const userId = ownerIdOf(owner);
  const { error } = await admin
    .from("ai_proposals")
    .update({ status: "expired", resolved_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("id", parseInput(uuidSchema, id))
    .eq("status", "approved");
  throwIfError(error);
}
