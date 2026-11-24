import { compareLocalDates, parseLocalDate } from "@/lib/finance";
import type { SimulatorRequestBody } from "./types";

export const MAX_COST_DIGITS = 15;
export const MAX_ITEM_NAME = 80;

export interface SimulatorFormValues {
  itemName: string;
  /** Raw text of the cost field (may contain dots from live formatting). */
  costText: string;
  buyNowDate: string;
  laterMode: "next_payday" | "date";
  laterDate: string;
}

export interface DateBounds {
  /** Today, inclusive (YYYY-MM-DD). */
  min: string;
  /** Last day of the 45-day window, inclusive. */
  max: string;
}

export type SimulatorFormErrors = Partial<Record<"itemName" | "cost" | "buyNowDate" | "laterDate", string>>;

/** Keeps digits only, drops leading zeros, caps the length; `display` groups thousands with dots. */
export function parseCostInput(text: string): { digits: string; display: string } {
  const digits = text.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_COST_DIGITS);
  return { digits, display: digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".") };
}

function isRealDate(value: string): boolean {
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

function dateError(value: string, bounds: DateBounds, label: string): string | undefined {
  if (!value) return `Hãy chọn ${label}.`;
  if (!isRealDate(value)) return `${label[0]!.toUpperCase()}${label.slice(1)} không hợp lệ.`;
  if (compareLocalDates(value, bounds.min) < 0 || compareLocalDates(value, bounds.max) > 0) {
    return `Chọn ${label} trong khoảng 45 ngày từ hôm nay (đến hết ngày ${bounds.max.split("-").reverse().join("/")}).`;
  }
  return undefined;
}

/** Client-side checks only; the server validates again and the engine has the final word. */
export function validateSimulatorForm(values: SimulatorFormValues, bounds: DateBounds): SimulatorFormErrors {
  const errors: SimulatorFormErrors = {};
  if (values.itemName.trim().length > MAX_ITEM_NAME) errors.itemName = `Tên tối đa ${MAX_ITEM_NAME} ký tự.`;
  const { digits } = parseCostInput(values.costText);
  if (digits === "") errors.cost = "Nhập số tiền lớn hơn 0.";
  const nowError = dateError(values.buyNowDate, bounds, "ngày mua ngay");
  if (nowError) errors.buyNowDate = nowError;
  if (values.laterMode === "date") {
    const laterError = dateError(values.laterDate, bounds, "ngày mua sau");
    if (laterError) errors.laterDate = laterError;
    else if (!nowError && compareLocalDates(values.laterDate, values.buyNowDate) <= 0) {
      errors.laterDate = "Ngày mua sau phải muộn hơn ngày mua ngay.";
    }
  }
  return errors;
}

export function toRequestBody(values: SimulatorFormValues): SimulatorRequestBody {
  const name = values.itemName.trim();
  return {
    costVnd: parseCostInput(values.costText).digits,
    ...(name ? { itemName: name } : {}),
    buyNowDate: values.buyNowDate,
    buyLater: values.laterMode === "date" ? { kind: "date", date: values.laterDate } : { kind: "next_payday" },
  };
}

/** `error.details.financeCode` from the API error envelope, if present. */
export function financeCodeOf(json: unknown): string | null {
  const error = typeof json === "object" && json !== null ? (json as { error?: unknown }).error : null;
  const details = typeof error === "object" && error !== null ? (error as { details?: unknown }).details : null;
  const code = typeof details === "object" && details !== null ? (details as { financeCode?: unknown }).financeCode : null;
  return typeof code === "string" ? code : null;
}
