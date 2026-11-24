import { describe, expect, it } from "vitest";
import { commitRequestSchema, previewRequestSchema } from "@/lib/import/schemas";
import type { PreviewRow } from "@/lib/import/analyze";
import type { CsvCommitResult, CsvPreviewResult } from "@/lib/import/service";
import type { FetchLike } from "@/lib/http/api-call";
import {
  changeMapping,
  chooseDayFirst,
  clearSelection,
  commitBlocker,
  commitSelection,
  defaultSelection,
  includedDuplicateIds,
  looksBinary,
  runCommit,
  runPreview,
  selectAllClean,
  toggleRow,
  validateCsvFileMeta,
  withFile,
  type CsvDeps,
  type CsvImportState,
} from "@/features/transactions/csv-import";
const row = (n: number, status: PreviewRow["status"], extra: Partial<PreviewRow> = {}): PreviewRow => ({
  rowId: `r${n}-0000000${n}`,
  rowNumber: n,
  status,
  reasons: [],
  warnings: [],
  values: { occurredAt: "2026-03-01T05:00:00.000Z", localDate: "2026-03-01", kind: "expense", amountVnd: "45000", category: "food", merchant: "X", description: null },
  duplicateOf: null,
  ...extra,
});
const ROWS: PreviewRow[] = [
  row(1, "ok"),
  row(2, "ok"),
  row(3, "invalid", { reasons: [{ field: "amount_vnd", code: "invalid_amount" }] }),
  row(4, "possible_duplicate", { reasons: [{ field: "row", code: "similar_to_existing" }] }),
  row(5, "exact_duplicate"),
  row(6, "ambiguous", { reasons: [{ field: "occurred_at", code: "ambiguous_date" }] }),
];
const counts = (rows: PreviewRow[]) => ({
  total: rows.length,
  ok: rows.filter((r) => r.status === "ok").length,
  invalid: rows.filter((r) => r.status === "invalid").length,
  ambiguous: rows.filter((r) => r.status === "ambiguous").length,
  possibleDuplicate: rows.filter((r) => r.status === "possible_duplicate").length,
  exactDuplicate: rows.filter((r) => r.status === "exact_duplicate").length,
});
const previewOf = (over: Partial<CsvPreviewResult> = {}): CsvPreviewResult => ({
  headers: ["Ngày", "Số tiền", "Nội dung"],
  delimiter: ",",
  mapping: { occurred_at: 0, kind: null, amount_vnd: 1, debit_vnd: null, credit_vnd: null, category: null, merchant: null, description: 2 },
  suggestedMapping: { occurred_at: 0, kind: null, amount_vnd: 1, debit_vnd: null, credit_vnd: null, category: null, merchant: null, description: 2 },
  mappingIssues: [],
  kindSource: "sign",
  dayFirst: null,
  needsDateFormat: false,
  rows: ROWS,
  counts: counts(ROWS),
  historicalOnlyCount: 0,
  balanceSnapshotAt: "2026-02-01T00:00:00.000Z",
  duplicateCheckTruncated: false,
  warnings: [],
  ...over,
});
const commitOk = (over: Partial<CsvCommitResult> = {}): CsvCommitResult => ({
  replayed: false,
  batch: { id: "b", status: "committed", acceptedCount: 2, rejectedCount: 4, filename: "a.csv", createdAt: "2026-03-01T00:00:00.000Z" },
  importedRowIds: ["r1-00000001", "r2-00000002"],
  refused: [],
  skippedCount: 4,
  ...over,
});
interface Call { url: string; body: Record<string, unknown> }
/** Fake fetch: records requests and answers from a queue (or a function). */
function fakeFetch(answer: (call: Call, index: number) => { status: number; json: unknown } | "throw") {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
    calls.push(call);
    const out = answer(call, calls.length - 1);
    if (out === "throw") throw new TypeError("offline");
    return { ok: out.status < 300, status: out.status, json: async () => out.json };
  };
  return { fetchImpl, calls };
}
const envelope = (status: number, code: string, message: string, reason?: string) => ({
  status,
  json: { error: { code, message, ...(reason ? { details: { reason } } : {}) } },
});
function depsWith(fetchImpl: FetchLike): CsvDeps & { keys: string[] } {
  const keys: string[] = [];
  let n = 0;
  return { fetch: fetchImpl, keys, newKey: () => { const k = `key-${++n}-padding`; keys.push(k); return k; } };
}
const FILE = { name: "sao-ke.csv", text: "Ngày,Số tiền,Nội dung\n01/03/2026,45000,x\n" };
async function previewed(preview = previewOf()) {
  const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, json: preview }));
  const deps = depsWith(fetchImpl);
  const state = await runPreview(deps, withFile(FILE));
  return { state, deps, calls };
}
describe("file checks before upload", () => {
  it("accepts a normal CSV and rejects oversize, empty and non-text files", () => {
    expect(validateCsvFileMeta({ name: "a.csv", size: 100, type: "text/csv" })).toBeNull();
    expect(validateCsvFileMeta({ name: "a.csv", size: 100, type: "" })).toBeNull();
    expect(validateCsvFileMeta({ name: "a.csv", size: 2_097_152, type: "text/csv" })).toBeNull();
    expect(validateCsvFileMeta({ name: "a.csv", size: 2_097_153, type: "text/csv" })).toMatch(/2 MB/);
    expect(validateCsvFileMeta({ name: "a.csv", size: 0, type: "text/csv" })).toMatch(/trống/);
    expect(validateCsvFileMeta({ name: "a.png", size: 10, type: "image/png" })).toMatch(/văn bản/);
    expect(validateCsvFileMeta({ name: "a.csv", size: 10, type: "application/pdf" })).toMatch(/văn bản/);
    expect(validateCsvFileMeta({ name: "a.exe", size: 10, type: "text/plain" })).toMatch(/văn bản/);
  });
  it("detects binary content renamed to .csv", () => {
    expect(looksBinary("a,b\u0000c")).toBe(true);
    expect(looksBinary("a,b\n1,2")).toBe(false);
  });
});
describe("preview step", () => {
  it("posts the file to the preview route with a body the server schema accepts, and writes nothing", async () => {
    const { state, calls } = await previewed();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/imports/csv/preview");
    expect(previewRequestSchema.safeParse(calls[0]?.body).success).toBe(true);
    expect(calls[0]?.body).toEqual({ csv: FILE.text, filename: "sao-ke.csv" });
    expect(state.step).toBe("preview");
    expect(state.busy).toBe("idle");
  });
  it("selects only clean rows by default (duplicates are opt-in, invalid and ambiguous unselectable)", async () => {
    const { state } = await previewed();
    expect(state.selected).toEqual(["r1-00000001", "r2-00000002"]);
    expect(defaultSelection(ROWS)).toEqual(state.selected);
    expect(includedDuplicateIds(state)).toEqual([]);
  });
  it("shows the server error and stays on the choose step when the preview fails", async () => {
    const { fetchImpl } = fakeFetch(() => envelope(400, "validation_failed", "Tệp CSV trống.", "empty_file"));
    const state = await runPreview(depsWith(fetchImpl), withFile(FILE));
    expect(state).toMatchObject({ step: "choose", busy: "idle", error: "Tệp CSV trống." });
  });
  it("reports a network failure in Vietnamese", async () => {
    const { fetchImpl } = fakeFetch(() => "throw");
    const state = await runPreview(depsWith(fetchImpl), withFile(FILE));
    expect(state.error).toMatch(/kết nối/);
  });
});
describe("mapping and date format changes", () => {
  it("re-previews with the edited mapping index and keeps the others on the suggestion", async () => {
    const { state, deps, calls } = await previewed();
    const next = await changeMapping(deps, state, "merchant", 2);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body.mapping).toEqual({ merchant: 2 });
    expect(previewRequestSchema.safeParse(calls[1]?.body).success).toBe(true);
    expect(next.overrides).toEqual({ merchant: 2 });
    const unmapped = await changeMapping(deps, next, "category", null);
    expect(calls[2]?.body.mapping).toEqual({ merchant: 2, category: null });
    expect(unmapped.overrides).toEqual({ merchant: 2, category: null });
  });
  it("keeps the previous preview and overrides when the server rejects a mapping", async () => {
    const { fetchImpl } = fakeFetch((_c, i) => (i === 0 ? { status: 200, json: previewOf() } : envelope(400, "validation_failed", "Cách ghép cột chưa hợp lệ.", "invalid_mapping")));
    const deps = depsWith(fetchImpl);
    const state = await runPreview(deps, withFile(FILE));
    const next = await changeMapping(deps, state, "merchant", 1);
    expect(next.error).toMatch(/ghép cột/);
    expect(next.overrides).toEqual({});
    expect(next.preview).toBe(state.preview);
    expect(next.step).toBe("preview");
  });
  it("asks for the date format and sends options.dayFirst on the next preview", async () => {
    const needs = previewOf({ needsDateFormat: true });
    const { fetchImpl, calls } = fakeFetch((_c, i) => ({ status: 200, json: i === 0 ? needs : previewOf({ dayFirst: true }) }));
    const deps = depsWith(fetchImpl);
    const state = await runPreview(deps, withFile(FILE));
    expect(commitBlocker(state)).toMatch(/định dạng ngày/);
    const next = await chooseDayFirst(deps, state, true);
    expect(calls[1]?.body.options).toEqual({ dayFirst: true });
    expect(previewRequestSchema.safeParse(calls[1]?.body).success).toBe(true);
    expect(next.dayFirst).toBe(true);
  });
  it("blocks the commit while the mapping is incomplete", async () => {
    const { state } = await previewed(previewOf({ mappingIssues: ["amount_missing"], rows: [], counts: counts([]) }));
    expect(commitBlocker(state)).toMatch(/cột ngày và cột số tiền/);
  });
});
describe("row selection", () => {
  it("lets duplicates be ticked explicitly and never invalid or ambiguous rows", async () => {
    const { state } = await previewed();
    expect(toggleRow(state, "r3-00000003")).toBe(state);
    expect(toggleRow(state, "r6-00000006")).toBe(state);
    expect(toggleRow(state, "unknown")).toBe(state);
    const withDup = toggleRow(state, "r4-00000004");
    expect(withDup.selected).toContain("r4-00000004");
    expect(includedDuplicateIds(withDup)).toEqual(["r4-00000004"]);
    expect(commitSelection(withDup)).toEqual({
      rowIds: ["r1-00000001", "r2-00000002", "r4-00000004"],
      includeDuplicateRowIds: ["r4-00000004"],
    });
    expect(toggleRow(withDup, "r4-00000004").selected).not.toContain("r4-00000004");
  });
  it("select-all keeps explicit duplicate opt-ins and clear empties everything", async () => {
    const { state } = await previewed();
    const withDup = toggleRow(state, "r5-00000005");
    const cleared = clearSelection(withDup);
    expect(cleared.selected).toEqual([]);
    expect(commitBlocker(cleared)).toMatch(/ít nhất một dòng/);
    expect(selectAllClean(withDup).selected.sort()).toEqual(["r1-00000001", "r2-00000002", "r5-00000005"]);
  });
  it("ignores selection changes while a request is running", async () => {
    const { state } = await previewed();
    const busy: CsvImportState = { ...state, busy: "committing" };
    expect(toggleRow(busy, "r1-00000001")).toBe(busy);
  });
});
describe("commit and idempotency", () => {
  it("never calls the commit route before runCommit", async () => {
    const { calls } = await previewed();
    expect(calls.every((c) => c.url.endsWith("/preview"))).toBe(true);
  });
  it("sends a confirmed, schema-valid commit and shows the summary", async () => {
    const { fetchImpl, calls } = fakeFetch((c) => (c.url.endsWith("preview") ? { status: 200, json: previewOf() } : { status: 200, json: commitOk() }));
    const deps = depsWith(fetchImpl);
    const state = toggleRow(await runPreview(deps, withFile(FILE)), "r4-00000004");
    const done = await runCommit(deps, state);
    const body = calls[1]?.body;
    expect(calls[1]?.url).toBe("/api/imports/csv/commit");
    expect(body).toMatchObject({
      confirmed: true,
      idempotencyKey: "key-1-padding",
      rowIds: ["r1-00000001", "r2-00000002", "r4-00000004"],
      includeDuplicateRowIds: ["r4-00000004"],
    });
    expect(commitRequestSchema.safeParse(body).success).toBe(true);
    expect(done.step).toBe("done");
    expect(done.result?.skippedCount).toBe(4);
  });
  it("reuses the SAME key when the identical commit is retried after a failure", async () => {
    let attempt = 0;
    const { fetchImpl, calls } = fakeFetch((c) => {
      if (c.url.endsWith("preview")) return { status: 200, json: previewOf() };
      attempt += 1;
      return attempt === 1 ? "throw" : { status: 200, json: commitOk() };
    });
    const deps = depsWith(fetchImpl);
    const state = await runPreview(deps, withFile(FILE));
    const failed = await runCommit(deps, state);
    expect(failed.step).toBe("preview");
    expect(failed.error).toMatch(/kết nối/);
    const retried = await runCommit(deps, failed);
    expect(retried.step).toBe("done");
    expect(calls[1]?.body.idempotencyKey).toBe(calls[2]?.body.idempotencyKey);
    expect(deps.keys).toHaveLength(1);
  });
  it("rotates the key when the selection changes", async () => {
    const { fetchImpl, calls } = fakeFetch((c) => (c.url.endsWith("preview") ? { status: 200, json: previewOf() } : "throw"));
    const deps = depsWith(fetchImpl);
    const first = await runCommit(deps, await runPreview(deps, withFile(FILE)));
    const changed = await runCommit(deps, toggleRow(first, "r2-00000002"));
    expect(calls[1]?.body.idempotencyKey).toBe("key-1-padding");
    expect(calls[2]?.body.idempotencyKey).toBe("key-2-padding");
    expect(calls[2]?.body.rowIds).toEqual(["r1-00000001"]);
    expect(changed.commit?.key).toBe("key-2-padding");
  });
  it("rotates the key when the mapping changes between attempts", async () => {
    const { fetchImpl, calls } = fakeFetch((c) => (c.url.endsWith("preview") ? { status: 200, json: previewOf() } : "throw"));
    const deps = depsWith(fetchImpl);
    const failed = await runCommit(deps, await runPreview(deps, withFile(FILE)));
    const remapped = await changeMapping(deps, failed, "merchant", 2);
    await runCommit(deps, remapped);
    const commits = calls.filter((c) => c.url.endsWith("commit"));
    expect(commits[0]?.body.idempotencyKey).not.toBe(commits[1]?.body.idempotencyKey);
  });
  it("handles a replayed response without claiming new rows were imported", async () => {
    const replay = commitOk({ replayed: true, importedRowIds: [], skippedCount: 0 });
    const { fetchImpl } = fakeFetch((c) => (c.url.endsWith("preview") ? { status: 200, json: previewOf() } : { status: 200, json: replay }));
    const deps = depsWith(fetchImpl);
    const done = await runCommit(deps, await runPreview(deps, withFile(FILE)));
    expect(done.step).toBe("done");
    expect(done.notice).toMatch(/đã được xử lý trước đó/);
  });
  it("does not treat a replayed FAILED batch as success and starts a new key", async () => {
    const failedBatch = commitOk({ replayed: true, importedRowIds: [], batch: { ...commitOk().batch, status: "failed", acceptedCount: 0 } });
    const { fetchImpl } = fakeFetch((c) => (c.url.endsWith("preview") ? { status: 200, json: previewOf() } : { status: 200, json: failedBatch }));
    const deps = depsWith(fetchImpl);
    const out = await runCommit(deps, await runPreview(deps, withFile(FILE)));
    expect(out.step).toBe("preview");
    expect(out.error).toMatch(/không có giao dịch nào được lưu/);
    expect(out.commit).toBeNull();
  });
  it("rotates the key after the server confirms nothing was saved (import_commit_failed)", async () => {
    const { fetchImpl } = fakeFetch((c) => (c.url.endsWith("preview") ? { status: 200, json: previewOf() } : envelope(500, "internal", "Không thể lưu giao dịch từ CSV. Không có dòng nào được lưu.", "import_commit_failed")));
    const deps = depsWith(fetchImpl);
    const out = await runCommit(deps, await runPreview(deps, withFile(FILE)));
    expect(out.error).toMatch(/Không có dòng nào được lưu/);
    expect(out.commit).toBeNull();
  });
  it("refuses to commit with nothing selected or an unanswered date format", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, json: previewOf({ needsDateFormat: true }) }));
    const deps = depsWith(fetchImpl);
    const state = await runPreview(deps, withFile(FILE));
    const out = await runCommit(deps, state);
    expect(out.error).toMatch(/định dạng ngày/);
    expect(calls).toHaveLength(1);
  });
  it("carries the preview's own mapping and date format into the commit", async () => {
    const { fetchImpl, calls } = fakeFetch((c) => (c.url.endsWith("preview") ? { status: 200, json: previewOf({ dayFirst: false }) } : { status: 200, json: commitOk() }));
    const deps = depsWith(fetchImpl);
    let state = await runPreview(deps, withFile(FILE));
    state = await chooseDayFirst(deps, state, false);
    state = await changeMapping(deps, state, "merchant", 2);
    await runCommit(deps, state);
    const commit = calls.at(-1)?.body;
    expect(commit?.mapping).toEqual({ merchant: 2 });
    expect(commit?.options).toEqual({ dayFirst: false });
    expect(commitRequestSchema.safeParse(commit).success).toBe(true);
  });
});
