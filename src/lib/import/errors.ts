import { AppError } from "@/lib/errors";

/**
 * Stable machine-readable reasons for CSV import failures. They travel to the client in
 * `safeDetails.reason`; the Vietnamese `userMessage` is for display. No cell content is ever
 * placed in an error (cells are untrusted and may contain private data).
 */
export type ImportErrorReason =
  | "payload_too_large"
  | "invalid_request"
  | "invalid_encoding"
  | "binary_content"
  | "empty_file"
  | "missing_header"
  | "no_data_rows"
  | "too_many_rows"
  | "too_many_columns"
  | "cell_too_long"
  | "unterminated_quote"
  | "invalid_quote"
  | "invalid_mapping"
  | "mapping_incomplete"
  | "unknown_row"
  | "duplicate_selection_not_selected"
  | "no_rows_to_import"
  | "import_commit_failed";

const MESSAGES: Record<ImportErrorReason, string> = {
  payload_too_large: "Tệp CSV vượt quá dung lượng cho phép.",
  invalid_request: "Yêu cầu nhập CSV chưa hợp lệ. Vui lòng kiểm tra và thử lại.",
  invalid_encoding: "Tệp không phải văn bản UTF-8 hợp lệ. Hãy lưu tệp CSV với mã hóa UTF-8.",
  binary_content: "Tệp có vẻ là tệp nhị phân, không phải CSV văn bản.",
  empty_file: "Tệp CSV trống.",
  missing_header: "Tệp CSV cần có dòng tiêu đề ở đầu.",
  no_data_rows: "Tệp CSV chỉ có dòng tiêu đề, chưa có giao dịch nào.",
  too_many_rows: "Tệp CSV có quá nhiều dòng.",
  too_many_columns: "Tệp CSV có quá nhiều cột.",
  cell_too_long: "Một ô trong tệp CSV quá dài.",
  unterminated_quote: "Tệp CSV có dấu ngoặc kép chưa được đóng.",
  invalid_quote: "Tệp CSV có dấu ngoặc kép không đúng định dạng.",
  invalid_mapping: "Cách ghép cột chưa hợp lệ.",
  mapping_incomplete: "Cần ghép tối thiểu cột ngày và cột số tiền trước khi nhập.",
  unknown_row: "Dòng được chọn không còn khớp với tệp CSV. Vui lòng xem trước lại.",
  duplicate_selection_not_selected: "Dòng trùng được cho phép nhập phải nằm trong danh sách dòng đã chọn.",
  no_rows_to_import: "Không có dòng hợp lệ nào được chọn để nhập.",
  import_commit_failed: "Không thể lưu giao dịch từ CSV. Không có dòng nào được lưu. Vui lòng thử lại.",
};

/** Typed import failure; maps to an HTTP error response through `toErrorResponse`. */
export class ImportError extends AppError {
  readonly reason: ImportErrorReason;
  constructor(
    reason: ImportErrorReason,
    options: { httpStatus?: number; detail?: Readonly<Record<string, string | number | boolean>>; cause?: unknown } = {},
  ) {
    super(reason === "import_commit_failed" ? "internal" : "validation_failed", {
      userMessage: MESSAGES[reason],
      ...(options.httpStatus === undefined ? {} : { httpStatus: options.httpStatus }),
      safeDetails: { ...options.detail, reason },
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "ImportError";
    this.reason = reason;
  }
}

export const isImportError = (value: unknown): value is ImportError => value instanceof ImportError;
