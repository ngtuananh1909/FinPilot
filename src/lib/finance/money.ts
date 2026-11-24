import { FinanceError } from "./errors";

/** Largest absolute VND amount accepted at the JSON boundary (JS safe-integer limit). */
export const MAX_VND = BigInt(Number.MAX_SAFE_INTEGER);

const NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/;
const SIGNED_INTEGER = /^-?(0|[1-9][0-9]*)$/;

/**
 * Parse a decimal-string VND amount from JSON. Rejects fractions, exponents,
 * whitespace, leading zeros and values beyond MAX_VND.
 */
export function parseVndString(value: string, options: { allowNegative?: boolean } = {}): bigint {
  const pattern = options.allowNegative ? SIGNED_INTEGER : NON_NEGATIVE_INTEGER;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new FinanceError("invalid_amount", "Amount must be an integer VND decimal string.");
  }
  const parsed = BigInt(value);
  assertWithinBounds(parsed);
  return parsed;
}

/** Serialize a VND amount for JSON (bigint is not JSON-serializable). */
export function vndToString(amount: bigint): string {
  return amount.toString();
}

export function assertWithinBounds(amount: bigint): void {
  if (typeof amount !== "bigint" || amount > MAX_VND || amount < -MAX_VND) {
    throw new FinanceError("invalid_amount", "Amount is outside the supported VND range.");
  }
}

export function assertPositiveVnd(amount: bigint): void {
  assertWithinBounds(amount);
  if (amount <= 0n) {
    throw new FinanceError("invalid_amount", "Amount must be greater than zero.");
  }
}

export function assertNonNegativeVnd(amount: bigint): void {
  assertWithinBounds(amount);
  if (amount < 0n) {
    throw new FinanceError("invalid_amount", "Amount must not be negative.");
  }
}

/** Integer division of non-negative values, rounding half up. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) {
    throw new FinanceError("invalid_amount", "Rounded division requires a positive divisor.");
  }
  return (2n * numerator + denominator) / (2n * denominator);
}
