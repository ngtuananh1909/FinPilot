import { describe, expect, it } from "vitest";
import { MAX_VND } from "@/lib/finance";
import { assertTargetDateAllowed, goalProgress } from "@/lib/settings/goal";

describe("goalProgress", () => {
  it("0 saved", () => {
    expect(goalProgress(1_000_000n, 0n)).toEqual({ percent: 0, remainingVnd: 1_000_000n, reached: false });
  });
  it("rounds down so 100 means reached", () => {
    expect(goalProgress(1000n, 999n)).toEqual({ percent: 99, remainingVnd: 1n, reached: false });
    expect(goalProgress(3n, 1n).percent).toBe(33);
  });
  it("exactly target", () => {
    expect(goalProgress(500n, 500n)).toEqual({ percent: 100, remainingVnd: 0n, reached: true });
  });
  it("over target is capped at 100 with zero remaining", () => {
    expect(goalProgress(500n, 9_000n)).toEqual({ percent: 100, remainingVnd: 0n, reached: true });
  });
  it("tiny ratio stays 0, no float rounding", () => {
    expect(goalProgress(MAX_VND, 1n).percent).toBe(0);
  });
  it("huge values keep exact bigint arithmetic", () => {
    const p = goalProgress(MAX_VND, MAX_VND - 1n);
    expect(p.percent).toBe(99);
    expect(p.remainingVnd).toBe(1n);
    expect(goalProgress(MAX_VND, MAX_VND / 2n).percent).toBe(49);
  });
  it("rejects invalid inputs", () => {
    expect(() => goalProgress(0n, 0n)).toThrow();
    expect(() => goalProgress(10n, -1n)).toThrow();
  });
});

describe("assertTargetDateAllowed (Asia/Ho_Chi_Minh today)", () => {
  const now = new Date("2026-11-24T05:00:00Z"); // 2026-11-24 local
  it("accepts today, future and null/undefined", () => {
    expect(() => assertTargetDateAllowed("2026-11-24", null, now)).not.toThrow();
    expect(() => assertTargetDateAllowed("2027-01-01", null, now)).not.toThrow();
    expect(() => assertTargetDateAllowed(null, null, now)).not.toThrow();
    expect(() => assertTargetDateAllowed(undefined, "2020-01-01", now)).not.toThrow();
  });
  it("rejects a past date", () => {
    expect(() => assertTargetDateAllowed("2026-11-23", null, now)).toThrow();
  });
  it("accepts an unchanged past date but not a different past date", () => {
    expect(() => assertTargetDateAllowed("2026-01-01", "2026-01-01", now)).not.toThrow();
    expect(() => assertTargetDateAllowed("2026-01-02", "2026-01-01", now)).toThrow();
  });
  it("uses the Vietnam calendar day, not UTC", () => {
    const lateUtc = new Date("2026-11-24T20:00:00Z"); // already 2026-11-25 in Vietnam
    expect(() => assertTargetDateAllowed("2026-11-24", null, lateUtc)).toThrow();
    expect(() => assertTargetDateAllowed("2026-11-25", null, lateUtc)).not.toThrow();
  });
});
