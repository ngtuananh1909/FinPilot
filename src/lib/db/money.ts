import { FinanceError, assertWithinBounds, parseVndString } from "@/lib/finance";

/**
 * Boundary parser for `bigint` columns. PostgREST returns them as JSON numbers (or strings
 * if a client asks for it). Accepts: safe integers (number), decimal strings, bigint.
 * Rejects: null/undefined, NaN, Infinity, fractions, numbers beyond MAX_SAFE_INTEGER,
 * exponent/whitespace/leading-zero strings, and anything beyond +/- MAX_VND.
 * Negative values are allowed because `balance_snapshot_vnd` can be negative; column
 * sign rules are enforced by the DB and by the input schemas.
 */
export function parseDbVnd(value: number | string | bigint | null): bigint {
  switch (typeof value) {
    case "bigint":
      assertWithinBounds(value);
      return value;
    case "number": {
      if (!Number.isSafeInteger(value)) {
        throw new FinanceError("invalid_amount", "Database amount is not a safe integer.");
      }
      return BigInt(value);
    }
    case "string":
      return parseVndString(value, { allowNegative: true });
    default:
      throw new FinanceError("invalid_amount", "Database amount is missing or has an unsupported type.");
  }
}

/** Serializes a VND amount for writes (decimal string; never a lossy JS number). */
export function vndForDb(amount: bigint): string {
  assertWithinBounds(amount);
  return amount.toString();
}
