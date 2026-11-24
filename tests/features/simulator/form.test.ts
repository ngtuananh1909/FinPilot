import { describe, expect, it } from "vitest";
import {
  MAX_COST_DIGITS,
  MAX_ITEM_NAME,
  financeCodeOf,
  parseCostInput,
  toRequestBody,
  validateSimulatorForm,
  type DateBounds,
  type SimulatorFormValues,
} from "@/features/simulator/form";
import { purchaseSimulationBodySchema } from "@/features/simulator/schema";

const bounds: DateBounds = { min: "2026-11-24", max: "2027-01-07" }; // 45 days inclusive
const valid: SimulatorFormValues = {
  itemName: "  Bàn phím  ",
  costText: "1.500.000",
  buyNowDate: "2026-11-24",
  laterMode: "next_payday",
  laterDate: "",
};
const withValues = (over: Partial<SimulatorFormValues>): SimulatorFormValues => ({ ...valid, ...over });

describe("parseCostInput", () => {
  it.each([
    ["1500000", "1500000", "1.500.000"],
    ["1.500.000", "1500000", "1.500.000"],
    ["  1 500 000 ₫", "1500000", "1.500.000"],
    ["000123", "123", "123"],
    ["0", "", ""],
    ["abc", "", ""],
    ["-5", "5", "5"], // the sign is dropped, so a negative can never reach the API
    ["1,5", "15", "15"],
    ["", "", ""],
  ])("%j -> digits %j", (text, digits, display) => {
    expect(parseCostInput(text)).toEqual({ digits, display });
  });

  it("caps the length so the value stays inside the safe-integer VND range", () => {
    const parsed = parseCostInput("9".repeat(40));
    expect(parsed.digits).toHaveLength(MAX_COST_DIGITS);
    expect(Number.isSafeInteger(Number(parsed.digits))).toBe(true);
  });
});

describe("validateSimulatorForm", () => {
  it("accepts a complete next-payday form", () => {
    expect(validateSimulatorForm(valid, bounds)).toEqual({});
  });

  it("requires a positive amount", () => {
    for (const costText of ["", "0", "000", "abc"]) {
      expect(validateSimulatorForm(withValues({ costText }), bounds).cost).toBe("Nhập số tiền lớn hơn 0.");
    }
  });

  it("limits the item name to 80 characters after trimming (same rule as the schema)", () => {
    expect(validateSimulatorForm(withValues({ itemName: "a".repeat(MAX_ITEM_NAME) }), bounds).itemName).toBeUndefined();
    expect(validateSimulatorForm(withValues({ itemName: `  ${"a".repeat(MAX_ITEM_NAME)}  ` }), bounds).itemName).toBeUndefined();
    expect(validateSimulatorForm(withValues({ itemName: "a".repeat(MAX_ITEM_NAME + 1) }), bounds).itemName).toMatch(/80/);
  });

  describe("buy-now date window", () => {
    it("accepts both ends of the window", () => {
      expect(validateSimulatorForm(withValues({ buyNowDate: bounds.min }), bounds).buyNowDate).toBeUndefined();
      expect(validateSimulatorForm(withValues({ buyNowDate: bounds.max }), bounds).buyNowDate).toBeUndefined();
    });
    it.each([
      ["2026-11-23", "yesterday"],
      ["2027-01-08", "one day past the window"],
    ])("rejects %s (%s) with the window end in the message", (buyNowDate) => {
      expect(validateSimulatorForm(withValues({ buyNowDate }), bounds).buyNowDate).toContain("07/01/2027");
    });
    it("asks for a date when empty and rejects non-dates", () => {
      expect(validateSimulatorForm(withValues({ buyNowDate: "" }), bounds).buyNowDate).toBe("Hãy chọn ngày mua ngay.");
      for (const buyNowDate of ["2026-02-30", "26-11-2026", "not a date"]) {
        expect(validateSimulatorForm(withValues({ buyNowDate }), bounds).buyNowDate).toBe("Ngày mua ngay không hợp lệ.");
      }
    });
  });

  describe("buy-later date mode", () => {
    const later = (laterDate: string, buyNowDate = "2026-11-24") => withValues({ laterMode: "date", laterDate, buyNowDate });
    it("requires a date", () => {
      expect(validateSimulatorForm(later(""), bounds).laterDate).toBe("Hãy chọn ngày mua sau.");
    });
    it("must be strictly after the buy-now date", () => {
      expect(validateSimulatorForm(later("2026-11-24"), bounds).laterDate).toBe("Ngày mua sau phải muộn hơn ngày mua ngay.");
      expect(validateSimulatorForm(later("2026-11-23", "2026-11-25"), bounds).laterDate).toMatch(/khoảng 45 ngày|muộn hơn/);
      expect(validateSimulatorForm(later("2026-11-25"), bounds).laterDate).toBeUndefined();
    });
    it("must be inside the 45-day window (outside gives a reselect message, never a comparison)", () => {
      expect(validateSimulatorForm(later(bounds.max), bounds).laterDate).toBeUndefined();
      expect(validateSimulatorForm(later("2027-01-08"), bounds).laterDate).toContain("trong khoảng 45 ngày");
    });
    it("is not validated in next_payday mode (a stale hidden value must not block submit)", () => {
      expect(validateSimulatorForm(withValues({ laterMode: "next_payday", laterDate: "garbage" }), bounds)).toEqual({});
    });
  });
});

describe("toRequestBody against the real server schema", () => {
  it("next_payday: sends no date and passes the strict schema", () => {
    const body = toRequestBody(valid);
    expect(body).toEqual({ costVnd: "1500000", itemName: "Bàn phím", buyNowDate: "2026-11-24", buyLater: { kind: "next_payday" } });
    const parsed = purchaseSimulationBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.costVnd).toBe(1_500_000n);
      expect(parsed.data.itemName).toBe("Bàn phím");
    }
  });

  it("date mode: sends the picked date", () => {
    const body = toRequestBody(withValues({ laterMode: "date", laterDate: "2026-12-05" }));
    expect(body.buyLater).toEqual({ kind: "date", date: "2026-12-05" });
    expect(purchaseSimulationBodySchema.safeParse(body).success).toBe(true);
  });

  it("omits itemName when blank instead of sending an empty string", () => {
    const body = toRequestBody(withValues({ itemName: "   " }));
    expect("itemName" in body).toBe(false);
    expect(purchaseSimulationBodySchema.safeParse(body).success).toBe(true);
  });

  it("never contains a stale later date in next_payday mode, and the cost is a string, not a number", () => {
    const body = toRequestBody(withValues({ laterMode: "next_payday", laterDate: "2026-12-05" }));
    expect(JSON.stringify(body)).not.toContain("2026-12-05");
    expect(typeof body.costVnd).toBe("string");
    expect(() => JSON.stringify(body)).not.toThrow(); // no bigint
  });

  it("every body the client validator accepts is accepted by the server schema (including the length cap)", () => {
    const forms = [
      valid,
      withValues({ costText: "9".repeat(40) }),
      withValues({ itemName: "a".repeat(MAX_ITEM_NAME), laterMode: "date", laterDate: "2027-01-07" }),
    ];
    for (const form of forms) {
      expect(validateSimulatorForm(form, bounds)).toEqual({});
      expect(purchaseSimulationBodySchema.safeParse(toRequestBody(form)).success).toBe(true);
    }
  });

  it("the server schema rejects what the client never sends: owner keys, numeric cost, extra keys", () => {
    const ok = toRequestBody(valid);
    expect(purchaseSimulationBodySchema.safeParse({ ...ok, user_id: "x" }).success).toBe(false);
    expect(purchaseSimulationBodySchema.safeParse({ ...ok, costVnd: 1500000 }).success).toBe(false);
    expect(purchaseSimulationBodySchema.safeParse({ ...ok, buyLater: { kind: "next_payday", date: "2026-12-05" } }).success).toBe(false);
    expect(purchaseSimulationBodySchema.safeParse({ ...ok, costVnd: "0" }).success).toBe(false);
  });
});

describe("financeCodeOf", () => {
  it("reads error.details.financeCode and ignores anything malformed", () => {
    expect(financeCodeOf({ error: { details: { financeCode: "payday_unknown" } } })).toBe("payday_unknown");
    for (const json of [null, undefined, "x", 3, {}, { error: null }, { error: { details: null } }, { error: { details: { financeCode: 5 } } }]) {
      expect(financeCodeOf(json)).toBeNull();
    }
  });
});
