import type { OwnerContext } from "@/lib/auth/owner-context";
import { evaluateAlerts } from "@/lib/alerts";
import { isDbError } from "@/lib/db/errors";
import type { RecurringRecord, TransactionRecord } from "@/lib/db/mappers";
import { loadFinanceInputs } from "@/lib/db/repositories/load-inputs";
import type { DbClient } from "@/lib/db/repositories/shared";
import { diffDays, forecastCashflow, vndToString, type ForecastEvent } from "@/lib/finance";
import { assumptionToDto } from "@/lib/finance-dto/assumptions";
import { assessForecastReadiness } from "@/lib/settings/readiness";
import { readinessToDto } from "@/lib/settings/dto";
import { transactionToDto } from "@/lib/transactions/dto";
import { monthToDateTotals } from "./month-totals";
import type { OverviewDto, OverviewReadyDto, UpcomingItemDto } from "./overview-types";

export const UPCOMING_LIMIT = 10;
export const RECENT_TRANSACTION_LIMIT = 5;
const PROFILE_INCOME_LABEL = "Lương dự kiến (theo hồ sơ)";

// The loader maps full rows but types them as the engine's minimal shapes; narrow at runtime.
const isTransactionRecord = (tx: object): tx is TransactionRecord => "category" in tx && "source" in tx;
const isRecurringRecord = (item: object): item is RecurringRecord => "label" in item;

function upcomingLabel(
  event: ForecastEvent,
  recurringLabels: ReadonlyMap<string, string>,
  transactionLabels: ReadonlyMap<string, string>,
): string {
  if (event.source === "profile_income") return PROFILE_INCOME_LABEL;
  if (event.source === "recurring") return recurringLabels.get(event.refId) ?? "Khoản định kỳ";
  return transactionLabels.get(event.refId) ?? (event.kind === "income" ? "Khoản thu đã lên lịch" : "Khoản chi đã lên lịch");
}

const INCOMPLETE_MESSAGES = {
  profile_missing: "Chưa có hồ sơ tài chính. Hãy hoàn thiện hồ sơ để xem số dư và dự báo 45 ngày.",
  profile_empty: "Hồ sơ tài chính còn trống. Hãy nhập số dư hiện tại hoặc thêm giao dịch để bắt đầu dự báo.",
  balance_unreliable:
    "Không đủ dữ liệu giao dịch để tính số dư đáng tin cậy (danh sách giao dịch quá dài). FinPilot không hiển thị số dư có thể sai.",
} as const;

/**
 * Builds the dashboard document for the verified owner with the user-scoped (RLS) client and an
 * injected clock. Numbers come from the deterministic engine (forecastCashflow); this function only
 * assembles and serialises them. Returns a typed `incomplete` state instead of zeros when the
 * profile is missing or the balance cannot be trusted.
 */
export async function getOverviewForOwner(client: DbClient, owner: OwnerContext, now: Date): Promise<OverviewDto> {
  const asOf = now.toISOString();
  let loaded: Awaited<ReturnType<typeof loadFinanceInputs>>;
  try {
    loaded = await loadFinanceInputs(client, owner, now);
  } catch (error) {
    if (isDbError(error) && error.reason === "profile_missing") {
      return { state: "incomplete", reason: "profile_missing", message: INCOMPLETE_MESSAGES.profile_missing, asOf, readiness: null };
    }
    throw error;
  }
  const { profile, transactions, recurringItems } = loaded;
  const readiness = readinessToDto(
    assessForecastReadiness({
      balanceSnapshotVnd: profile.balanceSnapshotVnd,
      paydayDay: profile.paydayDay,
      expectedMonthlyIncomeVnd: profile.expectedMonthlyIncomeVnd,
      expectedDailyExpenseVnd: profile.expectedDailyExpenseVnd,
      // A cut-off list is assumed to contain active items beyond the cut-off (same rule as Settings).
      activeRecurringCount: recurringItems.filter((i) => i.active).length + (loaded.recurringTruncated ? 1 : 0),
    }),
  );

  if (!loaded.balanceReliable) {
    return { state: "incomplete", reason: "balance_unreliable", message: INCOMPLETE_MESSAGES.balance_unreliable, asOf, readiness };
  }
  if (readiness.issues.length === 5 && transactions.length === 0) {
    // Every onboarding input is blank and nothing was ever recorded: there is nothing to forecast.
    return { state: "incomplete", reason: "profile_empty", message: INCOMPLETE_MESSAGES.profile_empty, asOf, readiness };
  }

  const forecast = forecastCashflow({ profile, transactions, recurringItems, now });

  const records = transactions.filter(isTransactionRecord);
  const recurringLabels = new Map(recurringItems.filter(isRecurringRecord).map((i) => [i.id, i.label] as const));
  const transactionLabels = new Map(
    records.map((t) => [t.id, t.merchant ?? t.description ?? t.category] as const),
  );

  const alerts = evaluateAlerts({ forecast, transactions, recurringLabels, now });
  const month = monthToDateTotals(transactions, now);
  const reserve = forecast.reserveVnd;

  const upcoming: UpcomingItemDto[] = forecast.events.slice(0, UPCOMING_LIMIT).map((event) => ({
    date: event.date,
    daysFromToday: diffDays(event.date, forecast.startDate),
    kind: event.kind,
    amountVnd: vndToString(event.amountVnd),
    label: upcomingLabel(event, recurringLabels, transactionLabels),
    source: event.source,
    estimated: event.source === "profile_income",
  }));

  const variable = forecast.assumptions[0];
  const variableExpenseBasis: OverviewReadyDto["completeness"]["variableExpenseBasis"] =
    variable?.code === "variable_expense_history"
      ? "history"
      : variable?.code === "variable_expense_profile_fallback"
        ? "profile_fallback"
        : "missing";

  const nowMs = now.getTime();
  const recent = records
    .filter((t) => t.occurredAt.getTime() <= nowMs)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || (a.id < b.id ? 1 : -1))
    .slice(0, RECENT_TRANSACTION_LIMIT)
    .map(transactionToDto);

  const summary = forecast.summary;
  return {
    state: "ready",
    asOf,
    timeZone: "Asia/Ho_Chi_Minh",
    currentBalance: {
      amountVnd: vndToString(forecast.startingBalanceVnd),
      asOf,
      snapshotAt: profile.balanceSnapshotAt.toISOString(),
      snapshotVnd: vndToString(profile.balanceSnapshotVnd),
    },
    month: {
      start: month.start,
      incomeVnd: vndToString(month.incomeVnd),
      expenseVnd: vndToString(month.expenseVnd),
      incomeCount: month.incomeCount,
      expenseCount: month.expenseCount,
    },
    reserveVnd: vndToString(reserve),
    availableAfterReserveVnd: vndToString(forecast.startingBalanceVnd - reserve),
    forecast: {
      horizonDays: forecast.horizonDays,
      startDate: forecast.startDate,
      endDate: forecast.endDate,
      days: forecast.days.map((d) => ({
        date: d.date,
        closingBalanceVnd: vndToString(d.closingBalanceVnd),
        belowReserve: d.belowReserve,
        belowZero: d.belowZero,
      })),
      summary: {
        minimumVnd: vndToString(summary.minimumVnd),
        minimumDate: summary.minimumDate,
        endBalanceVnd: vndToString(summary.endBalanceVnd),
        firstBelowReserveDate: summary.firstBelowReserveDate,
        firstBelowZeroDate: summary.firstBelowZeroDate,
        reserveBreachDays: summary.reserveBreachDays,
        safe: summary.safe,
      },
    },
    upcoming,
    assumptions: forecast.assumptions.map(assumptionToDto),
    unreconciled: forecast.unreconciledOccurrences.map((u) => ({
      itemId: u.itemId,
      label: recurringLabels.get(u.itemId) ?? "Khoản định kỳ",
      date: u.date,
      kind: u.kind,
      amountVnd: vndToString(u.amountVnd),
    })),
    completeness: {
      complete: readiness.complete && !loaded.truncated && forecast.unreconciledOccurrences.length === 0,
      issues: readiness.issues,
      truncated: loaded.truncated,
      balanceReliable: loaded.balanceReliable,
      variableExpenseBasis,
    },
    recentTransactions: recent,
    alerts: alerts.alerts,
    alertNotes: alerts.notes,
  };
}
