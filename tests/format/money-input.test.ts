import { describe, expect, it } from "vitest";
import {
  amountToInputText,
  diffVndStrings,
  displayDeltaVnd,
  displaySignedVnd,
  formatAmountInput,
  parseAmountField,
  percentOf,
} from "@/lib/format/money-input";
describe("formatAmountInput (live thousand separators)", () => {
  it.each([
    ["", ""],
    ["1", "1"],
    ["1500", "1.500"],
    ["1500000", "1.500.000"],
    ["1.500.0000", "15.000.000"],
    ["abc12x3", "123"],
    ["0001", "1"],
    ["0", "0"],
  ])("%j -> %j", (raw, expected) => {
    expect(formatAmountInput(raw)).toBe(expected);
  });
  it("drops a minus unless negatives are allowed, and keeps a lone minus while typing", () => {
    expect(formatAmountInput("-1500")).toBe("1.500");
    expect(formatAmountInput("-1500", { allowNegative: true })).toBe("-1.500");
    expect(formatAmountInput("-", { allowNegative: true })).toBe("-");
  });
  it("caps the digit count so the value always fits the API's safe-integer bound", () => {
    expect(formatAmountInput("9".repeat(30)).replace(/\./g, "")).toHaveLength(13);
  });
});
describe("parseAmountField", () => {
  it("returns a decimal string, never a number", () => {
    expect(parseAmountField("1.500.000", "positive")).toEqual({ ok: true, value: "1500000" });
    expect(parseAmountField("9007199254740", "positive")).toEqual({ ok: true, value: "9007199254740" });
  });
  it("rejects empty, zero (positive rule), decimals and negatives", () => {
    expect(parseAmountField("", "positive").ok).toBe(false);
    expect(parseAmountField("0", "positive").ok).toBe(false);
    expect(parseAmountField("0", "non_negative")).toEqual({ ok: true, value: "0" });
    expect(parseAmountField("12,5", "positive").ok).toBe(true); // separators are stripped, so this is 125
    expect(parseAmountField("1e3", "positive").ok).toBe(false);
    expect(parseAmountField("-5", "positive").ok).toBe(false);
    expect(parseAmountField("-5", "non_negative").ok).toBe(false);
    expect(parseAmountField("-5", "signed")).toEqual({ ok: true, value: "-5" });
  });
  it("round-trips through the input text", () => {
    expect(parseAmountField(amountToInputText("4850000"), "positive")).toEqual({ ok: true, value: "4850000" });
    expect(amountToInputText("-250000")).toBe("-250.000");
  });
});
describe("display helpers", () => {
  it("marks kind with a sign and keeps excluded neutral", () => {
    expect(displaySignedVnd("income", "4500000")).toBe("+4.500.000 ₫");
    expect(displaySignedVnd("expense", "45000")).toBe("−45.000 ₫");
    expect(displaySignedVnd("excluded", "45000")).toBe("45.000 ₫");
  });
  it("computes deltas with bigint, including values beyond 2^53", () => {
    expect(diffVndStrings("1000", "400")).toBe("600");
    expect(diffVndStrings("9007199254740993", "1")).toBe("9007199254740992");
    expect(diffVndStrings("x", "1")).toBeNull();
    expect(displayDeltaVnd("250000")).toBe("+250.000 ₫");
    expect(displayDeltaVnd("-250000")).toBe("-250.000 ₫");
    expect(displayDeltaVnd("0")).toBe("0 ₫");
  });
  it("computes percent with integer math", () => {
    expect(percentOf("6200000", "15000000")).toBe(41);
    expect(percentOf("15000000", "15000000")).toBe(100);
    expect(percentOf("20000000", "15000000")).toBe(100);
    expect(percentOf("1", "0")).toBeNull();
  });
});
