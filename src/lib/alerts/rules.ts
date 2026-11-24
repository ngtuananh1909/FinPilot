import {
  addDays,
  compareLocalDates,
  daysInMonth,
  diffDays,
  divideRoundHalfUp,
  formatLocalDate,
  localDateOf,
  parseLocalDate,
  vndToString,
  type FinanceTransaction,
  type LocalDate,
} from "@/lib/finance";
import { formatVndText } from "@/lib/format/vnd";
import { formatShortDate } from "@/lib/format/date-vi";
import type { Alert, AlertCode, AlertInput, AlertNote, AlertSeverity, AlertsResult } from "./types";

/** A recurring expense due within this many days (today inclusive) raises `bill_due_soon`. */
export const BILL_DUE_WITHIN_DAYS = 3;
/** Recent window: the 7 complete days before today (today is only partly observed). */
export const UNUSUAL_RECENT_DAYS = 7;
/** Baseline window: the 30 days that end the day before the recent window starts. */
export const UNUSUAL_BASELINE_DAYS = 30;
/** Same sample floor the forecast engine uses for its own history estimate. */
export const UNUSUAL_MIN_TRANSACTIONS = 5;
export const UNUSUAL_MIN_DISTINCT_DAYS = 7;
/** Alert when recent spend >= 1.5x the baseline-implied spend for 7 days (3/2, exact integer test). */
export const UNUSUAL_RATIO_NUMERATOR = 3n;
export const UNUSUAL_RATIO_DENOMINATOR = 2n;
/** ...and the excess is at least this many VND (avoids alerts on tiny absolute differences). */
export const UNUSUAL_MIN_EXCESS_VND = 200_000n;
/** From this ratio (2.0x) the severity is `warning` instead of `info`. */
const UNUSUAL_WARNING_RATIO_TENTHS = 20n;

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
const CODE_RANK: Record<AlertCode, number> = {
  negative_balance: 0,
  month_end_negative: 1,
  reserve_breach: 2,
  bill_due_soon: 3,
  unusual_spending: 4,
};

const FORECAST_CAVEAT =
  "Đây là ước tính từ số dư bạn nhập, các khoản định kỳ và mức chi tiêu ước tính; thu nhập có thể đến muộn hoặc khác dự kiến và FinPilot không kết nối ngân hàng.";

const vnd = (amount: bigint): string => formatVndText(amount.toString());

function reserveBreachAlert({ forecast }: AlertInput): Alert | null {
  const { summary, reserveVnd } = forecast;
  if (reserveVnd <= 0n || summary.firstBelowReserveDate === null) return null;
  const shortfall = reserveVnd - summary.minimumVnd;
  return {
    code: "reserve_breach",
    severity: "warning",
    title: "Số dư có thể xuống dưới mức dự phòng",
    body:
      `Theo ước tính, từ ${formatShortDate(summary.firstBelowReserveDate)} số dư xuống dưới mức dự phòng ${vnd(reserveVnd)}. ` +
      `Thấp nhất là ${vnd(summary.minimumVnd)} vào ${formatShortDate(summary.minimumDate)}, thiếu ${vnd(shortfall)} so với mức dự phòng. ` +
      `Số ngày dưới mức dự phòng: ${summary.reserveBreachDays}/${forecast.horizonDays}.`,
    caveat: FORECAST_CAVEAT,
    date: summary.firstBelowReserveDate,
    evidence: {
      firstBreachDate: summary.firstBelowReserveDate,
      minimumVnd: vndToString(summary.minimumVnd),
      minimumDate: summary.minimumDate,
      reserveVnd: vndToString(reserveVnd),
      shortfallVnd: vndToString(shortfall),
      breachDays: summary.reserveBreachDays,
      horizonDays: forecast.horizonDays,
    },
  };
}

function negativeBalanceAlert({ forecast }: AlertInput): Alert | null {
  const { summary } = forecast;
  if (summary.firstBelowZeroDate === null) return null;
  return {
    code: "negative_balance",
    severity: "critical",
    title: "Số dư ước tính có thể xuống âm",
    body:
      `Theo ước tính, từ ${formatShortDate(summary.firstBelowZeroDate)} số dư xuống dưới 0 ₫. ` +
      `Thấp nhất là ${vnd(summary.minimumVnd)} vào ${formatShortDate(summary.minimumDate)}.`,
    caveat: FORECAST_CAVEAT,
    date: summary.firstBelowZeroDate,
    evidence: {
      firstNegativeDate: summary.firstBelowZeroDate,
      minimumVnd: vndToString(summary.minimumVnd),
      minimumDate: summary.minimumDate,
    },
  };
}

/** Last calendar day of the month that contains the forecast start. */
export function monthEndOf(date: LocalDate): LocalDate {
  const { year, month } = parseLocalDate(date);
  return formatLocalDate(year, month, daysInMonth(year, month));
}

function monthEndNegativeAlert({ forecast }: AlertInput): Alert | null {
  const monthEnd = monthEndOf(forecast.startDate);
  const day = forecast.days.find((d) => d.date === monthEnd);
  if (!day || day.closingBalanceVnd >= 0n) return null;
  return {
    code: "month_end_negative",
    severity: "critical",
    title: "Cuối tháng số dư ước tính bị âm",
    body: `Theo ước tính, vào cuối tháng (${formatShortDate(monthEnd)}) số dư là ${vnd(day.closingBalanceVnd)}.`,
    caveat: FORECAST_CAVEAT,
    date: monthEnd,
    evidence: { monthEndDate: monthEnd, balanceVnd: vndToString(day.closingBalanceVnd) },
  };
}

function billDueSoonAlert({ forecast, recurringLabels }: AlertInput): Alert | null {
  const today = forecast.startDate;
  const due = forecast.events.filter(
    (e) =>
      e.source === "recurring" &&
      e.kind === "expense" &&
      diffDays(e.date, today) >= 0 &&
      diffDays(e.date, today) <= BILL_DUE_WITHIN_DAYS,
  );
  if (due.length === 0) return null;
  const total = due.reduce((sum, e) => sum + e.amountVnd, 0n);
  const lines = due.map((e) => {
    const left = diffDays(e.date, today);
    const when = left === 0 ? "hôm nay" : `${formatShortDate(e.date)}, còn ${left} ngày`;
    return `${recurringLabels?.get(e.refId) ?? "Khoản định kỳ"} ${vnd(e.amountVnd)} (${when})`;
  });
  return {
    code: "bill_due_soon",
    severity: "info",
    title: "Khoản định kỳ sắp đến hạn",
    body: `Trong ${BILL_DUE_WITHIN_DAYS} ngày tới: ${lines.join("; ")}. Tổng: ${vnd(total)}.`,
    caveat: "Số tiền và ngày lấy từ khoản định kỳ bạn đã nhập; hãy kiểm tra nếu thực tế khác.",
    date: due[0]!.date,
    evidence: { count: due.length, totalVnd: vndToString(total), firstDueDate: due[0]!.date },
  };
}

interface SpendSample {
  total: bigint;
  count: number;
  days: number;
  earliest: LocalDate | null;
}

function sampleVariableSpend(
  transactions: readonly FinanceTransaction[],
  from: LocalDate,
  to: LocalDate,
): SpendSample {
  let total = 0n;
  let count = 0;
  let earliest: LocalDate | null = null;
  const days = new Set<LocalDate>();
  for (const tx of transactions) {
    // Same definition of "variable" as the forecast engine: non-recurring, expense only.
    if (tx.kind !== "expense" || tx.recurringItemId) continue;
    const date = localDateOf(tx.occurredAt);
    if (compareLocalDates(date, from) < 0 || compareLocalDates(date, to) > 0) continue;
    total += tx.amountVnd;
    count += 1;
    days.add(date);
    if (earliest === null || compareLocalDates(date, earliest) < 0) earliest = date;
  }
  return { total, count, days: days.size, earliest };
}

export interface UnusualSpendingResult {
  alert: Alert | null;
  note: AlertNote | null;
}

/**
 * Compares the last 7 complete days of variable spending with the daily average of the 30 days
 * before them (average taken over the observed span, at most 30 days, so a short history does
 * not understate the baseline). Needs >= 5 transactions on >= 7 distinct baseline days.
 * Alerts when recent >= 1.5x expected AND the excess is >= 200.000 ₫ (exact bigint arithmetic).
 * A statistical comparison only; it says nothing about whether a transaction is legitimate.
 */
export function evaluateUnusualSpending(
  transactions: readonly FinanceTransaction[],
  now: Date,
): UnusualSpendingResult {
  const today = localDateOf(now);
  const recent = sampleVariableSpend(transactions, addDays(today, -UNUSUAL_RECENT_DAYS), addDays(today, -1));
  const baselineEnd = addDays(today, -UNUSUAL_RECENT_DAYS - 1);
  const baseline = sampleVariableSpend(
    transactions,
    addDays(baselineEnd, -(UNUSUAL_BASELINE_DAYS - 1)),
    baselineEnd,
  );
  if (
    baseline.earliest === null ||
    baseline.count < UNUSUAL_MIN_TRANSACTIONS ||
    baseline.days < UNUSUAL_MIN_DISTINCT_DAYS
  ) {
    return {
      alert: null,
      note: {
        code: "unusual_spending_insufficient_data",
        message:
          `Chưa đủ dữ liệu để so sánh chi tiêu 7 ngày qua với 30 ngày trước ` +
          `(cần ít nhất ${UNUSUAL_MIN_TRANSACTIONS} giao dịch trong ${UNUSUAL_MIN_DISTINCT_DAYS} ngày khác nhau; ` +
          `hiện có ${baseline.count} giao dịch trong ${baseline.days} ngày).`,
      },
    };
  }
  const spanDays = BigInt(Math.min(UNUSUAL_BASELINE_DAYS, diffDays(baselineEnd, baseline.earliest) + 1));
  const recentDays = BigInt(UNUSUAL_RECENT_DAYS);
  // expected7 = baseline.total * 7 / spanDays. Compare cross-multiplied to avoid rounding:
  //   recent >= ratio * expected7  <=>  recent * spanDays * den >= num * 7 * baseline.total
  const ratioHit =
    recent.total * spanDays * UNUSUAL_RATIO_DENOMINATOR >=
    UNUSUAL_RATIO_NUMERATOR * recentDays * baseline.total;
  const excessHit =
    recent.total * spanDays - recentDays * baseline.total >= UNUSUAL_MIN_EXCESS_VND * spanDays;
  if (!ratioHit || !excessHit) return { alert: null, note: null };

  const expected7 = divideRoundHalfUp(baseline.total * recentDays, spanDays);
  const excess = recent.total - expected7;
  const ratioTenths = (recent.total * spanDays * 10n) / (recentDays * baseline.total);
  const ratioText = `${ratioTenths / 10n},${ratioTenths % 10n}`;
  const from = formatShortDate(addDays(today, -UNUSUAL_RECENT_DAYS));
  const to = formatShortDate(addDays(today, -1));
  const severity: AlertSeverity = ratioTenths >= UNUSUAL_WARNING_RATIO_TENTHS ? "warning" : "info";
  return {
    alert: {
      code: "unusual_spending",
      severity,
      title: "Chi tiêu bất thường so với 30 ngày trước",
      body:
        `7 ngày qua (${from}–${to}) bạn chi ${vnd(recent.total)} cho các khoản không định kỳ, ` +
        `gấp khoảng ${ratioText} lần mức ${vnd(expected7)} suy ra từ trung bình 30 ngày trước đó ` +
        `(chênh ${vnd(excess)}). Mẫu so sánh: ${baseline.count} giao dịch trong ${baseline.days} ngày ` +
        `(${recent.count} giao dịch trong 7 ngày qua).`,
      caveat:
        "Đây chỉ là so sánh thống kê với thói quen chi tiêu trước đó, không đánh giá giao dịch nào đúng hay sai. " +
        "Một khoản chi lớn có chủ đích hoặc dữ liệu chưa đầy đủ vẫn có thể tạo ra cảnh báo này.",
      date: null,
      evidence: {
        recentTotalVnd: vndToString(recent.total),
        expectedVnd: vndToString(expected7),
        excessVnd: vndToString(excess),
        ratio: ratioText,
        baselineTransactions: baseline.count,
        baselineDays: baseline.days,
        recentTransactions: recent.count,
      },
    },
    note: null,
  };
}

/**
 * Deterministic rule-based alerts. Pure: same input -> same output, no clock, no I/O.
 * Sorted by severity (critical first), then by a fixed rule order.
 */
export function evaluateAlerts(input: AlertInput): AlertsResult {
  const unusual = evaluateUnusualSpending(input.transactions, input.now);
  const alerts = [
    negativeBalanceAlert(input),
    monthEndNegativeAlert(input),
    reserveBreachAlert(input),
    billDueSoonAlert(input),
    unusual.alert,
  ].filter((alert): alert is Alert => alert !== null);
  alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || CODE_RANK[a.code] - CODE_RANK[b.code]);
  return { alerts, notes: unusual.note ? [unusual.note] : [] };
}
