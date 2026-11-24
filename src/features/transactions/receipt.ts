import { amountToInputText } from "@/lib/format/money-input";
import { isoToVnInput, toVnInputValue } from "@/lib/format/vn-datetime";
import { toApiFailure, networkFailure, type ApiResult, type FetchLike } from "@/lib/http/api-call";
import { CATEGORY_CODES, DEFAULT_CATEGORY } from "./labels";
import { buildCreateBody, emptyFormValues, type TransactionFormValues } from "./form";

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp";
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Draft returned by POST /api/receipts/extract (untrusted model output, already validated). */
export interface ReceiptDraftView {
  merchant: string | null;
  occurredAt: string | null;
  totalVnd: string | null;
  category: string | null;
  confidence: number | null;
  warnings: string[];
}

export interface ReceiptExtractView {
  draft: ReceiptDraftView;
  quota: { limit: number; used: number; remaining: number };
  requiresConfirmation: true;
}

/** Client-side pre-check only; the server re-checks size and magic bytes. */
export function checkReceiptFile(file: { size: number; type: string }): string | null {
  if (!ALLOWED.has(file.type)) return "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.";
  if (file.size <= 0) return "Ảnh trống.";
  if (file.size > RECEIPT_MAX_BYTES) return "Ảnh quá lớn. Kích thước tối đa là 5 MB.";
  return null;
}

const WARNING_TEXT: Record<string, string> = {
  total_missing: "Không đọc được tổng tiền, hãy nhập.",
  total_unreadable: "Tổng tiền không rõ ràng, hãy kiểm tra.",
  total_out_of_range: "Tổng tiền đọc được không hợp lý, hãy nhập lại.",
  date_missing: "Không đọc được ngày, đã dùng thời điểm hiện tại.",
  date_unreadable: "Ngày không rõ ràng, đã dùng thời điểm hiện tại.",
  date_implausible: "Ngày đọc được không hợp lý, đã dùng thời điểm hiện tại.",
  time_unreadable: "Không đọc được giờ.",
  merchant_missing: "Không đọc được tên cửa hàng.",
  category_unknown: "Chưa xác định danh mục.",
  model_reported_uncertainty: "AI báo có phần chưa chắc chắn.",
  unreadable_response: "AI không đọc được hóa đơn. Bạn có thể nhập tay.",
};

export const receiptWarningText = (code: string): string => WARNING_TEXT[code] ?? "Cần kiểm tra lại thông tin.";

/** Prefills the normal transaction form; every field stays editable and nothing is saved yet. */
export function draftToFormValues(draft: ReceiptDraftView, now: Date): TransactionFormValues {
  const base = emptyFormValues(now);
  return {
    ...base,
    kind: "expense",
    amount: draft.totalVnd ? amountToInputText(draft.totalVnd) : "",
    occurredAt: draft.occurredAt ? isoToVnInput(draft.occurredAt) : toVnInputValue(now),
    category: draft.category && CATEGORY_CODES.includes(draft.category) ? draft.category : DEFAULT_CATEGORY,
    merchant: draft.merchant ?? "",
  };
}

/** POST /api/transactions body for a confirmed receipt (source "receipt"). */
export function buildReceiptBody(values: TransactionFormValues): Record<string, unknown> {
  return { ...buildCreateBody({ ...values, recurringItemId: "", recurringInstanceDate: "" }), source: "receipt" };
}

/** Sends the raw image bytes (not JSON) with the file's declared type. Never throws. */
export async function uploadReceipt(fetchImpl: FetchLike, file: Blob): Promise<ApiResult<ReceiptExtractView>> {
  let response;
  try {
    response = await fetchImpl("/api/receipts/extract", { method: "POST", headers: { "content-type": file.type }, body: file });
  } catch {
    return networkFailure();
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (!response.ok) return toApiFailure(response.status, json);
  if (typeof json !== "object" || json === null) return toApiFailure(502, null);
  return { ok: true, status: response.status, data: json as ReceiptExtractView };
}
