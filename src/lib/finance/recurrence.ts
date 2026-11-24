import {
  compareLocalDates,
  daysInMonth,
  formatLocalDate,
  parseLocalDate,
  type LocalDate,
} from "./dates";
import { FinanceError } from "./errors";
import type { RecurringItem } from "./types";

type ScheduleFields = Pick<RecurringItem, "dayOfMonth" | "startDate" | "endDate" | "active">;

function assertDayOfMonth(dayOfMonth: number): void {
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new FinanceError("invalid_day_of_month", `Day of month must be 1-31: ${dayOfMonth}`);
  }
}

/** Occurrence date inside one month. Days beyond the month length clamp to its last day. */
export function occurrenceDateInMonth(year: number, month: number, dayOfMonth: number): LocalDate {
  assertDayOfMonth(dayOfMonth);
  return formatLocalDate(year, month, Math.min(dayOfMonth, daysInMonth(year, month)));
}

/**
 * All occurrences of a monthly item with `from <= date <= to`, ascending.
 * Respects start/end dates and the active flag. Exactly one occurrence per month.
 */
export function recurringOccurrences(item: ScheduleFields, from: LocalDate, to: LocalDate): LocalDate[] {
  assertDayOfMonth(item.dayOfMonth);
  parseLocalDate(item.startDate);
  if (item.endDate) parseLocalDate(item.endDate);
  parseLocalDate(from);
  parseLocalDate(to);
  if (!item.active || compareLocalDates(from, to) > 0) return [];

  const first = parseLocalDate(from);
  const last = parseLocalDate(to);
  const result: LocalDate[] = [];
  let year = first.year;
  let month = first.month;
  while (year < last.year || (year === last.year && month <= last.month)) {
    const date = occurrenceDateInMonth(year, month, item.dayOfMonth);
    const inRange = compareLocalDates(date, from) >= 0 && compareLocalDates(date, to) <= 0;
    const afterStart = compareLocalDates(date, item.startDate) >= 0;
    const beforeEnd = !item.endDate || compareLocalDates(date, item.endDate) <= 0;
    if (inRange && afterStart && beforeEnd) result.push(date);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return result;
}

/** True when the item can still produce occurrences on or after `date`. */
export function isInForce(item: Pick<RecurringItem, "active" | "endDate">, date: LocalDate): boolean {
  return item.active && (!item.endDate || compareLocalDates(item.endDate, date) >= 0);
}

export function recurringKey(itemId: string, instanceDate: LocalDate): string {
  return `${itemId}|${instanceDate}`;
}

