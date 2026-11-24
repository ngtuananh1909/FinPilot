"use client";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FOCUS_RING } from "@/components/ui/classes";
import { displaySignedVnd } from "@/lib/format/money-input";
import { dayHeadingVi, formatVnTime } from "@/lib/format/vn-datetime";
import type { TransactionDto } from "@/lib/transactions/dto";
import { groupByLocalDate } from "./grouping";
import { KIND_LABEL, categoryLabel, sourceLabel } from "./labels";
export type ListStatus = "loading" | "error" | "ready";
const AMOUNT_TONE: Record<TransactionDto["kind"], string> = {
  income: "text-success",
  expense: "text-on-surface",
  excluded: "text-on-surface-variant",
};
export function TransactionRow({ transaction, onSelect }: { transaction: TransactionDto; onSelect: (t: TransactionDto) => void }) {
  const title = transaction.merchant || transaction.description || categoryLabel(transaction.category);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(transaction)}
        className={`flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-container-low ${FOCUS_RING}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-lg text-on-surface">{title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-on-surface-variant">
            <span>{categoryLabel(transaction.category)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatVnTime(transaction.occurredAt)}</span>
            <Badge tone="neutral">{sourceLabel(transaction.source)}</Badge>
            {transaction.recurringItemId ? <Badge tone="primary">Định kỳ</Badge> : null}
            {transaction.kind === "excluded" ? <Badge tone="warning">Loại trừ</Badge> : null}
          </span>
        </span>
        <span className={`shrink-0 text-right font-mono text-mono-md ${AMOUNT_TONE[transaction.kind]}`}>
          <span className="sr-only">{KIND_LABEL[transaction.kind]}: </span>
          {displaySignedVnd(transaction.kind, transaction.amountVnd)}
        </span>
      </button>
    </li>
  );
}
function ListSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">Đang tải giao dịch…</span>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
export function TransactionList({
  status,
  items,
  hasMore,
  loadingMore,
  loadMoreError,
  errorMessage,
  filtersActive,
  now,
  onRetry,
  onLoadMore,
  onSelect,
  onAdd,
  onClearFilters,
}: {
  status: ListStatus;
  items: readonly TransactionDto[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError?: string | null;
  errorMessage?: string | null;
  filtersActive: boolean;
  now: Date;
  onRetry: () => void;
  onLoadMore: () => void;
  onSelect: (t: TransactionDto) => void;
  onAdd: () => void;
  onClearFilters: () => void;
}) {
  if (status === "loading") return <ListSkeleton />;
  if (status === "error") {
    return (
      <ErrorState
        title="Không tải được giao dịch"
        message={errorMessage ?? "Vui lòng thử lại."}
        onRetry={onRetry}
      />
    );
  }
  if (items.length === 0) {
    return filtersActive ? (
      <EmptyState
        title="Không có giao dịch phù hợp"
        description="Thử đổi từ khóa hoặc bỏ bớt bộ lọc."
        action={
          <button type="button" onClick={onClearFilters} className={BUTTON_SECONDARY}>
            Xóa bộ lọc
          </button>
        }
      />
    ) : (
      <EmptyState
        title="Chưa có giao dịch nào"
        description="Thêm giao dịch đầu tiên hoặc nhập từ tệp CSV để bắt đầu theo dõi thu chi."
        action={
          <button type="button" onClick={onAdd} className={BUTTON_PRIMARY}>
            Thêm giao dịch
          </button>
        }
      />
    );
  }
  const groups = groupByLocalDate(items);
  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const headingId = `day-${group.localDate}`;
        return (
          <section key={group.localDate} aria-labelledby={headingId}>
            <h2 id={headingId} className="mb-2 px-1 text-label-lg text-on-surface-variant">
              {dayHeadingVi(group.localDate, now)}
            </h2>
            <ul className="divide-y divide-outline-variant overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest">
              {group.items.map((t) => (
                <TransactionRow key={t.id} transaction={t} onSelect={onSelect} />
              ))}
            </ul>
          </section>
        );
      })}
      <div aria-live="polite" className="flex flex-col items-center gap-2">
        {loadMoreError ? <p role="alert" className="text-body-md text-error">{loadMoreError}</p> : null}
        {hasMore ? (
          <button type="button" onClick={onLoadMore} disabled={loadingMore} className={BUTTON_SECONDARY}>
            {loadingMore ? "Đang tải…" : "Tải thêm"}
          </button>
        ) : (
          <p className="text-body-sm text-on-surface-variant">Đã hiển thị toàn bộ giao dịch.</p>
        )}
      </div>
    </div>
  );
}
