import { createHash } from "node:crypto";
import { localDateOf, type LocalDate } from "@/lib/finance";
import { categorySchema } from "@/lib/db/inputs";
import { parseCsv, type Delimiter, type ParsedCsv } from "./csv-parser";
import { importFingerprint } from "./fingerprint";
import { csvLimits, type CsvLimits } from "./limits";
import {
  resolveMapping,
  suggestMapping,
  type ColumnMapping,
  type MappingField,
  type MappingInput,
  type MappingIssueCode,
  type ResolvedMapping,
} from "./mapping";
import { parseAmount, parseDate, parseKind, type ImportKind } from "./normalize";
import { areSimilar, textTokens } from "./similarity";

export type RowStatus = "ok" | "invalid" | "possible_duplicate" | "exact_duplicate" | "ambiguous";

export interface RowReason {
  readonly field: MappingField | "row";
  readonly code: string;
}

/** Normalised values shown in the preview. Amounts are decimal strings (never JS numbers). */
export interface RowValues {
  readonly occurredAt: string | null;
  readonly localDate: LocalDate | null;
  readonly kind: ImportKind | null;
  readonly amountVnd: string | null;
  readonly category: string;
  readonly merchant: string | null;
  readonly description: string | null;
}

export interface DuplicateMatch {
  readonly scope: "existing" | "file";
  readonly transactionId?: string;
  readonly rowNumber?: number;
}

export interface PreviewRow {
  /** Stable for identical file content: `r<rowNumber>-<8 hex of the row's cells>`. */
  readonly rowId: string;
  /** 1-based position among data rows (header excluded). */
  readonly rowNumber: number;
  readonly status: RowStatus;
  readonly reasons: readonly RowReason[];
  /** Non-blocking notes, e.g. `category_defaulted`. */
  readonly warnings: readonly string[];
  readonly values: RowValues;
  readonly duplicateOf: DuplicateMatch | null;
}

/** Fully normalised, import-ready row data; present only for rows that parsed cleanly. */
export interface ImportCandidate {
  readonly occurredAt: Date;
  readonly localDate: LocalDate;
  readonly kind: ImportKind;
  readonly amountVnd: bigint;
  readonly category: string;
  readonly merchant: string | null;
  readonly description: string | null;
  readonly fingerprint: string;
  readonly tokens: ReadonlySet<string>;
}

export interface AnalyzedRow {
  readonly view: PreviewRow;
  readonly candidate: ImportCandidate | null;
}

export interface ImportOptions {
  readonly dayFirst?: boolean | undefined;
  readonly delimiter?: Delimiter | undefined;
}

export interface Analysis {
  readonly parsed: ParsedCsv;
  readonly mapping: ColumnMapping;
  readonly suggestedMapping: ColumnMapping;
  readonly mappingIssues: readonly MappingIssueCode[];
  readonly kindSource: ResolvedMapping["kindSource"];
  readonly rows: readonly AnalyzedRow[];
}

const EMPTY_VALUES: RowValues = {
  occurredAt: null,
  localDate: null,
  kind: null,
  amountVnd: null,
  category: "other",
  merchant: null,
  description: null,
};

const MERCHANT_MAX = 200;
const DESCRIPTION_MAX = 500;

const collapse = (s: string): string => s.normalize("NFC").replace(/\s+/gu, " ").trim();

function rowIdOf(rowNumber: number, cells: readonly string[]): string {
  const hash = createHash("sha256").update(JSON.stringify(cells), "utf8").digest("hex").slice(0, 8);
  return `r${rowNumber}-${hash}`;
}

interface AmountKind {
  readonly kind: ImportKind;
  readonly amount: bigint;
}

function resolveAmountAndKind(
  cell: (field: MappingField) => string,
  mapping: ColumnMapping,
  kindSource: ResolvedMapping["kindSource"],
  reasons: RowReason[],
): AmountKind | null {
  if (kindSource === "debit_credit") {
    const side = (field: "debit_vnd" | "credit_vnd") => {
      const raw = mapping[field] === null ? "" : cell(field);
      if (raw.trim() === "") return { magnitude: 0n };
      const parsed = parseAmount(raw);
      if (!parsed.ok) {
        reasons.push({ field, code: parsed.code });
        return null;
      }
      return { magnitude: parsed.magnitude };
    };
    const debit = side("debit_vnd");
    const credit = side("credit_vnd");
    if (!debit || !credit) return null;
    if (debit.magnitude > 0n && credit.magnitude > 0n) {
      reasons.push({ field: "row", code: "both_debit_and_credit" });
      return null;
    }
    if (debit.magnitude > 0n) return { kind: "expense", amount: debit.magnitude };
    if (credit.magnitude > 0n) return { kind: "income", amount: credit.magnitude };
    reasons.push({ field: "amount_vnd", code: "non_positive_amount" });
    return null;
  }

  const amount = parseAmount(cell("amount_vnd"));
  if (!amount.ok) {
    reasons.push({ field: "amount_vnd", code: amount.code });
    return null;
  }
  if (amount.magnitude === 0n) {
    reasons.push({ field: "amount_vnd", code: "non_positive_amount" });
    return null;
  }
  if (kindSource === "sign") {
    return { kind: amount.negative ? "expense" : "income", amount: amount.magnitude };
  }
  const rawKind = cell("kind");
  if (rawKind.trim() === "") {
    reasons.push({ field: "kind", code: "kind_missing" });
    return null;
  }
  const kind = parseKind(rawKind);
  if (!kind) {
    reasons.push({ field: "kind", code: "kind_unknown" });
    return null;
  }
  if (kind === "income" && amount.negative) {
    reasons.push({ field: "kind", code: "kind_sign_conflict" });
    return null;
  }
  return { kind, amount: amount.magnitude };
}

function analyzeRow(
  cells: readonly string[],
  index: number,
  headerCount: number,
  mapping: ColumnMapping,
  kindSource: ResolvedMapping["kindSource"],
  options: ImportOptions,
): AnalyzedRow {
  const rowNumber = index + 1;
  const rowId = rowIdOf(rowNumber, cells);
  const reasons: RowReason[] = [];
  const warnings: string[] = [];
  const invalid = (values: RowValues = EMPTY_VALUES): AnalyzedRow => ({
    candidate: null,
    view: {
      rowId,
      rowNumber,
      reasons,
      warnings,
      values,
      duplicateOf: null,
      status: reasons.length === 1 && reasons[0]?.code === "ambiguous_date" ? "ambiguous" : "invalid",
    },
  });

  if (cells.length !== headerCount) {
    reasons.push({ field: "row", code: "column_count_mismatch" });
    return invalid();
  }
  const cell = (field: MappingField): string => {
    const at = mapping[field];
    return at === null ? "" : (cells[at] ?? "");
  };

  const date = parseDate(cell("occurred_at"), { dayFirst: options.dayFirst });
  if (!date.ok) reasons.push({ field: "occurred_at", code: date.code });
  const amountKind = resolveAmountAndKind(cell, mapping, kindSource, reasons);

  const rawCategory = collapse(cell("category"));
  let category = "other";
  if (rawCategory !== "") {
    const checked = categorySchema.safeParse(rawCategory);
    if (checked.success) category = checked.data;
    else warnings.push("category_defaulted");
  }
  const merchantText = collapse(cell("merchant"));
  const descriptionText = collapse(cell("description"));
  if (merchantText.length > MERCHANT_MAX) reasons.push({ field: "merchant", code: "too_long" });
  if (descriptionText.length > DESCRIPTION_MAX) reasons.push({ field: "description", code: "too_long" });
  const merchant = merchantText === "" ? null : merchantText;
  const description = descriptionText === "" ? null : descriptionText;

  const values: RowValues = {
    occurredAt: date.ok ? date.instant.toISOString() : null,
    localDate: date.ok ? localDateOf(date.instant) : null,
    kind: amountKind?.kind ?? null,
    amountVnd: amountKind ? amountKind.amount.toString() : null,
    category,
    merchant,
    description,
  };
  if (reasons.length > 0 || !date.ok || !amountKind) return invalid(values);

  const candidate: ImportCandidate = {
    occurredAt: date.instant,
    localDate: localDateOf(date.instant),
    kind: amountKind.kind,
    amountVnd: amountKind.amount,
    category,
    merchant,
    description,
    fingerprint: importFingerprint({
      occurredAt: date.instant,
      kind: amountKind.kind,
      amountVnd: amountKind.amount,
      merchant,
    }),
    tokens: textTokens(merchant, description),
  };
  return {
    candidate,
    view: { rowId, rowNumber, status: "ok", reasons, warnings, values, duplicateOf: null },
  };
}

export interface AnalyzeInput {
  readonly csv: string;
  readonly mapping?: MappingInput | undefined;
  readonly options?: ImportOptions | undefined;
  readonly limits?: CsvLimits | undefined;
}

/**
 * Parses the CSV text and normalises every row. Pure and deterministic: the same input always
 * yields the same row ids and statuses (`ok | invalid | ambiguous`; duplicate statuses are added by
 * {@link classifyRows}). When the mapping is incomplete no rows are analysed.
 */
export function analyzeCsv(input: AnalyzeInput): Analysis {
  const options = input.options ?? {};
  const parsed = parseCsv(input.csv, { delimiter: options.delimiter, limits: input.limits ?? csvLimits() });
  const resolved = resolveMapping(parsed.headers, input.mapping);
  const rows =
    resolved.issues.length > 0
      ? []
      : parsed.rows.map((cells, i) =>
          analyzeRow(cells, i, parsed.headers.length, resolved.mapping, resolved.kindSource, options),
        );
  return {
    parsed,
    mapping: resolved.mapping,
    suggestedMapping: suggestMapping(parsed.headers),
    mappingIssues: resolved.issues,
    kindSource: resolved.kindSource,
    rows,
  };
}

/** Minimal shape of an already-stored transaction needed for duplicate review. */
export interface ExistingTransaction {
  readonly id: string;
  readonly occurredAt: Date;
  readonly kind: ImportKind;
  readonly amountVnd: bigint;
  readonly merchant: string | null;
  readonly description: string | null;
  readonly fingerprint: string | null;
}

const bucketKey = (localDate: string, kind: string, amount: bigint) => `${localDate}|${kind}|${amount.toString()}`;

/**
 * Adds duplicate statuses, in this precedence:
 *  1. `exact_duplicate`: same fingerprint as a stored transaction of this owner (stored value, or
 *     recomputed from the stored row's own fields), or as an EARLIER row of the same file.
 *  2. `possible_duplicate`: same local date + kind + amount as a stored transaction or earlier file
 *     row, and the merchant/description token sets overlap (Jaccard >= 0.5, see similarity.ts).
 * Nothing is dropped: the first occurrence in a file stays `ok`; the user decides about the rest.
 */
export function classifyRows(rows: readonly AnalyzedRow[], existing: readonly ExistingTransaction[]): AnalyzedRow[] {
  const existingByFingerprint = new Map<string, string>();
  const existingByBucket = new Map<string, { id: string; tokens: Set<string> }[]>();
  for (const tx of existing) {
    const computed = importFingerprint({
      occurredAt: tx.occurredAt,
      kind: tx.kind,
      amountVnd: tx.amountVnd,
      merchant: tx.merchant,
    });
    if (tx.fingerprint && !existingByFingerprint.has(tx.fingerprint)) existingByFingerprint.set(tx.fingerprint, tx.id);
    if (!existingByFingerprint.has(computed)) existingByFingerprint.set(computed, tx.id);
    const key = bucketKey(localDateOf(tx.occurredAt), tx.kind, tx.amountVnd);
    const list = existingByBucket.get(key) ?? [];
    list.push({ id: tx.id, tokens: textTokens(tx.merchant, tx.description) });
    existingByBucket.set(key, list);
  }

  const fileByFingerprint = new Map<string, number>();
  const fileByBucket = new Map<string, { rowNumber: number; tokens: ReadonlySet<string> }[]>();

  return rows.map((row) => {
    const c = row.candidate;
    if (!c || row.view.status !== "ok") return row;

    let status: RowStatus = "ok";
    let duplicateOf: DuplicateMatch | null = null;
    const reasons: RowReason[] = [];

    const existingId = existingByFingerprint.get(c.fingerprint);
    const earlierRow = fileByFingerprint.get(c.fingerprint);
    if (existingId !== undefined) {
      status = "exact_duplicate";
      duplicateOf = { scope: "existing", transactionId: existingId };
      reasons.push({ field: "row", code: "same_fingerprint_as_existing" });
    } else if (earlierRow !== undefined) {
      status = "exact_duplicate";
      duplicateOf = { scope: "file", rowNumber: earlierRow };
      reasons.push({ field: "row", code: "repeated_in_file" });
    } else {
      const key = bucketKey(c.localDate, c.kind, c.amountVnd);
      const storedHit = existingByBucket.get(key)?.find((e) => areSimilar(c.tokens, e.tokens));
      const fileHit = fileByBucket.get(key)?.find((e) => areSimilar(c.tokens, e.tokens));
      if (storedHit) {
        status = "possible_duplicate";
        duplicateOf = { scope: "existing", transactionId: storedHit.id };
        reasons.push({ field: "row", code: "similar_to_existing" });
      } else if (fileHit) {
        status = "possible_duplicate";
        duplicateOf = { scope: "file", rowNumber: fileHit.rowNumber };
        reasons.push({ field: "row", code: "similar_to_file_row" });
      }
    }

    if (!fileByFingerprint.has(c.fingerprint)) fileByFingerprint.set(c.fingerprint, row.view.rowNumber);
    const key = bucketKey(c.localDate, c.kind, c.amountVnd);
    const bucket = fileByBucket.get(key) ?? [];
    bucket.push({ rowNumber: row.view.rowNumber, tokens: c.tokens });
    fileByBucket.set(key, bucket);

    return status === "ok" ? row : { candidate: c, view: { ...row.view, status, reasons, duplicateOf } };
  });
}

export interface PreviewCounts {
  readonly total: number;
  readonly ok: number;
  readonly invalid: number;
  readonly ambiguous: number;
  readonly possibleDuplicate: number;
  readonly exactDuplicate: number;
}

export function countRows(rows: readonly AnalyzedRow[]): PreviewCounts {
  const counts = { total: rows.length, ok: 0, invalid: 0, ambiguous: 0, possibleDuplicate: 0, exactDuplicate: 0 };
  for (const { view } of rows) {
    if (view.status === "ok") counts.ok += 1;
    else if (view.status === "invalid") counts.invalid += 1;
    else if (view.status === "ambiguous") counts.ambiguous += 1;
    else if (view.status === "possible_duplicate") counts.possibleDuplicate += 1;
    else counts.exactDuplicate += 1;
  }
  return counts;
}

/** Rows that parsed cleanly and occurred at or before the balance snapshot (AC-04: history only). */
export function countHistoricalOnly(rows: readonly AnalyzedRow[], snapshotAt: Date): number {
  const cutoff = snapshotAt.getTime();
  return rows.filter((r) => r.candidate !== null && r.candidate.occurredAt.getTime() <= cutoff).length;
}
