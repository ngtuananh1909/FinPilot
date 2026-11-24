import type { Alert, AlertNote } from "@/lib/alerts";
import type { AssumptionDto } from "@/lib/finance-dto/assumptions";
import type { ReadinessDto } from "@/lib/settings/dto";
import type { TransactionDto } from "@/lib/transactions/dto";

/** Wire contract of GET /api/finance/overview. No bigint anywhere: amounts are decimal strings. */

export interface OverviewDayDto {
  date: string;
  closingBalanceVnd: string;
  belowReserve: boolean;
  belowZero: boolean;
}

export interface UpcomingItemDto {
  date: string;
  /** Whole days from today (0 = today). */
  daysFromToday: number;
  kind: "income" | "expense";
  amountVnd: string;
  label: string;
  source: "recurring" | "profile_income" | "transaction";
  /** True when the amount/date is an estimate (income taken from the profile). */
  estimated: boolean;
}

export interface UnreconciledDto {
  itemId: string;
  label: string;
  date: string;
  kind: "income" | "expense";
  amountVnd: string;
}

export interface OverviewReadyDto {
  state: "ready";
  /** Server clock when computed (ISO UTC). */
  asOf: string;
  timeZone: "Asia/Ho_Chi_Minh";
  currentBalance: { amountVnd: string; asOf: string; snapshotAt: string; snapshotVnd: string };
  month: {
    /** YYYY-MM-01 of the month in Asia/Ho_Chi_Minh. */
    start: string;
    incomeVnd: string;
    expenseVnd: string;
    incomeCount: number;
    expenseCount: number;
  };
  reserveVnd: string;
  /** currentBalance - reserve. May be negative. */
  availableAfterReserveVnd: string;
  forecast: {
    horizonDays: number;
    startDate: string;
    endDate: string;
    days: OverviewDayDto[];
    summary: {
      minimumVnd: string;
      minimumDate: string;
      endBalanceVnd: string;
      firstBelowReserveDate: string | null;
      firstBelowZeroDate: string | null;
      reserveBreachDays: number;
      safe: boolean;
    };
  };
  upcoming: UpcomingItemDto[];
  assumptions: AssumptionDto[];
  unreconciled: UnreconciledDto[];
  completeness: {
    complete: boolean;
    issues: ReadinessDto["issues"];
    truncated: boolean;
    balanceReliable: boolean;
    variableExpenseBasis: "history" | "profile_fallback" | "missing";
  };
  recentTransactions: TransactionDto[];
  alerts: Alert[];
  alertNotes: AlertNote[];
}

export type OverviewIncompleteReason = "profile_missing" | "profile_empty" | "balance_unreliable";

/** Typed incomplete state: never carries a balance, so nothing can be displayed as a fabricated number. */
export interface OverviewIncompleteDto {
  state: "incomplete";
  reason: OverviewIncompleteReason;
  message: string;
  asOf: string;
  readiness: ReadinessDto | null;
}

export type OverviewDto = OverviewReadyDto | OverviewIncompleteDto;
