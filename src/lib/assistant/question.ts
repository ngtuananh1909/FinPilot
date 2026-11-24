/** Max characters of one user chat message (also the cap for a `?q=` prefill). */
export const MAX_QUESTION_CHARS = 2000;
const PREFILL_CAP = 300;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * Sanitises the `?q=` prefill coming from Dashboard/Simulator links (anyone can craft the URL):
 * accepts only a string, drops lone surrogates and control/bidi characters, collapses
 * whitespace and caps at 300 code points. The result is only placed in the composer; it is
 * never auto-submitted.
 */
export function sanitizePrefill(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  const wellFormed = raw.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "");
  const cleaned = wellFormed.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return Array.from(cleaned).slice(0, PREFILL_CAP).join("");
}
