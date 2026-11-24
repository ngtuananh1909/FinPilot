import type { OwnerContext } from "@/lib/auth/owner-context";
import { vndToString } from "@/lib/finance";
import { goalUpsertSchema, PAGE_MAX, parseInput } from "@/lib/db/inputs";
import type { ProfileRecord } from "@/lib/db/mappers";
import { clearGoal, getGoal, upsertGoal } from "@/lib/db/repositories/goal";
import { requireProfile, updateProfile } from "@/lib/db/repositories/profile";
import { listRecurringItems } from "@/lib/db/repositories/recurring";
import type { DbClient } from "@/lib/db/repositories/shared";
import { recurringToDto, type RecurringDto } from "@/lib/transactions/dto";
import {
  goalToDto,
  profileToDto,
  readinessToDto,
  type GoalDto,
  type ProfileDto,
  type ReadinessDto,
} from "./dto";
import { assertTargetDateAllowed } from "./goal";
import { assessForecastReadiness } from "./readiness";
import { balanceSnapshotBodySchema, goalDeleteBodySchema, profilePatchBodySchema } from "./schemas";

/**
 * Orchestration for /api/settings/*. Every function takes the user-scoped (RLS) client and a
 * verified OwnerContext; `now` is injected so tests control the clock. No service-role client.
 * Recurring items are READ here only: they are managed through /api/recurring (deactivate,
 * never delete).
 */
export interface SettingsDocument {
  profile: ProfileDto;
  goal: GoalDto | null;
  recurringItems: RecurringDto[];
  /** True when more than PAGE_MAX recurring items exist and the list was cut off. */
  recurringTruncated: boolean;
  forecastReadiness: ReadinessDto;
}

export interface ProfileWriteResult {
  profile: ProfileDto;
  forecastReadiness: ReadinessDto;
}

export interface BalanceSnapshotResult extends ProfileWriteResult {
  previousSnapshot: { amountVnd: string; at: string };
  /** new - previous, decimal string (may be negative). */
  deltaVnd: string;
  /**
   * Always false: the new snapshot is a fresh anchor. Transactions dated at or before its
   * timestamp are NOT re-applied (docs/06: balance = snapshot + rows with occurred_at > snapshot_at).
   */
  earlierTransactionsReapplied: false;
}

async function readinessFor(client: DbClient, owner: OwnerContext, profile: ProfileRecord) {
  const page = await listRecurringItems(client, owner, { limit: PAGE_MAX });
  return { page, readiness: readinessForProfile(profile, page.items, page.hasMore) };
}

function readinessForProfile(profile: ProfileRecord, items: { active: boolean }[], hasMore: boolean) {
  // If the list was truncated, assume active items exist beyond the cut-off.
  const activeRecurringCount = items.filter((i) => i.active).length + (hasMore ? 1 : 0);
  return readinessToDto(
    assessForecastReadiness({
      balanceSnapshotVnd: profile.balanceSnapshotVnd,
      paydayDay: profile.paydayDay,
      expectedMonthlyIncomeVnd: profile.expectedMonthlyIncomeVnd,
      expectedDailyExpenseVnd: profile.expectedDailyExpenseVnd,
      activeRecurringCount,
    }),
  );
}

export async function getSettingsForOwner(client: DbClient, owner: OwnerContext): Promise<SettingsDocument> {
  const [profile, goal] = await Promise.all([requireProfile(client, owner), getGoal(client, owner)]);
  const { page, readiness } = await readinessFor(client, owner, profile);
  return {
    profile: profileToDto(profile),
    goal: goal ? goalToDto(goal) : null,
    recurringItems: page.items.map(recurringToDto),
    recurringTruncated: page.hasMore,
    forecastReadiness: readiness,
  };
}

/** Editable profile fields only. The balance snapshot, persona_code and is_demo are not accepted. */
export async function patchProfileForOwner(
  client: DbClient,
  owner: OwnerContext,
  body: unknown,
): Promise<ProfileWriteResult> {
  parseInput(profilePatchBodySchema, body);
  // The repository re-validates (strict) and maps to columns; the body is a verified subset.
  const profile = await updateProfile(client, owner, body);
  const { readiness } = await readinessFor(client, owner, profile);
  return { profile: profileToDto(profile), forecastReadiness: readiness };
}

/**
 * Explicit rebase. The timestamp is the SERVER clock (`now`), never a client value, and the
 * body has no timestamp field. Earlier transactions stay stored but stop affecting the balance.
 * The previous profile is read first (also yields 404 when no profile exists); the read and the
 * write are not one transaction, which is acceptable for a single-owner, user-initiated action.
 */
export async function setBalanceSnapshotForOwner(
  client: DbClient,
  owner: OwnerContext,
  body: unknown,
  now: Date,
): Promise<BalanceSnapshotResult> {
  const input = parseInput(balanceSnapshotBodySchema, body);
  const previous = await requireProfile(client, owner);
  const profile = await updateProfile(client, owner, {
    balanceSnapshotVnd: vndToString(input.amountVnd),
    balanceSnapshotAt: now.toISOString(),
  });
  const { readiness } = await readinessFor(client, owner, profile);
  return {
    profile: profileToDto(profile),
    forecastReadiness: readiness,
    previousSnapshot: {
      amountVnd: vndToString(previous.balanceSnapshotVnd),
      at: previous.balanceSnapshotAt.toISOString(),
    },
    deltaVnd: vndToString(profile.balanceSnapshotVnd - previous.balanceSnapshotVnd),
    earlierTransactionsReapplied: false,
  };
}

export async function getGoalForOwner(client: DbClient, owner: OwnerContext): Promise<GoalDto | null> {
  const goal = await getGoal(client, owner);
  return goal ? goalToDto(goal) : null;
}

/** Upsert keyed on user_id (the savings_goals primary key): a second PUT replaces, never adds. */
export async function putGoalForOwner(
  client: DbClient,
  owner: OwnerContext,
  body: unknown,
  now: Date,
): Promise<GoalDto> {
  const input = parseInput(goalUpsertSchema, body);
  const existing = await getGoal(client, owner);
  assertTargetDateAllowed(input.targetDate, existing?.targetDate ?? null, now);
  return goalToDto(await upsertGoal(client, owner, body));
}

export async function deleteGoalForOwner(client: DbClient, owner: OwnerContext, body: unknown): Promise<void> {
  parseInput(goalDeleteBodySchema, body);
  await clearGoal(client, owner);
}
