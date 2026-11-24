"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { BUTTON_PRIMARY, FOCUS_RING } from "@/components/ui/classes";
import { Field } from "@/components/ui/Field";
import { FormAlert } from "@/components/ui/FormAlert";
import { readApiError, requestJson } from "@/lib/http/client";
import { formatVndText } from "@/lib/format/vnd";
import { SimulationResult } from "./SimulationResult";
import {
  financeCodeOf,
  parseCostInput,
  toRequestBody,
  validateSimulatorForm,
  type DateBounds,
  type SimulatorFormErrors,
  type SimulatorFormValues,
} from "./form";
import type { SimulationDto } from "./types";

export interface SimulatorFormProps {
  bounds: DateBounds;
  /** Current minimum reserve (decimal string), read-only here; edited in Settings. */
  reserveVnd: string;
}

export type Submitter = (body: unknown) => Promise<{ ok: boolean; status: number; json: unknown }>;

const defaultSubmit: Submitter = (body) => requestJson("POST", "/api/simulations/purchase", body);

export function SimulatorForm({ bounds, reserveVnd, submit = defaultSubmit }: SimulatorFormProps & { submit?: Submitter }) {
  const [values, setValues] = useState<SimulatorFormValues>({
    itemName: "",
    costText: "",
    buyNowDate: bounds.min,
    laterMode: "next_payday",
    laterDate: "",
  });
  const [errors, setErrors] = useState<SimulatorFormErrors>({});
  const [pending, setPending] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationDto | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const costDisplay = parseCostInput(values.costText).display;

  const set = <K extends keyof SimulatorFormValues>(key: K, value: SimulatorFormValues[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const found = validateSimulatorForm(values, bounds);
    setErrors(found);
    setApiError(null);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    setResult(null);
    try {
      const response = await submit(toRequestBody(values));
      if (response.ok) {
        setResult(response.json as SimulationDto);
        queueMicrotask(() => resultRef.current?.focus());
      } else {
        const error = readApiError(response.json, "Không thể mô phỏng lúc này. Vui lòng thử lại.");
        setApiError(error.message);
        // Payday unknown: the only way forward is to pick a date, so switch to the date picker.
        if (financeCodeOf(response.json) === "payday_unknown") set("laterMode", "date");
      }
    } catch {
      setApiError("Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-card border border-outline-variant bg-surface-container-lowest p-4" aria-busy={pending}>
        <Field
          id={`${uid}-name`}
          label="Tên món đồ (không bắt buộc)"
          value={values.itemName}
          maxLength={80}
          autoComplete="off"
          placeholder="Ví dụ: Bàn phím cơ"
          error={errors.itemName}
          onChange={(e) => set("itemName", e.target.value)}
        />
        <Field
          id={`${uid}-cost`}
          label="Số tiền (₫)"
          inputMode="numeric"
          autoComplete="off"
          placeholder="1.500.000"
          value={costDisplay}
          error={errors.cost}
          hint={costDisplay ? `${formatVndText(parseCostInput(values.costText).digits)}` : "Chỉ nhập số, ví dụ 1500000."}
          aria-required="true"
          onChange={(e) => set("costText", e.target.value)}
        />
        <Field
          id={`${uid}-now`}
          label="Ngày mua ngay"
          type="date"
          min={bounds.min}
          max={bounds.max}
          value={values.buyNowDate}
          error={errors.buyNowDate}
          onChange={(e) => set("buyNowDate", e.target.value)}
        />

        <fieldset className="space-y-2">
          <legend className="text-label-md text-on-surface">Mua sau vào</legend>
          <label className="flex min-h-[44px] items-center gap-3 text-body-lg text-on-surface">
            <input
              type="radio"
              name={`${uid}-later`}
              checked={values.laterMode === "next_payday"}
              onChange={() => set("laterMode", "next_payday")}
              className={`h-5 w-5 accent-primary ${FOCUS_RING}`}
            />
            Ngày nhận lương tiếp theo
          </label>
          <label className="flex min-h-[44px] items-center gap-3 text-body-lg text-on-surface">
            <input
              type="radio"
              name={`${uid}-later`}
              checked={values.laterMode === "date"}
              onChange={() => set("laterMode", "date")}
              className={`h-5 w-5 accent-primary ${FOCUS_RING}`}
            />
            Chọn một ngày
          </label>
          {values.laterMode === "date" ? (
            <Field
              id={`${uid}-later-date`}
              label="Ngày mua sau"
              type="date"
              min={bounds.min}
              max={bounds.max}
              value={values.laterDate}
              error={errors.laterDate}
              hint="Trong khoảng 45 ngày kể từ hôm nay."
              onChange={(e) => set("laterDate", e.target.value)}
            />
          ) : null}
        </fieldset>

        <p className="rounded-control bg-surface-container-low px-3 py-2 text-body-md text-on-surface-variant">
          Mức dự phòng tối thiểu hiện tại: <strong className="text-on-surface">{formatVndText(reserveVnd)}</strong>.{" "}
          <Link href="/settings" className={`font-semibold text-primary underline ${FOCUS_RING}`}>
            Thay đổi trong Cài đặt
          </Link>
        </p>

        <FormAlert message={apiError} />
        <button type="submit" className={`${BUTTON_PRIMARY} w-full sm:w-auto`} disabled={pending}>
          {pending ? "Đang mô phỏng…" : "Mô phỏng"}
        </button>
      </form>

      <div ref={resultRef} tabIndex={-1} className="outline-none">
        {result ? <SimulationResult result={result} /> : null}
      </div>
    </div>
  );
}
