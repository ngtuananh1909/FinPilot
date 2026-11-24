import { DEFAULT_SIGNED_IN_PATH } from "./routes";

const MAX_LENGTH = 512;
// Control characters, whitespace and backslashes are never valid in an internal path we generate.
const FORBIDDEN = /[\u0000-\u001f\u007f\s\\]/;

function decodeOnce(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Returns `raw` only when it is a same-origin relative path ("/dashboard?x=1"), otherwise `fallback`.
 * Rejects protocol-relative ("//evil.com"), backslash tricks ("/\evil.com"), absolute and
 * scheme URLs ("https://x", "javascript:"), control characters and percent-encoded variants.
 */
export function sanitizeNextPath(raw: unknown, fallback: string = DEFAULT_SIGNED_IN_PATH): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
  // Check the raw value and up to two decoded forms (double-encoding such as %252f).
  let candidate: string | null = raw;
  for (let round = 0; round < 3; round += 1) {
    if (candidate === null) return fallback;
    if (!candidate.startsWith("/") || candidate.startsWith("//") || FORBIDDEN.test(candidate)) return fallback;
    const decoded: string | null = decodeOnce(candidate);
    if (decoded === candidate) break;
    candidate = decoded;
  }
  // Final structural check: resolving against a dummy origin must keep that origin.
  try {
    const base = "https://app.invalid";
    const resolved = new URL(raw, base);
    if (resolved.origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return raw;
}
