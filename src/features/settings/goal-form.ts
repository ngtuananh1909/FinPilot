import { compareLocalDates, localDateOf, parseLocalDate } from "@/lib/finance";
import { amountToInputText, parseAmountField, percentOf } from "@/lib/format/money-input";
import type { ApiFailure } from "@/lib/http/api-call";
import type { GoalDto } from "@/lib/settings/dto";
export interface GoalFormValues {
  name: string;
  target: string;
  saved: string;
  /** "" = no deadline. */
  targetDate: string;
}
export type GoalFormErrors = Partial<Record<keyof GoalFormValues, string>>;
export const emptyGoalValues = (): GoalFormValues => ({ name: "", target: "", saved: "0", targetDate: "" });
export const goalValuesFrom = (goal: GoalDto): GoalFormValues => ({
  name: goal.name,
  target: amountToInputText(goal.targetVnd),
  saved: amountToInputText(goal.savedVnd),
  targetDate: goal.targetDate ?? "",
});
function isRealDate(text: string): boolean {
  try {
    parseLocalDate(text);
    return true;
  } catch {
    return false;
  }
}
/**
 * `existingTargetDate` is the deadline already stored: an overdue goal may keep its date while its
 * name or saved amount is edited, mirroring the server rule. Any other date must not be in the past.
 */
export function validateGoalForm(values: GoalFormValues, now: Date, existingTargetDate: string | null): GoalFormErrors {
  const errors: GoalFormErrors = {};
  if (!values.name.trim()) errors.name = "Vui lòng đặt tên cho mục tiêu.";
  else if (values.name.trim().length > 100) errors.name = "Tên mục tiêu tối đa 100 ký tự.";
  const target = parseAmountField(values.target, "positive", "Số tiền mục tiêu");
  if (!target.ok) errors.target = target.message;
  const saved = parseAmountField(values.saved, "non_negative", "Số tiền đã tiết kiệm");
  if (!saved.ok) errors.saved = saved.message;
  if (values.targetDate) {
    if (!isRealDate(values.targetDate)) errors.targetDate = "Chọn hạn hợp lệ.";
    else if (values.targetDate !== existingTargetDate && compareLocalDates(values.targetDate, localDateOf(now)) < 0) {
      errors.targetDate = "Hạn mục tiêu không được ở trong quá khứ.";
    }
  }
  return errors;
}
/** PUT body (the endpoint replaces the single goal; an omitted `targetDate` clears the deadline). */
export function buildGoalBody(values: GoalFormValues): Record<string, unknown> {
  const target = parseAmountField(values.target, "positive");
  const saved = parseAmountField(values.saved, "non_negative");
  if (!target.ok || !saved.ok) throw new Error("invalid_goal_form");
  return {
    name: values.name.trim(),
    targetVnd: target.value,
    savedVnd: saved.value,
    ...(values.targetDate ? { targetDate: values.targetDate } : {}),
  };
}
const FIELD_TO_FORM: Record<string, keyof GoalFormValues> = {
  name: "name",
  targetVnd: "target",
  savedVnd: "saved",
  targetDate: "targetDate",
};
export function mapGoalFailure(failure: ApiFailure): { fieldErrors: GoalFormErrors; general: string | null } {
  const key = failure.field ? FIELD_TO_FORM[failure.field] : undefined;
  if (failure.code === "validation_failed" && key) {
    return {
      fieldErrors: {
        [key]: failure.rule === "target_date_in_past" ? "Hạn mục tiêu không được ở trong quá khứ." : failure.message,
      },
      general: null,
    };
  }
  return { fieldErrors: {}, general: failure.message };
}
/** Progress for the bar: prefers the server's value, falls back to bigint math on the strings. */
export function goalPercent(goal: GoalDto): number {
  const server = goal.progress.percent;
  if (Number.isInteger(server) && server >= 0 && server <= 100) return server;
  return percentOf(goal.savedVnd, goal.targetVnd) ?? 0;
}
