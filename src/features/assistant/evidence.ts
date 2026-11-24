import { formatVndText } from "@/lib/format/vnd";

/** Shape returned by POST /api/assistant/chat (see src/lib/assistant/chat.ts). */
export interface ToolEvidence {
  name: string;
  args: unknown;
  ok: boolean;
  error: string | null;
  result: unknown;
  cached: boolean;
}

export interface ProposalView {
  id: string;
  kind: "budget_update" | "goal_update";
  status: "pending" | "approved" | "rejected" | "expired";
  expiresAt: string;
  reason: string;
  changes: Array<{ field: string; label: string; from: string | null; to: string | null }>;
}

export interface QuotaView {
  limit: number;
  used: number;
  remaining: number;
}

export const TOOL_LABELS: Record<string, string> = {
  get_financial_snapshot: "Tình hình tài chính hiện tại",
  list_transactions: "Danh sách giao dịch",
  get_spending_breakdown: "Cơ cấu chi tiêu",
  forecast_cashflow: "Dự báo dòng tiền 45 ngày",
  simulate_purchase: "Mô phỏng mua ngay / mua sau",
  get_savings_goal: "Mục tiêu tiết kiệm",
  propose_budget_adjustment: "Đề xuất ngân sách",
  propose_savings_goal_update: "Đề xuất mục tiêu tiết kiệm",
};

const TOOL_ERRORS: Record<string, string> = {
  invalid_arguments: "tham số không hợp lệ, không chạy",
  unknown_tool: "công cụ không được phép",
  tool_failed: "không lấy được dữ liệu",
  profile_missing: "chưa có hồ sơ tài chính",
  no_change: "không có thay đổi",
  invalid_amount: "số tiền không hợp lệ",
  target_date_in_past: "hạn mục tiêu đã qua",
  range_too_long_max_92_days: "khoảng ngày quá dài (tối đa 92 ngày)",
};

const isDigits = (v: unknown): v is string => typeof v === "string" && /^-?\d+$/.test(v);
const vnd = (v: unknown) => (isDigits(v) ? formatVndText(v) : "—");
const viDate = (v: unknown): string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "—";
  const [y, m, d] = v.split("-");
  return `${d}/${m}/${y}`;
};
const get = (o: unknown, ...path: string[]): unknown => path.reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);

/** One-line, plain-language summary of a tool result, built only from typed fields. */
export function summarizeEvidence(e: ToolEvidence): string {
  if (!e.ok) return `Không thành công: ${TOOL_ERRORS[e.error ?? ""] ?? "lỗi công cụ"}.`;
  const r = e.result;
  if (get(r, "status") === "incomplete") return "Dữ liệu hồ sơ chưa đủ để tính.";
  switch (e.name) {
    case "get_financial_snapshot":
      return `Số dư ước tính ${vnd(get(r, "currentBalance", "estimatedVnd"))}; mức dự phòng ${vnd(get(r, "reserveVnd"))}.`;
    case "forecast_cashflow":
      return `Thấp nhất ${vnd(get(r, "summary", "minimumVnd"))} vào ${viDate(get(r, "summary", "minimumDate"))}; cuối kỳ ${vnd(get(r, "summary", "endBalanceVnd"))}; ${Number(get(r, "summary", "reserveBreachDays") ?? 0)} ngày dưới mức dự phòng.`;
    case "simulate_purchase":
      return `Mua ngay: thấp nhất ${vnd(get(r, "buyNow", "minimumVnd"))}${get(r, "buyNow", "safe") ? "" : " (dưới mức dự phòng)"}. Mua sau: thấp nhất ${vnd(get(r, "buyLater", "minimumVnd"))}${get(r, "buyLater", "safe") ? "" : " (dưới mức dự phòng)"}.`;
    case "list_transactions":
      return `${Number(get(r, "count") ?? 0)} giao dịch${get(r, "truncated") ? " (đã giới hạn)" : ""}.`;
    case "get_spending_breakdown":
      return `Tổng chi ${vnd(get(r, "totalVnd"))} trong ${Array.isArray(get(r, "categories")) ? (get(r, "categories") as unknown[]).length : 0} danh mục.`;
    case "get_savings_goal":
      return get(r, "status") === "none"
        ? "Chưa có mục tiêu tiết kiệm."
        : `Đã tiết kiệm ${vnd(get(r, "savedVnd"))} / ${vnd(get(r, "targetVnd"))} (${Number(get(r, "progress", "percent") ?? 0)}%).`;
    case "propose_budget_adjustment":
    case "propose_savings_goal_update":
      return "Đã tạo đề xuất, chờ bạn xác nhận.";
    default:
      return "Đã tra cứu.";
  }
}

export function formatChangeValue(field: string, value: string | null): string {
  if (value === null || value === "") return "—";
  if (field.endsWith("Vnd")) return vnd(value);
  if (field === "targetDate" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  return value;
}

export const PROPOSAL_STATUS_LABEL: Record<ProposalView["status"], string> = {
  pending: "Chờ xác nhận",
  approved: "Đã áp dụng",
  rejected: "Đã từ chối",
  expired: "Hết hạn",
};

export const SUGGESTED_PROMPTS = [
  "Tôi có đủ tiền đóng trọ không?",
  "Tại sao chi tiêu tuần này tăng?",
  "Mua bàn phím 1,5 triệu hôm nay có ổn không?",
] as const;
