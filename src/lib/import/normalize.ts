import { MAX_VND, formatLocalDate, parseLocalDate } from "@/lib/finance";
import { parseInstant } from "@/lib/db/time";

/**
 * Pure cell normalisers for CSV import. Nothing here evaluates or interprets cell text beyond
 * matching it against fixed patterns; unrecognised input yields a reason code, never a guess.
 */

/** Lower-case, strip Vietnamese diacritics (incl. đ), collapse separators to single spaces. */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Amount
// ---------------------------------------------------------------------------

export type AmountParse =
  | { readonly ok: true; readonly negative: boolean; readonly magnitude: bigint }
  | { readonly ok: false; readonly code: AmountErrorCode };

export type AmountErrorCode = "amount_missing" | "invalid_amount" | "fractional_amount" | "amount_too_large";

const CURRENCY_PREFIX = /^(?:vnđ|vnd|đ|₫)/iu;
const CURRENCY_SUFFIX = /(?:vnđ|vnd|đ|₫|d)$/iu;

/**
 * Parses a VND amount cell into sign + non-negative integer magnitude.
 *
 * Accepted: plain digits, `.`/`,` thousands grouping (`45.000`, `1,500,000`, `1.500.000đ`),
 * a currency marker (`đ ₫ d vnd vnđ`), a leading `+`/`-`/`−`, or accounting parentheses `(45000)` = negative.
 * A single separator followed by exactly three digits is grouping (VND has no minor unit), so
 * `1.234` is 1234. Any other single separator is a decimal point: `45.00` is accepted, `45.50` is
 * rejected (`fractional_amount`). Values above MAX_VND are rejected. Zero is returned as 0n and
 * the caller decides whether zero is allowed.
 */
export function parseAmount(raw: string): AmountParse {
  let s = raw.normalize("NFC").replace(/[\s\u00a0\u202f]/g, "");
  if (s === "") return { ok: false, code: "amount_missing" };

  let negative = false;
  let signSeen = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    signSeen = true;
    s = paren[1] as string;
  }
  for (let guard = 0; guard < 4; guard += 1) {
    const sign = /^[+\-\u2212]/.exec(s);
    if (sign) {
      if (signSeen) return { ok: false, code: "invalid_amount" };
      signSeen = true;
      negative = sign[0] !== "+";
      s = s.slice(1);
      continue;
    }
    if (CURRENCY_PREFIX.test(s)) {
      s = s.replace(CURRENCY_PREFIX, "");
      continue;
    }
    if (CURRENCY_SUFFIX.test(s)) {
      s = s.replace(CURRENCY_SUFFIX, "");
      continue;
    }
    break;
  }
  if (!/^[0-9.,]+$/.test(s)) return { ok: false, code: "invalid_amount" };

  const digits = integerDigits(s);
  if (typeof digits !== "string") return digits;
  const stripped = digits.replace(/^0+(?=\d)/, "");
  if (stripped.length > 16) return { ok: false, code: "amount_too_large" };
  const magnitude = BigInt(stripped);
  if (magnitude > MAX_VND) return { ok: false, code: "amount_too_large" };
  return { ok: true, negative: negative && magnitude !== 0n, magnitude };
}

const count = (s: string, ch: string) => s.split(ch).length - 1;

/** Returns the integer digits of `body` (digits and separators only) or a failure. */
function integerDigits(body: string): string | { ok: false; code: AmountErrorCode } {
  const dots = count(body, ".");
  const commas = count(body, ",");
  if (dots === 0 && commas === 0) return body;

  let thousands: string | null = null;
  let decimal: string | null = null;
  if (dots > 0 && commas > 0) {
    decimal = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
    thousands = decimal === "." ? "," : ".";
    if (count(body, decimal) !== 1) return { ok: false, code: "invalid_amount" };
  } else {
    const sep = dots > 0 ? "." : ",";
    if (dots + commas > 1) {
      thousands = sep;
    } else {
      const [lead = "", tail = ""] = body.split(sep);
      if (/^[1-9]\d{0,2}$/.test(lead) && /^\d{3}$/.test(tail)) thousands = sep;
      else decimal = sep;
    }
  }

  let intPart = body;
  let fraction = "";
  if (decimal !== null) {
    const at = body.indexOf(decimal);
    intPart = body.slice(0, at);
    fraction = body.slice(at + 1);
    if (!/^\d+$/.test(fraction)) return { ok: false, code: "invalid_amount" };
  }
  if (thousands !== null) {
    const grouped = new RegExp(`^[1-9]\\d{0,2}(?:\\${thousands}\\d{3})+$`);
    if (!grouped.test(intPart)) return { ok: false, code: "invalid_amount" };
    intPart = intPart.split(thousands).join("");
  } else if (!/^\d*$/.test(intPart)) {
    return { ok: false, code: "invalid_amount" };
  }
  if (decimal !== null && /[1-9]/.test(fraction)) return { ok: false, code: "fractional_amount" };
  return intPart === "" ? "0" : intPart;
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

export type DateErrorCode = "date_missing" | "invalid_date" | "ambiguous_date";
export type DateParse =
  | { readonly ok: true; readonly instant: Date }
  | { readonly ok: false; readonly code: DateErrorCode };

const MIN_INSTANT = Date.UTC(2000, 0, 1);
const MAX_INSTANT = Date.UTC(2101, 0, 1);
/** Date-only cells become local noon so the calendar day is stable (Asia/Ho_Chi_Minh is UTC+7, no DST). */
const DEFAULT_TIME = { hh: 12, mm: 0, ss: 0 };

const TIME = "(?:[T ]+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?";
const ISO_OFFSET = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/i;
const YEAR_FIRST = new RegExp(`^(\\d{4})([/-])(\\d{1,2})\\2(\\d{1,2})${TIME}$`);
const DAY_MONTH_FIRST = new RegExp(`^(\\d{1,2})([/-])(\\d{1,2})\\2(\\d{4})${TIME}$`);

interface Clock {
  readonly hh: number;
  readonly mm: number;
  readonly ss: number;
}

function clockOf(hh?: string, mm?: string, ss?: string): Clock {
  if (hh === undefined || mm === undefined) return DEFAULT_TIME;
  return { hh: Number(hh), mm: Number(mm), ss: ss === undefined ? 0 : Number(ss) };
}

/** Naive (offset-less) wall-clock time is Asia/Ho_Chi_Minh = +07:00. */
function localInstant(year: number, month: number, day: number, clock: Clock): Date | null {
  const date = formatLocalDate(year, month, day);
  try {
    parseLocalDate(date);
  } catch {
    return null;
  }
  if (clock.hh > 23 || clock.mm > 59 || clock.ss > 59) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return withinRange(parseInstant(`${date}T${p(clock.hh)}:${p(clock.mm)}:${p(clock.ss)}+07:00`));
}

function withinRange(instant: Date | null): Date | null {
  if (!instant) return null;
  const t = instant.getTime();
  return t >= MIN_INSTANT && t < MAX_INSTANT ? instant : null;
}

const fail = (code: DateErrorCode): DateParse => ({ ok: false, code });
const ok = (instant: Date | null): DateParse => (instant ? { ok: true, instant } : fail("invalid_date"));

/**
 * Parses a date cell. Supported: ISO-8601 with offset/Z; `YYYY-MM-DD` and `YYYY/MM/DD`
 * (year first, unambiguous); `DD/MM/YYYY`, `DD-MM-YYYY`. A time `HH:MM[:SS]` may follow the
 * naive forms. Naive values are Asia/Ho_Chi_Minh; date-only values are 12:00 local.
 *
 * `A/B/YYYY` with both A and B <= 12 and A != B is `ambiguous_date` unless `dayFirst` is
 * given (true = DD/MM, false = MM/DD). When one part is > 12 only one reading is possible and it
 * is used. Impossible calendar dates (30/02, 31/04) and years outside 2000..2100 are `invalid_date`.
 */
export function parseDate(raw: string, options: { dayFirst?: boolean | undefined } = {}): DateParse {
  const s = raw.trim();
  if (s === "") return fail("date_missing");

  const iso = ISO_OFFSET.exec(s);
  if (iso) {
    const offset = (iso[7] as string).toUpperCase();
    const fixed = offset.length === 5 && offset !== "Z" ? `${offset.slice(0, 3)}:${offset.slice(3)}` : offset;
    const seconds = iso[6] === undefined ? "" : `:${iso[6]}`;
    return ok(withinRange(parseInstant(`${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}${seconds}${fixed}`)));
  }

  const yearFirst = YEAR_FIRST.exec(s);
  if (yearFirst) {
    const [, y, , m, d, hh, mm, ss] = yearFirst;
    return ok(localInstant(Number(y), Number(m), Number(d), clockOf(hh, mm, ss)));
  }

  const dmy = DAY_MONTH_FIRST.exec(s);
  if (dmy) {
    const [, a, , b, y, hh, mm, ss] = dmy;
    const first = Number(a);
    const second = Number(b);
    let day: number;
    let month: number;
    if (options.dayFirst === true) {
      [day, month] = [first, second];
    } else if (options.dayFirst === false) {
      [day, month] = [second, first];
    } else if (first < 1 || second < 1) {
      return fail("invalid_date");
    } else if (first > 12) {
      [day, month] = [first, second];
    } else if (second > 12) {
      [day, month] = [second, first];
    } else if (first === second) {
      [day, month] = [first, second];
    } else {
      return fail("ambiguous_date");
    }
    return ok(localInstant(Number(y), month, day, clockOf(hh, mm, ss)));
  }
  return fail("invalid_date");
}

// ---------------------------------------------------------------------------
// Kind
// ---------------------------------------------------------------------------

export type ImportKind = "income" | "expense" | "excluded";

const KIND_WORDS: Readonly<Record<string, ImportKind>> = {
  income: "income",
  thu: "income",
  "thu nhap": "income",
  "thu vao": "income",
  credit: "income",
  "ghi co": "income",
  expense: "expense",
  chi: "expense",
  "chi tieu": "expense",
  "chi ra": "expense",
  debit: "expense",
  "ghi no": "expense",
  excluded: "excluded",
  "loai tru": "excluded",
};

/** Maps a kind-column cell to a kind, or null when unrecognised (never guessed). */
export function parseKind(raw: string): ImportKind | null {
  const word = foldText(raw);
  return Object.prototype.hasOwnProperty.call(KIND_WORDS, word) ? (KIND_WORDS[word] as ImportKind) : null;
}
