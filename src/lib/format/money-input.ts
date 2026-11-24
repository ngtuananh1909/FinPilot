import { parseVndInput } from "@/lib/onboarding/form";
import { formatVndText } from "./vnd";
/**
 * Money text helpers for forms. Amounts are whole VND kept as decimal STRINGS end to end
 * (no JS floats, no Number() on money).
 */
const MAX_DIGITS = 13;
/**
 * Live formatting while typing: keeps digits only (and one leading minus when allowed) and groups
 * thousands with dots, e.g. "1500000" -> "1.500.000". Extra digits beyond the supported size are dropped.
 */
export function formatAmountInput(raw: string, options: { allowNegative?: boolean } = {}): string {
  const negative = Boolean(options.allowNegative) && raw.trim().startsWith("-");
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, MAX_DIGITS);
  if (digits === "") return negative ? "-" : "";
  return `${negative ? "-" : ""}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}
export type AmountRule = "positive" | "non_negative" | "signed";
export type AmountParse = { ok: true; value: string } | { ok: false; message: string };
/** Validates form text and returns the decimal string the API expects. */
export function parseAmountField(text: string, rule: AmountRule, label = "Số tiền"): AmountParse {
  if (!text.trim()) return { ok: false, message: `Vui lòng nhập ${label.toLowerCase()}.` };
  const value = parseVndInput(text, { allowNegative: rule === "signed" });
  if (value === null) {
    return {
      ok: false,
      message:
        rule === "signed"
          ? `${label} cần là số nguyên đồng (có thể âm).`
          : `${label} cần là số nguyên đồng, không âm.`,
    };
  }
  if (rule === "positive" && value === "0") return { ok: false, message: `${label} phải lớn hơn 0.` };
  return { ok: true, value };
}
/** Decimal string from the API -> the text shown in an input ("1500000" -> "1.500.000"). */
export function amountToInputText(amount: string): string {
  return formatAmountInput(amount, { allowNegative: true });
}
/** Display text with the dong sign; "" for malformed input is shown as an em dash. */
export function displayVnd(amount: string): string {
  return formatVndText(amount) || "—";
}
/** Signed display for transaction rows. The sign is also conveyed in words by the caller (never color alone). */
export function displaySignedVnd(kind: "income" | "expense" | "excluded", amount: string): string {
  const text = displayVnd(amount);
  if (kind === "income") return `+${text}`;
  if (kind === "expense") return `−${text}`;
  return text;
}
/** a - b for decimal strings, via bigint. Used only for UI deltas, never stored. */
export function diffVndStrings(a: string, b: string): string | null {
  if (!/^-?\d+$/.test(a) || !/^-?\d+$/.test(b)) return null;
  return (BigInt(a) - BigInt(b)).toString();
}
/** Formats a signed delta with an explicit "+" for positive values ("+250.000 ₫"). */
export function displayDeltaVnd(delta: string): string {
  const text = displayVnd(delta);
  return /^\d/.test(delta) && delta !== "0" ? `+${text}` : text;
}
/** Percent of target as an integer 0..100 via bigint math; null on malformed input or zero target. */
export function percentOf(saved: string, target: string): number | null {
  if (!/^\d+$/.test(saved) || !/^\d+$/.test(target) || BigInt(target) === 0n) return null;
  const s = BigInt(saved);
  const t = BigInt(target);
  return s >= t ? 100 : Number((s * 100n) / t);
}
