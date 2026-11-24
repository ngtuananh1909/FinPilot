"use client";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Field } from "@/components/ui/Field";
import { FormAlert } from "@/components/ui/FormAlert";
import { BUTTON_PRIMARY } from "@/components/ui/classes";
import { createSubmitGuard } from "@/lib/demo/guest-flow";
import { formatAmountInput } from "@/lib/format/money-input";
import { browserFetch, type FetchLike } from "@/lib/http/api-call";
import type { ProfileDto } from "@/lib/settings/dto";
import type { ProfileWriteResult } from "@/lib/settings/service";
import { patchProfileApi } from "./api";
import {
  buildProfilePatch,
  profileValuesFrom,
  summarizeChanges,
  validateProfileForm,
  type ProfileFormErrors,
  type ProfileFormValues,
} from "./profile-form";
import { SettingsCard } from "./SettingsCard";
const FIELD_FROM_API: Record<string, keyof ProfileFormValues> = {
  displayName: "displayName",
  paydayDay: "paydayDay",
  expectedMonthlyIncomeVnd: "expectedMonthlyIncome",
  expectedDailyExpenseVnd: "expectedDailyExpense",
  projectedMonthlyBudgetVnd: "projectedMonthlyBudget",
  minimumReserveVnd: "minimumReserve",
};
/** Profile and forecast assumptions. Mount with `key={profile.updatedAt}` so a saved profile resets the form. */
export function ProfileCard({
  profile,
  onSaved,
  fetchImpl = browserFetch,
}: {
  profile: ProfileDto;
  onSaved: (result: ProfileWriteResult) => void;
  fetchImpl?: FetchLike;
}) {
  const original = useMemo(() => profileValuesFrom(profile), [profile]);
  const guard = useRef(createSubmitGuard()).current;
  const [values, setValues] = useState<ProfileFormValues>(original);
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const changes = useMemo(() => summarizeChanges(values, original), [values, original]);
  const set = (key: keyof ProfileFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setMessage(null);
  };
  const money = (key: keyof ProfileFormValues) => (value: string) => set(key, formatAmountInput(value));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!guard.tryEnter()) return;
    const found = validateProfileForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setMessage({ tone: "error", text: "Vui lòng kiểm tra các trường được đánh dấu." });
      guard.leave();
      return;
    }
    const patch = buildProfilePatch(values, original);
    if (patch === null) {
      setMessage({ tone: "info", text: "Bạn chưa thay đổi gì." });
      guard.leave();
      return;
    }
    setPending(true);
    const res = await patchProfileApi(fetchImpl, patch);
    setPending(false);
    guard.leave();
    if (res.ok) {
      onSaved(res.data);
      return;
    }
    const key = res.field ? FIELD_FROM_API[res.field] : undefined;
    if (key && res.code === "validation_failed") setErrors({ [key]: res.message });
    setMessage({ tone: "error", text: res.message });
  }
  return (
    <SettingsCard
      id="settings-profile"
      title="Hồ sơ và giả định dự báo"
      description="Các con số này giúp dự báo 45 ngày. Thay đổi có hiệu lực ngay cho Trang chủ và Mô phỏng."
    >
      <form onSubmit={(e) => void submit(e)} noValidate aria-busy={pending} className="flex flex-col gap-4">
        <FormAlert message={message?.text} tone={message?.tone ?? "info"} />
        <Field
          id="set-name"
          label="Tên hiển thị"
          maxLength={80}
          autoComplete="nickname"
          value={values.displayName}
          onChange={(e) => set("displayName", e.target.value)}
          error={errors.displayName}
          disabled={pending}
        />
        <Field
          id="set-payday"
          label="Ngày nhận lương (1 đến 31)"
          inputMode="numeric"
          autoComplete="off"
          value={values.paydayDay}
          onChange={(e) => set("paydayDay", e.target.value.replace(/\D/g, "").slice(0, 2))}
          hint="Để trống nếu thu nhập không cố định."
          error={errors.paydayDay}
          disabled={pending}
        />
        <Field
          id="set-income"
          label="Thu nhập dự kiến mỗi tháng (₫)"
          inputMode="numeric"
          autoComplete="off"
          value={values.expectedMonthlyIncome}
          onChange={(e) => money("expectedMonthlyIncome")(e.target.value)}
          error={errors.expectedMonthlyIncome}
          disabled={pending}
        />
        <Field
          id="set-daily"
          label="Chi tiêu ước tính mỗi ngày (₫)"
          inputMode="numeric"
          autoComplete="off"
          value={values.expectedDailyExpense}
          onChange={(e) => money("expectedDailyExpense")(e.target.value)}
          hint="Chỉ tính chi tiêu linh hoạt như ăn uống, đi lại. Khoản cố định hãy thêm ở mục định kỳ."
          error={errors.expectedDailyExpense}
          disabled={pending}
        />
        <Field
          id="set-budget"
          label="Ngân sách dự kiến mỗi tháng (₫)"
          inputMode="numeric"
          autoComplete="off"
          value={values.projectedMonthlyBudget}
          onChange={(e) => money("projectedMonthlyBudget")(e.target.value)}
          error={errors.projectedMonthlyBudget}
          disabled={pending}
        />
        <Field
          id="set-reserve"
          label="Mức dự phòng tối thiểu (₫)"
          inputMode="numeric"
          autoComplete="off"
          value={values.minimumReserve}
          onChange={(e) => money("minimumReserve")(e.target.value)}
          hint="Số dư bạn không muốn để xuống thấp hơn. Mô phỏng mua sắm dùng mức này để đánh giá an toàn."
          error={errors.minimumReserve}
          disabled={pending}
        />
        <div aria-live="polite">
          {changes.length > 0 ? (
            <div className="rounded-control bg-surface-container-low px-4 py-3">
              <p className="text-label-md text-on-surface">Thay đổi chưa lưu</p>
              <ul className="mt-1 space-y-1 text-body-md text-on-surface-variant">
                {changes.map((c) => (
                  <li key={c.label}>
                    {c.label}: {c.from} → <span className="font-semibold text-on-surface">{c.to}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          {pending ? "Đang lưu…" : "Lưu thay đổi"}
        </button>
      </form>
    </SettingsCard>
  );
}
