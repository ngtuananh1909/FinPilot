import { parseLocalDate } from "./dates";
import { FinanceError } from "./errors";
import { assertNonNegativeVnd, assertPositiveVnd, assertWithinBounds } from "./money";
import type { FinanceProfile, FinanceTransaction } from "./types";

/** Cash effect of a transaction: income +, expense -, excluded 0. */
export function signedAmount(transaction: Pick<FinanceTransaction, "kind" | "amountVnd">): bigint {
  switch (transaction.kind) {
    case "income":
      return transaction.amountVnd;
    case "expense":
      return -transaction.amountVnd;
    case "excluded":
      return 0n;
  }
}

export function validateTransactions(transactions: readonly FinanceTransaction[]): void {
  const seen = new Set<string>();
  for (const tx of transactions) {
    if (!(tx.occurredAt instanceof Date) || Number.isNaN(tx.occurredAt.getTime())) {
      throw new FinanceError("invalid_instant", `Transaction ${tx.id} has an invalid timestamp.`);
    }
    assertPositiveVnd(tx.amountVnd);
    if (seen.has(tx.id)) {
      throw new FinanceError("duplicate_transaction_id", `Transaction ${tx.id} appears twice.`);
    }
    seen.add(tx.id);
    const hasItem = Boolean(tx.recurringItemId);
    const hasDate = Boolean(tx.recurringInstanceDate);
    if (hasItem !== hasDate) {
      throw new FinanceError(
        "invalid_recurring_link",
        `Transaction ${tx.id} must set recurring item and instance date together.`,
      );
    }
    if (tx.recurringInstanceDate) parseLocalDate(tx.recurringInstanceDate);
  }
}

export function validateProfile(profile: FinanceProfile): void {
  assertWithinBounds(profile.balanceSnapshotVnd);
  assertNonNegativeVnd(profile.minimumReserveVnd);
  assertNonNegativeVnd(profile.expectedDailyExpenseVnd);
  assertNonNegativeVnd(profile.expectedMonthlyIncomeVnd);
  if (Number.isNaN(profile.balanceSnapshotAt.getTime())) {
    throw new FinanceError("invalid_instant", "Snapshot timestamp is invalid.");
  }
  if (
    profile.paydayDay !== null &&
    (!Number.isInteger(profile.paydayDay) || profile.paydayDay < 1 || profile.paydayDay > 31)
  ) {
    throw new FinanceError("invalid_day_of_month", "Payday must be 1-31 or null.");
  }
}

/**
 * balance(T) = snapshot + signed transactions with snapshotAt < occurredAt <= T.
 * Earlier history never changes the balance; later (future-dated) rows are excluded.
 */
export function balanceAt(
  profile: Pick<FinanceProfile, "balanceSnapshotVnd" | "balanceSnapshotAt">,
  transactions: readonly FinanceTransaction[],
  at: Date,
): bigint {
  const atMs = at.getTime();
  const snapshotMs = profile.balanceSnapshotAt.getTime();
  if (Number.isNaN(atMs) || Number.isNaN(snapshotMs)) {
    throw new FinanceError("invalid_instant", "Invalid timestamp.");
  }
  if (atMs < snapshotMs) {
    throw new FinanceError("snapshot_in_future", "Snapshot timestamp is after the evaluation time.");
  }
  validateTransactions(transactions);
  let balance = profile.balanceSnapshotVnd;
  for (const tx of transactions) {
    const ms = tx.occurredAt.getTime();
    if (ms > snapshotMs && ms <= atMs) balance += signedAmount(tx);
  }
  return balance;
}
