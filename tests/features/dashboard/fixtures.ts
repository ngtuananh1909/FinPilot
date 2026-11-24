import type { OverviewReadyDto, OverviewIncompleteDto } from "@/features/dashboard/overview-types";
import type { Alert } from "@/lib/alerts";
import { addDays } from "@/lib/finance";

const START = "2026-11-24";

/** 45 daily balances falling 100.000 ₫ per day from 2.500.000 ₫ (hand-made DTO: this tests rendering only). */
export function readyOverview(over: Partial<OverviewReadyDto> = {}): OverviewReadyDto {
  const days = Array.from({ length: 45 }, (_, i) => {
    const balance = 2_500_000 - i * 100_000;
    return {
      date: addDays(START, i),
      closingBalanceVnd: String(balance),
      belowReserve: balance < 300_000,
      belowZero: balance < 0,
    };
  });
  return {
    state: "ready",
    asOf: "2026-11-24T05:00:00.000Z",
    timeZone: "Asia/Ho_Chi_Minh",
    currentBalance: {
      amountVnd: "2500000",
      asOf: "2026-11-24T05:00:00.000Z",
      snapshotAt: "2026-11-20T02:00:00.000Z",
      snapshotVnd: "2800000",
    },
    month: { start: "2026-11-01", incomeVnd: "0", expenseVnd: "300000", incomeCount: 0, expenseCount: 3 },
    reserveVnd: "300000",
    availableAfterReserveVnd: "2200000",
    forecast: {
      horizonDays: 45,
      startDate: START,
      endDate: addDays(START, 44),
      days,
      summary: {
        minimumVnd: "-1900000",
        minimumDate: addDays(START, 44),
        endBalanceVnd: "-1900000",
        firstBelowReserveDate: addDays(START, 23),
        firstBelowZeroDate: addDays(START, 25),
        reserveBreachDays: 22,
        safe: false,
      },
    },
    upcoming: [
      { date: "2026-12-01", daysFromToday: 7, kind: "expense", amountVnd: "1500000", label: "Tiền trọ", source: "recurring", estimated: false },
      { date: "2026-12-05", daysFromToday: 11, kind: "income", amountVnd: "6000000", label: "Lương dự kiến (theo hồ sơ)", source: "profile_income", estimated: true },
    ],
    assumptions: [{ code: "variable_expense_profile_fallback", dailyVnd: "100000", sampleTransactionCount: 2, sampleDayCount: 2 }],
    unreconciled: [],
    completeness: { complete: true, issues: [], truncated: false, balanceReliable: true, variableExpenseBasis: "profile_fallback" },
    recentTransactions: [
      {
        id: "t1",
        occurredAt: "2026-11-23T05:00:00.000Z",
        localDate: "2026-11-23",
        kind: "expense",
        amountVnd: "45000",
        category: "food",
        merchant: "Cơm tấm",
        description: null,
        source: "manual",
        importBatchId: null,
        recurringItemId: null,
        recurringInstanceDate: null,
        createdAt: "2026-11-23T05:00:00.000Z",
        updatedAt: "2026-11-23T05:00:00.000Z",
      },
    ],
    alerts: [],
    alertNotes: [],
    ...over,
  };
}

export const reserveAlert: Alert = {
  code: "reserve_breach",
  severity: "warning",
  title: "Số dư có thể xuống dưới mức dự phòng",
  body: "Theo ước tính, từ 17/12 số dư xuống dưới mức dự phòng 300.000 ₫.",
  caveat: "Đây là ước tính từ số dư bạn nhập.",
  date: "2026-12-17",
  evidence: {},
};

export const negativeAlert: Alert = {
  code: "negative_balance",
  severity: "critical",
  title: "Số dư có thể xuống âm",
  body: "Theo ước tính, từ 19/12 số dư xuống âm.",
  caveat: "Đây là ước tính.",
  date: "2026-12-19",
  evidence: {},
};

export const incomplete = (reason: OverviewIncompleteDto["reason"]): OverviewIncompleteDto => ({
  state: "incomplete",
  reason,
  message: "Chưa có hồ sơ tài chính. Hãy hoàn thiện hồ sơ để xem số dư và dự báo 45 ngày.",
  asOf: "2026-11-24T05:00:00.000Z",
  readiness: null,
});
