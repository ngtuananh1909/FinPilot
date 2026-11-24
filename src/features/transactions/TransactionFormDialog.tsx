"use client";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { FormAlert } from "@/components/ui/FormAlert";
import { SelectField } from "@/components/ui/SelectField";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FOCUS_RING } from "@/components/ui/classes";
import { createSubmitGuard } from "@/lib/demo/guest-flow";
import { formatAmountInput } from "@/lib/format/money-input";
import { formatLocalDateVi } from "@/lib/format/vn-datetime";
import { browserFetch, type FetchLike } from "@/lib/http/api-call";
import type { RecurringDto, TransactionDto } from "@/lib/transactions/dto";
import type { TransactionWriteResult } from "@/lib/transactions/service";
import { createTransactionApi, deleteTransactionApi, updateTransactionApi } from "./api";
import {
  buildCreateBody,
  buildPatchBody,
  emptyFormValues,
  linkableItems,
  mapTransactionFailure,
  nearestOccurrence,
  occurrenceOptions,
  validateTransactionForm,
  valuesFromTransaction,
  type FormErrors,
  type TransactionFormValues,
} from "./form";
import { KIND_OPTIONS, categoryOptions, type TransactionKind } from "./labels";
export interface FormDialogResult {
  mode: "create" | "edit";
  result: TransactionWriteResult;
}
/**
 * Create / edit dialog. Mount it only while open so every opening starts from fresh state.
 * Submit is disabled while a request is pending; field errors come from validation or the
 * API's error envelope.
 */
export function TransactionFormDialog({
  transaction,
  recurringItems,
  onClose,
  onSaved,
  onDeleted,
  fetchImpl = browserFetch,
}: {
  /** Undefined = create mode. */
  transaction?: TransactionDto | undefined;
  recurringItems: readonly RecurringDto[];
  onClose: () => void;
  onSaved: (outcome: FormDialogResult) => void;
  /** Called after a successful delete, or when the row turned out to be gone already (`gone`). */
  onDeleted: (id: string, info: { gone: boolean; message: string }) => void;
  fetchImpl?: FetchLike;
}) {
  const mode = transaction ? "edit" : "create";
  const [now] = useState(() => new Date());
  const original = useMemo(() => (transaction ? valuesFromTransaction(transaction) : emptyFormValues(now)), [transaction, now]);
  const guard = useRef(createSubmitGuard()).current;
  const [values, setValues] = useState<TransactionFormValues>(original);
  const [errors, setErrors] = useState<FormErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const set = <K extends keyof TransactionFormValues>(key: K, value: TransactionFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const items = useMemo(
    () => linkableItems(recurringItems, values.kind, original.recurringItemId || undefined),
    [recurringItems, values.kind, original.recurringItemId],
  );
  const linkedItem = items.find((i) => i.id === values.recurringItemId);
  const occurrences = useMemo(
    () => (linkedItem ? occurrenceOptions(linkedItem, now, original.recurringItemId === linkedItem.id ? original.recurringInstanceDate : undefined) : []),
    [linkedItem, now, original.recurringItemId, original.recurringInstanceDate],
  );
  function changeKind(kind: TransactionKind) {
    setValues((prev) => {
      const stillLinkable = linkableItems(recurringItems, kind, original.recurringItemId || undefined).some(
        (i) => i.id === prev.recurringItemId,
      );
      return stillLinkable ? { ...prev, kind } : { ...prev, kind, recurringItemId: "", recurringInstanceDate: "" };
    });
    setErrors((prev) => ({ ...prev, kind: undefined, recurringItemId: undefined, recurringInstanceDate: undefined }));
  }
  function changeLink(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) {
      setValues((prev) => ({ ...prev, recurringItemId: "", recurringInstanceDate: "" }));
      return;
    }
    const dates = occurrenceOptions(item, now);
    const nearest = nearestOccurrence(dates, values.occurredAt.slice(0, 10)) ?? "";
    setValues((prev) => ({ ...prev, recurringItemId: itemId, recurringInstanceDate: nearest }));
    setErrors((prev) => ({ ...prev, recurringItemId: undefined, recurringInstanceDate: undefined }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!guard.tryEnter()) return;
    setGeneral(null);
    const found = validateTransactionForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setGeneral("Vui lòng kiểm tra các trường được đánh dấu.");
      guard.leave();
      return;
    }
    let body: Record<string, unknown> | null;
    try {
      body = mode === "create" ? buildCreateBody(values) : buildPatchBody(values, original);
    } catch {
      setGeneral("Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.");
      guard.leave();
      return;
    }
    if (body === null) {
      setGeneral("Bạn chưa thay đổi gì.");
      guard.leave();
      return;
    }
    setPending(true);
    const res =
      mode === "create" || !transaction
        ? await createTransactionApi(fetchImpl, body)
        : await updateTransactionApi(fetchImpl, transaction.id, body);
    setPending(false);
    guard.leave();
    if (res.ok) {
      onSaved({ mode, result: res.data });
      return;
    }
    const mapped = mapTransactionFailure(res);
    if (mapped.notFound && transaction) {
      onDeleted(transaction.id, { gone: true, message: mapped.general ?? res.message });
      return;
    }
    setErrors(mapped.fieldErrors);
    setGeneral(mapped.general ?? "Vui lòng kiểm tra các trường được đánh dấu.");
  }
  async function remove() {
    if (!transaction || !guard.tryEnter()) return;
    setPending(true);
    setDeleteError(null);
    const res = await deleteTransactionApi(fetchImpl, transaction.id);
    setPending(false);
    guard.leave();
    if (res.ok) {
      onDeleted(transaction.id, { gone: false, message: "Đã xóa giao dịch." });
      return;
    }
    const mapped = mapTransactionFailure(res);
    if (mapped.notFound) {
      onDeleted(transaction.id, { gone: true, message: mapped.general ?? res.message });
      return;
    }
    setDeleteError(mapped.general ?? res.message);
  }
  const kindExplanation = KIND_OPTIONS.find((k) => k.value === values.kind)?.explanation ?? "";
  return (
    <>
      <Dialog
        open={!confirmDelete}
        onClose={onClose}
        dismissible={!pending}
        title={mode === "create" ? "Thêm giao dịch" : "Sửa giao dịch"}
      >
        <form onSubmit={(e) => void submit(e)} noValidate aria-busy={pending} className="flex flex-col gap-4">
          <FormAlert message={general} />
          <fieldset className="flex flex-col gap-2" aria-describedby="txf-kind-help" disabled={pending}>
            <legend className="text-label-md text-on-surface">Loại giao dịch</legend>
            <div className="grid grid-cols-3 gap-2">
              {KIND_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-control border px-2 text-center text-label-lg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${
                    values.kind === option.value
                      ? "border-primary bg-primary-container text-on-primary-container"
                      : "border-outline-variant bg-surface-container-lowest text-on-surface"
                  }`}
                >
                  <input
                    type="radio"
                    name="txf-kind"
                    value={option.value}
                    checked={values.kind === option.value}
                    onChange={() => changeKind(option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <p id="txf-kind-help" className="text-body-sm text-on-surface-variant">
              {kindExplanation}
            </p>
          </fieldset>
          <Field
            id="txf-amount"
            label="Số tiền (₫)"
            inputMode="numeric"
            autoComplete="off"
            placeholder="150.000"
            value={values.amount}
            onChange={(e) => set("amount", formatAmountInput(e.target.value))}
            error={errors.amount}
            disabled={pending}
          />
          <Field
            id="txf-when"
            label="Ngày giờ (giờ Việt Nam)"
            type="datetime-local"
            value={values.occurredAt}
            onChange={(e) => set("occurredAt", e.target.value)}
            error={errors.occurredAt}
            disabled={pending}
          />
          <SelectField
            id="txf-category"
            label="Danh mục"
            value={values.category}
            options={categoryOptions(original.category)}
            onChange={(e) => set("category", e.target.value)}
            error={errors.category}
            disabled={pending}
          />
          <Field
            id="txf-merchant"
            label="Nơi nhận / cửa hàng (không bắt buộc)"
            maxLength={200}
            autoComplete="off"
            value={values.merchant}
            onChange={(e) => set("merchant", e.target.value)}
            error={errors.merchant}
            disabled={pending}
          />
          <Field
            id="txf-description"
            label="Ghi chú (không bắt buộc)"
            maxLength={500}
            autoComplete="off"
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            error={errors.description}
            disabled={pending}
          />
          <SelectField
            id="txf-link"
            label="Liên kết khoản định kỳ (không bắt buộc)"
            value={values.recurringItemId}
            options={[
              { value: "", label: "Không liên kết" },
              ...items.map((i) => ({ value: i.id, label: `${i.label}${i.active ? "" : " (đã tắt)"}` })),
            ]}
            onChange={(e) => changeLink(e.target.value)}
            hint={
              values.kind === "excluded"
                ? "Giao dịch loại trừ không liên kết được với khoản định kỳ."
                : items.length === 0
                  ? "Chưa có khoản định kỳ cùng loại. Bạn có thể thêm trong Cài đặt."
                  : "Liên kết giúp dự báo không tính trùng khoản này."
            }
            error={errors.recurringItemId}
            disabled={pending || values.kind === "excluded"}
          />
          {values.recurringItemId ? (
            <SelectField
              id="txf-instance"
              label="Kỳ của khoản định kỳ"
              value={values.recurringInstanceDate}
              options={[
                { value: "", label: occurrences.length === 0 ? "Không có kỳ hợp lệ" : "Chọn kỳ…" },
                ...occurrences.map((d) => ({ value: d, label: formatLocalDateVi(d) })),
              ]}
              onChange={(e) => set("recurringInstanceDate", e.target.value)}
              error={errors.recurringInstanceDate}
              disabled={pending}
            />
          ) : null}
          <div className="flex flex-col gap-2">
            <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
              {pending ? "Đang lưu…" : "Lưu giao dịch"}
            </button>
            <button type="button" disabled={pending} onClick={onClose} className={BUTTON_SECONDARY}>
              Hủy
            </button>
            {mode === "edit" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setDeleteError(null);
                  setConfirmDelete(true);
                }}
                className={`min-h-[44px] rounded-control text-label-lg text-error underline disabled:opacity-60 ${FOCUS_RING}`}
              >
                Xóa giao dịch
              </button>
            ) : null}
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        title="Xóa giao dịch này?"
        description="Giao dịch sẽ bị xóa khỏi dữ liệu của bạn và không thể khôi phục. Số dư và dự báo sẽ được tính lại."
        confirmLabel="Xóa giao dịch"
        pendingLabel="Đang xóa…"
        cancelLabel="Giữ lại"
        pending={pending}
        error={deleteError}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
