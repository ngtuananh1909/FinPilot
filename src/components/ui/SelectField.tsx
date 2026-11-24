import type { SelectHTMLAttributes } from "react";
import { INPUT } from "./classes";
interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className" | "children"> {
  id: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
  error?: string | undefined;
  hint?: string | undefined;
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean;
}
/** Label + native select with the same hint/error wiring as Field. */
export function SelectField({ id, label, options, error, hint, hideLabel = false, ...select }: SelectFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-label-md text-on-surface"}>
        {label}
      </label>
      <select
        id={id}
        {...select}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${INPUT} ${error ? "border-error" : ""}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={hintId} className="text-body-sm text-on-surface-variant">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
