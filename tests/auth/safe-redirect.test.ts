import { describe, expect, it } from "vitest";
import { sanitizeNextPath } from "@/lib/auth/safe-redirect";

describe("sanitizeNextPath", () => {
  it.each(["/dashboard", "/transactions?tab=1", "/settings#goal", "/onboarding", "/a/b/c"])("keeps same-origin path %s", (path) => {
    expect(sanitizeNextPath(path)).toBe(path);
  });

  it.each([
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/\\/evil.com",
    "https://evil.com",
    "http://evil.com/dashboard",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,x",
    "evil.com",
    "dashboard",
    "",
    " /dashboard",
    "/dash board",
    "/\t/evil.com",
    "/\n/evil.com",
    "/%2fevil.com",
    "/%2F%2Fevil.com",
    "/%5cevil.com",
    "/%5Cevil.com",
    "/%252f%252fevil.com",
    "/%0d%0aSet-Cookie:x=1",
    "/%00",
    "/%E0%A4%A",
    `/${"a".repeat(600)}`,
  ])("rejects %j and falls back", (value) => {
    expect(sanitizeNextPath(value)).toBe("/dashboard");
  });

  it("rejects non-strings and honours a custom fallback", () => {
    expect(sanitizeNextPath(undefined)).toBe("/dashboard");
    expect(sanitizeNextPath(null)).toBe("/dashboard");
    expect(sanitizeNextPath(["/dashboard"])).toBe("/dashboard");
    expect(sanitizeNextPath("//evil.com", "/onboarding")).toBe("/onboarding");
  });
});
