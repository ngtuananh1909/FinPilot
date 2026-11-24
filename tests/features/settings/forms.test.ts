import { describe, expect, it } from "vitest";
import { goalUpsertSchema, recurringCreateSchema, recurringUpdateSchema } from "@/lib/db/inputs";
import { toApiFailure } from "@/lib/http/api-call";
import type { GoalDto, ProfileDto } from "@/lib/settings/dto";
import { balanceSnapshotBodySchema, profilePatchBodySchema } from "@/lib/settings/schemas";
import type { RecurringDto } from "@/lib/transactions/dto";
import { BALANCE_ANCHOR_EXPLANATION, buildBalanceBody } from "@/features/settings/balance";
import { buildGoalBody, emptyGoalValues, goalPercent, goalValuesFrom, mapGoalFailure, validateGoalForm } from "@/features/settings/goal-form";
import {
  buildProfilePatch,
  profileValuesFrom,
  readinessLines,
  summarizeChanges,
  validateProfileForm,
} from "@/features/settings/profile-form";
import {
  buildRecurringCreateBody,
  buildRecurringPatchBody,
  emptyRecurringValues,
  mapRecurringFailure,
  recurringValuesFrom,
  validateRecurringForm,
} from "@/features/settings/recurring-form";
const NOW = new Date("2026-03-10T05:30:00Z");
const profile = (over: Partial<ProfileDto> = {}): ProfileDto => ({
  displayName: "Minh",
  balanceSnapshot: { amountVnd: "4850000", at: "2026-03-01T00:00:00.000Z" },
  expectedMonthlyIncomeVnd: "7500000",
  paydayDay: 5,
  expectedDailyExpenseVnd: "150000",
  projectedMonthlyBudgetVnd: "6000000",
  minimumReserveVnd: "1000000",
  isDemo: true,
  personaCode: "student",
  updatedAt: "2026-03-01T00:00:00.000Z",
  ...over,
});
describe("profile form", () => {
  it("round-trips the DTO into formatted text and an empty patch", () => {
    const values = profileValuesFrom(profile());
    expect(values).toMatchObject({ paydayDay: "5", expectedMonthlyIncome: "7.500.000", minimumReserve: "1.000.000" });
    expect(validateProfileForm(values)).toEqual({});
    expect(buildProfilePatch(values, values)).toBeNull();
  });
  it("sends only changed fields as decimal strings and the server schema accepts them", () => {
    const original = profileValuesFrom(profile());
    const patch = buildProfilePatch({ ...original, expectedMonthlyIncome: "8.000.000", paydayDay: "" }, original);
    expect(patch).toEqual({ expectedMonthlyIncomeVnd: "8000000", paydayDay: null });
    expect(profilePatchBodySchema.safeParse(patch).success).toBe(true);
    const all = buildProfilePatch(
      { displayName: "An", paydayDay: "31", expectedMonthlyIncome: "1", expectedDailyExpense: "2", projectedMonthlyBudget: "3", minimumReserve: "0" },
      original,
    );
    expect(profilePatchBodySchema.safeParse(all).success).toBe(true);
    expect(Object.values(all ?? {}).filter((v) => typeof v === "number")).toEqual([31]);
  });
  it("validates name, payday and each money field (zero allowed)", () => {
    const base = profileValuesFrom(profile());
    expect(validateProfileForm({ ...base, displayName: "  " }).displayName).toBeDefined();
    expect(validateProfileForm({ ...base, paydayDay: "32" }).paydayDay).toBeDefined();
    expect(validateProfileForm({ ...base, paydayDay: "0" }).paydayDay).toBeDefined();
    expect(validateProfileForm({ ...base, paydayDay: "" })).toEqual({});
    expect(validateProfileForm({ ...base, minimumReserve: "0" })).toEqual({});
    expect(validateProfileForm({ ...base, expectedDailyExpense: "" }).expectedDailyExpense).toBeDefined();
  });
  it("summarizes what will change in plain language", () => {
    const original = profileValuesFrom(profile());
    const lines = summarizeChanges({ ...original, minimumReserve: "2.000.000", paydayDay: "" }, original);
    expect(lines).toEqual([
      { label: "Ngày nhận lương", from: "ngày 5", to: "không cố định" },
      { label: "Mức dự phòng tối thiểu", from: "1.000.000 ₫", to: "2.000.000 ₫" },
    ]);
    expect(summarizeChanges(original, original)).toEqual([]);
  });
});
describe("forecast readiness lines", () => {
  it("is empty when complete", () => {
    expect(readinessLines({ complete: true, issues: [] })).toEqual([]);
  });
  it("links every issue to its field", () => {
    const lines = readinessLines({
      complete: false,
      issues: [
        { field: "balance_snapshot", problem: "zero" },
        { field: "payday_day", problem: "missing" },
        { field: "expected_monthly_income", problem: "zero" },
        { field: "expected_daily_expense", problem: "zero" },
        { field: "recurring_items", problem: "missing" },
      ],
    });
    expect(lines.map((l) => l.anchor)).toEqual(["settings-balance", "set-payday", "set-income", "set-daily", "settings-recurring"]);
    expect(lines[0]?.text).toMatch(/đang bằng 0/);
    expect(lines[1]?.text).toMatch(/chưa có/);
  });
});
describe("balance snapshot body", () => {
  it("always carries confirm:true and a decimal string, accepted by the server schema", () => {
    const built = buildBalanceBody("-1.250.000");
    expect(built).toEqual({ ok: true, body: { amountVnd: "-1250000", confirm: true } });
    if (built.ok) expect(balanceSnapshotBodySchema.safeParse(built.body).success).toBe(true);
  });
  it("rejects empty and non-numeric text", () => {
    expect(buildBalanceBody("").ok).toBe(false);
    expect(buildBalanceBody("abc").ok).toBe(false);
  });
  it("explains that earlier transactions are not re-applied", () => {
    expect(BALANCE_ANCHOR_EXPLANATION).toMatch(/KHÔNG được cộng lại/);
  });
});
const recurring = (over: Partial<RecurringDto> = {}): RecurringDto => ({
  id: "22222222-2222-4222-8222-222222222222",
  label: "Tiền trọ",
  kind: "expense",
  amountVnd: "3000000",
  dayOfMonth: 1,
  category: "rent",
  startDate: "2026-01-01",
  endDate: null,
  active: true,
  createdAt: "x",
  updatedAt: "x",
  ...over,
});
describe("recurring form", () => {
  it("defaults the start date to today in Vietnam and validates required fields", () => {
    const v = emptyRecurringValues(NOW);
    expect(v.startDate).toBe("2026-03-10");
    const errors = validateRecurringForm(v);
    expect(Object.keys(errors).sort()).toEqual(["amount", "dayOfMonth", "label"]);
  });
  it("builds a create body that the server schema accepts", () => {
    const body = buildRecurringCreateBody({ ...emptyRecurringValues(NOW), label: " Lương ", kind: "income", amount: "4.500.000", dayOfMonth: "31", category: "salary" });
    expect(body).toEqual({ label: "Lương", kind: "income", amountVnd: "4500000", dayOfMonth: 31, category: "salary", startDate: "2026-03-10" });
    expect(recurringCreateSchema.safeParse(body).success).toBe(true);
  });
  it("rejects a reversed date range and out-of-range days", () => {
    const base = { ...emptyRecurringValues(NOW), label: "a", amount: "1" };
    expect(validateRecurringForm({ ...base, dayOfMonth: "32" }).dayOfMonth).toBeDefined();
    expect(validateRecurringForm({ ...base, dayOfMonth: "0" }).dayOfMonth).toBeDefined();
    expect(validateRecurringForm({ ...base, dayOfMonth: "5", endDate: "2026-03-01" }).endDate).toBeDefined();
    expect(validateRecurringForm({ ...base, dayOfMonth: "5", endDate: "2026-03-10" })).toEqual({});
  });
  it("patches only what changed, including clearing the end date and deactivation-free edits", () => {
    const original = recurringValuesFrom(recurring({ endDate: "2026-12-31" }));
    expect(buildRecurringPatchBody(original, original)).toBeNull();
    const patch = buildRecurringPatchBody({ ...original, amount: "3.200.000", endDate: "" }, original);
    expect(patch).toEqual({ amountVnd: "3200000", endDate: null });
    expect(recurringUpdateSchema.safeParse(patch).success).toBe(true);
  });
  it("explains the kind lock", () => {
    const m = mapRecurringFailure(toApiFailure(400, { error: { code: "validation_failed", message: "g", details: { field: "kind", rule: "recurring_kind_locked" } } }));
    expect(m.fieldErrors.kind).toMatch(/đã có giao dịch/);
  });
  it("shows a 404 as gone", () => {
    const m = mapRecurringFailure(toApiFailure(404, { error: { code: "not_found", message: "n" } }));
    expect(m.general).toMatch(/không tồn tại/);
  });
});
const goal = (over: Partial<GoalDto> = {}): GoalDto => ({
  name: "Quỹ laptop",
  targetVnd: "15000000",
  savedVnd: "6200000",
  targetDate: "2026-12-31",
  updatedAt: "x",
  reached: false,
  progress: { percent: 41, remainingVnd: "8800000" },
  ...over,
});
describe("goal form", () => {
  it("validates name, amounts and deadline", () => {
    const errors = validateGoalForm(emptyGoalValues(), NOW, null);
    expect(Object.keys(errors).sort()).toEqual(["name", "target"]);
    const ok = { name: "Laptop", target: "15.000.000", saved: "0", targetDate: "2026-12-31" };
    expect(validateGoalForm(ok, NOW, null)).toEqual({});
    expect(validateGoalForm({ ...ok, targetDate: "2026-03-09" }, NOW, null).targetDate).toMatch(/quá khứ/);
    expect(validateGoalForm({ ...ok, targetDate: "2026-03-10" }, NOW, null)).toEqual({});
  });
  it("lets an overdue stored deadline stay unchanged (mirrors the server rule)", () => {
    const values = { name: "Laptop", target: "1", saved: "0", targetDate: "2026-01-01" };
    expect(validateGoalForm(values, NOW, "2026-01-01")).toEqual({});
    expect(validateGoalForm(values, NOW, "2026-02-01").targetDate).toBeDefined();
  });
  it("builds a PUT body (omitted deadline clears it) accepted by the server schema", () => {
    const withDate = buildGoalBody(goalValuesFrom(goal()));
    expect(withDate).toEqual({ name: "Quỹ laptop", targetVnd: "15000000", savedVnd: "6200000", targetDate: "2026-12-31" });
    expect(goalUpsertSchema.safeParse(withDate).success).toBe(true);
    const noDate = buildGoalBody({ ...goalValuesFrom(goal()), targetDate: "" });
    expect("targetDate" in noDate).toBe(false);
    expect(goalUpsertSchema.safeParse(noDate).success).toBe(true);
  });
  it("computes the bar percent from the server value, falling back to bigint math", () => {
    expect(goalPercent(goal())).toBe(41);
    expect(goalPercent(goal({ progress: { percent: Number.NaN, remainingVnd: "0" } }))).toBe(41);
    expect(goalPercent(goal({ reached: true, savedVnd: "20000000", progress: { percent: 100, remainingVnd: "0" } }))).toBe(100);
  });
  it("maps the past-deadline rule onto the date field", () => {
    const m = mapGoalFailure(toApiFailure(400, { error: { code: "validation_failed", message: "g", details: { field: "targetDate", rule: "target_date_in_past" } } }));
    expect(m.fieldErrors.targetDate).toMatch(/quá khứ/);
  });
});
