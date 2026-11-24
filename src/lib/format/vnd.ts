/** Display-only: groups a whole-VND decimal string with dots and appends the dong sign ("4.850.000 ₫"). */
export function formatVndText(amount: string): string {
  const match = /^(-?)(\d+)$/.exec(amount.trim());
  if (!match) return "";
  const [, sign = "", digits = ""] = match;
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ₫`;
}
