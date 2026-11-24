import { parseLocalDate } from "@/lib/finance";

const INSTANT_PATTERN =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-](\d{2}):(\d{2}))$/;

/**
 * Strict ISO-8601 instant parser. Requires an explicit offset (no host-timezone guesses) and
 * a real calendar date: `new Date("2026-02-30T00:00:00Z")` silently rolls over to March, so
 * the date, time and offset parts are validated before `Date` is used. Returns null if invalid.
 */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = INSTANT_PATTERN.exec(value);
  if (!m) return null;
  const [, date, hh, mm, ss, , oh, om] = m;
  try {
    parseLocalDate(date!);
  } catch {
    return null;
  }
  if (Number(hh) > 23 || Number(mm) > 59 || (ss !== undefined && Number(ss) > 59)) return null;
  if (oh !== undefined && (Number(oh) > 14 || Number(om) > 59)) return null;
  const time = new Date(value.replace(" ", "T")).getTime();
  return Number.isFinite(time) ? new Date(time) : null;
}
