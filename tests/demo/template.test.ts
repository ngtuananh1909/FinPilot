import { describe, expect, it } from "vitest";
import {
  balanceAt,
  forecastCashflow,
  localDateOf,
  type FinanceTransaction,
  type RecurringItem,
} from "@/lib/finance";
import { buildPersonaTemplate, toVietnamIso, type PersonaTemplate } from "@/lib/demo/template";
import { DEMO_FIXTURES } from "@/lib/demo/fixtures.generated";
import { PERSONA_CODES } from "@/lib/db/schema";

const vn = (iso: string) => new Date(`${iso}+07:00`);
const NOWS = [
  vn("2026-11-23T10:00:00"), // reference day (delta 0)
  vn("2026-12-05T00:05:00"), // just after local midnight
  vn("2027-01-31T23:59:30"), // month/year boundary
  vn("2028-03-01T08:00:00"), // after a leap day
];

function engineInput(t: PersonaTemplate, now: Date) {
  const transactions: FinanceTransaction[] = t.transactions.map((tx, i) => ({
    id: `t${i}`,
    occurredAt: new Date(tx.occurred_at),
    kind: tx.kind,
    amountVnd: BigInt(tx.amount_vnd),
  }));
  const recurringItems: RecurringItem[] = t.recurring_items.map((r, i) => ({
    id: `r${i}`,
    kind: r.kind,
    amountVnd: BigInt(r.amount_vnd),
    dayOfMonth: r.day_of_month,
    startDate: r.start_date,
    endDate: null,
    active: r.active,
  }));
  return {
    now,
    transactions,
    recurringItems,
    profile: {
      balanceSnapshotVnd: BigInt(t.profile.balance_snapshot_vnd),
      balanceSnapshotAt: new Date(t.profile.balance_snapshot_at),
      minimumReserveVnd: BigInt(t.profile.minimum_reserve_vnd),
      expectedDailyExpenseVnd: BigInt(t.profile.expected_daily_expense_vnd),
      expectedMonthlyIncomeVnd: BigInt(t.profile.expected_monthly_income_vnd),
      paydayDay: t.profile.payday_day,
    },
  };
}

describe("toVietnamIso", () => {
  it("renders +07:00 regardless of host timezone", () => {
    expect(toVietnamIso(new Date("2026-11-23T02:00:00Z"))).toBe("2026-11-23T09:00:00+07:00");
    expect(toVietnamIso(new Date("2026-12-31T17:30:15.999Z"))).toBe("2027-01-01T00:30:15+07:00");
  });
});

describe.each(PERSONA_CODES)("persona template: %s", (code) => {
  const fixture = DEMO_FIXTURES.personas[code];

  it("has exactly the keys the SQL function accepts and string amounts", () => {
    const t = buildPersonaTemplate(code, NOWS[0]!);
    expect(Object.keys(t).sort()).toEqual(["goal", "persona_code", "profile", "recurring_items", "transactions"]);
    expect(t.persona_code).toBe(code);
    expect(t.profile.is_demo).toBe(true);
    for (const tx of t.transactions) expect(tx.amount_vnd).toMatch(/^[1-9][0-9]*$/);
    expect(t.transactions).toHaveLength(fixture.transactions.length);
    expect(t.recurring_items).toHaveLength(fixture.recurringItems.length);
  });

  it("leaves dates unchanged on the fixture reference day and anchors the snapshot at now", () => {
    const now = NOWS[0]!;
    const t = buildPersonaTemplate(code, now);
    expect(t.transactions.map((x) => x.occurred_at)).toEqual(fixture.transactions.map((x) => x.occurredAt));
    expect(t.profile.balance_snapshot_at).toBe("2026-11-23T10:00:00+07:00");
    expect(t.goal.target_date).toBe(fixture.goal.targetDate);
  });

  it.each(NOWS.map((n) => [n.toISOString(), n] as const))("shifts every date by one delta (now=%s)", (_label, now) => {
    const t = buildPersonaTemplate(code, now);
    const delta = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
    const expected = delta(localDateOf(now), DEMO_FIXTURES.referenceDate);
    t.transactions.forEach((tx, i) => {
      const original = fixture.transactions[i]!.occurredAt;
      expect(delta(tx.occurred_at.slice(0, 10), original.slice(0, 10))).toBe(expected);
      expect(tx.occurred_at.slice(10)).toBe(original.slice(10)); // time of day and offset kept
    });
    t.recurring_items.forEach((item, i) => {
      expect(delta(item.start_date, fixture.recurringItems[i]!.startDate)).toBe(expected);
      expect(item.day_of_month).toBe(fixture.recurringItems[i]!.dayOfMonth); // calendar rule, not shifted
    });
    expect(delta(t.goal.target_date, fixture.goal.targetDate)).toBe(expected);
  });

  it.each(NOWS.map((n) => [n.toISOString(), n] as const))(
    "keeps all history older than the snapshot so the balance equals the snapshot (now=%s)",
    (_label, now) => {
      const t = buildPersonaTemplate(code, now);
      const input = engineInput(t, now);
      expect(balanceAt(input.profile, input.transactions, now)).toBe(BigInt(t.profile.balance_snapshot_vnd));
      for (const tx of input.transactions) {
        expect(tx.occurredAt.getTime()).toBeLessThan(input.profile.balanceSnapshotAt.getTime());
      }
    },
  );

  it.each(NOWS.map((n) => [n.toISOString(), n] as const))(
    "feeds the finance engine with history-based spending and no unreconciled items (now=%s)",
    (_label, now) => {
      const forecast = forecastCashflow(engineInput(buildPersonaTemplate(code, now), now));
      expect(forecast.days).toHaveLength(45);
      expect(forecast.assumptions[0]?.code).toBe("variable_expense_history");
      expect(forecast.unreconciledOccurrences).toEqual([]);
      expect(forecast.startingBalanceVnd).toBe(BigInt(fixture.profile.balanceSnapshotVnd));
    },
  );

  it("is deterministic", () => {
    expect(JSON.stringify(buildPersonaTemplate(code, NOWS[1]!))).toBe(JSON.stringify(buildPersonaTemplate(code, NOWS[1]!)));
  });
});

describe("template validation", () => {
  it("rejects an unknown persona", () => {
    expect(() => buildPersonaTemplate("nobody" as never, NOWS[0]!)).toThrow();
  });

  it("rejects an invalid clock", () => {
    expect(() => buildPersonaTemplate("student", new Date("nope"))).toThrow();
  });
});
