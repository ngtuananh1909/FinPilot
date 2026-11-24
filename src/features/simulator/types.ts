import type { AssumptionDto } from "@/lib/finance-dto/assumptions";
import type { ReadinessDto } from "@/lib/settings/dto";

/** Wire contract of POST /api/simulations/purchase. No bigint: amounts are decimal strings. */

export interface ScenarioDto {
  name: "now" | "later";
  purchaseDate: string;
  /** Daily closing balance with the purchase applied once, over the common horizon. */
  series: { date: string; balanceVnd: string }[];
  minimumVnd: string;
  minimumDate: string;
  endBalanceVnd: string;
  /** True only if EVERY daily balance is >= max(0, reserve). */
  safe: boolean;
  violation: "none" | "below_reserve" | "below_zero";
  firstBreachDate: string | null;
  reserveBreachDays: number;
  /** minimum - reserve; negative means the reserve is breached. */
  reserveHeadroomVnd: string;
}

export interface SimulationDto {
  itemName: string | null;
  costVnd: string;
  horizonDays: number;
  startDate: string;
  endDate: string;
  reserveVnd: string;
  currentBalanceVnd: string;
  buyLaterSource: "date" | "next_payday";
  baseline: {
    minimumVnd: string;
    minimumDate: string;
    endBalanceVnd: string;
    firstBelowReserveDate: string | null;
    firstBelowZeroDate: string | null;
    reserveBreachDays: number;
    safe: boolean;
  };
  scenarios: { now: ScenarioDto; later: ScenarioDto };
  /** later.minimum - now.minimum (positive: waiting keeps a higher low point). */
  minimumImprovementVnd: string;
  bothUnsafe: boolean;
  assumptions: AssumptionDto[];
  /** Plain-language Vietnamese conclusions generated from the engine result. */
  conclusions: string[];
  caveat: string;
  readiness: ReadinessDto;
}

export interface SimulatorRequestBody {
  costVnd: string;
  itemName?: string;
  buyNowDate?: string;
  buyLater: { kind: "date"; date: string } | { kind: "next_payday" };
}
