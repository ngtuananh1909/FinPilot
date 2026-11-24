import { compareLocalDates, localDateOf, parseLocalDate } from "@/lib/finance";
import { amountToInputText, parseAmountField } from "@/lib/format/money-input";
import type { ApiFailure } from "@/lib/http/api-call";
import type { RecurringDto } from "@/lib/transactions/dto";
import { DEFAULT_CATEGORY } from "@/features/transactions/labels";
export interface RecurringFormValues {
  label: string;
  kind: "income" | "expense";
  amount: string;
  /** Text so an empty field can be reported; validated as an integer 1..31. */
  dayOfMonth: string;
  category: string;
  startDate: string;
  /** "" = no end date. */
  endDate: string;
}
export type RecurringFormErrors = Partial<Record<keyof RecurringFormValues, string>>;
export const emptyRecurringValues = (now: Date): RecurringFormValues => ({
  label: "",
  kind: "expense",
  amount: "",
  dayOfMonth: "",
  category: DEFAULT_CATEGORY,
  startDate: localDateOf(now),
  endDate: "",
});
export const recurringValuesFrom = (item: RecurringDto): RecurringFormValues => ({
  label: item.label,
  kind: item.kind,
  amount: amountToInputText(item.amountVnd),
  dayOfMonth: String(item.dayOfMonth),
  category: item.category,
  startDate: item.startDate,
  endDate: item.endDate ?? "",
});
function isRealDate(text: string): boolean {
  try {
    parseLocalDate(text);
    return true;
  } catch {
    return false;
  }
}
export function validateRecurringForm(values: RecurringFormValues): RecurringFormErrors {
  const errors: RecurringFormErrors = {};
  if (!values.label.trim()) errors.label = "Vui lòng nhập tên khoản (ví dụ: Tiền trọ).";
  else if (values.label.trim().length > 100) errors.label = "Tên khoản tối đa 100 ký tự.";
  const amount = parseAmountField(values.amount, "positive");
  if (!amount.ok) errors.amount = amount.message;
  const day = values.dayOfMonth.trim();
  if (!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > 31) {
    errors.dayOfMonth = "Ngày trong tháng cần từ 1 đến 31. Tháng ngắn hơn sẽ dùng ngày cuối tháng.";
  }
  if (!isRealDate(values.startDate)) errors.startDate = "Chọn ngày bắt đầu hợp lệ.";
  if (values.endDate && !isRealDate(values.endDate)) errors.endDate = "Ngày kết thúc chưa hợp lệ.";
  else if (values.endDate && !errors.startDate && compareLocalDates(values.endDate, values.startDate) < 0) {
    errors.endDate = "Ngày kết thúc phải sau hoặc trùng ngày bắt đầu.";
  }
  return errors;
}
export function buildRecurringCreateBody(values: RecurringFormValues): Record<string, unknown> {
  const amount = parseAmountField(values.amount, "positive");
  if (!amount.ok) throw new Error("invalid_recurring_form");
  return {
    label: values.label.trim(),
    kind: values.kind,
    amountVnd: amount.value,
    dayOfMonth: Number(values.dayOfMonth.trim()),
    category: values.category.trim() || DEFAULT_CATEGORY,
    startDate: values.startDate,
    ...(values.endDate ? { endDate: values.endDate } : {}),
  };
}
/** Changed fields only; null when nothing changed. */
export function buildRecurringPatchBody(
  values: RecurringFormValues,
  original: RecurringFormValues,
): Record<string, unknown> | null {
  const create = buildRecurringCreateBody(values);
  const before = buildRecurringCreateBody(original);
  const patch: Record<string, unknown> = {};
  for (const key of ["label", "kind", "amountVnd", "dayOfMonth", "category", "startDate"]) {
    if (create[key] !== before[key]) patch[key] = create[key];
  }
  if ((values.endDate || null) !== (original.endDate || null)) patch.endDate = values.endDate || null;
  return Object.keys(patch).length === 0 ? null : patch;
}
const FIELD_TO_FORM: Record<string, keyof RecurringFormValues> = {
  label: "label",
  kind: "kind",
  amountVnd: "amount",
  dayOfMonth: "dayOfMonth",
  category: "category",
  startDate: "startDate",
  endDate: "endDate",
};
const RULE_MESSAGES: Record<string, string> = {
  recurring_kind_locked: "Không đổi được loại vì đã có giao dịch liên kết với khoản này.",
  invalid_range: "Ngày kết thúc phải sau hoặc trùng ngày bắt đầu.",
  invalid_amount: "Số tiền cần là số nguyên đồng lớn hơn 0.",
};
export function mapRecurringFailure(failure: ApiFailure): { fieldErrors: RecurringFormErrors; general: string | null } {
  if (failure.status === 404 || failure.code === "not_found") {
    return { fieldErrors: {}, general: "Khoản định kỳ đã bị xóa hoặc không tồn tại.", };
  }
  const key = failure.field ? FIELD_TO_FORM[failure.field] : undefined;
  if (failure.code === "validation_failed" && key) {
    return { fieldErrors: { [key]: (failure.rule ? RULE_MESSAGES[failure.rule] : undefined) ?? failure.message }, general: null };
  }
  return { fieldErrors: {}, general: failure.message };
}
