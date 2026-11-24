import { readApiError, type JsonResponse } from "@/lib/http/client";

const MAX_DIGITS = 13;

/**
 * Parses user text such as "4.850.000", "4 850 000" or "4,850,000" into a decimal string of whole
 * VND ("4850000"). Returns null when the text is not a whole number. No floating point is used.
 */
export function parseVndInput(text: string, options: { allowNegative?: boolean } = {}): string | null {
  const trimmed = text.trim().replace(/[\s.,_]/g, "").replace(/(?:₫|đ|vnd)$/i, "");
  const match = /^(-?)(\d+)$/.exec(trimmed);
  if (!match) return null;
  const [, sign = "", digits = ""] = match;
  if (sign && !options.allowNegative) return null;
  if (digits.length > MAX_DIGITS) return null;
  const normalized = digits.replace(/^0+(?=\d)/, "");
  return sign && normalized !== "0" ? `-${normalized}` : normalized;
}

export interface BalanceStepValues {
  balance: string;
}
export interface ProfileStepValues {
  paydayDay: string;
  expectedMonthlyIncome: string;
  expectedDailyExpense: string;
  minimumReserve: string;
}
export type StepErrors<T> = Partial<Record<keyof T, string>>;

export function validateBalanceStep(values: BalanceStepValues): StepErrors<BalanceStepValues> {
  if (!values.balance.trim()) return { balance: "Vui lòng nhập số dư hiện tại." };
  if (parseVndInput(values.balance, { allowNegative: true }) === null) {
    return { balance: "Số dư cần là số nguyên đồng, ví dụ 4.850.000." };
  }
  return {};
}

export function validateProfileStep(values: ProfileStepValues): StepErrors<ProfileStepValues> {
  const errors: StepErrors<ProfileStepValues> = {};
  const day = values.paydayDay.trim();
  if (day) {
    const n = Number(day);
    if (!/^\d{1,2}$/.test(day) || n < 1 || n > 31) errors.paydayDay = "Ngày nhận lương cần từ 1 đến 31.";
  }
  const money: Array<[keyof ProfileStepValues, string, string]> = [
    ["expectedMonthlyIncome", values.expectedMonthlyIncome, "Thu nhập hằng tháng"],
    ["expectedDailyExpense", values.expectedDailyExpense, "Chi tiêu mỗi ngày"],
    ["minimumReserve", values.minimumReserve, "Mức dự phòng tối thiểu"],
  ];
  for (const [key, raw, label] of money) {
    if (!raw.trim()) errors[key] = `Vui lòng nhập ${label.toLowerCase()} (nhập 0 nếu chưa có).`;
    else if (parseVndInput(raw) === null) errors[key] = `${label} cần là số nguyên đồng, không âm.`;
  }
  return errors;
}

export function buildBalanceBody(values: BalanceStepValues): { amountVnd: string; confirm: true } {
  const amountVnd = parseVndInput(values.balance, { allowNegative: true });
  if (amountVnd === null) throw new Error("invalid_balance");
  return { amountVnd, confirm: true };
}

export function buildProfileBody(values: ProfileStepValues) {
  const income = parseVndInput(values.expectedMonthlyIncome);
  const daily = parseVndInput(values.expectedDailyExpense);
  const reserve = parseVndInput(values.minimumReserve);
  if (income === null || daily === null || reserve === null) throw new Error("invalid_profile");
  return {
    paydayDay: values.paydayDay.trim() ? Number(values.paydayDay.trim()) : null,
    expectedMonthlyIncomeVnd: income,
    expectedDailyExpenseVnd: daily,
    minimumReserveVnd: reserve,
  };
}

export type StepResult = { ok: true } | { ok: false; code: string; message: string };

export interface OnboardingHttp {
  post(url: string, body: unknown): Promise<JsonResponse>;
  patch(url: string, body: unknown): Promise<JsonResponse>;
}

const NETWORK = "Không thể kết nối tới máy chủ. Vui lòng kiểm tra mạng và thử lại.";

async function settle(call: () => Promise<JsonResponse>): Promise<StepResult> {
  try {
    const res = await call();
    if (res.ok) return { ok: true };
    const info = readApiError(res.json);
    return { ok: false, ...info };
  } catch {
    return { ok: false, code: "network", message: NETWORK };
  }
}

/** Creates the default profile row for a new real user (idempotent on the server). */
export const bootstrapProfileRequest = (http: OnboardingHttp): Promise<StepResult> =>
  settle(() => http.post("/api/profile/bootstrap", {}));

export const submitBalanceStep = (http: OnboardingHttp, values: BalanceStepValues): Promise<StepResult> =>
  settle(() => http.post("/api/settings/balance-snapshot", buildBalanceBody(values)));

export const submitProfileStep = (http: OnboardingHttp, values: ProfileStepValues): Promise<StepResult> =>
  settle(() => http.patch("/api/settings/profile", buildProfileBody(values)));
