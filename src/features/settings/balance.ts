import { parseAmountField } from "@/lib/format/money-input";
export type BalanceBodyResult = { ok: true; body: { amountVnd: string; confirm: true } } | { ok: false; message: string };
/**
 * Body for POST /api/settings/balance-snapshot. `confirm: true` is only ever added here, which is
 * called from the final confirmation step; the amount may be negative (overdraft).
 */
export function buildBalanceBody(amountText: string): BalanceBodyResult {
  const parsed = parseAmountField(amountText, "signed", "Số dư");
  if (!parsed.ok) return parsed;
  return { ok: true, body: { amountVnd: parsed.value, confirm: true } };
}
export const BALANCE_ANCHOR_EXPLANATION =
  "Số dư mới trở thành mốc tính toán mới, được ghi nhận vào thời điểm bạn xác nhận. Các giao dịch có ngày trước thời điểm này vẫn được lưu để xem lịch sử nhưng KHÔNG được cộng lại vào số dư.";
