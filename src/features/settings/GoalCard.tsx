"use client";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { FormAlert } from "@/components/ui/FormAlert";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classes";
import { createSubmitGuard } from "@/lib/demo/guest-flow";
import { displayVnd, formatAmountInput } from "@/lib/format/money-input";
import { formatLocalDateVi } from "@/lib/format/vn-datetime";
import { browserFetch, type FetchLike } from "@/lib/http/api-call";
import type { GoalDto } from "@/lib/settings/dto";
import { deleteGoalApi, putGoalApi } from "./api";
import {
  buildGoalBody,
  emptyGoalValues,
  goalPercent,
  goalValuesFrom,
  mapGoalFailure,
  validateGoalForm,
  type GoalFormErrors,
  type GoalFormValues,
} from "./goal-form";
import { SettingsCard } from "./SettingsCard";
/** Progress bar with a text alternative: the numeric value is exposed through aria-valuenow. */
export function GoalProgress({ goal }: { goal: GoalDto }) {
  const percent = goalPercent(goal);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-body-lg text-on-surface">{goal.name}</p>
        <p className="font-mono text-mono-md text-on-surface">{percent}%</p>
      </div>
      <div
        role="progressbar"
        aria-label={`Tiến độ mục tiêu ${goal.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%, đã tiết kiệm ${displayVnd(goal.savedVnd)} trên ${displayVnd(goal.targetVnd)}`}
        className="mt-2 h-3 w-full overflow-hidden rounded-full bg-primary-container"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-body-md text-on-surface-variant">
        Đã tiết kiệm {displayVnd(goal.savedVnd)} / {displayVnd(goal.targetVnd)}
        {goal.reached ? ". Bạn đã đạt mục tiêu." : `. Còn thiếu ${displayVnd(goal.progress.remainingVnd)}.`}
      </p>
      <p className="text-body-sm text-on-surface-variant">
        {goal.targetDate ? `Hạn: ${formatLocalDateVi(goal.targetDate)}` : "Chưa đặt hạn."}
      </p>
    </div>
  );
}
function GoalFormDialog({
  goal,
  onClose,
  onSaved,
  fetchImpl,
}: {
  goal: GoalDto | null;
  onClose: () => void;
  onSaved: (goal: GoalDto, created: boolean) => void;
  fetchImpl: FetchLike;
}) {
  const [now] = useState(() => new Date());
  const original = useMemo(() => (goal ? goalValuesFrom(goal) : emptyGoalValues()), [goal]);
  const guard = useRef(createSubmitGuard()).current;
  const [values, setValues] = useState<GoalFormValues>(original);
  const [errors, setErrors] = useState<GoalFormErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof GoalFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!guard.tryEnter()) return;
    setGeneral(null);
    const found = validateGoalForm(values, now, goal?.targetDate ?? null);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setGeneral("Vui lòng kiểm tra các trường được đánh dấu.");
      guard.leave();
      return;
    }
    setPending(true);
    const res = await putGoalApi(fetchImpl, buildGoalBody(values));
    setPending(false);
    guard.leave();
    if (res.ok) {
      onSaved(res.data.goal, goal === null);
      return;
    }
    const mapped = mapGoalFailure(res);
    setErrors(mapped.fieldErrors);
    setGeneral(mapped.general ?? "Vui lòng kiểm tra các trường được đánh dấu.");
  }
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!pending}
      title={goal ? "Sửa mục tiêu tiết kiệm" : "Tạo mục tiêu tiết kiệm"}
      description="Bạn có một mục tiêu tiết kiệm tại một thời điểm."
    >
      <form onSubmit={(e) => void submit(e)} noValidate aria-busy={pending} className="flex flex-col gap-4">
        <FormAlert message={general} />
        <Field id="goal-name" label="Tên mục tiêu" maxLength={100} autoComplete="off" value={values.name} onChange={(e) => set("name", e.target.value)} error={errors.name} disabled={pending} />
        <Field id="goal-target" label="Số tiền mục tiêu (₫)" inputMode="numeric" autoComplete="off" value={values.target} onChange={(e) => set("target", formatAmountInput(e.target.value))} error={errors.target} disabled={pending} />
        <Field id="goal-saved" label="Đã tiết kiệm (₫)" inputMode="numeric" autoComplete="off" value={values.saved} onChange={(e) => set("saved", formatAmountInput(e.target.value))} error={errors.saved} disabled={pending} />
        <Field id="goal-date" label="Hạn hoàn thành (không bắt buộc)" type="date" value={values.targetDate} onChange={(e) => set("targetDate", e.target.value)} error={errors.targetDate} disabled={pending} />
        <div className="flex flex-col gap-2">
          <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
            {pending ? "Đang lưu…" : "Lưu mục tiêu"}
          </button>
          <button type="button" disabled={pending} onClick={onClose} className={BUTTON_SECONDARY}>
            Hủy
          </button>
        </div>
      </form>
    </Dialog>
  );
}
/** Exactly one savings goal: create when none exists, otherwise edit or remove. There is no way to add a second. */
export function GoalCard({
  goal,
  onChanged,
  fetchImpl = browserFetch,
}: {
  goal: GoalDto | null;
  onChanged: (goal: GoalDto | null, message: string) => void;
  fetchImpl?: FetchLike;
}) {
  const guard = useRef(createSubmitGuard()).current;
  const [formOpen, setFormOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (!guard.tryEnter()) return;
    setPending(true);
    setError(null);
    const res = await deleteGoalApi(fetchImpl);
    setPending(false);
    guard.leave();
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setConfirmRemove(false);
    onChanged(null, "Đã xóa mục tiêu tiết kiệm.");
  }
  return (
    <SettingsCard
      id="settings-goal"
      title="Mục tiêu tiết kiệm"
      description="Mỗi người dùng có một mục tiêu tiết kiệm."
    >
      {goal ? (
        <>
          <GoalProgress goal={goal} />
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setFormOpen(true)} className={BUTTON_SECONDARY}>
              Sửa mục tiêu
            </button>
            <button type="button" onClick={() => { setError(null); setConfirmRemove(true); }} className={BUTTON_SECONDARY}>
              Xóa mục tiêu
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-body-md text-on-surface-variant">
            Bạn chưa có mục tiêu tiết kiệm. Đặt một mục tiêu như mua laptop hay quỹ dự phòng để theo dõi tiến độ.
          </p>
          <button type="button" onClick={() => setFormOpen(true)} className={`${BUTTON_PRIMARY} mt-4`}>
            Tạo mục tiêu
          </button>
        </>
      )}
      {formOpen ? (
        <GoalFormDialog
          goal={goal}
          fetchImpl={fetchImpl}
          onClose={() => setFormOpen(false)}
          onSaved={(saved, created) => {
            setFormOpen(false);
            onChanged(saved, created ? "Đã tạo mục tiêu tiết kiệm." : "Đã lưu mục tiêu tiết kiệm.");
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirmRemove}
        title="Xóa mục tiêu tiết kiệm?"
        description="Mục tiêu và tiến độ hiện tại sẽ bị xóa. Giao dịch của bạn không bị ảnh hưởng."
        confirmLabel="Xóa mục tiêu"
        pendingLabel="Đang xóa…"
        cancelLabel="Giữ lại"
        pending={pending}
        error={error}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </SettingsCard>
  );
}
