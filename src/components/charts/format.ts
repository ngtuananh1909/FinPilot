const NBSP = "\u00a0";

function oneDecimal(value: number): string {
  // Round half away from zero to one decimal, drop a trailing ",0", vi-VN decimal comma.
  const tenths = Math.round(Math.abs(value) * 10);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return frac === 0 ? String(whole) : `${whole},${frac}`;
}

/**
 * Compact VND for axis labels: 2.500.000 -> "2,5 tr", 850.000 -> "850 k", 1.200.000.000 -> "1,2 tỷ".
 * Display only; `value` is a JS number prepared from the DTO (exact up to 2^53, far above any VND
 * amount the API accepts).
 */
export function formatCompactVnd(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  const sign = value < 0 && Math.round(abs) !== 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${oneDecimal(abs / 1_000_000_000)}${NBSP}tỷ`;
  if (abs >= 1_000_000) return `${sign}${oneDecimal(abs / 1_000_000)}${NBSP}tr`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}${NBSP}k`;
  return `${sign}${Math.round(abs)}`;
}

/** Exact VND text from a JS integer, "1.234.567 ₫". Display only. */
export function formatExactVnd(value: number): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value);
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${rounded < 0 ? "-" : ""}${digits} ₫`;
}

/**
 * Decimal string from the API -> number for pixel positions and axis labels ONLY.
 * Precision: exact while |value| <= Number.MAX_SAFE_INTEGER (the API rejects larger VND amounts);
 * beyond that it would lose digits, which could only shift a pixel, never a displayed exact amount.
 */
export function vndStringToNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
