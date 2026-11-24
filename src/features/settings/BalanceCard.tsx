"use client";
import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { FormAlert } from "@/components/ui/FormAlert";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classes";
import { createSubmitGuard } from "@/lib/demo/guest-flow";
import { displayDeltaVnd, displayVnd, formatAmountInput } from "@/lib/format/money-input";
import { formatDateTimeVi } from "@/lib/format/vn-datetime";
import { browserFetch, type FetchLike } from "@/lib/http/api-call";
import type { ProfileDto } from "@/lib/settings/dto";
import type { BalanceSnapshotResult } from "@/lib/settings/service";
import { setBalanceSnapshotApi } from "./api";
import { BALANCE_ANCHOR_EXPLANATION, buildBalanceBody } from "./balance";
import { SettingsCard } from "./SettingsCard";
type Step = "enter" | "confirm" | "done";
export function BalanceResult({ result }: { result: BalanceSnapshotResult }) {
  return (
    <div className="space-y-3">
      <p role="status" className="rounded-control bg-success-container px-4 py-3 text-body-md text-on-success-container">
        Đã đặt số dư mới: <strong>{displayVnd(result.profile.balanceSnapshot.amountVnd)}</strong>.
      </p>
      <dl className="space-y-2 text-body-md">
        <div className="flex justify-between gap-3">
          <dt className="text-on-surface-variant">Số dư trước đó</dt>
          <dd className="text-right text-on-surface">
            {displayVnd(result.previousSnapshot.amountVnd)} ({formatDateTimeVi(result.previousSnapshot.at)})
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-on-surface-variant">Chênh lệch</dt>
          <dd className="text-right text-on-surface">{displayDeltaVnd(result.deltaVnd)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-on-surface-variant">Ghi nhận lúc</dt>
          <dd className="text-right text-on-surface">{formatDateTimeVi(result.profile.balanceSnapshot.at)}</dd>
        </div>
      </dl>
      <p className="text-body-sm text-on-surface-variant">
        Các giao dịch trước thời điểm này không được cộng lại vào số dư mới.
      </p>
    </div>
  );
}
/** Confirmation step: states the new amount against the current one. The submit button lives only here. */
export function BalanceConfirmStep({
  profile,
  amountText,
  pending,
  error,
  onConfirm,
  onBack,
}: {
  profile: ProfileDto;
  amountText: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const built = buildBalanceBody(amountText);
  return (
    <div className="space-y-4">
      <FormAlert message={error} />
      <p className="text-body-md text-on-surface">
        Đặt số dư thành{" "}
        <strong>{built.ok ? displayVnd(built.body.amountVnd) : "—"}</strong> (hiện tại{" "}
        {displayVnd(profile.balanceSnapshot.amountVnd)}, ghi nhận {formatDateTimeVi(profile.balanceSnapshot.at)}).
      </p>
      <p className="rounded-control bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
        {BALANCE_ANCHOR_EXPLANATION}
      </p>
      <div className="flex flex-col gap-2">
        <button type="button" disabled={pending || !built.ok} onClick={onConfirm} className={BUTTON_PRIMARY}>
          {pending ? "Đang lưu…" : "Xác nhận đặt số dư mới"}
        </button>
        <button type="button" disabled={pending} onClick={onBack} className={BUTTON_SECONDARY}>
          Quay lại
        </button>
      </div>
    </div>
  );
}
function BalanceDialog({
  profile,
  onClose,
  onDone,
  fetchImpl,
}: {
  profile: ProfileDto;
  onClose: () => void;
  onDone: (result: BalanceSnapshotResult) => void;
  fetchImpl: FetchLike;
}) {
  const guard = useRef(createSubmitGuard()).current;
  const [step, setStep] = useState<Step>("enter");
  const [amountText, setAmountText] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<BalanceSnapshotResult | null>(null);
  function next() {
    const built = buildBalanceBody(amountText);
    if (!built.ok) {
      setFieldError(built.message);
      return;
    }
    setFieldError(undefined);
    setStep("confirm");
  }
  async function confirm() {
    const built = buildBalanceBody(amountText);
    if (!built.ok || !guard.tryEnter()) return;
    setPending(true);
    setError(null);
    const res = await setBalanceSnapshotApi(fetchImpl, built.body);
    setPending(false);
    guard.leave();
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setResult(res.data);
    setStep("done");
    onDone(res.data);
  }
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!pending}
      title="Đặt số dư hiện tại mới"
      description="Dùng khi số dư thực tế của bạn khác với số dư ứng dụng đang tính."
    >
      {step === "enter" ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
          className="flex flex-col gap-4"
        >
          <Field
            id="bal-amount"
            label="Số dư thực tế bây giờ (₫)"
            inputMode="numeric"
            autoComplete="off"
            placeholder="4.850.000"
            value={amountText}
            onChange={(e) => {
              setAmountText(formatAmountInput(e.target.value, { allowNegative: true }));
              setFieldError(undefined);
            }}
            hint="Có thể nhập số âm nếu tài khoản đang âm."
            error={fieldError}
          />
          <p className="text-body-sm text-on-surface-variant">{BALANCE_ANCHOR_EXPLANATION}</p>
          <div className="flex flex-col gap-2">
            <button type="submit" className={BUTTON_PRIMARY}>
              Tiếp tục
            </button>
            <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
              Hủy
            </button>
          </div>
        </form>
      ) : null}
      {step === "confirm" ? (
        <BalanceConfirmStep
          profile={profile}
          amountText={amountText}
          pending={pending}
          error={error}
          onConfirm={() => void confirm()}
          onBack={() => setStep("enter")}
        />
      ) : null}
      {step === "done" && result ? (
        <div className="space-y-4">
          <BalanceResult result={result} />
          <button type="button" onClick={onClose} className={BUTTON_PRIMARY}>
            Xong
          </button>
        </div>
      ) : null}
    </Dialog>
  );
}
/** Current balance anchor with an explicit, two-step action to replace it. */
export function BalanceCard({
  profile,
  onChanged,
  fetchImpl = browserFetch,
}: {
  profile: ProfileDto;
  onChanged: (result: BalanceSnapshotResult) => void;
  fetchImpl?: FetchLike;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SettingsCard
      id="settings-balance"
      title="Số dư hiện tại"
      description="Mốc số dư dùng để tính số dư ước tính và dự báo."
    >
      <p className="font-mono text-headline-md text-on-surface">{displayVnd(profile.balanceSnapshot.amountVnd)}</p>
      <p className="mt-1 text-body-md text-on-surface-variant">
        Ghi nhận lúc {formatDateTimeVi(profile.balanceSnapshot.at)} (giờ Việt Nam)
      </p>
      <button type="button" onClick={() => setOpen(true)} className={`${BUTTON_SECONDARY} mt-4`}>
        Đặt số dư mới…
      </button>
      {open ? (
        <BalanceDialog profile={profile} fetchImpl={fetchImpl} onClose={() => setOpen(false)} onDone={onChanged} />
      ) : null}
    </SettingsCard>
  );
}
