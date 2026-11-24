const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-11-24" -> "24/11". Returns the input unchanged if it is not a YYYY-MM-DD date. */
export function formatShortDate(localDate: string): string {
  const match = LOCAL_DATE.exec(localDate);
  return match ? `${match[3]}/${match[2]}` : localDate;
}

/** "2026-11-24" -> "24/11/2026". Returns the input unchanged if it is not a YYYY-MM-DD date. */
export function formatFullDate(localDate: string): string {
  const match = LOCAL_DATE.exec(localDate);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : localDate;
}

/**
 * ISO instant -> "14:35, 24/11/2026" in Asia/Ho_Chi_Minh (fixed +07:00, no DST). Does not depend on
 * the host timezone or on Intl. Returns "" for an invalid instant.
 */
export function formatDateTimeVi(isoInstant: string): string {
  const time = Date.parse(isoInstant);
  if (!Number.isFinite(time)) return "";
  const d = new Date(time + VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}, ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
