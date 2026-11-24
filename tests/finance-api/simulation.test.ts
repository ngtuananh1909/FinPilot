import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapProfileRow, mapRecurringRow, mapTransactionRow } from "@/lib/db/mappers";
import { forecastCashflow } from "@/lib/finance";
import { isOwnerScoped } from "../db/repositories/support/fake-client";
import {
  NOW,
  ORIGIN,
  OWNER_ID,
  harness,
  owned,
  profileRow,
  recurringRow,
  request,
  resetHarness,
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
const BAD_ORIGIN = { origin: "https://evil.example" };
const PATH = "/api/simulations/purchase";

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

// Default fixture (harness): now = 2026-11-24 12:00 VN, balance 2.500.000, reserve 300.000,
// 120.000/day (profile fallback), 6.000.000 income on day 5 (first: 2026-12-05).
// Baseline lowest before payday: 2026-12-04 = 2.500.000 - 11 * 120.000 = 1.180.000.
const post = async (body: unknown, headers?: Record<string, string>) => {
  const { POST } = await import("@/app/api/simulations/purchase/route");
  return POST(request("POST", PATH, body, headers));
};
const payday = { kind: "next_payday" } as const;

describe("POST /api/simulations/purchase: security", () => {
  it("403 for a foreign or missing Origin, before touching the database", async () => {
    const res = await post({ costVnd: "1000000", buyLater: payday }, BAD_ORIGIN);
    expect(res.status).toBe(403);
    expect(harness.db.fake.queries).toHaveLength(0);
    const missing = await post({ costVnd: "1000000", buyLater: payday }, {});
    expect(missing.status).toBe(403);
  });

  it("401 without a verified session and reads nothing", async () => {
    resetHarness({}, null);
    const res = await post({ costVnd: "1000000", buyLater: payday });
    expect(res.status).toBe(401);
    expect(harness.db.fake.queries).toHaveLength(0);
  });

  it.each([
    ["owner key at top level", { costVnd: "1000000", buyLater: payday, user_id: "x" }],
    ["owner key camelCase", { costVnd: "1000000", buyLater: payday, userId: "x" }],
    ["owner key nested in buyLater", { costVnd: "1000000", buyLater: { kind: "date", date: "2026-12-10", user_id: "x" } }],
    ["cost as JSON number", { costVnd: 1000000, buyLater: payday }],
    ["cost zero", { costVnd: "0", buyLater: payday }],
    ["cost negative", { costVnd: "-5", buyLater: payday }],
    ["cost with exponent", { costVnd: "1e6", buyLater: payday }],
    ["cost with fraction", { costVnd: "1000.5", buyLater: payday }],
    ["cost above the safe-integer limit", { costVnd: "9007199254740993", buyLater: payday }],
    ["missing buyLater", { costVnd: "1000000" }],
    ["unknown buyLater kind", { costVnd: "1000000", buyLater: { kind: "tomorrow" } }],
    ["bad date format", { costVnd: "1000000", buyLater: { kind: "date", date: "10/12/2026" } }],
    ["item name too long", { costVnd: "1000000", itemName: "x".repeat(81), buyLater: payday }],
    ["bad buyNowDate format", { costVnd: "1000000", buyNowDate: "tomorrow", buyLater: payday }],
  ])("400 for %s", async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("validation_failed");
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("400 for non-JSON and non-object bodies", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post("[1,2]")).status).toBe(400);
  });

  it("derives the owner from the session only and scopes every query to it", async () => {
    const res = await post({ costVnd: "1000000", buyLater: payday });
    expect(res.status).toBe(200);
    expect(harness.db.fake.queries.length).toBeGreaterThan(0);
    for (const q of harness.db.fake.queries) expect(isOwnerScoped(q, OWNER_ID), q.table).toBe(true);
    expect(writesOf(harness.db)).toHaveLength(0);
  });
});

describe("POST /api/simulations/purchase: results", () => {
  it("returns both daily series on the same dates, no bigint, plus baseline and assumptions", async () => {
    const res = await post({ costVnd: "1000000", itemName: "  Bàn phím  ", buyLater: payday });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body.itemName).toBe("Bàn phím");
    expect(body.costVnd).toBe("1000000");
    expect(body.buyLaterSource).toBe("next_payday");
    expect(body.scenarios.now.series).toHaveLength(45);
    expect(body.scenarios.later.series.map((p: { date: string }) => p.date)).toEqual(
      body.scenarios.now.series.map((p: { date: string }) => p.date),
    );
    expect(body.scenarios.now.purchaseDate).toBe("2026-11-24");
    expect(body.scenarios.later.purchaseDate).toBe("2026-12-05");
    expect(body.baseline).toMatchObject({ minimumVnd: "1180000", minimumDate: "2026-12-04", safe: true });
    expect(body.reserveVnd).toBe("300000");
    expect(body.currentBalanceVnd).toBe("2500000");
    expect(body.assumptions.map((a: { code: string }) => a.code)).toContain("variable_expense_profile_fallback");
    expect(body.conclusions.length).toBeGreaterThan(2);
    expect(body.caveat).toMatch(/ước tính/);
    expect(typeof body.minimumImprovementVnd).toBe("string");
    for (const s of [body.scenarios.now, body.scenarios.later]) {
      expect(typeof s.minimumVnd).toBe("string");
      expect(typeof s.reserveHeadroomVnd).toBe("string");
      expect(["none", "below_reserve", "below_zero"]).toContain(s.violation);
    }
  });

  it("uses the same baseline as a direct forecast: each scenario = baseline minus the cost from its date", async () => {
    const body = await json(await post({ costVnd: "750000", buyLater: { kind: "date", date: "2026-12-10" } }));
    const direct = forecastCashflow({
      profile: mapProfileRow(profileRow()),
      transactions: harness.db.tables.transactions!.map(mapTransactionRow),
      recurringItems: harness.db.tables.recurring_items!.map(mapRecurringRow),
      now: NOW,
    });
    direct.days.forEach((day, i) => {
      const now = BigInt(body.scenarios.now.series[i].balanceVnd);
      const later = BigInt(body.scenarios.later.series[i].balanceVnd);
      expect(now).toBe(day.closingBalanceVnd - 750000n);
      expect(later).toBe(day.date >= "2026-12-10" ? day.closingBalanceVnd - 750000n : day.closingBalanceVnd);
    });
  });

  it("AC-10: an interim reserve breach with a positive final balance is NOT safe", async () => {
    // Buying 1.000.000 now drops 2026-12-04 to 180.000 (< 300.000 reserve), then payday lifts the balance.
    const body = await json(await post({ costVnd: "1000000", buyLater: payday }));
    const now = body.scenarios.now;
    expect(BigInt(now.endBalanceVnd)).toBeGreaterThan(300000n);
    expect(now.safe).toBe(false);
    expect(now.violation).toBe("below_reserve");
    expect(now.minimumVnd).toBe("180000");
    expect(now.minimumDate).toBe("2026-12-04");
    expect(now.reserveBreachDays).toBeGreaterThan(0);
    expect(now.firstBreachDate).not.toBeNull();
    expect(now.reserveHeadroomVnd).toBe("-120000");
    expect(body.scenarios.later.safe).toBe(true);
    expect(body.bothUnsafe).toBe(false);
    expect(body.minimumImprovementVnd).toBe("1000000");
    const text = body.conclusions.join("\n");
    expect(text).toContain("giữa kỳ");
    expect(text).toContain("mức dự phòng");
  });

  it("reports bothUnsafe and suggests postponing or reducing, without a guarantee", async () => {
    const body = await json(await post({ costVnd: "5000000", buyLater: payday }));
    expect(body.bothUnsafe).toBe(true);
    expect(body.scenarios.now.safe).toBe(false);
    expect(body.scenarios.later.safe).toBe(false);
    const text = body.conclusions.join("\n");
    expect(text).toMatch(/hoãn/);
    expect(text).toMatch(/giảm/);
  });

  it("is deterministic for identical requests (AC-11)", async () => {
    const first = await (await post({ costVnd: "1000000", buyLater: payday })).text();
    for (let i = 0; i < 10; i += 1) expect(await (await post({ costVnd: "1000000", buyLater: payday })).text()).toBe(first);
  });

  it("treats an empty item name as no name", async () => {
    const body = await json(await post({ costVnd: "1000000", itemName: "   ", buyLater: payday }));
    expect(body.itemName).toBeNull();
  });
});

describe("POST /api/simulations/purchase: finance error mapping", () => {
  it("payday_unknown -> 422 asking the user to pick a date, never a comparison", async () => {
    resetHarness({
      financial_profiles: [owned(profileRow({ payday_day: null, expected_monthly_income_vnd: 0 }))],
    }, undefined, false);
    const res = await post({ costVnd: "1000000", buyLater: payday });
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error.details.financeCode).toBe("payday_unknown");
    expect(body.error.message).toMatch(/chọn một ngày/);
    expect(body).not.toHaveProperty("scenarios");
  });

  it("date_outside_horizon -> 422 telling the user to reselect inside the 45-day window", async () => {
    const res = await post({ costVnd: "1000000", buyLater: { kind: "date", date: "2027-01-08" } }); // day 46
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error.details).toMatchObject({ financeCode: "date_outside_horizon", startDate: "2026-11-24", endDate: "2027-01-07" });
    expect(body.error.message).toMatch(/chọn lại/);
    expect(body).not.toHaveProperty("scenarios");
  });

  it("accepts the last day of the window (day 45)", async () => {
    const res = await post({ costVnd: "1000000", buyLater: { kind: "date", date: "2027-01-07" } });
    expect(res.status).toBe(200);
  });

  it("rejects a buy-now date outside the window and a buy-later date that is not after buy-now", async () => {
    const past = await post({ costVnd: "1000000", buyNowDate: "2026-11-23", buyLater: payday });
    expect(past.status).toBe(422);
    expect((await json(past)).error.details.financeCode).toBe("date_outside_horizon");
    const same = await post({ costVnd: "1000000", buyLater: { kind: "date", date: "2026-11-24" } });
    expect(same.status).toBe(422);
    expect((await json(same)).error.details.financeCode).toBe("buy_later_not_after_buy_now");
  });

  it("an impossible calendar date is a 422 invalid_date, not a crash", async () => {
    const res = await post({ costVnd: "1000000", buyLater: { kind: "date", date: "2026-02-30" } });
    expect(res.status).toBe(422);
    expect((await json(res)).error.details.financeCode).toBe("invalid_date");
  });

  it("404 when the owner has no profile", async () => {
    resetHarness({}, { id: OWNER_ID, is_anonymous: false }, false);
    const res = await post({ costVnd: "1000000", buyLater: payday });
    expect(res.status).toBe(404);
  });

  it("known recurring income makes next_payday resolve without the profile fallback", async () => {
    resetHarness({
      recurring_items: [owned(recurringRow({ kind: "income", amount_vnd: 7000000, day_of_month: 15, label: "Lương" }))],
    });
    const body = await json(await post({ costVnd: "500000", buyLater: payday }));
    expect(body.scenarios.later.purchaseDate).toBe("2026-12-15");
  });
});
