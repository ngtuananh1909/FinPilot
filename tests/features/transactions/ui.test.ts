import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PreviewRow } from "@/lib/import/analyze";
import type { CsvPreviewResult } from "@/lib/import/service";
import type { FetchLike } from "@/lib/http/api-call";
import type { RecurringDto, TransactionDto } from "@/lib/transactions/dto";
import { initialCsvState, toggleRow, withFile, type CsvImportState } from "@/features/transactions/csv-import";
import { deleteTransactionApi } from "@/features/transactions/api";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/transactions",
}));
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
function expectReferencesResolve(html: string) {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/(?:aria-labelledby|aria-describedby|aria-controls|for)="([^"]+)"/g)) {
    for (const ref of (m[1] ?? "").split(" ")) expect(ids.has(ref), `missing id ${ref}`).toBe(true);
  }
}
const DISABLED_BUTTON = /<button\b[^>]*\sdisabled=""/g;
const NOW = new Date("2026-03-10T05:30:00Z");
const tx = (over: Partial<TransactionDto> = {}): TransactionDto => ({
  id: "11111111-1111-4111-8111-111111111111",
  occurredAt: "2026-03-10T03:00:00.000Z",
  localDate: "2026-03-10",
  kind: "expense",
  amountVnd: "45000",
  category: "coffee",
  merchant: "Highlands Coffee",
  description: null,
  source: "csv",
  importBatchId: null,
  recurringItemId: null,
  recurringInstanceDate: null,
  createdAt: "x",
  updatedAt: "x",
  ...over,
});
const baseList = {
  status: "ready" as const,
  items: [] as TransactionDto[],
  hasMore: false,
  loadingMore: false,
  filtersActive: false,
  now: NOW,
  onRetry: () => undefined,
  onLoadMore: () => undefined,
  onSelect: () => undefined,
  onAdd: () => undefined,
  onClearFilters: () => undefined,
};
describe("TransactionList states", () => {
  it("shows an announced skeleton while loading", async () => {
    const { TransactionList } = await import("@/features/transactions/TransactionList");
    const html = render(createElement(TransactionList, { ...baseList, status: "loading" }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Đang tải giao dịch");
    expect(html).not.toContain("<ul");
  });
  it("shows the error with a retry button", async () => {
    const { TransactionList } = await import("@/features/transactions/TransactionList");
    const html = render(createElement(TransactionList, { ...baseList, status: "error", errorMessage: "Máy chủ bận" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Máy chủ bận");
    expect(html).toContain("Thử lại");
  });
  it("shows the first-use empty state with an add action", async () => {
    const { TransactionList } = await import("@/features/transactions/TransactionList");
    const html = render(createElement(TransactionList, baseList));
    expect(html).toContain("Chưa có giao dịch nào");
    expect(html).toContain("Thêm giao dịch");
  });
  it("shows a different empty state when filters hide everything", async () => {
    const { TransactionList } = await import("@/features/transactions/TransactionList");
    const html = render(createElement(TransactionList, { ...baseList, filtersActive: true }));
    expect(html).toContain("Không có giao dịch phù hợp");
    expect(html).toContain("Xóa bộ lọc");
    expect(html).not.toContain("Chưa có giao dịch nào");
  });
  it("groups by Vietnam date and never relies on color alone for kind", async () => {
    const { TransactionList } = await import("@/features/transactions/TransactionList");
    const items = [
      tx(),
      tx({ id: "2", kind: "income", amountVnd: "4500000", category: "salary", merchant: "Công ty", source: "manual", recurringItemId: "r" }),
      tx({ id: "3", kind: "excluded", amountVnd: "100000", localDate: "2026-03-09", occurredAt: "2026-03-09T03:00:00.000Z", merchant: "Hoàn tiền", source: "seed" }),
    ];
    const html = render(createElement(TransactionList, { ...baseList, items, hasMore: true }));
    expect(html).toContain("Hôm nay · 10/03/2026");
    expect(html).toContain("Hôm qua · 09/03/2026");
    expect(html.match(/<section/g)).toHaveLength(2);
    expect(html).toContain("−45.000 ₫");
    expect(html).toContain("+4.500.000 ₫");
    expect(html).toContain("Chi tiêu: ");
    expect(html).toContain("Thu nhập: ");
    expect(html).toContain("Loại trừ");
    expect(html).toContain("Nhập CSV");
    expect(html).toContain("Dữ liệu mẫu");
    expect(html).toContain("Định kỳ");
    expect(html).toContain("Tải thêm");
    expect(html).toMatch(/<button[^>]*min-h-\[56px\]/);
    expectReferencesResolve(html);
  });
  it("disables Tải thêm while loading more and reports a paging error", async () => {
    const { TransactionList } = await import("@/features/transactions/TransactionList");
    const html = render(createElement(TransactionList, { ...baseList, items: [tx()], hasMore: true, loadingMore: true, loadMoreError: "Mất kết nối" }));
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Đang tải…<\/button>/);
    expect(html).toContain("Mất kết nối");
  });
  it("says everything is shown when there is no further page", async () => {
    const { TransactionList } = await import("@/features/transactions/TransactionList");
    const html = render(createElement(TransactionList, { ...baseList, items: [tx()] }));
    expect(html).toContain("Đã hiển thị toàn bộ giao dịch");
    expect(html).not.toContain("Tải thêm");
  });
});
describe("TransactionsView shell", () => {
  it("renders the loading state with a mobile FAB and a desktop-only header button", async () => {
    const { TransactionsView } = await import("@/features/transactions/TransactionsView");
    const html = render(createElement(TransactionsView, {}));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Đang tải giao dịch");
    expect(html).toMatch(/<button[^>]*aria-label="Thêm giao dịch"[^>]*md:hidden/);
    expect(html).toMatch(/<button[^>]*hidden md:inline-flex[^>]*>\+ Thêm giao dịch<\/button>/);
    expect(html).toContain('role="search"');
    expect(html).toContain('for="tx-search"');
    expect(html).not.toContain("<dialog");
    expectReferencesResolve(html);
  });
  it("keeps the extra filters collapsed on first paint", async () => {
    const { TransactionsView } = await import("@/features/transactions/TransactionsView");
    const html = render(createElement(TransactionsView, {}));
    expect(html).toMatch(/id="tx-filter-panel" class="hidden /);
    expect(html).toContain('aria-expanded="false"');
  });
});
describe("AddActionSheet", () => {
  it("without AI: offers manual and CSV, and shows receipt scan as disabled with an explanation", async () => {
    const { AddActionSheet } = await import("@/features/transactions/AddActionSheet");
    const html = render(createElement(AddActionSheet, { open: true, onClose: () => undefined, onChoose: () => undefined }));
    expect(html).toContain("Thêm thủ công");
    expect(html).toContain("Nhập CSV");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*aria-describedby="scan-soon-note"[^>]*>[\s\S]*Quét biên lai \(chưa khả dụng\)/);
    expect(html).toContain("chưa được cấu hình");
    expect(html).toContain("không tạo kết quả giả");
    expectReferencesResolve(html);
  });

  it("with AI configured: receipt scan is an enabled choice that promises review before saving", async () => {
    const { AddActionSheet } = await import("@/features/transactions/AddActionSheet");
    const html = render(createElement(AddActionSheet, { open: true, onClose: () => undefined, onChoose: () => undefined, aiConfigured: true }));
    expect(html).not.toMatch(/disabled=""[^>]*>[\s\S]{0,80}Quét biên lai/);
    expect(html).toContain("Bạn kiểm tra và tự lưu");
    expectReferencesResolve(html);
  });
});
describe("TransactionFormDialog", () => {
  const items: RecurringDto[] = [];
  it("renders the create form with labelled fields, a kind group and 44px controls", async () => {
    const { TransactionFormDialog } = await import("@/features/transactions/TransactionFormDialog");
    const html = render(createElement(TransactionFormDialog, { recurringItems: items, onClose: () => undefined, onSaved: () => undefined, onDeleted: () => undefined }));
    for (const id of ["txf-amount", "txf-when", "txf-category", "txf-merchant", "txf-description", "txf-link"]) {
      expect(html, id).toContain(`for="${id}"`);
    }
    expect(html).toContain("<legend");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("Lưu giao dịch");
    expect(html).not.toContain("Xóa giao dịch");
    expect(html).toMatch(/<option[^>]*value="other"[^>]*selected/);
    expectReferencesResolve(html);
  });
  it("explains the excluded kind in one line", async () => {
    const { KIND_OPTIONS } = await import("@/features/transactions/labels");
    const excluded = KIND_OPTIONS.find((k) => k.value === "excluded");
    expect(excluded?.explanation).toMatch(/Hoàn tiền hoặc chuyển khoản/);
    expect(excluded?.explanation).toMatch(/không làm thay đổi số dư/);
    expect(excluded?.explanation.split(". ")).toHaveLength(1);
  });
  it("shows existing values and the delete action in edit mode", async () => {
    const { TransactionFormDialog } = await import("@/features/transactions/TransactionFormDialog");
    const html = render(createElement(TransactionFormDialog, { transaction: tx(), recurringItems: items, onClose: () => undefined, onSaved: () => undefined, onDeleted: () => undefined }));
    expect(html).toContain("Sửa giao dịch");
    expect(html).toContain('value="45.000"');
    expect(html).toContain('value="2026-03-10T10:00"');
    expect(html).toContain("Xóa giao dịch");
    expect(html).not.toContain("Xóa giao dịch này?"); // confirm dialog is closed until requested
  });
  it("offers only same-kind active recurring items", async () => {
    const { TransactionFormDialog } = await import("@/features/transactions/TransactionFormDialog");
    const rec = (id: string, label: string, kind: "income" | "expense", active = true): RecurringDto => ({
      id, label, kind, amountVnd: "1", dayOfMonth: 1, category: "rent", startDate: "2026-01-01", endDate: null, active, createdAt: "x", updatedAt: "x",
    });
    const html = render(createElement(TransactionFormDialog, {
      recurringItems: [rec("a", "Phòng Quận 7", "expense"), rec("b", "Việc làm thêm", "income"), rec("c", "Gói cũ", "expense", false)],
      onClose: () => undefined, onSaved: () => undefined, onDeleted: () => undefined,
    }));
    expect(html).toContain("Phòng Quận 7");
    expect(html).not.toContain("Việc làm thêm");
    expect(html).not.toContain("Gói cũ");
  });
});
describe("delete confirmation", () => {
  it("renders a confirm dialog whose action is disabled while pending", async () => {
    const { ConfirmDialog } = await import("@/components/ui/ConfirmDialog");
    const props = { title: "Xóa giao dịch này?", confirmLabel: "Xóa giao dịch", onConfirm: () => undefined, onCancel: () => undefined };
    expect(render(createElement(ConfirmDialog, { ...props, open: false }))).toBe("");
    const idle = render(createElement(ConfirmDialog, { ...props, open: true }));
    expect(idle).toContain("Xóa giao dịch</button>");
    expect(idle.match(DISABLED_BUTTON)).toBeNull();
    const pending = render(createElement(ConfirmDialog, { ...props, open: true, pending: true, pendingLabel: "Đang xóa…" }));
    expect(pending.match(DISABLED_BUTTON)).toHaveLength(2);
    expect(pending).toContain("Đang xóa…");
  });
  it("sends {confirm:true} in the DELETE body and surfaces a 404 as such", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return { ok: false, status: 404, json: async () => ({ error: { code: "not_found", message: "Không tìm thấy" } }) };
    };
    const res = await deleteTransactionApi(f, "abc/def");
    expect(calls[0]?.url).toBe("/api/transactions/abc%2Fdef");
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ confirm: true });
    expect(res).toMatchObject({ ok: false, status: 404, code: "not_found" });
  });
});
const rowOf = (n: number, status: PreviewRow["status"], codes: string[] = []): PreviewRow => ({
  rowId: `r${n}-0000000${n}`,
  rowNumber: n,
  status,
  reasons: codes.map((code) => ({ field: "row", code })),
  warnings: [],
  values: { occurredAt: "2026-03-01T05:00:00.000Z", localDate: "2026-03-01", kind: "expense", amountVnd: "45000", category: "food", merchant: `Quán ${n}`, description: null },
  duplicateOf: null,
});
function previewState(over: Partial<CsvPreviewResult> = {}): CsvImportState {
  const rows = [rowOf(1, "ok"), rowOf(2, "invalid", ["invalid_amount"]), rowOf(3, "possible_duplicate", ["similar_to_existing"]), rowOf(4, "exact_duplicate", ["same_fingerprint_as_existing"]), rowOf(5, "ambiguous", ["ambiguous_date"])];
  const preview: CsvPreviewResult = {
    headers: ["Ngày", "Số tiền"],
    delimiter: ";",
    mapping: { occurred_at: 0, kind: null, amount_vnd: 1, debit_vnd: null, credit_vnd: null, category: null, merchant: null, description: null },
    suggestedMapping: { occurred_at: 0, kind: null, amount_vnd: 1, debit_vnd: null, credit_vnd: null, category: null, merchant: null, description: null },
    mappingIssues: [],
    kindSource: "sign",
    dayFirst: null,
    needsDateFormat: false,
    rows,
    counts: { total: 5, ok: 1, invalid: 1, ambiguous: 1, possibleDuplicate: 1, exactDuplicate: 1 },
    historicalOnlyCount: 2,
    balanceSnapshotAt: "2026-03-01T00:00:00.000Z",
    duplicateCheckTruncated: false,
    warnings: ["kind_from_amount_sign"],
    ...over,
  };
  return { ...withFile({ name: "sao-ke.csv", text: "x" }), step: "preview", preview, previewed: { overrides: {}, dayFirst: null }, selected: ["r1-00000001"] };
}
const noop = { onMapping: () => undefined, onDayFirst: () => undefined, onToggle: () => undefined, onSelectAllClean: () => undefined, onClearSelection: () => undefined };
describe("CsvPreviewPanel", () => {
  it("labels every row status, disables invalid/ambiguous and leaves duplicates unticked", async () => {
    const { CsvPreviewPanel } = await import("@/features/transactions/CsvPreviewPanel");
    const html = render(createElement(CsvPreviewPanel, { state: previewState(), handlers: noop, disabled: false }));
    for (const label of ["Hợp lệ", "Không hợp lệ", "Có thể trùng", "Trùng khớp", "Chưa rõ ngày"]) expect(html).toContain(label);
    const boxes = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
    expect(boxes).toHaveLength(5);
    expect(boxes[0]).toContain("checked");
    expect(boxes[0]).not.toContain("disabled");
    expect(boxes[1]).toContain("disabled");
    expect(boxes[2]).not.toContain("checked");
    expect(boxes[2]).not.toContain("disabled");
    expect(boxes[2]).toContain("Vẫn nhập dòng 3 dù có thể trùng");
    expect(boxes[3]).not.toContain("checked");
    expect(boxes[4]).toContain("disabled");
    expect(html).toContain("số tiền không đọc được");
    expect(html).toContain("gần giống giao dịch đã có");
    expect(html).toContain("chưa có gì được lưu");
  });
  it("explains historical-only rows and the delimiter, and surfaces warnings", async () => {
    const { CsvPreviewPanel } = await import("@/features/transactions/CsvPreviewPanel");
    const html = render(createElement(CsvPreviewPanel, { state: previewState(), handlers: noop, disabled: false }));
    expect(html).toContain("2 dòng có ngày trước hoặc đúng thời điểm số dư gốc");
    expect(html).toContain("không làm thay đổi số dư hiện tại");
    expect(html).toContain("dấu chấm phẩy");
    expect(html).toContain("suy ra từ dấu của số tiền");
  });
  it("hides the historical note when zero and shows editable mapping selects for each field", async () => {
    const { CsvPreviewPanel } = await import("@/features/transactions/CsvPreviewPanel");
    const html = render(createElement(CsvPreviewPanel, { state: previewState({ historicalOnlyCount: 0 }), handlers: noop, disabled: false }));
    expect(html).not.toContain("thời điểm số dư gốc");
    expect(html.match(/<select/g)).toHaveLength(8);
    expect(html).toMatch(/<option[^>]*value="0"[^>]*selected=""[^>]*>Cột 1: Ngày<\/option>/);
    expect(html).toMatch(/<option[^>]*value="1"[^>]*selected=""[^>]*>Cột 2: Số tiền<\/option>/);
    expectReferencesResolve(html);
  });
  it("asks the date-format question only when needed", async () => {
    const { CsvPreviewPanel } = await import("@/features/transactions/CsvPreviewPanel");
    const without = render(createElement(CsvPreviewPanel, { state: previewState(), handlers: noop, disabled: false }));
    expect(without).not.toContain("csv-day-first");
    const asked = render(createElement(CsvPreviewPanel, { state: previewState({ needsDateFormat: true }), handlers: noop, disabled: false }));
    expect(asked.match(/name="csv-day-first"/g)).toHaveLength(2);
    expect(asked).toContain("Ngày/Tháng/Năm");
    expect(asked).toContain("Tháng/Ngày/Năm");
  });
  it("lists mapping issues in an alert and no rows", async () => {
    const { CsvPreviewPanel } = await import("@/features/transactions/CsvPreviewPanel");
    const html = render(createElement(CsvPreviewPanel, { state: previewState({ mappingIssues: ["occurred_at_missing"], rows: [] }), handlers: noop, disabled: false }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Chưa chọn cột ngày giờ");
    expect(html).not.toContain("<table");
  });
  it("disables all controls while a request is running", async () => {
    const { CsvPreviewPanel } = await import("@/features/transactions/CsvPreviewPanel");
    const html = render(createElement(CsvPreviewPanel, { state: previewState(), handlers: noop, disabled: true }));
    expect([...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].every((m) => m[0].includes("disabled"))).toBe(true);
    expect([...html.matchAll(/<select[^>]*>/g)].every((m) => m[0].includes("disabled"))).toBe(true);
  });
  it("keeps the wide table inside its own scroll region (page stays 375px-safe by class)", async () => {
    const { CsvPreviewPanel } = await import("@/features/transactions/CsvPreviewPanel");
    const html = render(createElement(CsvPreviewPanel, { state: previewState(), handlers: noop, disabled: false }));
    const regionAt = html.indexOf("overflow-auto");
    const wideAt = html.indexOf("min-w-[640px]");
    expect(regionAt).toBeGreaterThan(-1);
    expect(wideAt).toBeGreaterThan(regionAt);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("<caption");
  });
  it("toggling a duplicate through the state machine makes the checkbox render checked", async () => {
    const { CsvPreviewPanel } = await import("@/features/transactions/CsvPreviewPanel");
    const html = render(createElement(CsvPreviewPanel, { state: toggleRow(previewState(), "r3-00000003"), handlers: noop, disabled: false }));
    const boxes = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
    expect(boxes[2]).toContain("checked");
  });
});
describe("CsvImportDialog and result", () => {
  it("opens on the file step with the no-write promise, size limit and a labelled input", async () => {
    const { CsvImportDialog } = await import("@/features/transactions/CsvImportDialog");
    const html = render(createElement(CsvImportDialog, { onClose: () => undefined, onImported: () => undefined }));
    expect(html).toContain("Chưa có gì được lưu cho đến khi bạn bấm Xác nhận nhập");
    expect(html).toContain('for="csv-file"');
    expect(html).toContain('type="file"');
    expect(html).toContain("tối đa 2 MB");
    expect(html).not.toContain("Xác nhận nhập 0");
    expectReferencesResolve(html);
  });
  it("summarizes imported, skipped and refused rows", async () => {
    const { CsvResultSummary } = await import("@/features/transactions/CsvImportDialog");
    const state: CsvImportState = {
      ...initialCsvState(),
      step: "done",
      result: {
        replayed: false,
        batch: { id: "b", status: "committed", acceptedCount: 2, rejectedCount: 3, filename: "a.csv", createdAt: "x" },
        importedRowIds: ["r1-00000001", "r2-00000002"],
        refused: [{ rowId: "r4-00000004", reason: "duplicate_not_confirmed" }],
        skippedCount: 2,
      },
    };
    const html = render(createElement(CsvResultSummary, { state }));
    expect(html).toContain("Đã nhập");
    expect(html).toMatch(/Đã nhập<\/dt><dd[^>]*>2</);
    expect(html).toMatch(/Bỏ qua \(không chọn\)<\/dt><dd[^>]*>2</);
    expect(html).toMatch(/Bị từ chối<\/dt><dd[^>]*>1</);
    expect(html).toContain("Dòng 4: Dòng trùng chưa được xác nhận");
  });
  it("words a replayed result without claiming a new import", async () => {
    const { CsvResultSummary } = await import("@/features/transactions/CsvImportDialog");
    const state: CsvImportState = {
      ...initialCsvState(),
      step: "done",
      notice: "Yêu cầu nhập này đã được xử lý trước đó nên không có giao dịch nào được ghi thêm.",
      result: { replayed: true, batch: { id: "b", status: "committed", acceptedCount: 2, rejectedCount: 0, filename: null, createdAt: "x" }, importedRowIds: [], refused: [], skippedCount: 0 },
    };
    const html = render(createElement(CsvResultSummary, { state }));
    expect(html).toContain("đã được xử lý trước đó");
  });
});
