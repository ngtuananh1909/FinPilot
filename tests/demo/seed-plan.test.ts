import { describe, expect, it } from "vitest";
import {
  SeedError,
  assertApplyAllowed,
  maskEmail,
  parseProjectRef,
  planSeed,
  type SeedEnv,
} from "@/lib/demo/seed-accounts";
import { GOOD_ENV } from "./support/seed-env";

function failure(env: SeedEnv): SeedError {
  try {
    planSeed(env);
  } catch (error) {
    if (error instanceof SeedError) return error;
    throw error;
  }
  throw new Error("expected planSeed to throw");
}

describe("planSeed", () => {
  it("maps slots to personas in fixed order", () => {
    const plan = planSeed(GOOD_ENV);
    expect(plan.accounts.map((a) => [a.slot, a.personaCode])).toEqual([
      [1, "student"],
      [2, "worker"],
      [3, "at_risk"],
    ]);
  });

  it("accepts a password of exactly 12 characters", () => {
    expect(() => planSeed({ ...GOOD_ENV, SEED_USER_2_PASSWORD: "abcdefghijkl" })).not.toThrow();
  });

  it("normalises e-mails and keeps passwords out of enumerable output", () => {
    const plan = planSeed({ ...GOOD_ENV, SEED_USER_1_EMAIL: "  Alice.Student@Example.TEST " });
    expect(plan.accounts[0]!.email).toBe("alice.student@example.test");
    expect(plan.accounts[0]!.password).toBe("placeholder-pass-111");
    expect(JSON.stringify(plan)).not.toContain("placeholder-pass");
    expect(Object.keys(plan.accounts[0]!)).not.toContain("password");
  });

  it.each([
    ["missing e-mail", { SEED_USER_2_EMAIL: undefined }, "SEED_USER_2_EMAIL", "missing"],
    ["blank password", { SEED_USER_3_PASSWORD: "   " }, "SEED_USER_3_PASSWORD", "missing"],
    ["malformed e-mail", { SEED_USER_1_EMAIL: "not-an-email" }, "SEED_USER_1_EMAIL", "invalid_email"],
    ["11-char password", { SEED_USER_2_PASSWORD: "abcdefghijk" }, "SEED_USER_2_PASSWORD", "weak_password"],
    ["73-char password", { SEED_USER_2_PASSWORD: "x".repeat(73) }, "SEED_USER_2_PASSWORD", "weak_password"],
    ["duplicate e-mail (case-insensitive)", { SEED_USER_2_EMAIL: "ALICE.student@example.test" }, "SEED_USER_2_EMAIL", "duplicate_email"],
    ["duplicate password", { SEED_USER_3_PASSWORD: "placeholder-pass-111" }, "SEED_USER_3_PASSWORD", "duplicate_password"],
  ])("rejects %s", (_label, override, variable, reason) => {
    const env = { ...GOOD_ENV, ...override } as SeedEnv;
    const error = failure(env);
    expect(error.code).toBe("invalid_configuration");
    expect(error.issues).toContainEqual({ variable, reason });
  });

  it("never puts e-mail or password values in error messages", () => {
    const env: SeedEnv = {
      SEED_USER_1_EMAIL: "dup.person@example.test",
      SEED_USER_1_PASSWORD: "sharedpassword-AAA",
      SEED_USER_2_EMAIL: "DUP.person@example.test",
      SEED_USER_2_PASSWORD: "sharedpassword-AAA",
      SEED_USER_3_EMAIL: "broken-email-value",
      SEED_USER_3_PASSWORD: "tiny",
    };
    const error = failure(env);
    const text = `${error.message} ${JSON.stringify(error.issues)} ${String(error.stack ?? "").split("\n")[0]}`;
    for (const secret of ["dup.person", "example.test", "sharedpassword", "broken-email-value", "tiny"]) {
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(error.message).toContain("SEED_USER_3_EMAIL");
  });
});

describe("maskEmail", () => {
  it("masks local part and domain", () => {
    expect(maskEmail("alice@mail.example.com")).toBe("a***@m***.com");
    expect(maskEmail("bob@example.test")).toBe("b***@e***.test");
  });
  it("never returns the full address", () => {
    for (const email of ["a@b.c", "nodomain", "x@y"]) expect(maskEmail(email)).not.toBe(email);
  });
});

describe("project ref gate", () => {
  const URL_ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co" };

  it("parses refs only from hosted supabase.co URLs", () => {
    expect(parseProjectRef("https://abcdefghijklmnop.supabase.co")).toBe("abcdefghijklmnop");
    expect(parseProjectRef("https://abcdefghijklmnop.supabase.co/rest/v1")).toBe("abcdefghijklmnop");
    expect(parseProjectRef("http://127.0.0.1:54321")).toBeNull();
    expect(parseProjectRef("https://evil.example.com")).toBeNull();
    expect(parseProjectRef("not a url")).toBeNull();
    expect(parseProjectRef(undefined)).toBeNull();
  });

  it("passes only when both variables equal the URL ref", () => {
    const ok = { ...URL_ENV, SEED_ALLOWED_PROJECT_REF: "abcdefghijklmnop", SEED_CONFIRM_PROJECT_REF: "ABCDEFGHIJKLMNOP" };
    expect(assertApplyAllowed(ok)).toBe("abcdefghijklmnop");
  });

  it.each([
    ["no allowed ref", { SEED_CONFIRM_PROJECT_REF: "abcdefghijklmnop" }],
    ["no confirm ref", { SEED_ALLOWED_PROJECT_REF: "abcdefghijklmnop" }],
    ["confirm mismatch", { SEED_ALLOWED_PROJECT_REF: "abcdefghijklmnop", SEED_CONFIRM_PROJECT_REF: "zzzzzzzzzzzzzzzz" }],
    ["allowed mismatch", { SEED_ALLOWED_PROJECT_REF: "zzzzzzzzzzzzzzzz", SEED_CONFIRM_PROJECT_REF: "abcdefghijklmnop" }],
    ["blank refs", { SEED_ALLOWED_PROJECT_REF: " ", SEED_CONFIRM_PROJECT_REF: " " }],
  ])("refuses: %s", (_label, extra) => {
    expect(() => assertApplyAllowed({ ...URL_ENV, ...extra })).toThrow(SeedError);
  });

  it("refuses a missing or non-hosted URL even if refs are set", () => {
    const refs = { SEED_ALLOWED_PROJECT_REF: "abcdefghijklmnop", SEED_CONFIRM_PROJECT_REF: "abcdefghijklmnop" };
    expect(() => assertApplyAllowed(refs)).toThrow(SeedError);
    expect(() => assertApplyAllowed({ ...refs, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" })).toThrow(SeedError);
  });
});
