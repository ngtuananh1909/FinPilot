import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_VND } from "@/lib/finance";
import { parseDbVnd, vndForDb } from "@/lib/db/money";

describe("parseDbVnd", () => {
  it.each([
    [0, 0n],
    [45000, 45000n],
    [-250000, -250000n],
    [Number.MAX_SAFE_INTEGER, MAX_VND],
    ["0", 0n],
    ["1500000", 1500000n],
    ["-300", -300n],
    ["9007199254740991", MAX_VND],
    [123n, 123n],
  ])("accepts %s", (input, expected) => {
    expect(parseDbVnd(input)).toBe(expected);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["fraction", 10.5],
    ["unsafe number", Number.MAX_SAFE_INTEGER + 1],
    ["unsafe negative", -(Number.MAX_SAFE_INTEGER + 1)],
    ["null", null],
    ["undefined", undefined as unknown as null],
    ["empty string", ""],
    ["fractional string", "10.5"],
    ["decimal zero", "10.0"],
    ["exponent", "1e3"],
    ["whitespace", " 5"],
    ["leading zero", "007"],
    ["hex", "0x10"],
    ["beyond safe string", "9007199254740992"],
    ["beyond safe bigint", MAX_VND + 1n],
    ["object", {} as unknown as number],
    ["boolean", true as unknown as number],
  ])("rejects %s", (_name, input) => {
    expect(() => parseDbVnd(input as number)).toThrowError(expect.objectContaining({ code: "invalid_amount" }));
  });

  it("round-trips any safe integer through number, string and vndForDb", () => {
    fc.assert(
      fc.property(fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }), (n) => {
        const big = BigInt(n);
        expect(parseDbVnd(n)).toBe(big);
        expect(parseDbVnd(String(n))).toBe(big);
        expect(parseDbVnd(vndForDb(big))).toBe(big);
      }),
    );
  });
});

describe("vndForDb", () => {
  it("serializes as a decimal string", () => {
    expect(vndForDb(1500000n)).toBe("1500000");
    expect(vndForDb(-5n)).toBe("-5");
  });
  it("rejects out-of-range and non-bigint values", () => {
    expect(() => vndForDb(MAX_VND + 1n)).toThrowError();
    expect(() => vndForDb(-MAX_VND - 1n)).toThrowError();
    expect(() => vndForDb(5 as unknown as bigint)).toThrowError();
  });
});
