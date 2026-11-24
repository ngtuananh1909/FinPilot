import { compareLocalDates, FinanceError, localDateOf, type LocalDate } from "@/lib/finance";
import { DbError } from "@/lib/db/errors";

export interface GoalProgress {
  /** Integer 0..100, rounded DOWN so 100 means the target is actually reached. */
  readonly percent: number;
  /** max(0, target - saved). */
  readonly remainingVnd: bigint;
  readonly reached: boolean;
}

/** Pure bigint arithmetic: no float, so huge amounts cannot lose precision. */
export function goalProgress(targetVnd: bigint, savedVnd: bigint): GoalProgress {
  if (typeof targetVnd !== "bigint" || typeof savedVnd !== "bigint" || targetVnd <= 0n || savedVnd < 0n) {
    throw new FinanceError("invalid_amount", "Goal target must be positive and saved amount non-negative.");
  }
  if (savedVnd >= targetVnd) return { percent: 100, remainingVnd: 0n, reached: true };
  return { percent: Number((savedVnd * 100n) / targetVnd), remainingVnd: targetVnd - savedVnd, reached: false };
}

/**
 * A goal deadline may not be before today (Asia/Ho_Chi_Minh) unless it is the value already
 * stored, so editing the name/saved amount of an overdue goal still works. Today is allowed.
 */
export function assertTargetDateAllowed(
  next: LocalDate | null | undefined,
  existing: LocalDate | null,
  now: Date,
): void {
  if (next == null) return;
  if (existing !== null && next === existing) return;
  if (compareLocalDates(next, localDateOf(now)) < 0) {
    throw new DbError("invalid_input", {
      userMessage: "Hạn mục tiêu không được ở trong quá khứ.",
      safeDetails: { field: "targetDate", rule: "target_date_in_past" },
    });
  }
}
