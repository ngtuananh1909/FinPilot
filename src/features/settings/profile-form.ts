import { amountToInputText, displayVnd, parseAmountField } from "@/lib/format/money-input";
import type { ReadinessDto } from "@/lib/settings/dto";
import type { ProfileDto } from "@/lib/settings/dto";
/** All form fields are text; money stays a decimal string once parsed (never a JS number). */
export interface ProfileFormValues {
  displayName: string;
  /** "" = no payday (irregular income). */
  paydayDay: string;
  expectedMonthlyIncome: string;
  expectedDailyExpense: string;
  projectedMonthlyBudget: string;
  minimumReserve: string;
}
export type ProfileFormErrors = Partial<Record<keyof ProfileFormValues, string>>;
export const profileValuesFrom = (p: ProfileDto): ProfileFormValues => ({
  displayName: p.displayName,
  paydayDay: p.paydayDay === null ? "" : String(p.paydayDay),
  expectedMonthlyIncome: amountToInputText(p.expectedMonthlyIncomeVnd),
  expectedDailyExpense: amountToInputText(p.expectedDailyExpenseVnd),
  projectedMonthlyBudget: amountToInputText(p.projectedMonthlyBudgetVnd),
  minimumReserve: amountToInputText(p.minimumReserveVnd),
});
const MONEY_FIELDS = [
  ["expectedMonthlyIncome", "Thu nhập dự kiến mỗi tháng"],
  ["expectedDailyExpense", "Chi tiêu ước tính mỗi ngày"],
  ["projectedMonthlyBudget", "Ngân sách dự kiến mỗi tháng"],
  ["minimumReserve", "Mức dự phòng tối thiểu"],
] as const satisfies ReadonlyArray<readonly [keyof ProfileFormValues, string]>;
export function validateProfileForm(values: ProfileFormValues): ProfileFormErrors {
  const errors: ProfileFormErrors = {};
  if (!values.displayName.trim()) errors.displayName = "Vui lòng nhập tên hiển thị.";
  else if (values.displayName.trim().length > 80) errors.displayName = "Tên hiển thị tối đa 80 ký tự.";
  const day = values.paydayDay.trim();
  if (day && (!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > 31)) {
    errors.paydayDay = "Ngày nhận lương cần từ 1 đến 31 (để trống nếu không cố định).";
  }
  for (const [key, label] of MONEY_FIELDS) {
    const parsed = parseAmountField(values[key], "non_negative", label);
    if (!parsed.ok) errors[key] = parsed.message;
  }
  return errors;
}
export interface ProfilePatch {
  displayName?: string;
  paydayDay?: number | null;
  expectedMonthlyIncomeVnd?: string;
  expectedDailyExpenseVnd?: string;
  projectedMonthlyBudgetVnd?: string;
  minimumReserveVnd?: string;
}
const WIRE_KEY = {
  expectedMonthlyIncome: "expectedMonthlyIncomeVnd",
  expectedDailyExpense: "expectedDailyExpenseVnd",
  projectedMonthlyBudget: "projectedMonthlyBudgetVnd",
  minimumReserve: "minimumReserveVnd",
} as const;
/** Only changed fields, so an untouched field is never overwritten. Null when nothing changed. Call after validation. */
export function buildProfilePatch(values: ProfileFormValues, original: ProfileFormValues): ProfilePatch | null {
  const patch: ProfilePatch = {};
  if (values.displayName.trim() !== original.displayName.trim()) patch.displayName = values.displayName.trim();
  if (values.paydayDay.trim() !== original.paydayDay.trim()) {
    patch.paydayDay = values.paydayDay.trim() ? Number(values.paydayDay.trim()) : null;
  }
  for (const [key] of MONEY_FIELDS) {
    const next = parseAmountField(values[key], "non_negative");
    const before = parseAmountField(original[key], "non_negative");
    if (!next.ok) throw new Error("invalid_profile_form");
    if (!before.ok || next.value !== before.value) patch[WIRE_KEY[key]] = next.value;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}
export interface ChangeLine {
  label: string;
  from: string;
  to: string;
}
const FIELD_LABEL: Record<keyof ProfileFormValues, string> = {
  displayName: "Tên hiển thị",
  paydayDay: "Ngày nhận lương",
  expectedMonthlyIncome: "Thu nhập dự kiến mỗi tháng",
  expectedDailyExpense: "Chi tiêu ước tính mỗi ngày",
  projectedMonthlyBudget: "Ngân sách dự kiến mỗi tháng",
  minimumReserve: "Mức dự phòng tối thiểu",
};
function shown(key: keyof ProfileFormValues, text: string): string {
  if (key === "displayName") return text.trim() || "(trống)";
  if (key === "paydayDay") return text.trim() ? `ngày ${text.trim()}` : "không cố định";
  const parsed = parseAmountField(text, "non_negative");
  return parsed.ok ? displayVnd(parsed.value) : "(chưa hợp lệ)";
}
/** Human-readable before/after list for the "what will change" summary. */
export function summarizeChanges(values: ProfileFormValues, original: ProfileFormValues): ChangeLine[] {
  const keys = Object.keys(FIELD_LABEL) as Array<keyof ProfileFormValues>;
  return keys
    .filter((key) => shown(key, values[key]) !== shown(key, original[key]))
    .map((key) => ({ label: FIELD_LABEL[key], from: shown(key, original[key]), to: shown(key, values[key]) }));
}
export interface ReadinessTarget {
  /** In-page anchor (element id) the banner links to. */
  anchor: string;
  label: string;
}
export const READINESS_TARGETS: Record<string, ReadinessTarget> = {
  balance_snapshot: { anchor: "settings-balance", label: "Số dư hiện tại" },
  payday_day: { anchor: "set-payday", label: "Ngày nhận lương" },
  expected_monthly_income: { anchor: "set-income", label: "Thu nhập dự kiến mỗi tháng" },
  expected_daily_expense: { anchor: "set-daily", label: "Chi tiêu ước tính mỗi ngày" },
  recurring_items: { anchor: "settings-recurring", label: "Khoản định kỳ (tiền trọ, lương…)" },
};
export interface ReadinessLine {
  anchor: string;
  text: string;
}
/** Lines for the incomplete-forecast banner; empty when the forecast is ready. */
export function readinessLines(readiness: ReadinessDto): ReadinessLine[] {
  if (readiness.complete) return [];
  return readiness.issues.map((issue) => {
    const target = READINESS_TARGETS[issue.field] ?? { anchor: "settings-profile", label: issue.field };
    return {
      anchor: target.anchor,
      text: `${target.label}: ${issue.problem === "missing" ? "chưa có" : "chưa thiết lập (đang bằng 0)"}`,
    };
  });
}
