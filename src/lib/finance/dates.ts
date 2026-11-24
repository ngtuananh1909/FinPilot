import { FinanceError } from "./errors";

/** Business timezone. Vietnam observes no DST, so the offset is a constant +07:00. */
export const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";
const VN_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const MS_PER_DAY = 86_400_000;

/** Calendar date `YYYY-MM-DD` in the Asia/Ho_Chi_Minh calendar. */
export type LocalDate = string;

interface DateParts {
  year: number;
  month: number;
  day: number;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new FinanceError("invalid_date", `Invalid month: ${month}`);
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseLocalDate(value: LocalDate): DateParts {
  const match = typeof value === "string" ? LOCAL_DATE_PATTERN.exec(value) : null;
  if (!match) {
    throw new FinanceError("invalid_date", `Expected YYYY-MM-DD, received: ${String(value)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new FinanceError("invalid_date", `Not a real calendar date: ${value}`);
  }
  return { year, month, day };
}

export function formatLocalDate(year: number, month: number, day: number): LocalDate {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Days since 1970-01-01 for a calendar date (timezone independent). */
export function toDayNumber(value: LocalDate): number {
  const { year, month, day } = parseLocalDate(value);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function fromDayNumber(dayNumber: number): LocalDate {
  const date = new Date(dayNumber * MS_PER_DAY);
  return formatLocalDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(value: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) {
    throw new FinanceError("invalid_date", "Day offset must be an integer.");
  }
  return fromDayNumber(toDayNumber(value) + days);
}

/** Whole days from `earlier` to `later` (positive when `later` is after `earlier`). */
export function diffDays(later: LocalDate, earlier: LocalDate): number {
  return toDayNumber(later) - toDayNumber(earlier);
}

/** Compare two validated local dates: negative, zero or positive. */
export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return toDayNumber(a) - toDayNumber(b);
}

/** Calendar date of an instant in Asia/Ho_Chi_Minh, independent of host timezone. */
export function localDateOf(instant: Date): LocalDate {
  const time = instant instanceof Date ? instant.getTime() : Number.NaN;
  if (Number.isNaN(time)) {
    throw new FinanceError("invalid_instant", "Expected a valid Date instant.");
  }
  const shifted = new Date(time + VN_UTC_OFFSET_MS);
  return formatLocalDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}
