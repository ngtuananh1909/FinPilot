import { describe, expect, it } from "vitest";
import { assertTargetAllowed, projectRefFromUrl } from "./target-guard";

describe("live-test target guard", () => {
  it("extracts the project ref from a hosted URL only", () => {
    expect(projectRefFromUrl("https://abcdefghijklmnop.supabase.co")).toBe("abcdefghijklmnop");
    expect(projectRefFromUrl("http://abcdefghijklmnop.supabase.co")).toBeNull();
    expect(projectRefFromUrl("https://abcdefghijklmnop.supabase.co.evil.example")).toBeNull();
    expect(projectRefFromUrl("not a url")).toBeNull();
  });

  it("refuses unset, malformed or mismatching configuration", () => {
    expect(() => assertTargetAllowed(undefined, "abcdefghijklmnop")).toThrow();
    expect(() => assertTargetAllowed("https://abcdefghijklmnop.supabase.co", undefined)).toThrow();
    expect(() => assertTargetAllowed("https://abcdefghijklmnop.supabase.co", "short")).toThrow();
    expect(() => assertTargetAllowed("https://zzzzzzzzzzzzzzzz.supabase.co", "abcdefghijklmnop")).toThrow(/Refusing/);
    expect(() => assertTargetAllowed("http://127.0.0.1:54321", "abcdefghijklmnop")).toThrow();
  });

  it("accepts only the exact approved ref", () => {
    expect(assertTargetAllowed("https://abcdefghijklmnop.supabase.co", "abcdefghijklmnop")).toBe("abcdefghijklmnop");
  });
});
