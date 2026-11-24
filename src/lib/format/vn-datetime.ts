import { addDays, localDateOf, parseLocalDate, type LocalDate } from "@/lib/finance";
/**
 * Asia/Ho_Chi_Minh date-time helpers for forms and lists. Vietnam has no DST, so the offset is a
 * constant +07:00 and nothing here depends on the host timezone.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const pad = (n: number): string => String(n).padStart(2, "0");
/** `YYYY-MM-DDTHH:mm` wall-clock text of an instant in Vietnam (value of <input type="datetime-local">). */
export function toVnInputValue(instant: Date): string {
  const shifted = new Date(instant.getTime() + VN_OFFSET_MS);
  return `${localDateOf(instant)}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}
const INPUT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
/**
 * `YYYY-MM-DDTHH:mm` (Vietnam wall clock) -> ISO-8601 with an explicit +07:00 offset, which is what
 * the API accepts. Returns null for malformed text or impossible dates (e.g. 2026-02-30).
 */
export function vnInputToIso(value: string): string | null {
  const match = INPUT_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, date = "", hh = "", mm = ""] = match;
  try {
    parseLocalDate(date);
  } catch {
    return null;
  }
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  return `${date}T${hh}:${mm}:00+07:00`;
}
/** ISO instant (any offset) -> `YYYY-MM-DDTHH:mm` Vietnam wall clock; "" when unparseable. */
export function isoToVnInput(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  return toVnInputValue(new Date(time));
}
/** `HH:mm` of an instant in Vietnam; "" when unparseable. */
export function formatVnTime(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const shifted = new Date(time + VN_OFFSET_MS);
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}
/** `YYYY-MM-DD` -> `DD/MM/YYYY`; unchanged text when it is not a local date. */
export function formatLocalDateVi(date: LocalDate): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}
/** "Hôm nay · 23/11/2026", "Hôm qua · …" or the plain date, relative to `now` in Vietnam. */
export function dayHeadingVi(date: LocalDate, now: Date): string {
  const today = localDateOf(now);
  const label = formatLocalDateVi(date);
  if (date === today) return `Hôm nay · ${label}`;
  if (date === addDays(today, -1)) return `Hôm qua · ${label}`;
  return label;
}
/** ISO timestamp -> "DD/MM/YYYY HH:mm" in Vietnam; "—" when unparseable. */
export function formatDateTimeVi(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "—";
  return `${formatLocalDateVi(localDateOf(new Date(time)))} ${formatVnTime(iso)}`;
}
