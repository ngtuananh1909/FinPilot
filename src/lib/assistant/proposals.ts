import type { OwnerContext } from "@/lib/auth/owner-context";
import { getGoal } from "@/lib/db/repositories/goal";
import { getProfile } from "@/lib/db/repositories/profile";
import { casUpdateBudget, casUpdateGoal, insertGoalIfAbsent } from "@/lib/db/repositories/proposal-apply";
import type { DbClient } from "@/lib/db/repositories/shared";
import { createAiProposal } from "@/lib/db/repositories/server-only/ai-data";
import {
  getProposal,
  markApprovedProposalStale,
  transitionPendingProposal,
  type StoredProposal,
} from "@/lib/db/repositories/server-only/ai-proposals";
import { AppError } from "@/lib/errors";
import { MAX_VND, parseVndString, vndToString } from "@/lib/finance";
import { assertTargetDateAllowed } from "@/lib/settings/goal";
import type { ToolOutcome } from "@/lib/ai/tool-loop";
import type { ProposalToolName } from "@/lib/ai/tools/definitions";

/** Proposals expire if not confirmed in time; a stale suggestion must not apply later. */
export const PROPOSAL_TTL_MS = 30 * 60 * 1000;

export interface ProposalDeps {
  /** Caller's RLS client (reads, and the compare-and-set apply). */
  readonly client: DbClient;
  /** Service-role client, created after requireOwner(); only touches ai_proposals. */
  readonly admin: DbClient;
}

export interface ProposalDto {
  id: string;
  kind: "budget_update" | "goal_update";
  status: "pending" | "approved" | "rejected" | "expired";
  expiresAt: string;
  reason: string;
  changes: Array<{ field: string; label: string; from: string | null; to: string | null }>;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));

export function proposalToDto(p: StoredProposal, now: Date): ProposalDto {
  const status = p.status === "pending" && p.expiresAt.getTime() <= now.getTime() ? "expired" : p.status;
  const reason = str(p.payload.reason) ?? "";
  if (p.kind === "budget_update") {
    return {
      id: p.id,
      kind: p.kind,
      status,
      expiresAt: p.expiresAt.toISOString(),
      reason,
      changes: [
        {
          field: "projectedMonthlyBudgetVnd",
          label: "Ngân sách chi tiêu tháng",
          from: str(p.baseline.projectedMonthlyBudgetVnd),
          to: str(p.payload.projectedMonthlyBudgetVnd),
        },
      ],
    };
  }
  const fields: Array<[string, string]> = [
    ["name", "Tên mục tiêu"],
    ["targetVnd", "Số tiền mục tiêu"],
    ["targetDate", "Hạn hoàn thành"],
  ];
  return {
    id: p.id,
    kind: p.kind,
    status,
    expiresAt: p.expiresAt.toISOString(),
    reason,
    changes: fields
      .map(([field, label]) => ({ field, label, from: p.baseline.exists ? str(p.baseline[field]) : null, to: str(p.payload[field]) }))
      .filter((c) => c.from !== c.to),
  };
}

function invalid(error: string): ToolOutcome {
  return { ok: false, error };
}

/**
 * Handler for the model's write-INTENT tools. Validates the values and stores a PENDING
 * proposal with the current values as baseline. It never changes profile or goal data.
 */
export async function createProposalFromTool(
  deps: ProposalDeps,
  owner: OwnerContext,
  now: Date,
  conversationId: string | null,
  name: ProposalToolName,
  args: unknown,
  created: ProposalDto[],
): Promise<ToolOutcome> {
  const a = args as Record<string, unknown>;
  const reason = String(a.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS);

  if (name === "propose_budget_adjustment") {
    const profile = await getProfile(deps.client, owner);
    if (!profile) return invalid("profile_missing");
    let next: bigint;
    try {
      next = parseVndString(String(a.newProjectedMonthlyBudgetVnd));
    } catch {
      return invalid("invalid_amount");
    }
    if (next > MAX_VND) return invalid("invalid_amount");
    if (next === profile.projectedMonthlyBudgetVnd) return invalid("no_change");
    const stored = await createAiProposal(deps.admin, owner, {
      kind: "budget_update",
      conversationId,
      expiresAt: expiresAt.toISOString(),
      payload: { projectedMonthlyBudgetVnd: vndToString(next), reason },
      baseline: { projectedMonthlyBudgetVnd: vndToString(profile.projectedMonthlyBudgetVnd) },
    });
    const full = await getProposal(deps.client, owner, stored.id);
    if (full) created.push(proposalToDto(full, now));
    return {
      ok: true,
      data: {
        proposalId: stored.id,
        status: "pending_user_confirmation",
        from: vndToString(profile.projectedMonthlyBudgetVnd),
        to: vndToString(next),
        note: "Chưa thay đổi gì. Người dùng phải bấm Xác nhận trên thẻ đề xuất.",
      },
    };
  }

  const goal = await getGoal(deps.client, owner);
  let targetVnd: bigint | null = goal?.targetVnd ?? null;
  if (a.targetVnd !== undefined) {
    try {
      targetVnd = parseVndString(String(a.targetVnd));
    } catch {
      return invalid("invalid_amount");
    }
    if (targetVnd <= 0n) return invalid("invalid_amount");
  }
  const nameNext = a.name !== undefined ? String(a.name).replace(/\s+/g, " ").trim().slice(0, 100) : (goal?.name ?? null);
  const targetDate = a.targetDate !== undefined ? (a.targetDate as string | null) : (goal?.targetDate ?? null);
  if (!nameNext || targetVnd === null) return invalid("goal_needs_name_and_target");
  try {
    assertTargetDateAllowed(targetDate, goal?.targetDate ?? null, now);
  } catch {
    return invalid("target_date_in_past");
  }
  if (goal && goal.name === nameNext && goal.targetVnd === targetVnd && goal.targetDate === targetDate) return invalid("no_change");
  const stored = await createAiProposal(deps.admin, owner, {
    kind: "goal_update",
    conversationId,
    expiresAt: expiresAt.toISOString(),
    payload: { name: nameNext, targetVnd: vndToString(targetVnd), targetDate, reason },
    baseline: goal
      ? { exists: true, name: goal.name, targetVnd: vndToString(goal.targetVnd), savedVnd: vndToString(goal.savedVnd), targetDate: goal.targetDate }
      : { exists: false },
  });
  const full = await getProposal(deps.client, owner, stored.id);
  if (full) created.push(proposalToDto(full, now));
  return {
    ok: true,
    data: {
      proposalId: stored.id,
      status: "pending_user_confirmation",
      note: "Chưa thay đổi gì. Người dùng phải bấm Xác nhận trên thẻ đề xuất. Đề xuất không chuyển tiền.",
    },
  };
}

const conflict = (message: string, reason: string) =>
  new AppError("validation_failed", { httpStatus: 409, userMessage: message, safeDetails: { reason } });

async function explainUnclaimable(deps: ProposalDeps, owner: OwnerContext, id: string, now: Date): Promise<never> {
  const current = await getProposal(deps.client, owner, id);
  if (!current) throw new AppError("not_found", { userMessage: "Không tìm thấy đề xuất này." });
  if (current.status === "pending" && current.expiresAt.getTime() <= now.getTime()) {
    await transitionPendingProposal(deps.admin, owner, id, "expired", now, { requireNotExpired: false });
    throw conflict("Đề xuất đã hết hạn. Hãy hỏi lại trợ lý để có đề xuất mới.", "proposal_expired");
  }
  throw conflict("Đề xuất này đã được xử lý trước đó.", `proposal_${current.status}`);
}

/**
 * Applies a proposal after the user's explicit confirmation.
 * 1. Claim: pending -> approved, only if pending, owned and not expired (exactly one winner).
 * 2. Apply with compare-and-set against the stored baseline (caller's RLS client).
 * 3. If the record changed since the proposal was made, the claim is downgraded to expired
 *    and nothing is written (stale). Forged, foreign, expired and replayed ids never apply.
 */
export async function approveProposal(deps: ProposalDeps, owner: OwnerContext, id: unknown, now: Date): Promise<ProposalDto> {
  const proposalId = String(id);
  const claimed = await transitionPendingProposal(deps.admin, owner, proposalId, "approved", now, { requireNotExpired: true });
  if (!claimed) return explainUnclaimable(deps, owner, proposalId, now);

  let applied = false;
  try {
    if (claimed.kind === "budget_update") {
      applied = await casUpdateBudget(
        deps.client,
        owner,
        parseVndString(String(claimed.baseline.projectedMonthlyBudgetVnd)),
        parseVndString(String(claimed.payload.projectedMonthlyBudgetVnd)),
      );
    } else {
      const next = {
        name: String(claimed.payload.name),
        targetVnd: parseVndString(String(claimed.payload.targetVnd)),
        targetDate: (claimed.payload.targetDate as string | null) ?? null,
      };
      applied = claimed.baseline.exists
        ? await casUpdateGoal(
            deps.client,
            owner,
            {
              name: String(claimed.baseline.name),
              targetVnd: parseVndString(String(claimed.baseline.targetVnd)),
              savedVnd: parseVndString(String(claimed.baseline.savedVnd)),
              targetDate: (claimed.baseline.targetDate as string | null) ?? null,
            },
            next,
          )
        : await insertGoalIfAbsent(deps.client, owner, next);
    }
  } catch (error) {
    await markApprovedProposalStale(deps.admin, owner, proposalId, now).catch(() => undefined);
    throw error;
  }
  if (!applied) {
    await markApprovedProposalStale(deps.admin, owner, proposalId, now);
    throw conflict("Dữ liệu đã thay đổi kể từ khi có đề xuất này nên không áp dụng. Hãy hỏi lại trợ lý.", "proposal_stale");
  }
  return proposalToDto(claimed, now);
}

export async function rejectProposal(deps: ProposalDeps, owner: OwnerContext, id: unknown, now: Date): Promise<ProposalDto> {
  const proposalId = String(id);
  const rejected = await transitionPendingProposal(deps.admin, owner, proposalId, "rejected", now, { requireNotExpired: false });
  if (!rejected) return explainUnclaimable(deps, owner, proposalId, now);
  return proposalToDto(rejected, now);
}
