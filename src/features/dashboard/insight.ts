import type { Alert, AlertSeverity } from "@/lib/alerts";
import { formatShortDate } from "@/lib/format/date-vi";

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: "Cần chú ý ngay",
  warning: "Cảnh báo",
  info: "Lưu ý",
};

const MAX_QUESTION_LENGTH = 300;

/** Link to the Assistant with a prefilled question (`?q=`). No AI call happens here. */
export function assistantHref(question: string): string {
  return `/assistant?q=${encodeURIComponent(capQuestion(question))}`;
}

/**
 * Caps by code points and replaces lone surrogates: `slice` by UTF-16 units can cut an emoji in
 * half, and encodeURIComponent throws URIError on a lone surrogate (which would crash the page).
 */
function capQuestion(question: string): string {
  const wellFormed = question.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
  return Array.from(wellFormed).slice(0, MAX_QUESTION_LENGTH).join("");
}

export const DEFAULT_QUESTION = "Tình hình dòng tiền 45 ngày tới của tôi thế nào?";

/** The question the user would most plausibly ask about this alert. */
export function questionForAlert(alert: Alert): string {
  const date = alert.date ? formatShortDate(alert.date) : "";
  switch (alert.code) {
    case "negative_balance":
      return `Vì sao số dư của tôi có thể xuống âm từ ${date} và tôi nên làm gì?`;
    case "month_end_negative":
      return "Vì sao cuối tháng số dư của tôi có thể bị âm và tôi nên làm gì?";
    case "reserve_breach":
      return `Số dư của tôi có thể xuống dưới mức dự phòng từ ${date}. Tôi nên điều chỉnh thế nào?`;
    case "bill_due_soon":
      return "Tôi có đủ tiền cho các khoản định kỳ sắp đến hạn không?";
    case "unusual_spending":
      return "Tại sao chi tiêu 7 ngày qua của tôi cao hơn 30 ngày trước?";
  }
}
