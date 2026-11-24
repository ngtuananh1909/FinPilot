import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapProfileRow, mapRecurringRow, mapTransactionRow } from "@/lib/db/mappers";
import { forecastCashflow } from "@/lib/finance";
import { monthToDateTotals } from "@/features/dashboard/month-totals";
import { isOwnerScoped } from "../db/repositories/support/fake-client";
import {
  NOW,
  ORIGIN,
  OTHER_ID,
  OWNER_ID,
  foreign,
  harness,
  owned,
  profileRow,
  recurringRow,
  resetHarness,
  transactionRow,
  writesOf,
} from "../settings/support/harness";

vi.mock("@/lib/db/server", async () => {
  const { harness: h } = await import("../settings/support/harness");
  return {
    createSupabaseServerClient: async () => {
      const client = h.db.fake.client as unknown as { from: (t: string) => unknown };
      return {
        auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
        from: (t: string) => client.from(t),
      };
    },
  };
});
vi.mock("@/lib/db/admin", () => ({
  createSupabaseAdminClient: () => {
    throw new Error("admin client must not be used by finance routes");
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted structurally
const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, any>;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (localIso: string) => `${localIso}+07:00`;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  resetHarness();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const get = async () => (await import("@/app/api/finance/overview/route")).GET();

describe("GET /api/finance/overview", () => {
  it("401 without a verified session and reads nothing", async () => {
    resetHarness({}, null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(harness.db.fake.queries).toHaveLength(0);
  });

  it("returns a bigint-free DTO with strings for every amount and no-store caching", async () => {
    resetHarness({
      transactions: [owned(transactionRow({ id: uid(1), occurred_at: at("2026-11-20T12:00:00"), amount_vnd: 45000 }))],
      recurring_items: [owned(recurringRow({ id: uid(9), day_of_month: 28, amount_vnd: 1500000, label: "Tiền trọ" }))],
    });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body.state).toBe("ready");
    expect(body.timeZone).toBe("Asia/Ho_Chi_Minh");
    expect(body.asOf).toBe(NOW.toISOString());
    for (const value of [
      body.currentBalance.amountVnd,
      body.reserveVnd,
      body.availableAfterReserveVnd,
      body.month.incomeVnd,
      body.month.expenseVnd,
      body.forecast.summary.minimumVnd,
      body.forecast.days[0].closingBalanceVnd,
      body.upcoming[0].amountVnd,
    ]) {
      expect(typeof value).toBe("string");
      expect(value).toMatch(/^-?\d+$/);
    }
    expect(body.forecast.days).toHaveLength(45);
    expect(body.forecast.startDate).toBe("2026-11-24");
    expect(body.forecast.endDate).toBe("2027-01-07");
    expect(body.upcoming.length).toBeLessThanOrEqual(10);
    expect(body.upcoming[0].label).toBe("Tiền trọ");
    expect(body.recentTransactions).toHaveLength(1);
    expect(body.recentTransactions[0]).not.toHaveProperty("user_id");
    expect(JSON.stringify(body)).not.toContain(OWNER_ID);
  });

  it("uses exactly the numbers of a direct forecastCashflow call on the same rows", async () => {
    resetHarness({
      transactions: [
        owned(transactionRow({ id: uid(1), occurred_at: at("2026-11-18T12:00:00"), amount_vnd: 80000 })),
        owned(transactionRow({ id: uid(2), occurred_at: at("2026-11-26T12:00:00"), amount_vnd: 700000 })),
        owned(transactionRow({ id: uid(3), occurred_at: at("2026-11-19T12:00:00"), kind: "income", amount_vnd: 300000 })),
      ],
      recurring_items: [owned(recurringRow({ id: uid(9), day_of_month: 28 }))],
    });
    const body = await json(await get());
    const direct = forecastCashflow({
      profile: mapProfileRow(profileRow()),
      transactions: harness.db.tables.transactions!.map(mapTransactionRow),
      recurringItems: harness.db.tables.recurring_items!.map(mapRecurringRow),
      now: NOW,
    });
    expect(body.currentBalance.amountVnd).toBe(direct.startingBalanceVnd.toString());
    expect(body.forecast.summary.minimumVnd).toBe(direct.summary.minimumVnd.toString());
    expect(body.forecast.summary.minimumDate).toBe(direct.summary.minimumDate);
    expect(body.forecast.summary.endBalanceVnd).toBe(direct.summary.endBalanceVnd.toString());
    expect(body.forecast.summary.reserveBreachDays).toBe(direct.summary.reserveBreachDays);
    expect(body.forecast.days.map((d: { closingBalanceVnd: string }) => d.closingBalanceVnd)).toEqual(
      direct.days.map((d) => d.closingBalanceVnd.toString()),
    );
    expect(body.availableAfterReserveVnd).toBe((direct.startingBalanceVnd - direct.reserveVnd).toString());
  });

  it("month-to-date totals ignore excluded rows, other months and future rows", async () => {
    resetHarness({
      transactions: [
        owned(transactionRow({ id: uid(1), occurred_at: at("2026-11-02T09:00:00"), kind: "income", amount_vnd: 1000000 })),
        owned(transactionRow({ id: uid(2), occurred_at: at("2026-11-20T12:00:00"), amount_vnd: 200000 })),
        owned(transactionRow({ id: uid(3), occurred_at: at("2026-11-21T12:00:00"), kind: "excluded", amount_vnd: 5000000 })),
        owned(transactionRow({ id: uid(4), occurred_at: at("2026-10-31T23:30:00"), amount_vnd: 7000000 })), // October
        owned(transactionRow({ id: uid(5), occurred_at: at("2026-11-30T12:00:00"), amount_vnd: 900000 })), // future
        owned(transactionRow({ id: uid(6), occurred_at: at("2026-11-01T00:30:00"), amount_vnd: 11000 })), // 1st, VN time
      ],
    });
    const body = await json(await get());
    expect(body.month.start).toBe("2026-11-01");
    expect(body.month.incomeVnd).toBe("1000000");
    expect(body.month.expenseVnd).toBe("211000");
    expect(body.month.expenseCount).toBe(2);
    // the future row is not in recent transactions either
    expect(body.recentTransactions.map((t: { id: string }) => t.id)).not.toContain(uid(5));
  });

  it("returns a typed incomplete state (and no balance) when the profile is missing", async () => {
    resetHarness({}, { id: OWNER_ID, is_anonymous: false }, false);
    const res = await get();
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ state: "incomplete", reason: "profile_missing" });
    expect(body).not.toHaveProperty("currentBalance");
    expect(JSON.stringify(body)).not.toMatch(/amountVnd|closingBalance/);
  });

  it("returns profile_empty (not zeros) when every onboarding input is blank and nothing was recorded", async () => {
    resetHarness({
      financial_profiles: [
        owned(
          profileRow({
            balance_snapshot_vnd: 0,
            payday_day: null,
            expected_monthly_income_vnd: 0,
            expected_daily_expense_vnd: 0,
            minimum_reserve_vnd: 0,
          }),
        ),
      ],
    }, undefined, false);
    const body = await json(await get());
    expect(body).toMatchObject({ state: "incomplete", reason: "profile_empty" });
    expect(body.readiness.issues).toHaveLength(5);
    expect(body).not.toHaveProperty("currentBalance");
  });

  it("flags incomplete inputs in `completeness` while still returning the forecast", async () => {
    const body = await json(await get()); // default profile has no recurring items
    expect(body.state).toBe("ready");
    expect(body.completeness.complete).toBe(false);
    expect(body.completeness.issues).toContainEqual({ field: "recurring_items", problem: "missing" });
    expect(body.completeness.balanceReliable).toBe(true);
    expect(body.completeness.variableExpenseBasis).toBe("profile_fallback");
    expect(body.assumptions.map((a: { code: string }) => a.code)).toContain("variable_expense_profile_fallback");
    expect(body.assumptions.map((a: { code: string }) => a.code)).toContain("income_from_profile");
  });

  it("includes deterministic alerts and the insufficient-data note", async () => {
    resetHarness({ financial_profiles: [owned(profileRow({ minimum_reserve_vnd: 2400000 }))] });
    const body = await json(await get());
    expect(body.alerts.map((a: { code: string }) => a.code)).toContain("reserve_breach");
    expect(body.alertNotes[0].message).toContain("Chưa đủ dữ liệu");
    for (const alert of body.alerts) {
      expect(alert.caveat).toBeTruthy();
      expect(alert.body).not.toMatch(/gian lận/i);
    }
  });

  it("reads only the verified owner's rows and never writes", async () => {
    resetHarness({
      financial_profiles: [owned(profileRow()), foreign(profileRow({ balance_snapshot_vnd: 999000000 }))],
      transactions: [
        owned(transactionRow({ id: uid(1), occurred_at: at("2026-11-20T12:00:00") })),
        foreign(transactionRow({ id: uid(2), occurred_at: at("2026-11-20T12:00:00"), amount_vnd: 123456789 })),
      ],
    }, undefined, false);
    const body = await json(await get());
    expect(body.currentBalance.snapshotVnd).toBe("2500000");
    expect(body.recentTransactions).toHaveLength(1);
    expect(harness.db.fake.queries.length).toBeGreaterThan(0);
    for (const q of harness.db.fake.queries) expect(isOwnerScoped(q, OWNER_ID), q.table).toBe(true);
    expect(harness.db.fake.queries.some((q) => q.calls.some((c) => c.args.includes(OTHER_ID)))).toBe(false);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("is deterministic for the same clock and data", async () => {
    const first = await (await get()).text();
    const second = await (await get()).text();
    expect(second).toBe(first);
  });

  it("limits the recent snippet to 5 newest posted rows", async () => {
    resetHarness({
      transactions: Array.from({ length: 8 }, (_, i) =>
        owned(transactionRow({ id: uid(i + 1), occurred_at: at(`2026-11-${String(10 + i).padStart(2, "0")}T12:00:00`) })),
      ),
    });
    const body = await json(await get());
    expect(body.recentTransactions.map((t: { id: string }) => t.id)).toEqual([uid(8), uid(7), uid(6), uid(5), uid(4)]);
  });
});

describe("monthToDateTotals (month boundary in Asia/Ho_Chi_Minh)", () => {
  it("counts a row at 00:30 on the 1st (VN) even though it is the previous day in UTC", () => {
    const totals = monthToDateTotals(
      [
        { id: "a", kind: "expense", amountVnd: 10n, occurredAt: new Date("2026-10-31T17:30:00Z") }, // 2026-11-01 00:30 VN
        { id: "b", kind: "expense", amountVnd: 99n, occurredAt: new Date("2026-10-31T16:59:00Z") }, // 2026-10-31 23:59 VN
      ],
      NOW,
    );
    expect(totals.expenseVnd).toBe(10n);
  });
});
