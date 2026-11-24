"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { FormAlert } from "@/components/ui/FormAlert";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classes";
import { createSubmitGuard } from "@/lib/demo/guest-flow";
import { requestJson } from "@/lib/http/client";
import {
  bootstrapProfileRequest,
  submitBalanceStep,
  submitProfileStep,
  validateBalanceStep,
  validateProfileStep,
  type BalanceStepValues,
  type OnboardingHttp,
  type ProfileStepValues,
  type StepErrors,
} from "@/lib/onboarding/form";

const http: OnboardingHttp = {
  post: (url, body) => requestJson("POST", url, body),
  patch: (url, body) => requestJson("PATCH", url, body),
};

type Prepare = "ready" | "running" | "failed";

export function OnboardingWizard({ profileExists }: { profileExists: boolean }) {
  const router = useRouter();
  const guard = useRef(createSubmitGuard()).current;
  const started = useRef(false);
  const [prepare, setPrepare] = useState<Prepare>(profileExists ? "ready" : "running");
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceStepValues>({ balance: "" });
  const [balanceErrors, setBalanceErrors] = useState<StepErrors<BalanceStepValues>>({});
  const [profile, setProfile] = useState<ProfileStepValues>({
    paydayDay: "",
    expectedMonthlyIncome: "",
    expectedDailyExpense: "",
    minimumReserve: "",
  });
  const [profileErrors, setProfileErrors] = useState<StepErrors<ProfileStepValues>>({});

  const runBootstrap = useCallback(async () => {
    setPrepare("running");
    setPrepareError(null);
    const result = await bootstrapProfileRequest(http);
    if (result.ok) setPrepare("ready");
    else {
      setPrepare("failed");
      setPrepareError(result.message);
    }
  }, []);

  useEffect(() => {
    if (profileExists || started.current) return;
    started.current = true;
    void runBootstrap();
  }, [profileExists, runBootstrap]);

  async function onBalance(event: FormEvent) {
    event.preventDefault();
    if (prepare !== "ready" || !guard.tryEnter()) return;
    const errors = validateBalanceStep(balance);
    setBalanceErrors(errors);
    setMessage(null);
    if (Object.keys(errors).length === 0) {
      setPending(true);
      const result = await submitBalanceStep(http, balance);
      if (result.ok) setStep(2);
      else setMessage(result.message);
      setPending(false);
    }
    guard.leave();
  }

  async function onProfile(event: FormEvent) {
    event.preventDefault();
    if (prepare !== "ready" || !guard.tryEnter()) return;
    const errors = validateProfileStep(profile);
    setProfileErrors(errors);
    setMessage(null);
    if (Object.keys(errors).length === 0) {
      setPending(true);
      const result = await submitProfileStep(http, profile);
      if (result.ok) {
        router.push("/dashboard");
        return; // stay disabled while navigating
      }
      setMessage(result.message);
      setPending(false);
    }
    guard.leave();
  }

  const skip = () => router.push("/dashboard");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-label-md text-primary" aria-live="polite">
        Bước {step}/2
      </p>

      {prepare === "running" ? (
        <p role="status" className="text-body-md text-on-surface-variant">
          Đang chuẩn bị hồ sơ của bạn…
        </p>
      ) : null}
      {prepare === "failed" ? (
        <div className="flex flex-col gap-2">
          <FormAlert message={prepareError} />
          <button type="button" onClick={() => void runBootstrap()} className={BUTTON_SECONDARY}>
            Thử lại
          </button>
        </div>
      ) : null}

      {step === 1 ? (
        <form onSubmit={onBalance} noValidate aria-busy={pending} className="flex flex-col gap-4">
          <FormAlert message={message} />
          <Field
            id="onb-balance"
            label="Số dư hiện tại (₫)"
            inputMode="numeric"
            autoComplete="off"
            placeholder="4.850.000"
            value={balance.balance}
            onChange={(e) => setBalance({ balance: e.target.value })}
            hint="Tổng tiền bạn đang có ngay lúc này. Số dư được ghi nhận tại thời điểm bạn bấm Tiếp tục; các giao dịch trước đó không được cộng lại."
            error={balanceErrors.balance}
            disabled={pending || prepare !== "ready"}
          />
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button type="submit" disabled={pending || prepare !== "ready"} className={BUTTON_PRIMARY}>
              {pending ? "Đang lưu…" : "Tiếp tục"}
            </button>
            <button type="button" onClick={skip} disabled={pending} className={BUTTON_SECONDARY}>
              Bỏ qua, thiết lập sau
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={onProfile} noValidate aria-busy={pending} className="flex flex-col gap-4">
          <FormAlert message={message} />
          <Field
            id="onb-payday"
            label="Ngày nhận lương (1 đến 31)"
            inputMode="numeric"
            autoComplete="off"
            placeholder="5"
            value={profile.paydayDay}
            onChange={(e) => setProfile({ ...profile, paydayDay: e.target.value })}
            hint="Có thể để trống nếu thu nhập không cố định."
            error={profileErrors.paydayDay}
            disabled={pending}
          />
          <Field
            id="onb-income"
            label="Thu nhập dự kiến mỗi tháng (₫)"
            inputMode="numeric"
            autoComplete="off"
            placeholder="12.000.000"
            value={profile.expectedMonthlyIncome}
            onChange={(e) => setProfile({ ...profile, expectedMonthlyIncome: e.target.value })}
            error={profileErrors.expectedMonthlyIncome}
            disabled={pending}
          />
          <Field
            id="onb-daily"
            label="Chi tiêu ước tính mỗi ngày (₫)"
            inputMode="numeric"
            autoComplete="off"
            placeholder="150.000"
            value={profile.expectedDailyExpense}
            onChange={(e) => setProfile({ ...profile, expectedDailyExpense: e.target.value })}
            hint="Chỉ tính các khoản chi linh hoạt như ăn uống, đi lại. Khoản cố định có thể thêm sau."
            error={profileErrors.expectedDailyExpense}
            disabled={pending}
          />
          <Field
            id="onb-reserve"
            label="Mức dự phòng tối thiểu (₫)"
            inputMode="numeric"
            autoComplete="off"
            placeholder="2.000.000"
            value={profile.minimumReserve}
            onChange={(e) => setProfile({ ...profile, minimumReserve: e.target.value })}
            hint="Số dư bạn không muốn để xuống thấp hơn. Dự báo sẽ cảnh báo khi gần chạm mức này."
            error={profileErrors.minimumReserve}
            disabled={pending}
          />
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
              {pending ? "Đang lưu…" : "Hoàn tất"}
            </button>
            <button type="button" onClick={skip} disabled={pending} className={BUTTON_SECONDARY}>
              Bỏ qua, thiết lập sau
            </button>
          </div>
        </form>
      )}
      <p className="text-body-sm text-on-surface-variant">
        Nếu bỏ qua, dự báo sẽ hiển thị trạng thái chưa đủ dữ liệu cho đến khi bạn bổ sung trong Cài đặt.
      </p>
    </div>
  );
}
