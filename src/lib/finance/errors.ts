export type FinanceErrorCode =
  | "invalid_date"
  | "invalid_instant"
  | "invalid_amount"
  | "invalid_day_of_month"
  | "invalid_recurring_link"
  | "invalid_horizon"
  | "duplicate_transaction_id"
  | "snapshot_in_future"
  | "date_outside_horizon"
  | "buy_later_not_after_buy_now"
  | "payday_unknown";

/** Typed validation failure. API layers map `code` to a user-facing message. */
export class FinanceError extends Error {
  readonly code: FinanceErrorCode;

  constructor(code: FinanceErrorCode, message: string) {
    super(message);
    this.name = "FinanceError";
    this.code = code;
  }
}
