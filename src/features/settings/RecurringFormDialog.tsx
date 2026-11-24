"use client";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { FormAlert } from "@/components/ui/FormAlert";
import { SelectField } from "@/components/ui/SelectField";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classes";
import { categoryOptions } from "@/features/transactions/labels";
import { createSubmitGuard } from "@/lib/demo/guest-flow";
import { formatAmountInput } from "@/lib/format/money-input";
import { browserFetch, type FetchLike } from "@/lib/http/api-call";
import type { RecurringDto } from "@/lib/transactions/dto";
import { createRecurringApi, updateRecurringApi } from "./api";
import {
  buildRecurringCreateBody,
  buildRecurringPatchBody,
  emptyRecurringValues,
  mapRecurringFailure,
  recurringValuesFrom,
  validateRecurringForm,
  type RecurringFormErrors,
  type RecurringFormValues,
} from "./recurring-form";
/** Add or edit a recurring item. Mount only while open. There is no delete: items are deactivated from the list. */
export function RecurringFormDialog({
  item,
  onClose,
  onSaved,
  fetchImpl = browserFetch,
}: {
  item?: RecurringDto | undefined;
  onClose: () => void;
  onSaved: (item: RecurringDto, mode: "create" | "edit") => void;
  fetchImpl?: FetchLike;
}) {
  const mode = item ? "edit" : "create";
  const [now] = useState(() => new Date());
  const original = useMemo(() => (item ? recurringValuesFrom(item) : emptyRecurringValues(now)), [item, now]);
  const guard = useRef(createSubmitGuard()).current;
  const [values, setValues] = useState<RecurringFormValues>(original);
  const [errors, setErrors] = useState<RecurringFormErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = <K extends keyof RecurringFormValues>(key: K, value: RecurringFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!guard.tryEnter()) return;
    setGeneral(null);
    const found = validateRecurringForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setGeneral("Vui lòng kiểm tra các trường được đánh dấu.");
      guard.leave();
      return;
    }
    let body: Record<string, unknown> | null;
    try {
      body = mode === "create" ? buildRecurringCreateBody(values) : buildRecurringPatchBody(values, original);
    } catch {
      setGeneral("Dữ liệu chưa hợp lệ.");
      guard.leave();
      return;
    }
    if (body === null || !(mode === "create" || item)) {
      setGeneral("Bạn chưa thay đổi gì.");
      guard.leave();
      return;
    }
    setPending(true);
    const res = item ? await updateRecurringApi(fetchImpl, item.id, body) : await createRecurringApi(fetchImpl, body);
    setPending(false);
    guard.leave();
    if (res.ok) {
      onSaved(res.data.item, mode);
      return;
    }
    const mapped = mapRecurringFailure(res);
    setErrors(mapped.fieldErrors);
    setGeneral(mapped.general ?? "Vui lòng kiểm tra các trường được đánh dấu.");
  }
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!pending}
      title={mode === "create" ? "Thêm khoản định kỳ" : "Sửa khoản định kỳ"}
      description="Khoản lặp lại hằng tháng như tiền trọ, lương, gói internet."
    >
      <form onSubmit={(e) => void submit(e)} noValidate aria-busy={pending} className="flex flex-col gap-4">
        <FormAlert message={general} />
        <Field
          id="rec-label"
          label="Tên khoản"
          maxLength={100}
          autoComplete="off"
          value={values.label}
          onChange={(e) => set("label", e.target.value)}
          error={errors.label}
          disabled={pending}
        />
        <SelectField
          id="rec-kind"
          label="Loại"
          value={values.kind}
          options={[
            { value: "expense", label: "Chi (tiền ra)" },
            { value: "income", label: "Thu (tiền vào)" },
          ]}
          onChange={(e) => set("kind", e.target.value as RecurringFormValues["kind"])}
          error={errors.kind}
          disabled={pending}
        />
        <Field
          id="rec-amount"
          label="Số tiền mỗi kỳ (₫)"
          inputMode="numeric"
          autoComplete="off"
          value={values.amount}
          onChange={(e) => set("amount", formatAmountInput(e.target.value))}
          error={errors.amount}
          disabled={pending}
        />
        <Field
          id="rec-day"
          label="Ngày trong tháng (1 đến 31)"
          inputMode="numeric"
          autoComplete="off"
          value={values.dayOfMonth}
          onChange={(e) => set("dayOfMonth", e.target.value.replace(/\D/g, "").slice(0, 2))}
          hint="Tháng không có ngày này sẽ dùng ngày cuối tháng."
          error={errors.dayOfMonth}
          disabled={pending}
        />
        <SelectField
          id="rec-category"
          label="Danh mục"
          value={values.category}
          options={categoryOptions(original.category)}
          onChange={(e) => set("category", e.target.value)}
          error={errors.category}
          disabled={pending}
        />
        <Field
          id="rec-start"
          label="Bắt đầu từ ngày"
          type="date"
          value={values.startDate}
          onChange={(e) => set("startDate", e.target.value)}
          error={errors.startDate}
          disabled={pending}
        />
        <Field
          id="rec-end"
          label="Kết thúc vào ngày (không bắt buộc)"
          type="date"
          value={values.endDate}
          onChange={(e) => set("endDate", e.target.value)}
          error={errors.endDate}
          disabled={pending}
        />
        <div className="flex flex-col gap-2">
          <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
            {pending ? "Đang lưu…" : "Lưu khoản định kỳ"}
          </button>
          <button type="button" disabled={pending} onClick={onClose} className={BUTTON_SECONDARY}>
            Hủy
          </button>
        </div>
      </form>
    </Dialog>
  );
}
