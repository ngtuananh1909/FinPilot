"use client";
import { useRef, useState, type ChangeEvent } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { FormAlert } from "@/components/ui/FormAlert";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from "@/components/ui/classes";
import { createSubmitGuard } from "@/lib/demo/guest-flow";
import { browserFetch, type FetchLike } from "@/lib/http/api-call";
import type { MappingField } from "@/lib/import/mapping";
import {
  changeMapping,
  chooseDayFirst,
  clearSelection,
  commitBlocker,
  commitSelection,
  initialCsvState,
  looksBinary,
  refusedReasonLabel,
  runCommit,
  runPreview,
  selectAllClean,
  toggleRow,
  validateCsvFileMeta,
  withFile,
  type CsvDeps,
  type CsvImportState,
} from "./csv-import";
import { CsvPreviewPanel } from "./CsvPreviewPanel";
const READ_FAILED = "Không đọc được tệp. Hãy thử chọn lại tệp CSV.";
const BINARY_MESSAGE = "Tệp có vẻ là tệp nhị phân, không phải CSV văn bản.";
export function CsvResultSummary({ state }: { state: CsvImportState }) {
  const result = state.result;
  if (!result) return null;
  const imported = result.replayed ? result.batch.acceptedCount : result.importedRowIds.length;
  return (
    <div className="space-y-3">
      <p role="status" className="rounded-control bg-success-container px-4 py-3 text-body-md text-on-success-container">
        {result.replayed ? "Yêu cầu này đã được xử lý trước đó." : "Đã nhập xong."}
      </p>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-card bg-surface-container-low p-3">
          <dt className="text-body-sm text-on-surface-variant">Đã nhập</dt>
          <dd className="text-title-lg text-on-surface">{imported}</dd>
        </div>
        <div className="rounded-card bg-surface-container-low p-3">
          <dt className="text-body-sm text-on-surface-variant">Bỏ qua (không chọn)</dt>
          <dd className="text-title-lg text-on-surface">{result.skippedCount}</dd>
        </div>
        <div className="rounded-card bg-surface-container-low p-3">
          <dt className="text-body-sm text-on-surface-variant">Bị từ chối</dt>
          <dd className="text-title-lg text-on-surface">{result.refused.length}</dd>
        </div>
      </dl>
      {state.notice ? <p className="text-body-md text-on-surface-variant">{state.notice}</p> : null}
      {result.refused.length > 0 ? (
        <ul className="list-disc space-y-1 pl-6 text-body-md text-on-surface-variant">
          {result.refused.map((r) => (
            <li key={r.rowId}>
              Dòng {r.rowId.slice(1, r.rowId.indexOf("-"))}: {refusedReasonLabel(r.reason)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
/**
 * Multi-step CSV import: choose file -> preview (nothing saved) -> explicit confirm -> summary.
 * Mount only while open. `onImported` fires after a fresh successful commit so the list can reload.
 */
export function CsvImportDialog({
  onClose,
  onImported,
  fetchImpl = browserFetch,
}: {
  onClose: () => void;
  onImported: () => void;
  fetchImpl?: FetchLike;
}) {
  const guard = useRef(createSubmitGuard()).current;
  const deps = useRef<CsvDeps>({ fetch: fetchImpl, newKey: () => crypto.randomUUID() }).current;
  const [state, setState] = useState<CsvImportState>(initialCsvState);
  const [fileError, setFileError] = useState<string | null>(null);
  const busy = state.busy !== "idle";
  async function run(busy: CsvImportState["busy"], base: CsvImportState, action: () => Promise<CsvImportState>) {
    if (!guard.tryEnter()) return;
    setState({ ...base, busy, error: null });
    try {
      const next = await action();
      setState(next);
      if (next.step === "done" && next.result && !next.result.replayed) onImported();
    } finally {
      guard.leave();
    }
  }
  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = validateCsvFileMeta({ name: file.name, size: file.size, type: file.type });
    if (problem) {
      setFileError(problem);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileError(READ_FAILED);
      return;
    }
    if (looksBinary(text)) {
      setFileError(BINARY_MESSAGE);
      return;
    }
    setFileError(null);
    const next = withFile({ name: file.name, text });
    await run("previewing", next, () => runPreview(deps, next));
  }
  const blocker = commitBlocker(state);
  const count = commitSelection(state).rowIds.length;
  const closeLocked = state.busy === "committing";
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      dismissible={!closeLocked}
      title="Nhập giao dịch từ CSV"
      description="Chọn tệp, xem trước và chọn dòng muốn nhập. Chưa có gì được lưu cho đến khi bạn bấm Xác nhận nhập ở bước cuối."
    >
      <div className="flex flex-col gap-4" aria-busy={busy}>
        <FormAlert message={fileError ?? state.error} />
        {state.busy === "previewing" ? (
          <p role="status" className="text-body-md text-on-surface-variant">
            Đang đọc và xem trước tệp…
          </p>
        ) : null}
        {state.step === "choose" ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="csv-file" className="text-label-md text-on-surface">
              Tệp CSV (tối đa 2 MB)
            </label>
            <input
              id="csv-file"
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              disabled={busy}
              onChange={(e) => void onFile(e)}
              aria-describedby="csv-file-hint"
              className={INPUT}
            />
            <p id="csv-file-hint" className="text-body-sm text-on-surface-variant">
              Tệp được đọc ngay trên thiết bị của bạn và chỉ gửi đi để xem trước. Cần có dòng tiêu đề, cột ngày và cột số
              tiền. Dữ liệu chỉ được lưu sau khi bạn xác nhận.
            </p>
          </div>
        ) : null}
        {state.step === "preview" ? (
          <>
            <CsvPreviewPanel
              state={state}
              disabled={busy}
              handlers={{
                onMapping: (field: MappingField, column) =>
                  void run("previewing", state, () => changeMapping(deps, state, field, column)),
                onDayFirst: (dayFirst) => void run("previewing", state, () => chooseDayFirst(deps, state, dayFirst)),
                onToggle: (rowId) => setState((s) => toggleRow(s, rowId)),
                onSelectAllClean: () => setState((s) => selectAllClean(s)),
                onClearSelection: () => setState((s) => clearSelection(s)),
              }}
            />
            <div className="flex flex-col gap-2 border-t border-outline-variant pt-4">
              <p id="csv-commit-note" className="text-body-sm text-on-surface-variant">
                {count > 0
                  ? `Bấm xác nhận để ghi ${count} dòng đã chọn vào dữ liệu của bạn. Trước đó, chưa có gì được lưu.`
                  : (blocker ?? "")}
              </p>
              <button
                type="button"
                disabled={busy || blocker !== null}
                aria-describedby="csv-commit-note"
                onClick={() => void run("committing", state, () => runCommit(deps, state))}
                className={BUTTON_PRIMARY}
              >
                {state.busy === "committing" ? "Đang nhập…" : `Xác nhận nhập ${count} giao dịch`}
              </button>
              <button type="button" disabled={busy} onClick={() => setState(initialCsvState())} className={BUTTON_SECONDARY}>
                Chọn tệp khác
              </button>
              <button type="button" disabled={closeLocked} onClick={onClose} className={BUTTON_SECONDARY}>
                Hủy, không lưu gì
              </button>
            </div>
          </>
        ) : null}
        {state.step === "done" ? (
          <>
            <CsvResultSummary state={state} />
            <button type="button" onClick={onClose} className={BUTTON_PRIMARY}>
              Xong
            </button>
          </>
        ) : null}
        {state.step === "choose" ? (
          <button type="button" disabled={busy} onClick={onClose} className={BUTTON_SECONDARY}>
            Đóng
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}
