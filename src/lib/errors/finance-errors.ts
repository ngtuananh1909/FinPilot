import type { FinanceError, FinanceErrorCode } from "@/lib/finance";
import { AppError } from "./app-error";

const FINANCE_MESSAGES: Record<FinanceErrorCode, string> = {
  invalid_date: "Ngày không hợp lệ.",
  invalid_instant: "Thời điểm không hợp lệ.",
  invalid_amount: "Số tiền không hợp lệ. Vui lòng nhập số nguyên VND.",
  invalid_day_of_month: "Ngày trong tháng không hợp lệ.",
  invalid_recurring_link: "Liên kết khoản định kỳ không hợp lệ.",
  invalid_horizon: "Khoảng dự báo không hợp lệ.",
  duplicate_transaction_id: "Có giao dịch bị trùng mã.",
  snapshot_in_future: "Thời điểm số dư không được nằm trong tương lai.",
  date_outside_horizon: "Ngày nằm ngoài khoảng dự báo 45 ngày.",
  buy_later_not_after_buy_now: "Ngày mua sau phải muộn hơn ngày mua ngay.",
  payday_unknown: "Chưa xác định được ngày nhận lương. Vui lòng cập nhật trong Cài đặt.",
};

/** Maps a FinanceError to an AppError. Only the stable code is exposed, never the raw message. */
export function financeErrorToAppError(error: FinanceError): AppError {
  return new AppError("finance_invalid_input", {
    userMessage: FINANCE_MESSAGES[error.code],
    safeDetails: { financeCode: error.code },
    cause: error,
  });
}
