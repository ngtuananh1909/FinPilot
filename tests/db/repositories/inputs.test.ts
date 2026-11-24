import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  OFFSET_MAX,
  PAGE_DEFAULT,
  PAGE_MAX,
  clampLimit,
  clampOffset,
  goalUpsertSchema,
  parseInput,
  profileUpdateSchema,
  recurringCreateSchema,
  recurringUpdateSchema,
  sanitizeSearchTerm,
  transactionCreateSchema,
  transactionListSchema,
  transactionUpdateSchema,
} from "@/lib/db/inputs";

const validTx = { occurredAt: "2026-11-20T12:30:00+07:00", kind: "expense", amountVnd: "45000" };
const reason = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { reason?: string }).reason;
  }
  return undefined;
};

describe("strict schemas reject owner injection", () => {
  it.each([
    ["transactionCreate", transactionCreateSchema, validTx],
    ["transactionUpdate", transactionUpdateSchema, { category: "food" }],
    ["recurringCreate", recurringCreateSchema, { label: "x", kind: "expense", amountVnd: "1", dayOfMonth: 1, startDate: "2026-01-01" }],
    ["recurringUpdate", recurringUpdateSchema, { active: false }],
    ["goal", goalUpsertSchema, { name: "g", targetVnd: "1" }],
    ["profile", profileUpdateSchema, { displayName: "x" }],
    ["list", transactionListSchema, {}],
  ] as const)("%s refuses user_id / userId / owner keys", (_n, schema, base) => {
    expect(parseInput(schema, base)).toBeDefined();
    for (const key of ["user_id", "userId", "owner", "owner_id"]) {
      expect(reason(() => parseInput(schema, { ...base, [key]: "other" })), key).toBe("invalid_input");
    }
  });

  it("does not echo the submitted value in the error", () => {
    try {
      parseInput(transactionCreateSchema, { ...validTx, user_id: "SECRET-VALUE" });
      expect.unreachable();
    } catch (e) {
      expect(JSON.stringify((e as { safeDetails: unknown }).safeDetails)).not.toContain("SECRET-VALUE");
    }
  });

  it("profile update cannot set server-controlled fields", () => {
    for (const key of ["personaCode", "persona_code", "isDemo", "is_demo"]) {
      expect(reason(() => parseInput(profileUpdateSchema, { displayName: "x", [key]: true }))).toBe("invalid_input");
    }
  });

  it("transactions cannot be created with source 'seed'", () => {
    expect(reason(() => parseInput(transactionCreateSchema, { ...validTx, source: "seed" }))).toBe("invalid_input");
  });
});

describe("amount, date and pair validation", () => {
  it.each(["0", "-5", "10.5", "1e3", "", " 5", "9007199254740992", "abc"])("rejects amount %j", (amountVnd) => {
    expect(reason(() => parseInput(transactionCreateSchema, { ...validTx, amountVnd }))).toBe("invalid_input");
  });
  it("rejects number-typed amounts (JSON contract is a decimal string)", () => {
    expect(reason(() => parseInput(transactionCreateSchema, { ...validTx, amountVnd: 45000 }))).toBe("invalid_input");
  });
  it("accepts the largest safe amount", () => {
    expect(parseInput(transactionCreateSchema, { ...validTx, amountVnd: "9007199254740991" }).amountVnd).toBe(9007199254740991n);
  });
  it.each(["2026-11-20", "2026-11-20T12:30:00", "20/11/2026", "2026-02-30T00:00:00Z", "1999-01-01T00:00:00Z", "2200-01-01T00:00:00Z", "yesterday"])(
    "rejects instant %j (offset required, bounded)",
    (occurredAt) => {
      expect(reason(() => parseInput(transactionCreateSchema, { ...validTx, occurredAt }))).toBe("invalid_input");
    },
  );
  it("requires the recurring link pair (both or none)", () => {
    const id = "55555555-5555-4555-8555-555555555555";
    expect(reason(() => parseInput(transactionCreateSchema, { ...validTx, recurringItemId: id }))).toBe("invalid_input");
    expect(reason(() => parseInput(transactionCreateSchema, { ...validTx, recurringInstanceDate: "2026-11-05" }))).toBe("invalid_input");
    expect(reason(() => parseInput(transactionCreateSchema, { ...validTx, recurringItemId: id, recurringInstanceDate: "2026-02-30" }))).toBe("invalid_input");
    expect(reason(() => parseInput(transactionCreateSchema, { ...validTx, recurringItemId: "nope", recurringInstanceDate: "2026-11-05" }))).toBe("invalid_input");
    expect(parseInput(transactionCreateSchema, { ...validTx, recurringItemId: id, recurringInstanceDate: "2026-11-05" }).recurringItemId).toBe(id);
    expect(parseInput(transactionCreateSchema, validTx).recurringItemId).toBeUndefined();
  });
  it("validates recurring ranges and day of month", () => {
    const base = { label: "x", kind: "expense", amountVnd: "1", dayOfMonth: 31, startDate: "2026-05-01" };
    expect(parseInput(recurringCreateSchema, base).dayOfMonth).toBe(31);
    expect(reason(() => parseInput(recurringCreateSchema, { ...base, dayOfMonth: 32 }))).toBe("invalid_input");
    expect(reason(() => parseInput(recurringCreateSchema, { ...base, dayOfMonth: 0 }))).toBe("invalid_input");
    expect(reason(() => parseInput(recurringCreateSchema, { ...base, endDate: "2026-04-30" }))).toBe("invalid_input");
    expect(reason(() => parseInput(recurringUpdateSchema, {}))).toBe("invalid_input");
  });
  it("goal: positive target, non-negative saved", () => {
    expect(reason(() => parseInput(goalUpsertSchema, { name: "g", targetVnd: "0" }))).toBe("invalid_input");
    expect(reason(() => parseInput(goalUpsertSchema, { name: "g", targetVnd: "5", savedVnd: "-1" }))).toBe("invalid_input");
    expect(parseInput(goalUpsertSchema, { name: "g", targetVnd: "5" }).savedVnd).toBe(0n);
  });
});

describe("pagination clamps", () => {
  it("defaults and bounds", () => {
    expect(clampLimit(undefined)).toBe(PAGE_DEFAULT);
    expect(clampLimit(Number.NaN)).toBe(PAGE_DEFAULT);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-10)).toBe(1);
    expect(clampLimit(10_000)).toBe(PAGE_MAX);
    expect(clampLimit(Infinity)).toBe(PAGE_DEFAULT);
    expect(clampLimit(25.9)).toBe(25);
    expect(clampOffset(-5)).toBe(0);
    expect(clampOffset(1e12)).toBe(OFFSET_MAX);
    expect(clampOffset(undefined)).toBe(0);
  });
  it("always yields 1..200 and 0..OFFSET_MAX", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: false }), (n) => {
        const l = clampLimit(n);
        const o = clampOffset(n);
        expect(l).toBeGreaterThanOrEqual(1);
        expect(l).toBeLessThanOrEqual(PAGE_MAX);
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThanOrEqual(OFFSET_MAX);
      }),
    );
  });
  it("list schema applies them", () => {
    const f = parseInput(transactionListSchema, { limit: 9999, offset: -3 });
    expect(f.limit).toBe(PAGE_MAX);
    expect(f.offset).toBe(0);
    expect(parseInput(transactionListSchema, {}).limit).toBe(PAGE_DEFAULT);
  });
});

describe("filters", () => {
  it("validates kind, category and date range", () => {
    expect(reason(() => parseInput(transactionListSchema, { kind: "transfer" }))).toBe("invalid_input");
    expect(reason(() => parseInput(transactionListSchema, { category: "food,kind.eq.income" }))).toBe("invalid_input");
    expect(reason(() => parseInput(transactionListSchema, { category: "a)or(b" }))).toBe("invalid_input");
    expect(reason(() => parseInput(transactionListSchema, { fromDate: "2026-02-30" }))).toBe("invalid_input");
    expect(reason(() => parseInput(transactionListSchema, { fromDate: "2026-12-01", toDate: "2026-11-01" }))).toBe("invalid_input");
    expect(parseInput(transactionListSchema, { fromDate: "2026-11-01", toDate: "2026-11-01", kind: "income", category: "Ăn uống" }).category).toBe("Ăn uống");
  });
});

describe("sanitizeSearchTerm", () => {
  it.each([
    ["50%", "50"],
    ["a_b", "a b"],
    ["x,description.eq.secret", "x description.eq.secret"],
    ["x),user_id.eq.other,(y", "x user id.eq.other y".replace("user id", "user_id").replace("user_id", "user id")],
    ["or=(a,b)", "or a b"],
    ['"quoted"', "quoted"],
    ["back\\slash", "back slash"],
    ["*wild*", "wild"],
    ["Cà phê Highlands", "Cà phê Highlands"],
    ["O'Brien-Co.", "O'Brien-Co."],
  ])("neutralises %j", (raw, expected) => {
    expect(sanitizeSearchTerm(raw)).toBe(expected);
  });

  it("never lets filter metacharacters through, for any input", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (raw) => {
        const out = sanitizeSearchTerm(raw);
        expect(out).not.toMatch(/[%_,()\\"*=&:;<>|{}[\]]/);
        expect(out.length).toBeLessThanOrEqual(100);
      }),
    );
  });

  it("rejects searches that sanitise to nothing", () => {
    expect(reason(() => parseInput(transactionListSchema, { search: "%%%" }))).toBe("invalid_input");
    expect(reason(() => parseInput(transactionListSchema, { search: "   " }))).toBe("invalid_input");
  });
});
