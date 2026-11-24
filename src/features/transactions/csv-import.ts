import { callApi, type FetchLike } from "@/lib/http/api-call";
import type { PreviewRow } from "@/lib/import/analyze";
import { DEFAULT_CSV_MAX_BYTES } from "@/lib/import/limits";
import type { MappingField, MappingInput } from "@/lib/import/mapping";
import type { CsvCommitResult, CsvPreviewResult } from "@/lib/import/service";
/**
 * CSV import state machine (pure functions + injected fetch). Nothing is written until
 * `runCommit` is called by the explicit final confirmation.
 *
 * Idempotency: one key per distinct commit request. A retry of the SAME request reuses the key
 * (so a double click or a lost response cannot import twice); changing the selection, mapping or
 * date format creates a new key. The server marks a batch `failed` when its insert fails and a
 * repeat of that key would only replay the failed batch, so that single case also rotates the key.
 */
export const CSV_MAX_BYTES = DEFAULT_CSV_MAX_BYTES;
export const MAPPING_FIELD_ORDER = [
  "occurred_at",
  "amount_vnd",
  "debit_vnd",
  "credit_vnd",
  "kind",
  "category",
  "merchant",
  "description",
] as const satisfies readonly MappingField[];
export const MAPPING_FIELD_LABEL: Record<MappingField, string> = {
  occurred_at: "Ngày giờ",
  amount_vnd: "Số tiền",
  debit_vnd: "Tiền chi ra (ghi nợ)",
  credit_vnd: "Tiền thu vào (ghi có)",
  kind: "Loại (thu/chi)",
  category: "Danh mục",
  merchant: "Nơi nhận / cửa hàng",
  description: "Nội dung",
};
export interface CsvDeps {
  fetch: FetchLike;
  newKey: () => string;
}
export interface CsvFile {
  name: string;
  text: string;
}
export type CsvBusy = "idle" | "previewing" | "committing";
export interface CsvImportState {
  step: "choose" | "preview" | "done";
  busy: CsvBusy;
  file: CsvFile | null;
  /** The user's own mapping edits; omitted fields fall back to the server's suggestion. */
  overrides: MappingInput;
  dayFirst: boolean | null;
  preview: CsvPreviewResult | null;
  /** The mapping/format the current `preview` was produced with; commit always uses exactly this. */
  previewed: { overrides: MappingInput; dayFirst: boolean | null } | null;
  /** Row ids ticked for import. */
  selected: string[];
  commit: { key: string; signature: string } | null;
  result: CsvCommitResult | null;
  error: string | null;
  notice: string | null;
}
export const initialCsvState = (): CsvImportState => ({
  step: "choose",
  busy: "idle",
  file: null,
  overrides: {},
  dayFirst: null,
  preview: null,
  previewed: null,
  selected: [],
  commit: null,
  result: null,
  error: null,
  notice: null,
});
const TEXT_EXTENSIONS = /\.(csv|tsv|txt)$/i;
const TEXT_TYPES = new Set(["", "text/csv", "text/plain", "text/tab-separated-values", "application/csv", "application/vnd.ms-excel"]);
/** Client-side checks before upload: size cap and plain-text only. The server re-validates everything. */
export function validateCsvFileMeta(meta: { name: string; size: number; type: string }, maxBytes = CSV_MAX_BYTES): string | null {
  if (meta.size === 0) return "Tệp CSV trống.";
  if (meta.size > maxBytes) return "Tệp quá lớn: tối đa 2 MB.";
  const typeOk = TEXT_TYPES.has(meta.type.toLowerCase());
  const extOk = TEXT_EXTENSIONS.test(meta.name);
  if (!typeOk || !extOk) return "Chỉ nhận tệp văn bản CSV (.csv, .tsv hoặc .txt).";
  return null;
}
/** Text that contains NUL bytes is binary renamed to .csv. */
export const looksBinary = (text: string): boolean => text.includes("\u0000");
export function withFile(file: CsvFile): CsvImportState {
  return { ...initialCsvState(), file };
}
const SELECTABLE: ReadonlySet<PreviewRow["status"]> = new Set(["ok", "possible_duplicate", "exact_duplicate"]);
const DUPLICATE: ReadonlySet<PreviewRow["status"]> = new Set(["possible_duplicate", "exact_duplicate"]);
export const isSelectable = (row: PreviewRow): boolean => SELECTABLE.has(row.status);
export const isDuplicate = (row: PreviewRow): boolean => DUPLICATE.has(row.status);
/** Default selection: clean rows only. Duplicates need an explicit tick; invalid/ambiguous can never be ticked. */
export const defaultSelection = (rows: readonly PreviewRow[]): string[] =>
  rows.filter((r) => r.status === "ok").map((r) => r.rowId);
export function previewBody(file: CsvFile, overrides: MappingInput, dayFirst: boolean | null): Record<string, unknown> {
  return {
    csv: file.text,
    filename: file.name.slice(0, 255),
    ...(Object.keys(overrides).length > 0 ? { mapping: overrides } : {}),
    ...(dayFirst === null ? {} : { options: { dayFirst } }),
  };
}
async function requestPreview(
  deps: CsvDeps,
  state: CsvImportState,
  overrides: MappingInput,
  dayFirst: boolean | null,
): Promise<CsvImportState> {
  if (!state.file) return { ...state, error: "Chưa chọn tệp." };
  const res = await callApi<CsvPreviewResult>(
    deps.fetch,
    "POST",
    "/api/imports/csv/preview",
    previewBody(state.file, overrides, dayFirst),
  );
  if (!res.ok) return { ...state, busy: "idle", error: res.message, notice: null };
  const preview = res.data;
  return {
    ...state,
    step: "preview",
    busy: "idle",
    overrides,
    dayFirst,
    preview,
    previewed: { overrides, dayFirst },
    selected: defaultSelection(preview.rows),
    // A new preview invalidates any earlier commit key: the request it describes may differ.
    error: null,
    notice: null,
  };
}
/** First preview of the chosen file, or a refresh with the current mapping. */
export const runPreview = (deps: CsvDeps, state: CsvImportState): Promise<CsvImportState> =>
  requestPreview(deps, state, state.overrides, state.dayFirst);
/** Changes one column mapping (`null` = unmapped) and previews again. A rejected mapping leaves the old preview intact. */
export const changeMapping = (
  deps: CsvDeps,
  state: CsvImportState,
  field: MappingField,
  column: number | null,
): Promise<CsvImportState> => requestPreview(deps, state, { ...state.overrides, [field]: column }, state.dayFirst);
/** Answers the "day first or month first" question and previews again. */
export const chooseDayFirst = (deps: CsvDeps, state: CsvImportState, dayFirst: boolean): Promise<CsvImportState> =>
  requestPreview(deps, state, state.overrides, dayFirst);
export function toggleRow(state: CsvImportState, rowId: string): CsvImportState {
  const row = state.preview?.rows.find((r) => r.rowId === rowId);
  if (!row || !isSelectable(row) || state.busy !== "idle") return state;
  const selected = state.selected.includes(rowId)
    ? state.selected.filter((id) => id !== rowId)
    : [...state.selected, rowId];
  return { ...state, selected };
}
/** Ticks every clean row and leaves duplicates as they are. */
export function selectAllClean(state: CsvImportState): CsvImportState {
  if (!state.preview) return state;
  const duplicatesKept = state.selected.filter((id) => {
    const row = state.preview?.rows.find((r) => r.rowId === id);
    return row ? isDuplicate(row) : false;
  });
  return { ...state, selected: [...defaultSelection(state.preview.rows), ...duplicatesKept] };
}
export const clearSelection = (state: CsvImportState): CsvImportState => ({ ...state, selected: [] });
/** Ids of selected duplicate rows (the user's explicit opt-in). */
export function includedDuplicateIds(state: CsvImportState): string[] {
  const rows = state.preview?.rows ?? [];
  return state.selected.filter((id) => {
    const row = rows.find((r) => r.rowId === id);
    return row ? isDuplicate(row) : false;
  });
}
/** What would be sent: sorted for stable signatures. */
export function commitSelection(state: CsvImportState): { rowIds: string[]; includeDuplicateRowIds: string[] } {
  const rows = state.preview?.rows ?? [];
  const valid = new Set(rows.filter(isSelectable).map((r) => r.rowId));
  const rowIds = [...new Set(state.selected)].filter((id) => valid.has(id)).sort();
  const dups = new Set(includedDuplicateIds(state));
  return { rowIds, includeDuplicateRowIds: rowIds.filter((id) => dups.has(id)) };
}
export function commitSignature(state: CsvImportState): string {
  const { rowIds, includeDuplicateRowIds } = commitSelection(state);
  const mapping = Object.entries(state.previewed?.overrides ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({
    rowIds,
    includeDuplicateRowIds,
    mapping,
    dayFirst: state.previewed?.dayFirst ?? null,
    file: [state.file?.name ?? "", state.file?.text.length ?? 0],
  });
}
/** Reason the final confirm must stay disabled, or null when it may proceed. */
export function commitBlocker(state: CsvImportState): string | null {
  const { preview } = state;
  if (!preview) return "Chưa có bản xem trước.";
  if (preview.mappingIssues.length > 0) return "Cần ghép tối thiểu cột ngày và cột số tiền.";
  if (preview.needsDateFormat && state.previewed?.dayFirst === null) return "Hãy chọn định dạng ngày trước khi nhập.";
  if (commitSelection(state).rowIds.length === 0) return "Hãy chọn ít nhất một dòng để nhập.";
  return null;
}
/** The one function that writes. Never throws; failures keep the preview and the key for a safe retry. */
export async function runCommit(deps: CsvDeps, state: CsvImportState): Promise<CsvImportState> {
  const blocker = commitBlocker(state);
  if (blocker || !state.file || !state.previewed) return { ...state, busy: "idle", error: blocker ?? "Chưa chọn tệp." };
  const signature = commitSignature(state);
  const key = state.commit && state.commit.signature === signature ? state.commit.key : deps.newKey();
  const commit = { key, signature };
  const { rowIds, includeDuplicateRowIds } = commitSelection(state);
  const { overrides, dayFirst } = state.previewed;
  const res = await callApi<CsvCommitResult>(deps.fetch, "POST", "/api/imports/csv/commit", {
    confirmed: true,
    idempotencyKey: key,
    csv: state.file.text,
    filename: state.file.name.slice(0, 255),
    ...(Object.keys(overrides).length > 0 ? { mapping: overrides } : {}),
    ...(dayFirst === null ? {} : { options: { dayFirst } }),
    rowIds,
    ...(includeDuplicateRowIds.length > 0 ? { includeDuplicateRowIds } : {}),
  });
  if (!res.ok) {
    const rotate = res.reason === "import_commit_failed";
    return { ...state, busy: "idle", error: res.message, commit: rotate ? null : commit };
  }
  const result = res.data;
  if (result.replayed && result.batch.status === "failed") {
    return {
      ...state,
      busy: "idle",
      error: "Lần nhập trước với cùng yêu cầu đã thất bại và không có giao dịch nào được lưu. Hãy thử nhập lại.",
      commit: null,
    };
  }
  return {
    ...state,
    step: "done",
    busy: "idle",
    commit,
    result,
    error: null,
    notice: result.replayed
      ? "Yêu cầu nhập này đã được xử lý trước đó nên không có giao dịch nào được ghi thêm."
      : null,
  };
}
const REASON_LABEL: Record<string, string> = {
  duplicate_not_confirmed: "Dòng trùng chưa được xác nhận",
  ambiguous_row: "Dòng có ngày chưa rõ định dạng",
  invalid_row: "Dòng không hợp lệ",
};
export const refusedReasonLabel = (reason: string): string => REASON_LABEL[reason] ?? "Không nhập được";
export const ROW_STATUS_LABEL: Record<PreviewRow["status"], string> = {
  ok: "Hợp lệ",
  invalid: "Không hợp lệ",
  possible_duplicate: "Có thể trùng",
  exact_duplicate: "Trùng khớp",
  ambiguous: "Chưa rõ ngày",
};
const REASON_TEXT: Record<string, string> = {
  amount_missing: "thiếu số tiền",
  invalid_amount: "số tiền không đọc được",
  amount_too_large: "số tiền quá lớn",
  fractional_amount: "số tiền có phần thập phân",
  non_positive_amount: "số tiền phải lớn hơn 0",
  both_debit_and_credit: "vừa có tiền chi vừa có tiền thu",
  kind_missing: "thiếu loại thu/chi",
  kind_unknown: "không hiểu loại thu/chi",
  kind_sign_conflict: "loại và dấu số tiền mâu thuẫn",
  column_count_mismatch: "số cột không khớp tiêu đề",
  too_long: "nội dung quá dài",
  same_fingerprint_as_existing: "giống hệt giao dịch đã có",
  repeated_in_file: "lặp lại trong tệp",
  similar_to_existing: "gần giống giao dịch đã có",
  similar_to_file_row: "gần giống một dòng khác trong tệp",
  ambiguous_date: "ngày có thể là ngày/tháng hoặc tháng/ngày",
};
/** Readable reason for a row (code from the API). Unknown codes fall back to a generic phrase. */
export const reasonText = (code: string): string => REASON_TEXT[code] ?? "dữ liệu chưa hợp lệ";
export const MAPPING_ISSUE_TEXT: Record<string, string> = {
  occurred_at_missing: "Chưa chọn cột ngày giờ.",
  amount_missing: "Chưa chọn cột số tiền (hoặc cột chi/thu).",
  amount_conflict: "Không dùng đồng thời cột số tiền và cột chi/thu: hãy bỏ một trong hai.",
};
export const WARNING_TEXT: Record<string, string> = {
  kind_from_amount_sign: "Không có cột loại thu/chi: loại được suy ra từ dấu của số tiền.",
  all_amounts_positive_no_kind_column:
    "Mọi số tiền đều dương và không có cột loại, nên tất cả dòng được xem là thu nhập. Hãy kiểm tra lại cách ghép cột.",
  duplicate_check_truncated: "Kiểm tra trùng chỉ xét một phần giao dịch đã có, nên có thể còn sót dòng trùng.",
};
