import type { OwnerContext } from "@/lib/auth/owner-context";
import { parseInput } from "@/lib/db/inputs";
import { loadFinanceInputs } from "@/lib/db/repositories/load-inputs";
import type { DbClient } from "@/lib/db/repositories/shared";
import { AppError } from "@/lib/errors";
import {
  FinanceError,
  forecastCashflow,
  simulatePurchase,
  vndToString,
  type PurchaseSimulation,
  type ScenarioResult,
} from "@/lib/finance";
import { assumptionToDto } from "@/lib/finance-dto/assumptions";
import { formatFullDate } from "@/lib/format/date-vi";
import { readinessToDto } from "@/lib/settings/dto";
import { assessForecastReadiness } from "@/lib/settings/readiness";
import { SIMULATION_CAVEAT, buildConclusions } from "./conclusions";
import { purchaseSimulationBodySchema } from "./schema";
import type { ScenarioDto, SimulationDto } from "./types";

function scenarioToDto(s: ScenarioResult): ScenarioDto {
  return {
    name: s.name,
    purchaseDate: s.purchaseDate,
    series: s.closingBalances.map((p) => ({ date: p.date, balanceVnd: vndToString(p.balanceVnd) })),
    minimumVnd: vndToString(s.minimumVnd),
    minimumDate: s.minimumDate,
    endBalanceVnd: vndToString(s.endBalanceVnd),
    safe: s.safe,
    violation: s.violation,
    firstBreachDate: s.firstBreachDate,
    reserveBreachDays: s.reserveBreachDays,
    reserveHeadroomVnd: vndToString(s.reserveHeadroomVnd),
  };
}

export function simulationToDto(
  sim: PurchaseSimulation,
  context: { itemName: string | null; currentBalanceVnd: bigint; readiness: SimulationDto["readiness"] },
): SimulationDto {
  const b = sim.baseline;
  return {
    itemName: context.itemName,
    costVnd: vndToString(sim.costVnd),
    horizonDays: sim.horizonDays,
    startDate: sim.startDate,
    endDate: sim.endDate,
    reserveVnd: vndToString(sim.reserveVnd),
    currentBalanceVnd: vndToString(context.currentBalanceVnd),
    buyLaterSource: sim.buyLaterSource,
    baseline: {
      minimumVnd: vndToString(b.minimumVnd),
      minimumDate: b.minimumDate,
      endBalanceVnd: vndToString(b.endBalanceVnd),
      firstBelowReserveDate: b.firstBelowReserveDate,
      firstBelowZeroDate: b.firstBelowZeroDate,
      reserveBreachDays: b.reserveBreachDays,
      safe: b.safe,
    },
    scenarios: { now: scenarioToDto(sim.scenarios.now), later: scenarioToDto(sim.scenarios.later) },
    minimumImprovementVnd: vndToString(sim.minimumImprovementVnd),
    bothUnsafe: sim.bothUnsafe,
    assumptions: sim.assumptions.map(assumptionToDto),
    conclusions: buildConclusions(sim, context.itemName),
    caveat: SIMULATION_CAVEAT,
    readiness: context.readiness,
  };
}

/** Finance validation failures the user can fix by reselecting a date get a specific message. */
function mapSimulationError(error: unknown, window: { startDate: string; endDate: string }): never {
  if (error instanceof FinanceError) {
    if (error.code === "payday_unknown") {
      throw new AppError("finance_invalid_input", {
        userMessage:
          "Chưa xác định được ngày nhận lương trong 45 ngày tới nên chưa thể so sánh. Hãy chọn một ngày cụ thể cho lần mua sau.",
        safeDetails: { financeCode: "payday_unknown" },
        cause: error,
      });
    }
    if (error.code === "date_outside_horizon") {
      throw new AppError("finance_invalid_input", {
        userMessage:
          `Ngày đã chọn nằm ngoài khoảng dự báo (${formatFullDate(window.startDate)} đến ${formatFullDate(window.endDate)}). ` +
          "Hãy chọn lại ngày trong khoảng này; FinPilot không so sánh khi ngày nằm ngoài khoảng dự báo.",
        safeDetails: { financeCode: "date_outside_horizon", startDate: window.startDate, endDate: window.endDate },
        cause: error,
      });
    }
  }
  throw error;
}

/**
 * Runs the engine for the verified owner: forecast (server clock) then simulatePurchase on the SAME
 * baseline. Read-only. `body` is untrusted JSON, validated by a strict schema.
 */
export async function simulatePurchaseForOwner(
  client: DbClient,
  owner: OwnerContext,
  body: unknown,
  now: Date,
): Promise<SimulationDto> {
  const input = parseInput(purchaseSimulationBodySchema, body);
  const loaded = await loadFinanceInputs(client, owner, now);
  if (!loaded.balanceReliable) {
    throw new AppError("finance_invalid_input", {
      userMessage: "Không đủ dữ liệu giao dịch để tính số dư đáng tin cậy nên chưa thể mô phỏng. Hãy cập nhật số dư mới trong Cài đặt.",
      safeDetails: { financeCode: "balance_unreliable" },
    });
  }
  const forecast = forecastCashflow({
    profile: loaded.profile,
    transactions: loaded.transactions,
    recurringItems: loaded.recurringItems,
    now,
  });
  let simulation: PurchaseSimulation;
  try {
    simulation = simulatePurchase(forecast, {
      costVnd: input.costVnd,
      ...(input.buyNowDate === undefined ? {} : { buyNowDate: input.buyNowDate }),
      buyLater: input.buyLater,
    });
  } catch (error) {
    return mapSimulationError(error, forecast);
  }
  const readiness = readinessToDto(
    assessForecastReadiness({
      balanceSnapshotVnd: loaded.profile.balanceSnapshotVnd,
      paydayDay: loaded.profile.paydayDay,
      expectedMonthlyIncomeVnd: loaded.profile.expectedMonthlyIncomeVnd,
      expectedDailyExpenseVnd: loaded.profile.expectedDailyExpenseVnd,
      activeRecurringCount: loaded.recurringItems.filter((i) => i.active).length + (loaded.recurringTruncated ? 1 : 0),
    }),
  );
  return simulationToDto(simulation, {
    itemName: input.itemName && input.itemName.length > 0 ? input.itemName : null,
    currentBalanceVnd: forecast.startingBalanceVnd,
    readiness,
  });
}
