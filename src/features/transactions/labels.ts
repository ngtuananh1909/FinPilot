export type TransactionKind = "income" | "expense" | "excluded";
export const KIND_OPTIONS: ReadonlyArray<{ value: TransactionKind; label: string; explanation: string }> = [
  { value: "expense", label: "Chi tiêu", explanation: "Tiền ra khỏi tài khoản, làm giảm số dư." },
  { value: "income", label: "Thu nhập", explanation: "Tiền vào tài khoản, làm tăng số dư." },
  {
    value: "excluded",
    label: "Loại trừ",
    explanation:
      "Hoàn tiền hoặc chuyển khoản nội bộ: được lưu để tham khảo nhưng không làm thay đổi số dư hay ngân sách.",
  },
];
/** Spoken/visible word for a kind: used next to the sign so meaning never relies on color alone. */
export const KIND_LABEL: Record<TransactionKind, string> = {
  income: "Thu nhập",
  expense: "Chi tiêu",
  excluded: "Loại trừ",
};
/** Category codes the form offers. The API accepts any short text; `other` is the fallback. */
export const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  food: "Ăn uống",
  coffee: "Cà phê",
  groceries: "Đi chợ, siêu thị",
  transport: "Di chuyển",
  shopping: "Mua sắm",
  rent: "Tiền trọ",
  utilities: "Điện nước, internet",
  subscriptions: "Gói đăng ký",
  installment: "Trả góp",
  education: "Học tập",
  health: "Sức khỏe",
  entertainment: "Giải trí",
  salary: "Lương",
  allowance: "Trợ cấp",
  other: "Khác",
};
export const CATEGORY_CODES: readonly string[] = Object.keys(CATEGORY_LABEL);
export const DEFAULT_CATEGORY = "other";
export function categoryLabel(code: string): string {
  return CATEGORY_LABEL[code] ?? code;
}
/** Options for a category select; keeps an unknown stored category selectable so editing never loses it. */
export function categoryOptions(current?: string): Array<{ value: string; label: string }> {
  const codes = current && !CATEGORY_CODES.includes(current) ? [...CATEGORY_CODES, current] : CATEGORY_CODES;
  return codes.map((value) => ({ value, label: categoryLabel(value) }));
}
export const SOURCE_LABEL: Record<string, string> = {
  manual: "Thủ công",
  csv: "Nhập CSV",
  receipt: "Quét biên lai",
  seed: "Dữ liệu mẫu",
};
export const sourceLabel = (source: string): string => SOURCE_LABEL[source] ?? source;
