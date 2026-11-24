import { signedAmount, type TransactionKind } from "@/lib/finance";

export type ImpactReason = "counted_in_balance" | "before_snapshot" | "future_dated" | "excluded";

export interface TransactionImpact {
  /** Counted by balanceAt(now): snapshotAt < occurredAt <= now and kind is not `excluded`. */
  affectsCurrentBalance: boolean;
  /** occurredAt is after `now`; it enters the forecast, not today's balance. */
  isFuture: boolean;
  /** occurredAt <= snapshotAt: shapes analytics/history only (AC-04). Equal to the snapshot instant counts as historical. */
  isHistoricalOnly: boolean;
  reason: ImpactReason;
  /** Signed change this row makes to the current balance (0n unless it is counted). */
  balanceDeltaVnd: bigint;
}

/**
 * Mirrors `balanceAt` in the finance engine: a row is counted only when
 * `snapshotAt < occurredAt <= now`; `excluded` rows never move cash.
 */
export function computeTransactionImpact(
  transaction: { occurredAt: Date; kind: TransactionKind; amountVnd: bigint },
  snapshotAt: Date,
  now: Date,
): TransactionImpact {
  const at = transaction.occurredAt.getTime();
  const isHistoricalOnly = at <= snapshotAt.getTime();
  const isFuture = at > now.getTime();
  const counted = !isHistoricalOnly && !isFuture && transaction.kind !== "excluded";
  const reason: ImpactReason = isHistoricalOnly
    ? "before_snapshot"
    : isFuture
      ? "future_dated"
      : transaction.kind === "excluded"
        ? "excluded"
        : "counted_in_balance";
  return {
    affectsCurrentBalance: counted,
    isFuture,
    isHistoricalOnly,
    reason,
    balanceDeltaVnd: counted ? signedAmount(transaction) : 0n,
  };
}

export const IMPACT_MESSAGES_VI: Record<ImpactReason, string> = {
  counted_in_balance: "Giao dịch này được tính vào số dư hiện tại.",
  before_snapshot:
    "Giao dịch này nằm trước thời điểm số dư gốc nên chỉ ảnh hưởng phân tích lịch sử, không thay đổi số dư hiện tại.",
  future_dated: "Giao dịch này ở tương lai nên chưa thay đổi số dư hiện tại; nó được đưa vào dự báo.",
  excluded: "Giao dịch loại trừ không làm thay đổi số dư hiện tại.",
};
