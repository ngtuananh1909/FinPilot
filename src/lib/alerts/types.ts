import type { FinanceTransaction, Forecast } from "@/lib/finance";

export type AlertCode =
  | "negative_balance"
  | "month_end_negative"
  | "reserve_breach"
  | "bill_due_soon"
  | "unusual_spending";

export type AlertSeverity = "info" | "warning" | "critical";

/** Wire-safe alert: no bigint. Amounts inside `evidence` are decimal strings. */
export interface Alert {
  code: AlertCode;
  severity: AlertSeverity;
  title: string;
  /** Vietnamese text with the concrete numbers and the sample size. */
  body: string;
  /** Why the number may be wrong. Always present. */
  caveat: string;
  /** Local date (YYYY-MM-DD) the alert refers to, if any. */
  date: string | null;
  evidence: Record<string, string | number>;
}

/** Visible explanation when a rule could not run because the data is too thin. */
export interface AlertNote {
  code: "unusual_spending_insufficient_data";
  message: string;
}

export interface AlertsResult {
  alerts: Alert[];
  notes: AlertNote[];
}

export interface AlertInput {
  forecast: Forecast;
  /** Posted and future-dated transactions (the same list given to the forecast). */
  transactions: readonly FinanceTransaction[];
  /** Recurring item id -> label, used to name bills in the text. */
  recurringLabels?: ReadonlyMap<string, string>;
  /** Injected clock. The rules never read the system time. */
  now: Date;
}
