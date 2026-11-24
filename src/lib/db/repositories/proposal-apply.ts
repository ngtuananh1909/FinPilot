import type { OwnerContext } from "@/lib/auth/owner-context";
import { vndForDb } from "../money";
import { ownerIdOf, throwIfError, type DbClient } from "./shared";

/**
 * Compare-and-set writes used when the user CONFIRMS an AI proposal. They run with the
 * caller's RLS client. Each update matches the baseline values captured when the proposal was
 * created; if anything changed since, zero rows match and the caller reports a stale proposal.
 * This makes the apply step idempotent without a new database function.
 */

export async function casUpdateBudget(
  client: DbClient,
  owner: OwnerContext,
  expectedVnd: bigint,
  nextVnd: bigint,
): Promise<boolean> {
  const userId = ownerIdOf(owner);
  const { data, error } = await client
    .from("financial_profiles")
    .update({ projected_monthly_budget_vnd: vndForDb(nextVnd) })
    .eq("user_id", userId)
    .eq("projected_monthly_budget_vnd", vndForDb(expectedVnd))
    .select("user_id");
  throwIfError(error);
  return Array.isArray(data) && data.length === 1;
}

export interface GoalValues {
  name: string;
  targetVnd: bigint;
  savedVnd: bigint;
  targetDate: string | null;
}

export async function casUpdateGoal(
  client: DbClient,
  owner: OwnerContext,
  expected: GoalValues,
  next: Omit<GoalValues, "savedVnd">,
): Promise<boolean> {
  const userId = ownerIdOf(owner);
  let q = client
    .from("savings_goals")
    .update({ name: next.name, target_vnd: vndForDb(next.targetVnd), target_date: next.targetDate })
    .eq("user_id", userId)
    .eq("name", expected.name)
    .eq("target_vnd", vndForDb(expected.targetVnd))
    .eq("saved_vnd", vndForDb(expected.savedVnd));
  q = expected.targetDate === null ? q.is("target_date", null) : q.eq("target_date", expected.targetDate);
  const { data, error } = await q.select("user_id");
  throwIfError(error);
  return Array.isArray(data) && data.length === 1;
}

/** Creates the first goal. A concurrent creation hits the primary key and returns false. */
export async function insertGoalIfAbsent(client: DbClient, owner: OwnerContext, next: Omit<GoalValues, "savedVnd">): Promise<boolean> {
  const userId = ownerIdOf(owner);
  const { error } = await client.from("savings_goals").insert({
    user_id: userId,
    name: next.name,
    target_vnd: vndForDb(next.targetVnd),
    saved_vnd: "0",
    target_date: next.targetDate,
  });
  if (error && (error as { code?: string }).code === "23505") return false;
  throwIfError(error);
  return true;
}
