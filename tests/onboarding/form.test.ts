import { describe, expect, it, vi } from "vitest";
import {
  bootstrapProfileRequest,
  buildBalanceBody,
  buildProfileBody,
  parseVndInput,
  submitBalanceStep,
  submitProfileStep,
  validateBalanceStep,
  validateProfileStep,
  type OnboardingHttp,
} from "@/lib/onboarding/form";

describe("parseVndInput", () => {
  it.each([
    ["4.850.000", "4850000"],
    ["4,850,000", "4850000"],
    ["4 850 000 ₫", "4850000"],
    ["0", "0"],
    ["007", "7"],
    ["0000", "0"],
    ["12000000đ", "12000000"],
  ])("parses %s", (text, expected) => expect(parseVndInput(text)).toBe(expected));
  it.each(["", "abc", "12.5x", "1e6", "-5", "--5", "٣"])("rejects %j", (text) => expect(parseVndInput(text)).toBeNull());
  it("allows a negative balance only when asked, and rejects absurd length", () => {
    expect(parseVndInput("-150.000", { allowNegative: true })).toBe("-150000");
    expect(parseVndInput("-0", { allowNegative: true })).toBe("0");
    expect(parseVndInput("9".repeat(14))).toBeNull();
  });
});

describe("step validation", () => {
  it("requires a balance", () => {
    expect(validateBalanceStep({ balance: "" }).balance).toBeTruthy();
    expect(validateBalanceStep({ balance: "1.2x" })).toEqual({ balance: expect.any(String) });
    expect(validateBalanceStep({ balance: "-100.000" })).toEqual({});
  });
  it("validates payday, income, daily spend and reserve", () => {
    const ok = { paydayDay: "5", expectedMonthlyIncome: "12.000.000", expectedDailyExpense: "150.000", minimumReserve: "0" };
    expect(validateProfileStep(ok)).toEqual({});
    expect(validateProfileStep({ ...ok, paydayDay: "" })).toEqual({});
    expect(Object.keys(validateProfileStep({ ...ok, paydayDay: "32" }))).toEqual(["paydayDay"]);
    expect(Object.keys(validateProfileStep({ ...ok, paydayDay: "0" }))).toEqual(["paydayDay"]);
    expect(Object.keys(validateProfileStep({ ...ok, paydayDay: "1.5" }))).toEqual(["paydayDay"]);
    expect(Object.keys(validateProfileStep({ ...ok, expectedMonthlyIncome: "-1", minimumReserve: "" }))).toEqual([
      "expectedMonthlyIncome",
      "minimumReserve",
    ]);
  });
});

describe("request bodies", () => {
  it("builds the strict API payloads (decimal strings, confirm:true, no owner fields)", () => {
    expect(buildBalanceBody({ balance: "4.850.000" })).toEqual({ amountVnd: "4850000", confirm: true });
    expect(buildProfileBody({ paydayDay: "", expectedMonthlyIncome: "1", expectedDailyExpense: "2", minimumReserve: "3" })).toEqual({
      paydayDay: null,
      expectedMonthlyIncomeVnd: "1",
      expectedDailyExpenseVnd: "2",
      minimumReserveVnd: "3",
    });
  });
});

describe("submit helpers", () => {
  const http = (reply: { ok: boolean; status: number; json: unknown } | Error) => {
    const call = vi.fn(async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    });
    const value: OnboardingHttp = { post: call, patch: call };
    return { value, call };
  };
  it("posts bootstrap with an empty body, balance with confirm, and patches the profile", async () => {
    const h = http({ ok: true, status: 200, json: {} });
    expect(await bootstrapProfileRequest(h.value)).toEqual({ ok: true });
    expect(h.call).toHaveBeenLastCalledWith("/api/profile/bootstrap", {});
    await submitBalanceStep(h.value, { balance: "1000" });
    expect(h.call).toHaveBeenLastCalledWith("/api/settings/balance-snapshot", { amountVnd: "1000", confirm: true });
    await submitProfileStep(h.value, { paydayDay: "5", expectedMonthlyIncome: "1", expectedDailyExpense: "2", minimumReserve: "3" });
    expect(h.call).toHaveBeenLastCalledWith("/api/settings/profile", expect.objectContaining({ paydayDay: 5 }));
  });
  it("surfaces the API envelope message and survives network errors", async () => {
    const api = http({ ok: false, status: 403, json: { error: { code: "forbidden", message: "Bạn không có quyền." } } });
    expect(await bootstrapProfileRequest(api.value)).toEqual({ ok: false, code: "forbidden", message: "Bạn không có quyền." });
    const net = http(new TypeError("Failed to fetch"));
    expect(await submitBalanceStep(net.value, { balance: "1" })).toMatchObject({ ok: false, code: "network" });
  });
});
