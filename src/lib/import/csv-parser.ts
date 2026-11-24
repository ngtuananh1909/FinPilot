import { ImportError } from "./errors";
import { csvLimits, type CsvLimits } from "./limits";

export const DELIMITERS = [",", ";", "\t"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

export interface ParsedCsv {
  readonly delimiter: Delimiter;
  readonly headers: readonly string[];
  /** Data records exactly as parsed (may be ragged: the caller flags rows whose length differs). */
  readonly rows: readonly (readonly string[])[];
}

export interface ParseCsvOptions {
  readonly delimiter?: Delimiter | undefined;
  readonly limits?: CsvLimits | undefined;
}

/** C0 control characters other than TAB, LF and CR. A text CSV never contains these. */
const BINARY_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

interface TokenizeLimits {
  readonly maxRecords: number;
  readonly maxColumns: number;
  readonly maxCellLength: number;
}

function checkCell(field: string, limits: TokenizeLimits): void {
  if (field.length > limits.maxCellLength) throw new ImportError("cell_too_long", { httpStatus: 400 });
}

/**
 * RFC 4180 tokenizer with the usual leniencies: LF, CRLF and bare CR end a record; a quote
 * inside an unquoted field is literal; fully blank lines are skipped. A quoted field may contain
 * delimiters, line breaks and doubled quotes. Cell text is only ever copied, never interpreted.
 */
function tokenize(text: string, delimiter: Delimiter, limits: TokenizeLimits): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let atFieldStart = true;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    checkCell(field, limits);
    record.push(field);
    if (record.length > limits.maxColumns) throw new ImportError("too_many_columns");
    field = "";
  };
  const endRecord = () => {
    pushField();
    const blank = record.length === 1 && record[0] === "";
    if (!blank) records.push(record);
    record = [];
    atFieldStart = true;
  };

  while (i < n && records.length < limits.maxRecords) {
    const ch = text[i] as string;
    if (ch === '"' && atFieldStart) {
      i += 1;
      for (;;) {
        if (i >= n) throw new ImportError("unterminated_quote");
        const c = text[i] as string;
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        field += c;
        i += 1;
        if (field.length > limits.maxCellLength) throw new ImportError("cell_too_long");
      }
      const next = text[i];
      if (!(next === undefined || next === delimiter || next === "\n" || next === "\r")) {
        throw new ImportError("invalid_quote");
      }
      atFieldStart = false;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      atFieldStart = true;
      i += 1;
    } else if (ch === "\r" || ch === "\n") {
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      endRecord();
    } else {
      field += ch;
      atFieldStart = false;
      i += 1;
    }
  }
  if (records.length < limits.maxRecords && (!atFieldStart || record.length > 0)) endRecord();
  return records;
}

/** Picks the delimiter (`,` `;` TAB) whose first records have the most consistent multi-column shape. */
export function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ",";
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    let score = 0;
    try {
      const sample = tokenize(text, delimiter, { maxRecords: 20, maxColumns: 1000, maxCellLength: 100_000 });
      const columns = sample[0]?.length ?? 0;
      if (columns >= 2) {
        const consistent = sample.filter((r) => r.length === columns).length;
        score = consistent * 1000 + columns;
      }
    } catch {
      score = 0;
    }
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Parses an uploaded CSV string. Enforces (in this order, before any tokenizing): byte size,
 * valid text (no U+FFFD, NUL or binary control bytes), non-empty. Then header presence, row,
 * column and cell limits. Throws ImportError (HTTP 400, 413 for size).
 */
export function parseCsv(input: string, options: ParseCsvOptions = {}): ParsedCsv {
  const limits = options.limits ?? csvLimits();
  if (typeof input !== "string") throw new ImportError("invalid_request");
  if (Buffer.byteLength(input, "utf8") > limits.maxBytes) {
    throw new ImportError("payload_too_large", { httpStatus: 413 });
  }
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (BINARY_CONTROL.test(text)) throw new ImportError("binary_content");
  if (text.includes("\uFFFD")) throw new ImportError("invalid_encoding");
  if (text.trim() === "") throw new ImportError("empty_file");

  const delimiter = options.delimiter ?? detectDelimiter(text);
  const records = tokenize(text, delimiter, {
    maxRecords: limits.maxRows + 2,
    maxColumns: limits.maxColumns,
    maxCellLength: limits.maxCellLength,
  });
  const header = records[0];
  if (!header || header.every((cell) => cell.trim() === "")) throw new ImportError("missing_header");
  if (records.length === 1) throw new ImportError("no_data_rows");
  if (records.length - 1 > limits.maxRows) throw new ImportError("too_many_rows");
  return { delimiter, headers: header.map((cell) => cell.trim()), rows: records.slice(1) };
}
