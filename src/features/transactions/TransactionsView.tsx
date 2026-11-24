"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { BUTTON_PRIMARY, FOCUS_RING } from "@/components/ui/classes";
import { browserFetch, type FetchLike } from "@/lib/http/api-call";
import type { RecurringDto, TransactionDto } from "@/lib/transactions/dto";
import { AddActionSheet, type AddAction } from "./AddActionSheet";
import { listRecurringApi, listTransactionsApi } from "./api";
import { CsvImportDialog } from "./CsvImportDialog";
import { ReceiptScanDialog } from "./ReceiptScanDialog";
import { EMPTY_FILTERS, PAGE_SIZE, hasActiveFilters, validateFilters, type TransactionFilters } from "./filters";
import { TransactionFiltersBar } from "./TransactionFiltersBar";
import { TransactionFormDialog, type FormDialogResult } from "./TransactionFormDialog";
import { TransactionList, type ListStatus } from "./TransactionList";
const DEBOUNCE_MS = 300;
type FormState = { transaction: TransactionDto | undefined } | null;
/** Transactions page body: filters, grouped list with paging, and the add/edit/import dialogs. */
export function TransactionsView({ fetchImpl = browserFetch, aiConfigured = false }: { fetchImpl?: FetchLike; aiConfigured?: boolean }) {
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<TransactionFilters>(EMPTY_FILTERS);
  const [reloadToken, setReloadToken] = useState(0);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [items, setItems] = useState<TransactionDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<FormState>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [recurringItems, setRecurringItems] = useState<RecurringDto[]>([]);
  const recurringLoaded = useRef(false);
  const requestId = useRef(0);
  const [now] = useState(() => new Date());
  // Debounce filter edits; an invalid range is not applied until it is fixed.
  useEffect(() => {
    if (validateFilters(filters) !== null) return;
    const timer = setTimeout(() => setApplied(filters), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters]);
  useEffect(() => {
    const id = ++requestId.current;
    setStatus((current) => (current === "ready" ? current : "loading")); // keep rows visible while refreshing
    setErrorMessage(null);
    setLoadMoreError(null);
    void listTransactionsApi(fetchImpl, applied, { limit: PAGE_SIZE, offset: 0 }).then((res) => {
      if (id !== requestId.current) return; // a newer request superseded this one
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(res.message);
        return;
      }
      setItems(res.data.items);
      setHasMore(res.data.hasMore);
      setStatus("ready");
    });
  }, [applied, reloadToken, fetchImpl]);
  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    const res = await listTransactionsApi(fetchImpl, applied, { limit: PAGE_SIZE, offset: items.length });
    if (id !== requestId.current) return;
    setLoadingMore(false);
    if (!res.ok) {
      setLoadMoreError(res.message);
      return;
    }
    const page = res.data;
    setItems((prev) => [...prev, ...page.items]);
    setHasMore(page.hasMore);
  }, [applied, fetchImpl, items.length, loadingMore]);
  const ensureRecurring = useCallback(async () => {
    if (recurringLoaded.current) return;
    recurringLoaded.current = true;
    const res = await listRecurringApi(fetchImpl);
    if (res.ok) setRecurringItems(res.data.items);
    else recurringLoaded.current = false; // allow a retry on the next open
  }, [fetchImpl]);
  const reload = () => setReloadToken((n) => n + 1);
  function openForm(transaction?: TransactionDto) {
    setBanner(null);
    void ensureRecurring();
    setForm({ transaction });
  }
  function choose(action: AddAction) {
    setSheetOpen(false);
    if (action === "manual") openForm();
    else if (action === "receipt") {
      setBanner(null);
      setReceiptOpen(true);
    } else {
      setBanner(null);
      setCsvOpen(true);
    }
  }
  function onSaved({ mode, result }: FormDialogResult) {
    setForm(null);
    setBanner(`${mode === "create" ? "Đã thêm giao dịch." : "Đã lưu thay đổi."} ${result.impact.messageVi}`);
    reload();
  }
  function onDeleted(id: string, info: { gone: boolean; message: string }) {
    setForm(null);
    setItems((prev) => prev.filter((t) => t.id !== id));
    setBanner(info.message);
    reload();
  }
  const filtersActive = hasActiveFilters(applied);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-headline-md text-on-surface">Thu chi</h1>
        <button type="button" onClick={() => setSheetOpen(true)} className={`${BUTTON_PRIMARY} hidden md:inline-flex`}>
          + Thêm giao dịch
        </button>
      </div>
      <TransactionFiltersBar
        filters={filters}
        onChange={setFilters}
        onClear={() => {
          setFilters(EMPTY_FILTERS);
          setApplied(EMPTY_FILTERS);
        }}
      />
      <FormAlert message={banner} tone="info" />
      <TransactionList
        status={status}
        items={items}
        hasMore={hasMore}
        loadingMore={loadingMore}
        loadMoreError={loadMoreError}
        errorMessage={errorMessage}
        filtersActive={filtersActive}
        now={now}
        onRetry={reload}
        onLoadMore={() => void loadMore()}
        onSelect={(t) => openForm(t)}
        onAdd={() => setSheetOpen(true)}
        onClearFilters={() => {
          setFilters(EMPTY_FILTERS);
          setApplied(EMPTY_FILTERS);
        }}
      />
      <button
        type="button"
        aria-label="Thêm giao dịch"
        onClick={() => setSheetOpen(true)}
        className={`fixed bottom-[72px] right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg md:hidden ${FOCUS_RING}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <AddActionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onChoose={choose} aiConfigured={aiConfigured} />
      {form ? (
        <TransactionFormDialog
          transaction={form.transaction}
          recurringItems={recurringItems}
          fetchImpl={fetchImpl}
          onClose={() => setForm(null)}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      ) : null}
      {receiptOpen ? (
        <ReceiptScanDialog
          fetchImpl={fetchImpl}
          onClose={() => setReceiptOpen(false)}
          onSaved={({ impact }) => {
            setBanner(`Đã lưu giao dịch từ biên lai. ${impact.messageVi}`);
            reload();
          }}
        />
      ) : null}
      {csvOpen ? (
        <CsvImportDialog
          fetchImpl={fetchImpl}
          onClose={() => setCsvOpen(false)}
          onImported={() => {
            setBanner("Đã nhập giao dịch từ CSV.");
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
