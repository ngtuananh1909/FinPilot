import type { OwnerContext } from "@/lib/auth/owner-context";
import { goalUpsertSchema, parseInput } from "../inputs";
import { COLUMNS, mapGoalRow, toGoalUpsert, type GoalRecord } from "../mappers";
import { ownerIdOf, throwIfError, type DbClient } from "./shared";

const TABLE = "savings_goals";

/** savings_goals.user_id is the primary key, so a user has at most one active goal. */
export async function getGoal(client: DbClient, owner: OwnerContext): Promise<GoalRecord | null> {
  const userId = ownerIdOf(owner);
  const { data, error } = await client.from(TABLE).select(COLUMNS.goal).eq("user_id", userId).maybeSingle();
  throwIfError(error);
  return data ? mapGoalRow(data) : null;
}

/** Creates or replaces the caller's single goal. */
export async function upsertGoal(client: DbClient, owner: OwnerContext, input: unknown): Promise<GoalRecord> {
  const userId = ownerIdOf(owner);
  const payload = toGoalUpsert(userId, parseInput(goalUpsertSchema, input));
  const { data, error } = await client
    .from(TABLE)
    .upsert(payload, { onConflict: "user_id" })
    .select(COLUMNS.goal)
    .single();
  throwIfError(error);
  return mapGoalRow(data);
}

/** Removes the caller's goal. Idempotent: no error if none exists. */
export async function clearGoal(client: DbClient, owner: OwnerContext): Promise<void> {
  const userId = ownerIdOf(owner);
  const { error } = await client.from(TABLE).delete().eq("user_id", userId);
  throwIfError(error);
}
