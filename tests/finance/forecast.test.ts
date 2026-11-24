import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FinanceError, forecastCashflow, type FinanceTransaction } from "@/lib/finance";
import { input, profile, recurring, stable, tx, vn } from "./helpers";

const closing = (f: ReturnType<typeof forecastCashflow>) => f.days.map((d) => d.closingBalanceVnd);

describe("45-day forecast window", () => {
  it("covers D0..D0+44 inclusive in Vietnam local days", () => {
    const f = forecastCashflow(input());
    expect(f.horizonDays).toBe(45);
    expect(f.days).toHaveLength(45);
    expect(f.startDate).toBe("2026-11-23");
    expect(f.endDate).toBe("2027-01-06");
    expect(f.days[0]?.date).toBe("2026-11-23");
    expect(f.days[44]?.date).toBe("2027-01-06");
  });

  it("uses the Vietnam calendar day, not the host day, around midnight", () => {
    const f = forecastCashflow(input({ now: vn("2026-11-24T00:30:00") }));
    expect(f.startDate).toBe("2026-11-24");
    const late = forecastCashflow(input({ now: vn("2026-11-23T23:59:59") }));
    expect(late.startDate).toBe("2026-11-23");
  });

  it.each([0, -1, 367, 1.5, Number.NaN])("rejects horizon %s", (horizonDays) => {
    expect(() => forecastCashflow(input({ horizonDays }))).toThrow(FinanceError);
  });

  it("supports a custom shorter horizon", () => {
    expect(forecastCashflow(input({ horizonDays: 7 })).days).toHaveLength(7);
  });

  it("rejects a negative reserve and invalid payday", () => {
    expect(() => forecastCashflow(input({ profile: profile({ minimumReserveVnd: -1n }) }))).toThrow(FinanceError);
    expect(() => forecastCashflow(input({ profile: profile({ paydayDay: 32 }) }))).toThrow(FinanceError);
  });
});

describe("variable spending assumptions", () => {
  it("falls back to the profile estimate when there is no history", () => {
    const f = forecastCashflow(input({ profile: profile({ expectedDailyExpenseVnd: 100_000n }) }));
    expect(f.assumptions[0]).toMatchObject({
      code: "variable_expense_profile_fallback",
      dailyVnd: 100_000n,
      sampleTransactionCount: 0,
    });
    expect(f.days[0]?.closingBalanceVnd).toBe(2_900_000n);
    expect(f.days[44]?.closingBalanceVnd).toBe(3_000_000n - 45n * 100_000n);
  });

  it("reports a missing estimate instead of silently assuming zero", () => {
    const f = forecastCashflow(input());
    expect(f.assumptions[0]).toEqual({ code: "variable_expense_missing" });
    expect(new Set(closing(f))).toEqual(new Set([3_000_000n]));
    expect(f.summary.safe).toBe(true);
  });

  const history = (amounts: bigint[], firstDay = 16): FinanceTransaction[] =>
    amounts.map((amount, i) => tx("expense", amount, `2026-11-${String(firstDay + i).padStart(2, "0")}T12:00:00`));

  it("uses 30-day history when there are enough transactions and distinct days", () => {
    const f = forecastCashflow(
      input({
        profile: profile({ expectedDailyExpenseVnd: 999_000n }),
        transactions: history(Array(7).fill(70_000n)),
      }),
    );
    expect(f.assumptions[0]).toEqual({
      code: "variable_expense_history",
      dailyVnd: 70_000n,
      sampleTransactionCount: 7,
      sampleDayCount: 7,
      windowDays: 7,
    });
    expect(f.days[1]?.variableExpenseVnd).toBe(70_000n);
  });

  it("rounds the daily average half up", () => {
    const amounts = [...Array<bigint>(7).fill(100_000n), 100_004n]; // 800,004 / 8 days = 100,000.5
    const f = forecastCashflow(input({ transactions: history(amounts, 15) }));
    expect(f.assumptions[0]).toMatchObject({ code: "variable_expense_history", dailyVnd: 100_001n, windowDays: 8 });
  });

  it("falls back when distinct days are below 7, even with many transactions", () => {
    const sameDays = [
      ...history(Array(6).fill(50_000n)),
      tx("expense", 50_000n, "2026-11-16T18:00:00"),
      tx("expense", 50_000n, "2026-11-17T18:00:00"),
      tx("expense", 50_000n, "2026-11-18T18:00:00"),
    ];
    const f = forecastCashflow(input({ profile: profile({ expectedDailyExpenseVnd: 80_000n }), transactions: sameDays }));
    expect(f.assumptions[0]).toMatchObject({ code: "variable_expense_profile_fallback", sampleDayCount: 6 });
  });

  it("ignores income, excluded, recurring-linked, older than 30 days, and today's rows", () => {
    const noise = [
      tx("income", 9_000_000n, "2026-11-20T08:00:00"),
      tx("excluded", 400_000n, "2026-11-20T08:00:00"),
      tx("expense", 5_000_000n, "2026-11-20T08:00:00", { recurringItemId: "r", recurringInstanceDate: "2026-11-20" }),
      tx("expense", 777_000n, "2026-10-23T08:00:00"), // 31 days before D0
      tx("expense", 888_000n, "2026-11-23T08:00:00"), // today, before snapshot
    ];
    const f = forecastCashflow(input({ transactions: [...history(Array(7).fill(70_000n)), ...noise] }));
    expect(f.assumptions[0]).toMatchObject({ code: "variable_expense_history", dailyVnd: 70_000n, sampleTransactionCount: 7 });
  });

  it("includes the oldest day of the 30-day window", () => {
    const f = forecastCashflow(
      input({ transactions: [...history(Array(7).fill(70_000n)), tx("expense", 300_000n, "2026-10-24T08:00:00")] }),
    );
    expect(f.assumptions[0]).toMatchObject({ dailyVnd: 26_333n, windowDays: 30, sampleTransactionCount: 8 });
  });

  it("reduces today's estimate by variable spending already posted after the snapshot", () => {
    const p = profile({ expectedDailyExpenseVnd: 100_000n });
    const spent = forecastCashflow(input({ profile: p, transactions: [tx("expense", 30_000n, "2026-11-23T09:30:00")] }));
    expect(spent.days[0]?.variableExpenseVnd).toBe(70_000n);
    expect(spent.days[1]?.variableExpenseVnd).toBe(100_000n);
    expect(spent.startingBalanceVnd).toBe(2_970_000n);
    expect(spent.days[0]?.closingBalanceVnd).toBe(2_900_000n);

    const over = forecastCashflow(input({ profile: p, transactions: [tx("expense", 250_000n, "2026-11-23T09:30:00")] }));
    expect(over.days[0]?.variableExpenseVnd).toBe(0n);
    expect(over.days[0]?.closingBalanceVnd).toBe(2_750_000n);

    const before = forecastCashflow(input({ profile: p, transactions: [tx("expense", 250_000n, "2026-11-23T08:00:00")] }));
    expect(before.days[0]?.variableExpenseVnd).toBe(100_000n);
  });
});

describe("known items and recurrence", () => {
  it("places a future-dated expense on its own day only, not in today's balance", () => {
    const f = forecastCashflow(input({ transactions: [tx("expense", 400_000n, "2026-11-26T08:00:00")] }));
    expect(f.startingBalanceVnd).toBe(3_000_000n);
    expect(f.days[2]?.closingBalanceVnd).toBe(3_000_000n);
    expect(f.days[3]?.closingBalanceVnd).toBe(2_600_000n);
    expect(f.days[44]?.closingBalanceVnd).toBe(2_600_000n);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ date: "2026-11-26", source: "transaction" });
  });

  it("includes a later-today transaction in today's close but not the starting balance", () => {
    const f = forecastCashflow(input({ transactions: [tx("income", 500_000n, "2026-11-23T11:00:00")] }));
    expect(f.startingBalanceVnd).toBe(3_000_000n);
    expect(f.days[0]?.closingBalanceVnd).toBe(3_500_000n);
  });

  it("ignores future-dated excluded rows and rows beyond the horizon", () => {
    const f = forecastCashflow(
      input({
        transactions: [tx("excluded", 1_000_000n, "2026-11-30T08:00:00"), tx("expense", 1_000_000n, "2027-01-07T08:00:00")],
      }),
    );
    expect(f.events).toHaveLength(0);
    expect(f.summary.endBalanceVnd).toBe(3_000_000n);
  });

  it("projects monthly recurring items on their dates", () => {
    const rent = recurring({ id: "rent", amountVnd: 1_800_000n, dayOfMonth: 1 });
    const f = forecastCashflow(input({ recurringItems: [rent] }));
    expect(f.events.map((e) => e.date)).toEqual(["2026-12-01", "2027-01-01"]);
    expect(f.days[8]?.date).toBe("2026-12-01");
    expect(f.days[7]?.closingBalanceVnd).toBe(3_000_000n);
    expect(f.days[8]?.closingBalanceVnd).toBe(1_200_000n);
    expect(f.days[44]?.closingBalanceVnd).toBe(-600_000n);
  });

  it("clamps day 31 to Feb 28 (2027) and Feb 29 (leap 2028)", () => {
    const item = recurring({ id: "bill", amountVnd: 500_000n, dayOfMonth: 31 });
    const ordinary = forecastCashflow(
      input({ recurringItems: [item], now: vn("2027-02-10T10:00:00"), profile: profile({ balanceSnapshotAt: vn("2027-02-10T08:00:00") }) }),
    );
    expect(ordinary.events.map((e) => e.date)).toEqual(["2027-02-28", "2027-03-31"].filter((d) => d <= ordinary.endDate));
    expect(ordinary.events[0]?.date).toBe("2027-02-28");
    const leap = forecastCashflow(
      input({ recurringItems: [item], now: vn("2028-02-10T10:00:00"), profile: profile({ balanceSnapshotAt: vn("2028-02-10T08:00:00") }) }),
    );
    expect(leap.events[0]?.date).toBe("2028-02-29");
  });

  it("does not project a recurring occurrence already posted in the future (no duplicate)", () => {
    const rent = recurring({ id: "rent", amountVnd: 1_800_000n, dayOfMonth: 1 });
    const posted = tx("expense", 1_800_000n, "2026-11-30T20:00:00", {
      recurringItemId: "rent",
      recurringInstanceDate: "2026-12-01",
    });
    const withPosting = forecastCashflow(input({ recurringItems: [rent], transactions: [posted] }));
    const without = forecastCashflow(input({ recurringItems: [rent] }));
    expect(withPosting.events.filter((e) => e.date === "2026-12-01")).toHaveLength(0);
    expect(withPosting.events.filter((e) => e.refId === "rent")).toHaveLength(1); // only January
    expect(withPosting.days[8]?.closingBalanceVnd).toBe(without.days[8]?.closingBalanceVnd);
    expect(withPosting.summary.endBalanceVnd).toBe(without.summary.endBalanceVnd);
  });

  it("does not project an occurrence that was already posted today", () => {
    const rent = recurring({ id: "rent", amountVnd: 1_800_000n, dayOfMonth: 1 });
    const posted = tx("expense", 1_800_000n, "2026-12-01T08:00:00", {
      recurringItemId: "rent",
      recurringInstanceDate: "2026-12-01",
    });
    const f = forecastCashflow(
      input({
        recurringItems: [rent],
        transactions: [posted],
        now: vn("2026-12-01T10:00:00"),
      }),
    );
    expect(f.startingBalanceVnd).toBe(1_200_000n);
    expect(f.events.map((e) => e.date)).toEqual(["2027-01-01"]);
    expect(f.days[0]?.closingBalanceVnd).toBe(1_200_000n);
  });

  it("reports unposted occurrences after the snapshot day instead of guessing", () => {
    const p = profile({ balanceSnapshotAt: vn("2026-11-01T09:00:00") });
    const unposted = recurring({ id: "rent", amountVnd: 1_800_000n, dayOfMonth: 5 });
    const snapshotDay = recurring({ id: "snapday", amountVnd: 10n, dayOfMonth: 1 });
    const settledItem = recurring({ id: "utilities", amountVnd: 300_000n, dayOfMonth: 15 });
    const posted = tx("expense", 300_000n, "2026-11-15T10:00:00", {
      recurringItemId: "utilities",
      recurringInstanceDate: "2026-11-15",
    });
    const f = forecastCashflow(input({ profile: p, recurringItems: [unposted, snapshotDay, settledItem], transactions: [posted] }));
    expect(f.unreconciledOccurrences).toEqual([
      { itemId: "rent", date: "2026-11-05", kind: "expense", amountVnd: 1_800_000n },
    ]);
    expect(f.startingBalanceVnd).toBe(3_000_000n - 300_000n);
  });

  it("respects inactive and ended items", () => {
    const f = forecastCashflow(
      input({
        recurringItems: [
          recurring({ id: "off", active: false }),
          recurring({ id: "ended", endDate: "2026-11-30" }),
        ],
      }),
    );
    expect(f.events).toHaveLength(0);
  });
});

describe("income fallback from profile", () => {
  const base = { expectedMonthlyIncomeVnd: 5_000_000n, paydayDay: 5 };

  it("uses profile income when no recurring income is in force", () => {
    const f = forecastCashflow(input({ profile: profile(base) }));
    expect(f.events.map((e) => [e.date, e.source])).toEqual([
      ["2026-12-05", "profile_income"],
      ["2027-01-05", "profile_income"],
    ]);
    expect(f.assumptions.map((a) => a.code)).toContain("income_from_profile");
  });

  it("does not add profile income on top of recurring income (no double count)", () => {
    const salary = recurring({ id: "salary", kind: "income", amountVnd: 5_000_000n, dayOfMonth: 5 });
    const f = forecastCashflow(input({ profile: profile(base), recurringItems: [salary] }));
    expect(f.events.every((e) => e.source === "recurring")).toBe(true);
    expect(f.events).toHaveLength(2);
    expect(f.assumptions.map((a) => a.code)).not.toContain("income_from_profile");
  });

  it("falls back again when the recurring income is inactive or ended", () => {
    const off = recurring({ id: "salary", kind: "income", active: false });
    const ended = recurring({ id: "old", kind: "income", endDate: "2026-10-31" });
    const f = forecastCashflow(input({ profile: profile(base), recurringItems: [off, ended] }));
    expect(f.events.every((e) => e.source === "profile_income")).toBe(true);
  });

  it("adds nothing without a payday or income amount", () => {
    expect(forecastCashflow(input({ profile: profile({ expectedMonthlyIncomeVnd: 5_000_000n }) })).events).toHaveLength(0);
    expect(forecastCashflow(input({ profile: profile({ paydayDay: 5 }) })).events).toHaveLength(0);
  });
});

describe("reserve flags", () => {
  it("flags breaches against max(0, reserve) and counts them", () => {
    const f = forecastCashflow(
      input({ profile: profile({ minimumReserveVnd: 2_500_000n, expectedDailyExpenseVnd: 100_000n }) }),
    );
    expect(f.days[4]?.closingBalanceVnd).toBe(2_500_000n);
    expect(f.days[4]?.belowReserve).toBe(false); // equal to reserve is allowed
    expect(f.days[5]?.belowReserve).toBe(true);
    expect(f.summary.firstBelowReserveDate).toBe("2026-11-28");
    expect(f.summary.reserveBreachDays).toBe(40);
    expect(f.summary.firstBelowZeroDate).toBe("2026-12-23");
    expect(f.summary.safe).toBe(false);
    expect(f.summary.minimumDate).toBe("2027-01-06");
    expect(f.summary.minimumVnd).toBe(3_000_000n - 45n * 100_000n);
  });

  it("is safe when every day stays at or above the reserve", () => {
    const f = forecastCashflow(input({ profile: profile({ minimumReserveVnd: 3_000_000n }) }));
    expect(f.summary.safe).toBe(true);
    expect(f.summary.reserveBreachDays).toBe(0);
  });
});

describe("determinism and purity", () => {
  const fixed = input({
    profile: profile({ minimumReserveVnd: 500_000n, expectedDailyExpenseVnd: 120_000n, expectedMonthlyIncomeVnd: 4_000_000n, paydayDay: 31 }),
    recurringItems: [recurring({ id: "rent", amountVnd: 1_500_000n, dayOfMonth: 30 })],
    transactions: [tx("expense", 55_000n, "2026-11-23T09:20:00"), tx("income", 200_000n, "2026-11-29T09:20:00")],
  });
  const scenario = () => structuredClone(fixed);

  it("returns identical results across 100 replays", () => {
    const reference = stable(forecastCashflow(scenario()));
    for (let i = 0; i < 100; i += 1) expect(stable(forecastCashflow(scenario()))).toBe(reference);
  });

  it("does not mutate its inputs", () => {
    const given = scenario();
    const before = stable(given);
    forecastCashflow(given);
    expect(stable(given)).toBe(before);
  });

  it("is independent of the input order of transactions and recurring items", () => {
    const a = scenario();
    const b = { ...a, transactions: [...a.transactions].reverse(), recurringItems: [...a.recurringItems].reverse() };
    expect(stable(forecastCashflow(b))).toBe(stable(forecastCashflow(a)));
  });

  it("property: closing balances conserve start + known income - known expense - variable", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom<"income" | "expense">("income", "expense"), fc.integer({ min: 1, max: 3_000_000 }), fc.integer({ min: 0, max: 60 })), { maxLength: 15 }),
        fc.array(fc.tuple(fc.constantFrom<"income" | "expense">("income", "expense"), fc.integer({ min: 1, max: 3_000_000 }), fc.integer({ min: 1, max: 31 })), { maxLength: 6 }),
        fc.integer({ min: 0, max: 300_000 }),
        (txRows, recRows, daily) => {
          const transactions = txRows.map(([kind, amount, dayOffset], i) => ({
            id: `p-${i}`,
            kind,
            amountVnd: BigInt(amount),
            occurredAt: new Date(vn("2026-11-23T12:00:00").getTime() + dayOffset * 86_400_000),
          }));
          const recurringItems = recRows.map(([kind, amount, day], i) =>
            recurring({ id: `r-${i}`, kind, amountVnd: BigInt(amount), dayOfMonth: day }),
          );
          const f = forecastCashflow(
            input({ profile: profile({ expectedDailyExpenseVnd: BigInt(daily) }), transactions, recurringItems }),
          );
          let balance = f.startingBalanceVnd;
          for (const day of f.days) {
            balance = balance + day.incomeVnd - day.knownExpenseVnd - day.variableExpenseVnd;
            expect(day.closingBalanceVnd).toBe(balance);
          }
          const incomeEvents = f.events.filter((e) => e.kind === "income").reduce((s, e) => s + e.amountVnd, 0n);
          const expenseEvents = f.events.filter((e) => e.kind === "expense").reduce((s, e) => s + e.amountVnd, 0n);
          expect(f.days.reduce((s, d) => s + d.incomeVnd, 0n)).toBe(incomeEvents);
          expect(f.days.reduce((s, d) => s + d.knownExpenseVnd, 0n)).toBe(expenseEvents);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: posting a projected occurrence with the same amount on its day changes no closing balance", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 1, max: 4_000_000 }),
        fc.constantFrom<"income" | "expense">("income", "expense"),
        (day, amount, kind) => {
          const item = recurring({ id: "r", kind, amountVnd: BigInt(amount), dayOfMonth: day });
          const baseline = forecastCashflow(input({ recurringItems: [item] }));
          const target = baseline.events.find((e) => e.refId === "r");
          expect(target).toBeDefined();
          const posting = tx(kind, BigInt(amount), `${target!.date}T23:30:00`, {
            recurringItemId: "r",
            recurringInstanceDate: target!.date,
          });
          const posted = forecastCashflow(input({ recurringItems: [item], transactions: [posting] }));
          const targetIndex = baseline.days.findIndex((d) => d.date === target!.date);
          expect(closing(posted).slice(targetIndex)).toEqual(closing(baseline).slice(targetIndex));
          expect(posted.events.filter((e) => e.source === "recurring" && e.date === target!.date)).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
