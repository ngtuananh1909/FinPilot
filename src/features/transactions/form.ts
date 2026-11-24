import { addDays, diffDays, localDateOf, recurringOccurrences, type LocalDate } from "@/lib/finance";
import { parseAmountField, amountToInputText } from "@/lib/format/money-input";
import { isoToVnInput, toVnInputValue, vnInputToIso } from "@/lib/format/vn-datetime";
import type { ApiFailure } from "@/lib/http/api-call";
import type { RecurringDto, TransactionDto } from "@/lib/transactions/dto";
import { DEFAULT_CATEGORY, type TransactionKind } from "./labels";
export interface TransactionFormValues {
  kind: TransactionKind;
  /** Display text with thousand separators ("1.500.000"). */
  amount: string;
  /** `YYYY-MM-DDTHH:mm`, Asia/Ho_Chi_Minh wall clock. */
  occurredAt: string;
  category: string;
  merchant: string;
  description: string;
  /** "" = not linked. */
  recurringItemId: string;
  recurringInstanceDate: string;
}
export type FormErrors = Partial<Record<keyof TransactionFormValues, string>>;
const MERCHANT_MAX = 200;
const DESCRIPTION_MAX = 500;
export function emptyFormValues(now: Date): TransactionFormValues {
  return {
    kind: "expense",
    amount: "",
    occurredAt: toVnInputValue(now),
    category: DEFAULT_CATEGORY,
    merchant: "",
    description: "",
    recurringItemId: "",
    recurringInstanceDate: "",
  };
}
export function valuesFromTransaction(t: TransactionDto): TransactionFormValues {
  return {
    kind: t.kind,
    amount: amountToInputText(t.amountVnd),
    occurredAt: isoToVnInput(t.occurredAt),
    category: t.category || DEFAULT_CATEGORY,
    merchant: t.merchant ?? "",
    description: t.description ?? "",
    recurringItemId: t.recurringItemId ?? "",
    recurringInstanceDate: t.recurringInstanceDate ?? "",
  };
}
export function validateTransactionForm(values: TransactionFormValues): FormErrors {
  const errors: FormErrors = {};
  const amount = parseAmountField(values.amount, "positive");
  if (!amount.ok) errors.amount = amount.message;
  if (vnInputToIso(values.occurredAt) === null) errors.occurredAt = "Vui lòng chọn ngày và giờ hợp lệ.";
  if (!values.category.trim()) errors.category = "Vui lòng chọn danh mục (có thể chọn Khác).";
  if (values.merchant.trim().length > MERCHANT_MAX) errors.merchant = `Tối đa ${MERCHANT_MAX} ký tự.`;
  if (values.description.trim().length > DESCRIPTION_MAX) errors.description = `Tối đa ${DESCRIPTION_MAX} ký tự.`;
  if (values.recurringItemId && !values.recurringInstanceDate) {
    errors.recurringInstanceDate = "Chọn kỳ của khoản định kỳ cần liên kết.";
  }
  if (values.recurringItemId && values.kind === "excluded") {
    errors.recurringItemId = "Giao dịch loại trừ không thể liên kết với khoản định kỳ.";
  }
  return errors;
}
const textOrNull = (text: string): string | null => (text.trim() ? text.trim() : null);
function parsed(values: TransactionFormValues) {
  const amount = parseAmountField(values.amount, "positive");
  const occurredAt = vnInputToIso(values.occurredAt);
  if (!amount.ok || occurredAt === null) throw new Error("invalid_transaction_form");
  return { amountVnd: amount.value, occurredAt };
}
/** POST body. Call only after `validateTransactionForm` returned no errors. */
export function buildCreateBody(values: TransactionFormValues): Record<string, unknown> {
  const { amountVnd, occurredAt } = parsed(values);
  const merchant = textOrNull(values.merchant);
  const description = textOrNull(values.description);
  return {
    kind: values.kind,
    amountVnd,
    occurredAt,
    category: values.category.trim() || DEFAULT_CATEGORY,
    ...(merchant ? { merchant } : {}),
    ...(description ? { description } : {}),
    ...(values.recurringItemId
      ? { recurringItemId: values.recurringItemId, recurringInstanceDate: values.recurringInstanceDate }
      : {}),
    source: "manual",
  };
}
/**
 * PATCH body containing only what changed (null when nothing did). The recurring link keys are
 * always sent as a pair, as the API requires; clearing the link sends both as null.
 */
export function buildPatchBody(
  values: TransactionFormValues,
  original: TransactionFormValues,
): Record<string, unknown> | null {
  const { amountVnd, occurredAt } = parsed(values);
  const patch: Record<string, unknown> = {};
  if (values.kind !== original.kind) patch.kind = values.kind;
  if (amountVnd !== parsed(original).amountVnd) patch.amountVnd = amountVnd;
  if (occurredAt !== vnInputToIso(original.occurredAt)) patch.occurredAt = occurredAt;
  if (values.category.trim() !== original.category.trim()) patch.category = values.category.trim() || DEFAULT_CATEGORY;
  if (textOrNull(values.merchant) !== textOrNull(original.merchant)) patch.merchant = textOrNull(values.merchant);
  if (textOrNull(values.description) !== textOrNull(original.description)) {
    patch.description = textOrNull(values.description);
  }
  if (
    values.recurringItemId !== original.recurringItemId ||
    values.recurringInstanceDate !== original.recurringInstanceDate
  ) {
    patch.recurringItemId = values.recurringItemId || null;
    patch.recurringInstanceDate = values.recurringItemId ? values.recurringInstanceDate || null : null;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}
const RULE_MESSAGES: Record<string, string> = {
  invalid_amount: "Số tiền cần là số nguyên đồng lớn hơn 0.",
  invalid_instant: "Ngày giờ chưa hợp lệ.",
  invalid_category: "Danh mục chỉ gồm chữ, số, dấu gạch ngang hoặc gạch dưới (tối đa 50 ký tự).",
  recurring_item_not_found: "Không tìm thấy khoản định kỳ này.",
  not_an_occurrence: "Ngày này không phải một kỳ của khoản định kỳ.",
  recurring_kind_mismatch: "Loại giao dịch phải trùng loại của khoản định kỳ.",
  recurring_link_pair: "Cần chọn cả khoản định kỳ và kỳ liên kết.",
};
const FIELD_TO_FORM: Record<string, keyof TransactionFormValues> = {
  amountVnd: "amount",
  occurredAt: "occurredAt",
  kind: "kind",
  category: "category",
  merchant: "merchant",
  description: "description",
  recurringItemId: "recurringItemId",
  recurringInstanceDate: "recurringInstanceDate",
};
export interface MappedFailure {
  fieldErrors: FormErrors;
  /** Message for the form-level live region; null when the failure was attached to a field. */
  general: string | null;
  /** The record no longer exists (404). */
  notFound: boolean;
}
export const NOT_FOUND_MESSAGE = "Giao dịch đã bị xóa hoặc không tồn tại.";
/** Maps the API error envelope onto form fields where possible, else a general message. */
export function mapTransactionFailure(failure: ApiFailure): MappedFailure {
  if (failure.status === 404 || failure.code === "not_found") {
    return { fieldErrors: {}, general: NOT_FOUND_MESSAGE, notFound: true };
  }
  const key = failure.field ? FIELD_TO_FORM[failure.field] : undefined;
  if (failure.code === "validation_failed" && key) {
    const message = (failure.rule ? RULE_MESSAGES[failure.rule] : undefined) ?? failure.message;
    return { fieldErrors: { [key]: message }, general: null, notFound: false };
  }
  return { fieldErrors: {}, general: failure.message, notFound: false };
}
export interface OccurrenceOption {
  date: LocalDate;
}
/**
 * Valid occurrences of an item that a transaction may be linked to: about three months back to one
 * month ahead of `now`, honouring the day-of-month clamp (31st -> last day) and start/end dates.
 * `keep` (an already linked instance) is always offered so editing never silently drops a link.
 * Newest first.
 */
export function occurrenceOptions(item: RecurringDto, now: Date, keep?: string): LocalDate[] {
  const today = localDateOf(now);
  const dates = recurringOccurrences(
    { dayOfMonth: item.dayOfMonth, startDate: item.startDate, endDate: item.endDate, active: true },
    addDays(today, -92),
    addDays(today, 31),
  );
  if (keep && !dates.includes(keep)) dates.push(keep);
  return dates.sort().reverse();
}
/** The occurrence closest to the transaction's own date (ties prefer the earlier one). */
export function nearestOccurrence(dates: readonly LocalDate[], transactionDate: LocalDate): LocalDate | null {
  let best: LocalDate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const date of [...dates].sort()) {
    const distance = Math.abs(diffDays(date, transactionDate));
    if (distance < bestDistance) {
      best = date;
      bestDistance = distance;
    }
  }
  return best;
}
/** Items that can be linked to a transaction of this kind (active, same kind, never for `excluded`). */
export function linkableItems(items: readonly RecurringDto[], kind: TransactionKind, keepId?: string): RecurringDto[] {
  if (kind === "excluded") return [];
  return items.filter((item) => item.kind === kind && (item.active || item.id === keepId));
}
