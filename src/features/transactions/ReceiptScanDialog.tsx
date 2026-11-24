"use client";

import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { FormAlert } from "@/components/ui/FormAlert";
import { SelectField } from "@/components/ui/SelectField";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classes";
import { formatAmountInput } from "@/lib/format/money-input";
import { callApi, type FetchLike } from "@/lib/http/api-call";
import type { ImpactDto, TransactionDto } from "@/lib/transactions/dto";
import { validateTransactionForm, type FormErrors, type TransactionFormValues } from "./form";
import { categoryOptions } from "./labels";
import {
  RECEIPT_ACCEPT,
  buildReceiptBody,
  checkReceiptFile,
  draftToFormValues,
  receiptWarningText,
  uploadReceipt,
  type ReceiptDraftView,
} from "./receipt";

type Step = "pick" | "review" | "saved";

/**
 * Receipt flow: pick a photo -> AI vision draft -> user edits -> explicit "Lưu giao dịch".
 * The draft is never saved automatically; saving uses the normal transactions API once.
 */
export function ReceiptScanDialog({
  fetchImpl,
  onClose,
  onSaved,
}: {
  fetchImpl: FetchLike;
  onClose: () => void;
  onSaved: (result: { transaction: TransactionDto; impact: ImpactDto }) => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReceiptDraftView | null>(null);
  const [values, setValues] = useState<TransactionFormValues | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const saved = useRef(false);
  const uid = useId();

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    const problem = checkReceiptFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await uploadReceipt(fetchImpl, file);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setDraft(r.data.draft);
    setRemaining(r.data.quota.remaining);
    setValues(draftToFormValues(r.data.draft, new Date()));
    setStep("review");
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!values || busy || saved.current) return;
    const found = validateTransactionForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError(null);
    const r = await callApi<{ transaction: TransactionDto; impact: ImpactDto }>(fetchImpl, "POST", "/api/transactions", buildReceiptBody(values));
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    saved.current = true;
    setStep("saved");
    onSaved(r.data);
  }

  const set = <K extends keyof TransactionFormValues>(key: K, value: TransactionFormValues[K]) =>
    setValues((v) => (v ? { ...v, [key]: value } : v));

  return (
    <Dialog open onClose={onClose} title="Quét biên lai" description="AI đọc ảnh để gợi ý; bạn kiểm tra và tự lưu.">
      {step === "pick" ? (
        <div className="flex flex-col gap-3">
          <label htmlFor={`${uid}-file`} className={`${BUTTON_PRIMARY} cursor-pointer`} aria-disabled={busy}>
            {busy ? "Đang đọc ảnh…" : "Chọn hoặc chụp ảnh biên lai"}
          </label>
          <input
            id={`${uid}-file`}
            type="file"
            accept={RECEIPT_ACCEPT}
            capture="environment"
            className="sr-only"
            disabled={busy}
            onChange={(e) => void onFile(e)}
          />
          <p className="text-body-sm text-on-surface-variant">
            JPEG, PNG hoặc WebP, tối đa 5 MB. Ảnh chỉ được xử lý để đọc thông tin và không được lưu lại. Mỗi ngày có 5 lượt quét.
          </p>
          <div role="status" aria-live="polite">{busy ? "Đang gửi ảnh cho AI…" : null}</div>
        </div>
      ) : null}

      {step === "review" && values ? (
        <form onSubmit={(e) => void onSave(e)} className="flex flex-col gap-3" noValidate>
          <p className="rounded-control bg-warning-container p-3 text-body-sm text-on-warning-container">
            Đây là bản nháp do AI đọc, chưa được lưu. Hãy kiểm tra từng ô trước khi lưu.
          </p>
          {draft && draft.warnings.length > 0 ? (
            <ul className="list-disc pl-5 text-body-sm text-on-surface-variant" aria-label="Lưu ý từ bản nháp">
              {draft.warnings.map((w) => (
                <li key={w}>{receiptWarningText(w)}</li>
              ))}
            </ul>
          ) : null}
          <Field id={`${uid}-merchant`} label="Cửa hàng" value={values.merchant} maxLength={200} onChange={(e) => set("merchant", e.target.value)} error={errors.merchant} />
          <Field
            id={`${uid}-amount`}
            label="Số tiền (₫)"
            inputMode="numeric"
            value={values.amount}
            onChange={(e) => set("amount", formatAmountInput(e.target.value))}
            error={errors.amount}
          />
          <Field
            id={`${uid}-time`}
            label="Thời gian (giờ Việt Nam)"
            type="datetime-local"
            value={values.occurredAt}
            onChange={(e) => set("occurredAt", e.target.value)}
            error={errors.occurredAt}
          />
          <SelectField
            id={`${uid}-category`}
            label="Danh mục"
            value={values.category}
            options={categoryOptions(values.category)}
            onChange={(e) => set("category", e.target.value)}
            error={errors.category}
          />
          {remaining !== null ? <p className="text-body-sm text-on-surface-variant">Còn {remaining} lượt quét hôm nay.</p> : null}
          <FormAlert message={error} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={BUTTON_PRIMARY} disabled={busy}>
              {busy ? "Đang lưu…" : "Lưu giao dịch"}
            </button>
            <button type="button" className={BUTTON_SECONDARY} onClick={onClose} disabled={busy}>
              Hủy, không lưu
            </button>
          </div>
        </form>
      ) : null}

      {step === "saved" ? (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-body-md text-on-surface">Đã lưu giao dịch từ biên lai.</p>
          <button type="button" className={BUTTON_PRIMARY} onClick={onClose}>
            Đóng
          </button>
        </div>
      ) : null}

      {step === "pick" ? <FormAlert message={error} /> : null}
    </Dialog>
  );
}
