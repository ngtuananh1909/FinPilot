import { describe, expect, it } from "vitest";
import {
  assertPositiveVnd,
  divideRoundHalfUp,
  FinanceError,
  MAX_VND,
  parseVndString,
  vndToString,
} from "@/lib/finance";

describe("VND parsing at the JSON boundary", () => {
  it("accepts integer decimal strings", () => {
    expect(parseVndString("0")).toBe(0n);
    expect(parseVndString("1500000")).toBe(1_500_000n);
    expect(parseVndString("-250000", { allowNegative: true })).toBe(-250_000n);
    expect(parseVndString(MAX_VND.toString())).toBe(MAX_VND);
  });

  it.each(["", " 5", "5 ", "1.5", "1e3", "007", "-5", "+5", "1,000", "0x10", "٣"])(
    "rejects %j",
    (value) => {
      expect(() => parseVndString(value)).toThrow(FinanceError);
    },
  );

  it("rejects values beyond the safe-integer bound and non-strings", () => {
    expect(() => parseVndString((MAX_VND + 1n).toString())).toThrow(FinanceError);
    expect(() => parseVndString(1500000 as unknown as string)).toThrow(FinanceError);
  });

  it("round-trips through strings", () => {
    expect(vndToString(parseVndString("123456789"))).toBe("123456789");
  });

  it("requires positive amounts where needed", () => {
    expect(() => assertPositiveVnd(0n)).toThrow(FinanceError);
    expect(() => assertPositiveVnd(-1n)).toThrow(FinanceError);
    expect(() => assertPositiveVnd(1n)).not.toThrow();
  });

  it("rounds integer division half up", () => {
    expect(divideRoundHalfUp(10n, 4n)).toBe(3n); // 2.5 -> 3
    expect(divideRoundHalfUp(9n, 4n)).toBe(2n); // 2.25 -> 2
    expect(divideRoundHalfUp(11n, 4n)).toBe(3n); // 2.75 -> 3
    expect(divideRoundHalfUp(0n, 7n)).toBe(0n);
  });
});
