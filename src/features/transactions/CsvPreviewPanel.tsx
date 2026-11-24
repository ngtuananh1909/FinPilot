"use client";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { SelectField } from "@/components/ui/SelectField";
import { displaySignedVnd } from "@/lib/format/money-input";
import { formatDateTimeVi } from "@/lib/format/vn-datetime";
import type { PreviewRow } from "@/lib/import/analyze";
import type { MappingField } from "@/lib/import/mapping";
import {
  MAPPING_FIELD_LABEL,
  MAPPING_FIELD_ORDER,
  MAPPING_ISSUE_TEXT,
  ROW_STATUS_LABEL,
  WARNING_TEXT,
  isDuplicate,
  isSelectable,
  reasonText,
  type CsvImportState,
} from "./csv-import";
import { categoryLabel } from "./labels";
const STATUS_TONE: Record<PreviewRow["status"], BadgeTone> = {
  ok: "success",
  invalid: "error",
  possible_duplicate: "warning",
  exact_duplicate: "warning",
  ambiguous: "warning",
};
const DELIMITER_NAME: Record<string, string> = { ",": "dấu phẩy (,)", ";": "dấu chấm phẩy (;)", "\t": "tab" };
const NONE = "";
export interface CsvPreviewHandlers {
  onMapping: (field: MappingField, column: number | null) => void;
  onDayFirst: (dayFirst: boolean) => void;
  onToggle: (rowId: string) => void;
  onSelectAllClean: () => void;
  onClearSelection: () => void;
}
function rowMessage(row: PreviewRow): string {
  const reasons = row.reasons.map((r) => reasonText(r.code));
  if (row.status === "ok") return row.warnings.includes("category_defaulted") ? "Danh mục được đặt là Khác." : "";
  return reasons.length > 0 ? reasons.join("; ") : "";
}
function SelectionCell({ row, checked, disabled, onToggle }: { row: PreviewRow; checked: boolean; disabled: boolean; onToggle: () => void }) {
  const selectable = isSelectable(row);
  const label = isDuplicate(row)
    ? `Vẫn nhập dòng ${row.rowNumber} dù có thể trùng`
    : `Chọn dòng ${row.rowNumber} để nhập`;
  return (
    <label className="flex min-h-[44px] min-w-[44px] items-center justify-center">
      <input
        type="checkbox"
        className="h-5 w-5 accent-primary"
        checked={checked}
        disabled={disabled || !selectable}
        onChange={onToggle}
        aria-label={selectable ? label : `Dòng ${row.rowNumber} không thể nhập (${ROW_STATUS_LABEL[row.status]})`}
      />
    </label>
  );
}
/** Mapping, date-format question, counts and the per-row table. Presentational: all state lives in `state`. */
export function CsvPreviewPanel({
  state,
  handlers,
  disabled,
}: {
  state: CsvImportState;
  handlers: CsvPreviewHandlers;
  disabled: boolean;
}) {
  const preview = state.preview;
  if (!preview) return null;
  const { counts } = preview;
  const columnOptions = [
    { value: NONE, label: "— Không dùng —" },
    ...preview.headers.map((h, i) => ({ value: String(i), label: `Cột ${i + 1}: ${h || "(trống)"}` })),
  ];
  const selectedValue = (field: MappingField): string => {
    const column = field in state.overrides ? state.overrides[field] : preview.mapping[field];
    return column === null || column === undefined ? NONE : String(column);
  };
  const warnings = preview.warnings.map((w) => WARNING_TEXT[w]).filter((w): w is string => Boolean(w));
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body-md text-on-surface-variant">
        Tệp: <span className="font-semibold text-on-surface">{state.file?.name}</span>. Dấu phân cách:{" "}
        {DELIMITER_NAME[preview.delimiter] ?? "không rõ"}. Đây chỉ là bản xem trước, <strong>chưa có gì được lưu</strong>.
      </p>
      {warnings.length > 0 ? (
        <ul className="list-disc space-y-1 rounded-control border border-warning/40 bg-warning-container px-6 py-3 text-body-md text-on-warning-container">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <section aria-labelledby="csv-mapping-heading" className="space-y-3">
        <h3 id="csv-mapping-heading" className="text-title-md text-on-surface">
          Ghép cột
        </h3>
        <p className="text-body-sm text-on-surface-variant">
          Ứng dụng đã đoán cột theo tiêu đề. Đổi lựa chọn nếu chưa đúng, bản xem trước sẽ được cập nhật.
        </p>
        {preview.mappingIssues.length > 0 ? (
          <ul role="alert" className="list-disc space-y-1 rounded-control border border-error/40 bg-error-container px-6 py-3 text-body-md text-on-error-container">
            {preview.mappingIssues.map((code) => (
              <li key={code}>{MAPPING_ISSUE_TEXT[code] ?? "Cách ghép cột chưa đủ."}</li>
            ))}
          </ul>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MAPPING_FIELD_ORDER.map((field) => (
            <SelectField
              key={field}
              id={`csv-map-${field}`}
              label={MAPPING_FIELD_LABEL[field]}
              value={selectedValue(field)}
              options={columnOptions}
              disabled={disabled}
              onChange={(e) => handlers.onMapping(field, e.target.value === NONE ? null : Number(e.target.value))}
            />
          ))}
        </div>
      </section>
      {preview.needsDateFormat ? (
        <fieldset className="space-y-2 rounded-control border border-warning/40 bg-warning-container p-4" disabled={disabled}>
          <legend className="px-1 text-label-lg text-on-warning-container">Ngày trong tệp được viết theo thứ tự nào?</legend>
          <p className="text-body-sm text-on-warning-container">
            Một số ngày như 03/04/2026 có thể hiểu theo hai cách. Hãy chọn để tránh nhập sai tháng.
          </p>
          {[
            { value: true, label: "Ngày/Tháng/Năm (03/04 là 3 tháng 4)" },
            { value: false, label: "Tháng/Ngày/Năm (03/04 là 4 tháng 3)" },
          ].map((option) => (
            <label key={String(option.value)} className="flex min-h-[44px] items-center gap-3 text-body-md text-on-surface">
              <input
                type="radio"
                name="csv-day-first"
                className="h-5 w-5 accent-primary"
                checked={state.dayFirst === option.value}
                onChange={() => handlers.onDayFirst(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <section aria-labelledby="csv-rows-heading" className="space-y-3">
        <h3 id="csv-rows-heading" className="text-title-md text-on-surface">
          Các dòng trong tệp
        </h3>
        <div role="group" aria-label="Thống kê dòng" className="flex flex-wrap gap-2">
          <Badge tone="neutral">{counts.total} dòng</Badge>
          <Badge tone="success">{counts.ok} hợp lệ</Badge>
          <Badge tone="error">{counts.invalid} không hợp lệ</Badge>
          <Badge tone="warning">{counts.possibleDuplicate + counts.exactDuplicate} có thể trùng</Badge>
          <Badge tone="warning">{counts.ambiguous} chưa rõ ngày</Badge>
        </div>
        {preview.historicalOnlyCount !== null && preview.historicalOnlyCount > 0 ? (
          <p className="rounded-control bg-surface-container-low px-4 py-3 text-body-md text-on-surface">
            {preview.historicalOnlyCount} dòng có ngày trước hoặc đúng thời điểm số dư gốc
            {preview.balanceSnapshotAt ? ` (${formatDateTimeVi(preview.balanceSnapshotAt)})` : ""}. Các dòng này chỉ được
            dùng để phân tích lịch sử, <strong>không làm thay đổi số dư hiện tại</strong>.
          </p>
        ) : null}
        <p className="text-body-sm text-on-surface-variant">
          Dòng không hợp lệ hoặc chưa rõ ngày không thể nhập. Dòng có thể trùng mặc định không được chọn: chỉ tick khi bạn
          chắc chắn muốn nhập.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handlers.onSelectAllClean} disabled={disabled} className="min-h-[44px] text-label-lg text-primary underline disabled:opacity-60">
            Chọn tất cả dòng hợp lệ
          </button>
          <button type="button" onClick={handlers.onClearSelection} disabled={disabled} className="min-h-[44px] text-label-lg text-primary underline disabled:opacity-60">
            Bỏ chọn tất cả
          </button>
        </div>
        {preview.rows.length === 0 ? (
          <p className="text-body-md text-on-surface-variant">
            Chưa có dòng nào để hiển thị. Hãy hoàn tất việc ghép cột ở trên.
          </p>
        ) : (
          <div
            role="region"
            aria-label="Bảng xem trước các dòng CSV (có thể cuộn ngang)"
            tabIndex={0}
            className="max-h-[50vh] overflow-auto rounded-card border border-outline-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <table className="w-full min-w-[640px] border-collapse text-left text-body-md">
              <caption className="sr-only">Xem trước các dòng CSV, chọn dòng để nhập</caption>
              <thead className="sticky top-0 bg-surface-container text-label-md text-on-surface-variant">
                <tr>
                  <th scope="col" className="px-2 py-2">Nhập</th>
                  <th scope="col" className="px-2 py-2">Dòng</th>
                  <th scope="col" className="px-2 py-2">Trạng thái</th>
                  <th scope="col" className="px-2 py-2">Ngày giờ</th>
                  <th scope="col" className="px-2 py-2">Số tiền</th>
                  <th scope="col" className="px-2 py-2">Nội dung</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {preview.rows.map((row) => {
                  const { values } = row;
                  const note = rowMessage(row);
                  return (
                    <tr key={row.rowId} className={isSelectable(row) ? "" : "bg-surface-container-low"}>
                      <td className="px-2 py-1">
                        <SelectionCell
                          row={row}
                          checked={state.selected.includes(row.rowId)}
                          disabled={disabled}
                          onToggle={() => handlers.onToggle(row.rowId)}
                        />
                      </td>
                      <td className="px-2 py-1 font-mono text-mono-md">{row.rowNumber}</td>
                      <td className="px-2 py-1">
                        <Badge tone={STATUS_TONE[row.status]}>{ROW_STATUS_LABEL[row.status]}</Badge>
                      </td>
                      <td className="px-2 py-1">{values.occurredAt ? formatDateTimeVi(values.occurredAt) : "—"}</td>
                      <td className="px-2 py-1 font-mono text-mono-md">
                        {values.kind && values.amountVnd ? displaySignedVnd(values.kind, values.amountVnd) : "—"}
                      </td>
                      <td className="px-2 py-1">
                        <span className="block">
                          {values.merchant ?? values.description ?? categoryLabel(values.category)}
                        </span>
                        {note ? <span className="block text-body-sm text-on-surface-variant">{note}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
