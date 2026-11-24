import { describe, expect, it } from "vitest";
import { getPublicEnv } from "@/lib/config/public-env";

const base = { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk", NEXT_PUBLIC_APP_URL: "http://localhost:3000" };

describe("NEXT_PUBLIC_SUPABASE_URL normalisation", () => {
  it.each([
    "https://abcdefghijklmnopqrst.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co/",
    "https://abcdefghijklmnopqrst.supabase.co/rest/v1/",
    "https://abcdefghijklmnopqrst.supabase.co/rest/v1",
  ])("keeps only the origin of %s", (url) => {
    expect(getPublicEnv({ ...base, NEXT_PUBLIC_SUPABASE_URL: url }).NEXT_PUBLIC_SUPABASE_URL).toBe(
      "https://abcdefghijklmnopqrst.supabase.co",
    );
  });
  it("rejects plain http", () => {
    expect(() => getPublicEnv({ ...base, NEXT_PUBLIC_SUPABASE_URL: "http://abcdefghijklmnopqrst.supabase.co" })).toThrow();
  });
});
