import type { LocalDate } from "./dates";
import type { ForecastSummary } from "./types";

export interface BalancePoint {
  date: LocalDate;
  balanceVnd: bigint;
}

/**
 * Safe means EVERY daily closing balance is >= max(0, reserve); a positive final
 * balance cannot compensate for an earlier breach.
 */
export function summarizeBalances(points: readonly BalancePoint[], reserveVnd: bigint): ForecastSummary {
  const first = points[0];
  if (!first) throw new Error("summarizeBalances requires at least one point");
  const reserve = reserveVnd > 0n ? reserveVnd : 0n;
  let minimum = first;
  let firstBelowZero: LocalDate | null = null;
  let firstBelowReserve: LocalDate | null = null;
  let breachDays = 0;
  for (const point of points) {
    if (point.balanceVnd < minimum.balanceVnd) minimum = point;
    if (point.balanceVnd < 0n && firstBelowZero === null) firstBelowZero = point.date;
    if (point.balanceVnd < reserve) {
      breachDays += 1;
      if (firstBelowReserve === null) firstBelowReserve = point.date;
    }
  }
  const last = points[points.length - 1] ?? first;
  return {
    minimumVnd: minimum.balanceVnd,
    minimumDate: minimum.date,
    endBalanceVnd: last.balanceVnd,
    firstBelowZeroDate: firstBelowZero,
    firstBelowReserveDate: firstBelowReserve,
    reserveBreachDays: breachDays,
    safe: breachDays === 0,
  };
}
