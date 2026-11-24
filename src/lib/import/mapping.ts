import { ImportError } from "./errors";
import { foldText } from "./normalize";

/**
 * Canonical import fields. `debit_vnd` / `credit_vnd` are the two-column alternative to a
 * single (signed) `amount_vnd`. `persona_code` and any other column are ignored.
 */
export const MAPPING_FIELDS = [
  "occurred_at",
  "kind",
  "amount_vnd",
  "debit_vnd",
  "credit_vnd",
  "category",
  "merchant",
  "description",
] as const;
export type MappingField = (typeof MAPPING_FIELDS)[number];

/** Zero-based column index per field; null = not mapped. */
export type ColumnMapping = Readonly<Record<MappingField, number | null>>;
/** What a client may send: omitted keys fall back to the auto-suggestion, `null` explicitly unmaps. */
export type MappingInput = Partial<Record<MappingField, number | null>>;

const SYNONYMS: Readonly<Record<MappingField, readonly string[]>> = {
  occurred_at: [
    "occurred at",
    "date",
    "datetime",
    "transaction date",
    "posting date",
    "time",
    "ngay",
    "ngay giao dich",
    "ngay gd",
    "thoi gian",
    "thoi gian giao dich",
  ],
  kind: ["kind", "type", "transaction type", "loai", "loai giao dich", "thu chi"],
  amount_vnd: ["amount vnd", "amount", "value", "vnd", "so tien", "so tien gd", "gia tri", "so tien giao dich"],
  debit_vnd: ["debit", "withdrawal", "ghi no", "chi ra", "rut ra", "tien ra", "so tien chi"],
  credit_vnd: ["credit", "deposit", "ghi co", "thu vao", "gui vao", "tien vao", "so tien thu"],
  category: ["category", "danh muc", "nhom", "phan loai"],
  merchant: ["merchant", "payee", "counterparty", "nguoi nhan", "noi nhan", "cua hang", "don vi"],
  description: [
    "description",
    "desc",
    "memo",
    "note",
    "notes",
    "ghi chu",
    "noi dung",
    "mo ta",
    "noi dung giao dich",
    "dien giai",
    "chi tiet",
  ],
};

const EMPTY: ColumnMapping = {
  occurred_at: null,
  kind: null,
  amount_vnd: null,
  debit_vnd: null,
  credit_vnd: null,
  category: null,
  merchant: null,
  description: null,
};

/**
 * Suggests a mapping from header names (English + Vietnamese synonyms, diacritics-insensitive).
 * First exact synonym match wins, and a column is used at most once. Debit/credit are only
 * suggested when no single amount column was found.
 */
export function suggestMapping(headers: readonly string[]): ColumnMapping {
  const folded = headers.map(foldText);
  const used = new Set<number>();
  const out: Record<MappingField, number | null> = { ...EMPTY };
  for (const field of MAPPING_FIELDS) {
    if ((field === "debit_vnd" || field === "credit_vnd") && out.amount_vnd !== null) continue;
    const index = folded.findIndex((h, i) => !used.has(i) && SYNONYMS[field].includes(h));
    if (index >= 0) {
      out[field] = index;
      used.add(index);
    }
  }
  return out;
}

export type MappingIssueCode = "occurred_at_missing" | "amount_missing" | "amount_conflict";

export interface ResolvedMapping {
  readonly mapping: ColumnMapping;
  readonly issues: readonly MappingIssueCode[];
  /** How `kind` is determined for each row. */
  readonly kindSource: "column" | "debit_credit" | "sign";
}

/**
 * Applies a client mapping on top of the suggestion. Throws `invalid_mapping` for out-of-range
 * indices or one column mapped to two fields. Incomplete mappings (no date / no amount) are
 * returned as `issues`, so the preview can ask the user to complete them.
 */
export function resolveMapping(headers: readonly string[], input?: MappingInput): ResolvedMapping {
  const merged: Record<MappingField, number | null> = { ...suggestMapping(headers) };
  if (input) {
    for (const field of MAPPING_FIELDS) {
      const value = input[field];
      if (value !== undefined) merged[field] = value;
    }
  }
  const used = new Set<number>();
  for (const field of MAPPING_FIELDS) {
    const index = merged[field];
    if (index === null) continue;
    if (!Number.isInteger(index) || index < 0 || index >= headers.length || used.has(index)) {
      throw new ImportError("invalid_mapping");
    }
    used.add(index);
  }

  const issues: MappingIssueCode[] = [];
  if (merged.occurred_at === null) issues.push("occurred_at_missing");
  const hasSplit = merged.debit_vnd !== null || merged.credit_vnd !== null;
  if (merged.amount_vnd === null && !hasSplit) issues.push("amount_missing");
  if (merged.amount_vnd !== null && hasSplit) issues.push("amount_conflict");

  // Separate debit/credit columns carry the kind themselves; a mapped kind column is then unused.
  const splitOnly = merged.amount_vnd === null && hasSplit;
  const kindSource = splitOnly ? "debit_credit" : merged.kind !== null ? "column" : "sign";
  return { mapping: merged, issues, kindSource };
}
