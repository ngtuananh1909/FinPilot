import { vndToString } from "@/lib/finance";
import type { GoalRecord, ProfileRecord } from "@/lib/db/mappers";
import { goalProgress } from "./goal";
import type { ForecastReadiness } from "./readiness";

/** Wire shapes: amounts are decimal strings (never bigint), instants ISO UTC, no user_id. */
export interface ProfileDto {
  displayName: string;
  balanceSnapshot: { amountVnd: string; at: string };
  expectedMonthlyIncomeVnd: string;
  paydayDay: number | null;
  /** Estimated variable spend per day. */
  expectedDailyExpenseVnd: string;
  projectedMonthlyBudgetVnd: string;
  minimumReserveVnd: string;
  isDemo: boolean;
  personaCode: string | null;
  updatedAt: string;
}

export interface GoalDto {
  name: string;
  targetVnd: string;
  savedVnd: string;
  targetDate: string | null;
  updatedAt: string;
  reached: boolean;
  progress: { percent: number; remainingVnd: string };
}

export interface ReadinessDto {
  complete: boolean;
  issues: { field: string; problem: "missing" | "zero" }[];
}

export function profileToDto(p: ProfileRecord): ProfileDto {
  return {
    displayName: p.displayName,
    balanceSnapshot: { amountVnd: vndToString(p.balanceSnapshotVnd), at: p.balanceSnapshotAt.toISOString() },
    expectedMonthlyIncomeVnd: vndToString(p.expectedMonthlyIncomeVnd),
    paydayDay: p.paydayDay,
    expectedDailyExpenseVnd: vndToString(p.expectedDailyExpenseVnd),
    projectedMonthlyBudgetVnd: vndToString(p.projectedMonthlyBudgetVnd),
    minimumReserveVnd: vndToString(p.minimumReserveVnd),
    isDemo: p.isDemo,
    personaCode: p.personaCode,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function goalToDto(g: GoalRecord): GoalDto {
  const progress = goalProgress(g.targetVnd, g.savedVnd);
  return {
    name: g.name,
    targetVnd: vndToString(g.targetVnd),
    savedVnd: vndToString(g.savedVnd),
    targetDate: g.targetDate,
    updatedAt: g.updatedAt.toISOString(),
    reached: progress.reached,
    progress: { percent: progress.percent, remainingVnd: vndToString(progress.remainingVnd) },
  };
}

export function readinessToDto(r: ForecastReadiness): ReadinessDto {
  return { complete: r.complete, issues: r.issues.map((i) => ({ field: i.field, problem: i.problem })) };
}
