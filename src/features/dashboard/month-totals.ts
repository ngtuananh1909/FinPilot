import { formatLocalDate, localDateOf, parseLocalDate, type FinanceTransaction } from "@/lib/finance";

export interface MonthTotals {
  /** YYYY-MM-01 in Asia/Ho_Chi_Minh. */
  start: string;
  incomeVnd: bigint;
  expenseVnd: bigint;
  incomeCount: number;
  expenseCount: number;
}

/**
 * Month-to-date income and expense in Asia/Ho_Chi_Minh: posted rows (occurredAt <= now) whose local
 * date falls in the current month. `excluded` rows (transfers, refunds) are ignored. Rows dated
 * before the balance snapshot still count: this describes activity, not the balance.
 * Plain integer sums; the balance and forecast come only from the engine.
 */
export function monthToDateTotals(transactions: readonly FinanceTransaction[], now: Date): MonthTotals {
  const today = localDateOf(now);
  const { year, month } = parseLocalDate(today);
  const start = formatLocalDate(year, month, 1);
  const nowMs = now.getTime();
  const totals: MonthTotals = { start, incomeVnd: 0n, expenseVnd: 0n, incomeCount: 0, expenseCount: 0 };
  for (const tx of transactions) {
    if (tx.kind === "excluded" || tx.occurredAt.getTime() > nowMs) continue;
    const date = localDateOf(tx.occurredAt);
    if (date < start || date > today) continue; // ISO dates compare lexicographically
    if (tx.kind === "income") {
      totals.incomeVnd += tx.amountVnd;
      totals.incomeCount += 1;
    } else {
      totals.expenseVnd += tx.amountVnd;
      totals.expenseCount += 1;
    }
  }
  return totals;
}
