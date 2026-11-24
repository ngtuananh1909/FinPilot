import { compareLocalDates, parseLocalDate, type LocalDate } from "./dates";
import { FinanceError } from "./errors";
import { assertPositiveVnd } from "./money";
import { summarizeBalances, type BalancePoint } from "./summary";
import type { Assumption, Forecast, ForecastSummary } from "./types";

export type BuyLaterChoice = { kind: "date"; date: LocalDate } | { kind: "next_payday" };

export interface PurchaseSimulationInput {
  costVnd: bigint;
  /** Defaults to the forecast start date (today). */
  buyNowDate?: LocalDate;
  buyLater: BuyLaterChoice;
}

export type Violation = "none" | "below_reserve" | "below_zero";

export interface ScenarioResult {
  name: "now" | "later";
  purchaseDate: LocalDate;
  closingBalances: BalancePoint[];
  minimumVnd: bigint;
  minimumDate: LocalDate;
  endBalanceVnd: bigint;
  /** True only if every daily balance in the horizon is >= max(0, reserve). */
  safe: boolean;
  violation: Violation;
  firstBreachDate: LocalDate | null;
  reserveBreachDays: number;
  /** minimum - reserve. Negative means the reserve is breached. */
  reserveHeadroomVnd: bigint;
}

export interface PurchaseSimulation {
  horizonDays: number;
  startDate: LocalDate;
  endDate: LocalDate;
  reserveVnd: bigint;
  costVnd: bigint;
  buyLaterSource: "date" | "next_payday";
  baseline: ForecastSummary;
  assumptions: Assumption[];
  scenarios: { now: ScenarioResult; later: ScenarioResult };
  /** later.minimum - now.minimum (positive means waiting keeps a higher low point). */
  minimumImprovementVnd: bigint;
  bothUnsafe: boolean;
}

function assertInHorizon(forecast: Forecast, date: LocalDate, label: string): void {
  parseLocalDate(date);
  if (compareLocalDates(date, forecast.startDate) < 0 || compareLocalDates(date, forecast.endDate) > 0) {
    throw new FinanceError(
      "date_outside_horizon",
      `${label} must be between ${forecast.startDate} and ${forecast.endDate}.`,
    );
  }
}

/** First recurring (or profile-derived) income date strictly after `after`, within the horizon. */
export function findNextPayday(forecast: Forecast, after: LocalDate): LocalDate | null {
  for (const event of forecast.events) {
    if (event.kind === "income" && event.source !== "transaction" && compareLocalDates(event.date, after) > 0) {
      return event.date;
    }
  }
  return null;
}

function evaluateScenario(
  forecast: Forecast,
  name: "now" | "later",
  purchaseDate: LocalDate,
  costVnd: bigint,
): ScenarioResult {
  const closingBalances: BalancePoint[] = forecast.days.map((day) => ({
    date: day.date,
    balanceVnd: compareLocalDates(day.date, purchaseDate) >= 0 ? day.closingBalanceVnd - costVnd : day.closingBalanceVnd,
  }));
  const summary = summarizeBalances(closingBalances, forecast.reserveVnd);
  const violation: Violation =
    summary.firstBelowZeroDate !== null ? "below_zero" : summary.firstBelowReserveDate !== null ? "below_reserve" : "none";
  return {
    name,
    purchaseDate,
    closingBalances,
    minimumVnd: summary.minimumVnd,
    minimumDate: summary.minimumDate,
    endBalanceVnd: summary.endBalanceVnd,
    safe: summary.safe,
    violation,
    firstBreachDate: summary.firstBelowReserveDate,
    reserveBreachDays: summary.reserveBreachDays,
    reserveHeadroomVnd: summary.minimumVnd - forecast.reserveVnd,
  };
}

/**
 * Compare buying now vs later on the SAME baseline forecast and assumptions.
 * The purchase is subtracted once, on its date and every later day.
 */
export function simulatePurchase(forecast: Forecast, input: PurchaseSimulationInput): PurchaseSimulation {
  assertPositiveVnd(input.costVnd);
  const buyNowDate = input.buyNowDate ?? forecast.startDate;
  assertInHorizon(forecast, buyNowDate, "Buy-now date");

  let buyLaterDate: LocalDate;
  if (input.buyLater.kind === "next_payday") {
    const payday = findNextPayday(forecast, buyNowDate);
    if (payday === null) {
      throw new FinanceError("payday_unknown", "No payday found inside the horizon. Choose a date instead.");
    }
    buyLaterDate = payday;
  } else {
    buyLaterDate = input.buyLater.date;
    assertInHorizon(forecast, buyLaterDate, "Buy-later date");
  }
  if (compareLocalDates(buyLaterDate, buyNowDate) <= 0) {
    throw new FinanceError("buy_later_not_after_buy_now", "Buy-later date must be after the buy-now date.");
  }

  const now = evaluateScenario(forecast, "now", buyNowDate, input.costVnd);
  const later = evaluateScenario(forecast, "later", buyLaterDate, input.costVnd);
  return {
    horizonDays: forecast.horizonDays,
    startDate: forecast.startDate,
    endDate: forecast.endDate,
    reserveVnd: forecast.reserveVnd,
    costVnd: input.costVnd,
    buyLaterSource: input.buyLater.kind,
    baseline: forecast.summary,
    assumptions: forecast.assumptions,
    scenarios: { now, later },
    minimumImprovementVnd: later.minimumVnd - now.minimumVnd,
    bothUnsafe: !now.safe && !later.safe,
  };
}
