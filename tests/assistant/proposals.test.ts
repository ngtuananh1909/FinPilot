import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import { ownerContextFromVerifiedUser } from "@/lib/auth/owner-context";
import { approveProposal, createProposalFromTool, rejectProposal, type ProposalDeps, type ProposalDto } from "@/lib/assistant/proposals";
import { AppError } from "@/lib/errors";
import { OTHER_ID, OWNER_ID, goalRow, profileRow } from "../db/repositories/support/fake-client";
import { createMemoryDb, type MemoryDb } from "./support/memory-db";

const NOW = new Date("2026-11-24T05:00:00Z");
const LATER = new Date(NOW.getTime() + 31 * 60_000);
const owner = (id = OWNER_ID) => ownerContextFromVerifiedUser({ userId: id, user: { id } as User, isAnonymous: false });

let db: MemoryDb;
const deps = (): ProposalDeps => ({ client: db.client as unknown as ProposalDeps["client"], admin: db.admin as unknown as ProposalDeps["admin"] });
const profile = () => db.tables.financial_profiles!.find((p) => p.user_id === OWNER_ID)!;
const goal = () => db.tables.savings_goals!.find((g) => g.user_id === OWNER_ID);

beforeEach(() => {
  db = createMemoryDb({
    financial_profiles: [
      { ...profileRow(), user_id: OWNER_ID },
      { ...profileRow(), user_id: OTHER_ID },
    ],
    savings_goals: [{ ...goalRow(), user_id: OWNER_ID }],
  });
});

async function proposeBudget(to = "3000000", who = owner()) {
  const created: ProposalDto[] = [];
  const out = await createProposalFromTool(deps(), who, NOW, null, "propose_budget_adjustment", { newProjectedMonthlyBudgetVnd: to, reason: "Chi tiêu tăng" }, created);
  return { out, created, id: (out as { ok: true; data: { proposalId: string } }).data?.proposalId };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return String((e.safeDetails as { reason?: string } | undefined)?.reason ?? e.code);
    return `other:${String(e)}`;
  }
}

describe("creating proposals (write-intent tools)", () => {
  it("stores a pending budget proposal with baseline and changes nothing", async () => {
    const { out, created } = await proposeBudget();
    expect(out.ok).toBe(true);
    expect(String(profile().projected_monthly_budget_vnd)).toBe("4000000");
    expect(created[0]).toMatchObject({ kind: "budget_update", status: "pending", changes: [{ from: "4000000", to: "3000000" }] });
    expect(db.tables.ai_proposals![0]).toMatchObject({ user_id: OWNER_ID, status: "pending", baseline: { projectedMonthlyBudgetVnd: "4000000" } });
  });

  it.each([
    ["no change", "4000000", "no_change"],
    ["not an integer", "3.5", "invalid_amount"],
    ["negative", "-1", "invalid_amount"],
  ])("rejects %s", async (_l, to, error) => {
    const { out } = await proposeBudget(to);
    expect(out).toEqual({ ok: false, error });
    expect(db.tables.ai_proposals ?? []).toHaveLength(0);
  });

  it("validates goal proposals: target date not in the past, needs a change", async () => {
    const created: ProposalDto[] = [];
    const past = await createProposalFromTool(deps(), owner(), NOW, null, "propose_savings_goal_update", { targetDate: "2026-01-01", reason: "x" }, created);
    expect(past).toEqual({ ok: false, error: "target_date_in_past" });
    const same = await createProposalFromTool(deps(), owner(), NOW, null, "propose_savings_goal_update", { name: "Laptop", reason: "x" }, created);
    expect(same).toEqual({ ok: false, error: "no_change" });
    const ok = await createProposalFromTool(deps(), owner(), NOW, null, "propose_savings_goal_update", { targetVnd: "12000000", reason: "x" }, created);
    expect(ok.ok).toBe(true);
    expect(created[0]!.changes).toEqual([{ field: "targetVnd", label: "Số tiền mục tiêu", from: "15000000", to: "12000000" }]);
  });
});

describe("approving proposals", () => {
  it("applies a budget proposal exactly once after explicit approval", async () => {
    const { id } = await proposeBudget();
    const dto = await approveProposal(deps(), owner(), id, NOW);
    expect(dto.status).toBe("approved");
    expect(String(profile().projected_monthly_budget_vnd)).toBe("3000000");
    expect(String(db.tables.financial_profiles!.find((p) => p.user_id === OTHER_ID)!.projected_monthly_budget_vnd)).toBe("4000000");
    expect(await codeOf(approveProposal(deps(), owner(), id, NOW))).toBe("proposal_approved");
    expect(String(profile().projected_monthly_budget_vnd)).toBe("3000000");
  });

  it("two concurrent approvals apply once", async () => {
    const { id } = await proposeBudget();
    const results = await Promise.all([codeOf(approveProposal(deps(), owner(), id, NOW)), codeOf(approveProposal(deps(), owner(), id, NOW))]);
    expect(results.sort()).toEqual(["ok", "proposal_approved"]);
    expect(String(profile().projected_monthly_budget_vnd)).toBe("3000000");
  });

  it("refuses a stale proposal when the budget changed since, and writes nothing", async () => {
    const { id } = await proposeBudget();
    profile().projected_monthly_budget_vnd = "4500000";
    expect(await codeOf(approveProposal(deps(), owner(), id, NOW))).toBe("proposal_stale");
    expect(String(profile().projected_monthly_budget_vnd)).toBe("4500000");
    expect(db.tables.ai_proposals![0]!.status).toBe("expired");
  });

  it("refuses expired, foreign, forged and rejected proposals", async () => {
    const { id } = await proposeBudget();
    expect(await codeOf(approveProposal(deps(), owner(OTHER_ID), id, NOW))).toBe("not_found");
    expect(await codeOf(approveProposal(deps(), owner(), "11111111-2222-4333-8444-555555555555", NOW))).toBe("not_found");
    expect(await codeOf(approveProposal(deps(), owner(), "not-a-uuid", NOW))).toBe("invalid_input");
    expect(await codeOf(approveProposal(deps(), owner(), id, LATER))).toBe("proposal_expired");
    expect(String(profile().projected_monthly_budget_vnd)).toBe("4000000");

    const second = await proposeBudget("2500000");
    expect((await rejectProposal(deps(), owner(), second.id, NOW)).status).toBe("rejected");
    expect(await codeOf(approveProposal(deps(), owner(), second.id, NOW))).toBe("proposal_rejected");
    expect(String(profile().projected_monthly_budget_vnd)).toBe("4000000");
  });

  it("applies a goal update with compare-and-set, keeping the saved amount", async () => {
    const created: ProposalDto[] = [];
    const out = await createProposalFromTool(deps(), owner(), NOW, null, "propose_savings_goal_update", { targetVnd: "12000000", targetDate: "2027-06-01", reason: "x" }, created);
    const id = (out as { data: { proposalId: string } }).data.proposalId;
    await approveProposal(deps(), owner(), id, NOW);
    expect(goal()).toMatchObject({ name: "Laptop", target_date: "2027-06-01" });
    expect(String(goal()!.target_vnd)).toBe("12000000");
    expect(String(goal()!.saved_vnd)).toBe("2000000");
  });

  it("creates the first goal when none exists, once", async () => {
    db.tables.savings_goals = [];
    const created: ProposalDto[] = [];
    const out = await createProposalFromTool(deps(), owner(), NOW, null, "propose_savings_goal_update", { name: "Quỹ khẩn cấp", targetVnd: "5000000", reason: "x" }, created);
    expect(created[0]!.changes.map((c) => c.from)).toEqual([null, null]);
    const id = (out as { data: { proposalId: string } }).data.proposalId;
    await approveProposal(deps(), owner(), id, NOW);
    expect(db.tables.savings_goals).toHaveLength(1);
    expect(goal()).toMatchObject({ name: "Quỹ khẩn cấp" });
    expect(String(goal()!.saved_vnd)).toBe("0");
  });
});
