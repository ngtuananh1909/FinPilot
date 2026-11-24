"use client";
import { useState } from "react";
import { Field } from "@/components/ui/Field";
import { SelectField } from "@/components/ui/SelectField";
import { BUTTON_SECONDARY } from "@/components/ui/classes";
import { hasActiveFilters, validateFilters, type TransactionFilters } from "./filters";
import { KIND_OPTIONS, categoryOptions } from "./labels";
const KIND_FILTER_OPTIONS = [{ value: "", label: "Tất cả loại" }, ...KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label }))];
const CATEGORY_FILTER_OPTIONS = [{ value: "", label: "Tất cả danh mục" }, ...categoryOptions()];
/** Search is always visible; the remaining filters sit behind a toggle to keep 375px screens compact. */
export function TransactionFiltersBar({
  filters,
  onChange,
  onClear,
  initiallyOpen = false,
}: {
  filters: TransactionFilters;
  onChange: (next: TransactionFilters) => void;
  onClear: () => void;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const rangeError = validateFilters(filters);
  const extraCount = [filters.kind, filters.category, filters.fromDate, filters.toDate].filter(Boolean).length;
  return (
    <form role="search" aria-label="Tìm và lọc giao dịch" onSubmit={(e) => e.preventDefault()} className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field
            id="tx-search"
            label="Tìm giao dịch"
            type="search"
            autoComplete="off"
            placeholder="Cửa hàng, ghi chú…"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
          />
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="tx-filter-panel"
          onClick={() => setOpen((v) => !v)}
          className={BUTTON_SECONDARY}
        >
          Bộ lọc{extraCount > 0 ? ` (${extraCount})` : ""}
        </button>
      </div>
      <div id="tx-filter-panel" className={`${open ? "grid" : "hidden"} grid-cols-1 gap-3 sm:grid-cols-2`}>
        <SelectField
          id="tx-kind"
          label="Loại"
          value={filters.kind}
          options={KIND_FILTER_OPTIONS}
          onChange={(e) => onChange({ ...filters, kind: e.target.value as TransactionFilters["kind"] })}
        />
        <SelectField
          id="tx-category"
          label="Danh mục"
          value={filters.category}
          options={CATEGORY_FILTER_OPTIONS}
          onChange={(e) => onChange({ ...filters, category: e.target.value })}
        />
        <Field
          id="tx-from"
          label="Từ ngày"
          type="date"
          value={filters.fromDate}
          onChange={(e) => onChange({ ...filters, fromDate: e.target.value })}
        />
        <Field
          id="tx-to"
          label="Đến ngày"
          type="date"
          value={filters.toDate}
          error={rangeError ?? undefined}
          onChange={(e) => onChange({ ...filters, toDate: e.target.value })}
        />
      </div>
      {hasActiveFilters(filters) ? (
        <button type="button" onClick={onClear} className="min-h-[44px] text-label-lg text-primary underline">
          Xóa bộ lọc
        </button>
      ) : null}
    </form>
  );
}
