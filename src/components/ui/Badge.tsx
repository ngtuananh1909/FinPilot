import type { ReactNode } from "react";
export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "error";
const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-container text-on-surface-variant",
  primary: "bg-primary-container text-on-primary-container",
  success: "bg-success-container text-on-success-container",
  warning: "bg-warning-container text-on-warning-container",
  error: "bg-error-container text-on-error-container",
};
/** Small status pill. Always carries text, so meaning never depends on color alone. */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-md ${TONE[tone]}`}>{children}</span>
  );
}
