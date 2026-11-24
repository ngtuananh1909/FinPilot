import { forecastCashflow, simulatePurchase, type PurchaseSimulation, type PurchaseSimulationInput } from "@/lib/finance";
import type { SimulationDto } from "@/features/simulator/types";
import { simulationToDto } from "@/features/simulator/simulation-service";
import type { ReadinessDto } from "@/lib/settings/dto";
import { input, profile } from "../../finance/helpers";

/** Engine-built (not hand-made) simulation, so wording tests run against real engine output. */
export function runSimulation(opts: {
  balance: bigint;
  reserve: bigint;
  dailyExpense?: bigint;
  monthlyIncome?: bigint;
  paydayDay?: number | null;
  cost: bigint;
  buyNowDate?: string;
  buyLater: PurchaseSimulationInput["buyLater"];
}): PurchaseSimulation {
  const forecast = forecastCashflow(
    input({
      profile: profile({
        balanceSnapshotVnd: opts.balance,
        minimumReserveVnd: opts.reserve,
        expectedDailyExpenseVnd: opts.dailyExpense ?? 0n,
        expectedMonthlyIncomeVnd: opts.monthlyIncome ?? 0n,
        paydayDay: opts.paydayDay ?? null,
      }),
    }),
  );
  return simulatePurchase(forecast, {
    costVnd: opts.cost,
    ...(opts.buyNowDate ? { buyNowDate: opts.buyNowDate } : {}),
    buyLater: opts.buyLater,
  });
}

export const READY: ReadinessDto = { complete: true, issues: [] } as unknown as ReadinessDto;

export function toDto(sim: PurchaseSimulation, itemName: string | null = null, readiness: ReadinessDto = READY): SimulationDto {
  return simulationToDto(sim, { itemName, currentBalanceVnd: sim.scenarios.now.closingBalances[0]!.balanceVnd, readiness });
}
