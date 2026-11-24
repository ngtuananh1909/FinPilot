import type { OwnerContext } from "@/lib/auth/owner-context";
import type { ForecastInput } from "@/lib/finance";
import { DbError } from "../errors";
import { COLUMNS, mapRecurringRow, mapTransactionRow } from "../mappers";
import { mapProfileRow } from "../mappers";
import { ownerIdOf, throwIfError, type DbClient } from "./shared";

/** Days of history always loaded (variable-expense sampling window plus margin). */
export const HISTORY_WINDOW_DAYS = 90;
/** Rows per PostgREST request (Supabase default max_rows is 1000). */
export const TRANSACTION_PAGE_SIZE = 1000;
/** Hard cap on transactions loaded for one forecast. */
export const MAX_TRANSACTIONS = 5000;
/** Hard cap on recurring items loaded for one forecast. */
export const MAX_RECURRING_ITEMS = 200;

const DAY_MS = 86_400_000;

export interface FinanceInputsLoad {
  readonly profile: ForecastInput["profile"];
  readonly transactions: ForecastInput["transactions"];
  readonly recurringItems: ForecastInput["recurringItems"];
  /** Earliest `occurred_at` requested: min(balance snapshot, now - 90 days). Future rows are included. */
  readonly windowStart: Date;
  readonly transactionsTruncated: boolean;
  readonly recurringTruncated: boolean;
  /** True if anything was cut off. The caller must surface this; it is never silent. */
  readonly truncated: boolean;
  /**
   * False when transactions were truncated AND the oldest loaded row is newer than the
   * balance snapshot, i.e. some post-snapshot rows are missing and balances would be wrong.
   * Callers must not present a forecast as reliable when this is false.
   */
  readonly balanceReliable: boolean;
}

/**
 * Loads the engine inputs for the caller: profile, transactions and recurring items.
 * Window: from min(snapshot time, now - 90 days) with NO upper bound, so snapshot-onward and
 * all future-dated rows are included, up to MAX_TRANSACTIONS (newest first). Everything is
 * filtered by the verified owner. Throws `profile_missing` if the user has no profile.
 */
export async function loadFinanceInputs(
  client: DbClient,
  owner: OwnerContext,
  now: Date,
): Promise<FinanceInputsLoad> {
  const userId = ownerIdOf(owner);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new DbError("invalid_input", { safeDetails: { field: "now" } });
  }

  const profileResult = await client
    .from("financial_profiles")
    .select(COLUMNS.profile)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(profileResult.error);
  if (!profileResult.data) throw new DbError("profile_missing");
  const profile = mapProfileRow(profileResult.data);

  const historyStart = now.getTime() - HISTORY_WINDOW_DAYS * DAY_MS;
  const windowStart = new Date(Math.min(profile.balanceSnapshotAt.getTime(), historyStart));

  const rows: unknown[] = [];
  let transactionsTruncated = false;
  for (let offset = 0; ; offset += TRANSACTION_PAGE_SIZE) {
    const remaining = MAX_TRANSACTIONS - rows.length;
    if (remaining <= 0) {
      // Cap reached exactly: probe one more row to know whether data was cut off.
      const probe = await client
        .from("transactions")
        .select("id")
        .eq("user_id", userId)
        .gte("occurred_at", windowStart.toISOString())
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset);
      throwIfError(probe.error);
      transactionsTruncated = (probe.data?.length ?? 0) > 0;
      break;
    }
    const size = Math.min(TRANSACTION_PAGE_SIZE, remaining);
    const page = await client
      .from("transactions")
      .select(COLUMNS.transaction)
      .eq("user_id", userId)
      .gte("occurred_at", windowStart.toISOString())
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + size - 1);
    throwIfError(page.error);
    const data = page.data ?? [];
    rows.push(...data);
    if (data.length < size) break;
  }
  const transactions = rows.map(mapTransactionRow);

  const recurringResult = await client
    .from("recurring_items")
    .select(COLUMNS.recurring)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(0, MAX_RECURRING_ITEMS);
  throwIfError(recurringResult.error);
  const recurringRows = recurringResult.data ?? [];
  const recurringTruncated = recurringRows.length > MAX_RECURRING_ITEMS;
  const recurringItems = recurringRows.slice(0, MAX_RECURRING_ITEMS).map(mapRecurringRow);

  // Rows are newest-first, so the oldest loaded row is last.
  const oldest = transactions.length > 0 ? transactions[transactions.length - 1]!.occurredAt : null;
  const balanceReliable =
    !transactionsTruncated || (oldest !== null && oldest.getTime() <= profile.balanceSnapshotAt.getTime());

  return {
    profile,
    transactions,
    recurringItems,
    windowStart,
    transactionsTruncated,
    recurringTruncated,
    truncated: transactionsTruncated || recurringTruncated,
    balanceReliable: balanceReliable && !recurringTruncated,
  };
}
