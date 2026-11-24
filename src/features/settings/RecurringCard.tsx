"use client";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormAlert } from "@/components/ui/FormAlert";
import { BUTTON_SECONDARY } from "@/components/ui/classes";
import { updateTransactionApi } from "@/features/transactions/api";
import { categoryLabel } from "@/features/transactions/labels";
import { createSubmitGuard } from "@/lib/demo/guest-flow";
import { displayVnd } from "@/lib/format/money-input";
import { formatLocalDateVi } from "@/lib/format/vn-datetime";
import { browserFetch, type FetchLike } from "@/lib/http/api-call";
import type { RecurringDto, RecurringSuggestionDto } from "@/lib/transactions/dto";
import { updateRecurringApi } from "./api";
import { RecurringFormDialog } from "./RecurringFormDialog";
import { SettingsCard } from "./SettingsCard";
export function RecurringList({
  items,
  onEdit,
  onToggle,
  busyId,
}: {
  items: readonly RecurringDto[];
  onEdit: (item: RecurringDto) => void;
  onToggle: (item: RecurringDto) => void;
  busyId: string | null;
}) {
  if (items.length === 0) {
    return (
      <p className="text-body-md text-on-surface-variant">
        Chưa có khoản định kỳ nào. Thêm tiền trọ, lương hoặc các khoản lặp lại hằng tháng để dự báo chính xác hơn.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-outline-variant">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className={`text-body-lg ${item.active ? "text-on-surface" : "text-on-surface-variant line-through"}`}>
              {item.label}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-on-surface-variant">
              <Badge tone={item.kind === "income" ? "success" : "neutral"}>{item.kind === "income" ? "Thu" : "Chi"}</Badge>
              <span className="font-mono text-mono-md text-on-surface">
                {item.kind === "income" ? "+" : "−"}
                {displayVnd(item.amountVnd)}
              </span>
              <span>Ngày {item.dayOfMonth} hằng tháng</span>
              <span>{categoryLabel(item.category)}</span>
              <Badge tone={item.active ? "primary" : "warning"}>{item.active ? "Đang áp dụng" : "Đã tắt"}</Badge>
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => onEdit(item)} className={BUTTON_SECONDARY}>
              Sửa<span className="sr-only"> {item.label}</span>
            </button>
            <button type="button" disabled={busyId === item.id} onClick={() => onToggle(item)} className={BUTTON_SECONDARY}>
              {item.active ? "Tắt" : "Bật lại"}
              <span className="sr-only"> {item.label}</span>
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
/** Proposed matches only. Each needs its own explicit click; nothing links automatically. */
export function SuggestionList({
  suggestions,
  items,
  linkingKey,
  errors,
  onLink,
}: {
  suggestions: readonly RecurringSuggestionDto[];
  items: readonly RecurringDto[];
  linkingKey: string | null;
  errors: Readonly<Record<string, string>>;
  onLink: (suggestion: RecurringSuggestionDto, transactionId: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <section aria-labelledby="rec-suggest-title" className="mt-6 rounded-card bg-surface-container-low p-4">
      <h3 id="rec-suggest-title" className="text-title-md text-on-surface">
        Có thể khớp
      </h3>
      <p className="mt-1 text-body-sm text-on-surface-variant">
        Các kỳ định kỳ đã qua nhưng chưa được ghi nhận. Ứng dụng chỉ gợi ý; không có gì được liên kết cho đến khi bạn bấm
        Liên kết. Liên kết giúp dự báo không tính trùng khoản này.
      </p>
      <ul className="mt-3 space-y-4">
        {suggestions.map((s) => {
          const item = items.find((i) => i.id === s.itemId);
          const name = item?.label ?? "Khoản định kỳ";
          const key = `${s.itemId}:${s.instanceDate}`;
          return (
            <li key={key}>
              <p className="text-body-md text-on-surface">
                <strong>{name}</strong> kỳ {formatLocalDateVi(s.instanceDate)} (dự kiến {displayVnd(s.expectedAmountVnd)})
              </p>
              {s.candidates.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant">
                  Chưa thấy giao dịch nào khớp. Bạn có thể thêm giao dịch ở trang Thu chi và liên kết khi lưu.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {s.candidates.map((c) => (
                    <li key={c.transactionId} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-body-md text-on-surface-variant">
                        Giao dịch ngày {formatLocalDateVi(c.transactionDate)}, lệch {c.dayDistance} ngày, chênh{" "}
                        {displayVnd(c.amountDifferenceVnd)} so với dự kiến
                      </span>
                      <button
                        type="button"
                        disabled={linkingKey !== null}
                        aria-label={`Liên kết giao dịch ngày ${formatLocalDateVi(c.transactionDate)} với ${name} kỳ ${formatLocalDateVi(s.instanceDate)}`}
                        onClick={() => onLink(s, c.transactionId)}
                        className={BUTTON_SECONDARY}
                      >
                        {linkingKey === `${key}:${c.transactionId}` ? "Đang liên kết…" : "Liên kết"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {errors[key] ? <p role="alert" className="mt-1 text-body-sm text-error">{errors[key]}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
export function RecurringCard({
  items,
  truncated,
  suggestions,
  suggestionsIncomplete,
  onChanged,
  fetchImpl = browserFetch,
}: {
  items: readonly RecurringDto[];
  truncated: boolean;
  suggestions: readonly RecurringSuggestionDto[];
  suggestionsIncomplete: boolean;
  /** Called after any write so the page can reload settings and suggestions. */
  onChanged: (message: string) => void;
  fetchImpl?: FetchLike;
}) {
  const guard = useRef(createSubmitGuard()).current;
  const [dialog, setDialog] = useState<{ item: RecurringDto | undefined } | null>(null);
  const [deactivating, setDeactivating] = useState<RecurringDto | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [linkErrors, setLinkErrors] = useState<Record<string, string>>({});
  async function setActive(item: RecurringDto, active: boolean) {
    if (!guard.tryEnter()) return;
    setPending(true);
    setBusyId(item.id);
    setError(null);
    const res = await updateRecurringApi(fetchImpl, item.id, { active });
    setPending(false);
    setBusyId(null);
    guard.leave();
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setDeactivating(null);
    onChanged(active ? `Đã bật lại "${item.label}".` : `Đã tắt "${item.label}". Lịch sử giao dịch được giữ nguyên.`);
  }
  async function link(suggestion: RecurringSuggestionDto, transactionId: string) {
    if (!guard.tryEnter()) return;
    const key = `${suggestion.itemId}:${suggestion.instanceDate}`;
    setLinkingKey(`${key}:${transactionId}`);
    setLinkErrors((prev) => ({ ...prev, [key]: "" }));
    const res = await updateTransactionApi(fetchImpl, transactionId, {
      recurringItemId: suggestion.itemId,
      recurringInstanceDate: suggestion.instanceDate,
    });
    setLinkingKey(null);
    guard.leave();
    if (!res.ok) {
      setLinkErrors((prev) => ({ ...prev, [key]: res.message }));
      return;
    }
    onChanged("Đã liên kết giao dịch với khoản định kỳ. " + res.data.impact.messageVi);
  }
  return (
    <SettingsCard
      id="settings-recurring"
      title="Khoản thu chi định kỳ"
      description="Tiền trọ, lương, gói cước… lặp lại hằng tháng và được đưa vào dự báo. Bạn có thể tắt một khoản (không xóa) để giữ nguyên lịch sử."
      actions={
        <button type="button" onClick={() => setDialog({ item: undefined })} className={BUTTON_SECONDARY}>
          Thêm khoản định kỳ
        </button>
      }
    >
      <FormAlert message={deactivating ? null : error} />
      <RecurringList
        items={items}
        busyId={busyId}
        onEdit={(item) => setDialog({ item })}
        onToggle={(item) => (item.active ? setDeactivating(item) : void setActive(item, true))}
      />
      {truncated ? (
        <p className="mt-2 text-body-sm text-on-surface-variant">Chỉ hiển thị một phần danh sách khoản định kỳ.</p>
      ) : null}
      <SuggestionList
        suggestions={suggestions}
        items={items}
        linkingKey={linkingKey}
        errors={linkErrors}
        onLink={(s, id) => void link(s, id)}
      />
      {suggestionsIncomplete ? (
        <p className="mt-2 text-body-sm text-on-surface-variant">Gợi ý khớp có thể chưa đầy đủ do dữ liệu quá nhiều.</p>
      ) : null}
      {dialog ? (
        <RecurringFormDialog
          item={dialog.item}
          fetchImpl={fetchImpl}
          onClose={() => setDialog(null)}
          onSaved={(item, mode) => {
            setDialog(null);
            onChanged(mode === "create" ? `Đã thêm "${item.label}".` : `Đã lưu "${item.label}".`);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deactivating !== null}
        tone="primary"
        title={`Tắt "${deactivating?.label ?? ""}"?`}
        description="Khoản này sẽ không còn được tính vào dự báo từ nay. Các giao dịch đã ghi vẫn giữ nguyên và bạn có thể bật lại bất cứ lúc nào. Khoản định kỳ không thể bị xóa."
        confirmLabel="Tắt khoản này"
        pendingLabel="Đang tắt…"
        cancelLabel="Giữ nguyên"
        pending={pending}
        error={error}
        onConfirm={() => deactivating && void setActive(deactivating, false)}
        onCancel={() => setDeactivating(null)}
      />
    </SettingsCard>
  );
}
