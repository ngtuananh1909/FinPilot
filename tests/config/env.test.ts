import { describe, expect, it } from "vitest";
import { EnvValidationError } from "@/lib/config/env-core";
import { getPublicEnv } from "@/lib/config/public-env";
import { getAiConfigStatus, getServerEnv } from "@/lib/config/server-env";

const SECRET = "sk-super-secret-value-123";
const publicOk = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};
const aiOk = {
  AI_PROVIDER: "openrouter",
  AI_BASE_URL: "https://ai.example.com/v1",
  AI_API_KEY: SECRET,
  AI_MODEL: "m",
  AI_VISION_MODEL: "mv",
};

describe("getPublicEnv", () => {
  it("accepts valid values", () => {
    expect(getPublicEnv(publicOk).NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
  });
  it("rejects missing or blank public vars, naming keys only", () => {
    const run = () => getPublicEnv({ ...publicOk, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined });
    expect(run).toThrow(EnvValidationError);
    try {
      run();
    } catch (e) {
      const keys = (e as EnvValidationError).issues.map((i) => i.key);
      expect(keys).toEqual(expect.arrayContaining(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]));
    }
  });
  it("defaults the app URL", () => {
    expect(getPublicEnv({ ...publicOk, NEXT_PUBLIC_APP_URL: undefined }).NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });
});

describe("getServerEnv", () => {
  it("starts with an empty environment using defaults", () => {
    const env = getServerEnv({});
    expect(env).toMatchObject({
      AI_TIMEOUT_MS: 20000,
      AI_MAX_TOOL_STEPS: 4,
      GUEST_CHAT_DAILY_LIMIT: 20,
      GUEST_SCAN_DAILY_LIMIT: 5,
      RECEIPT_MAX_BYTES: 5242880,
      CSV_MAX_BYTES: 2097152,
    });
    expect(getAiConfigStatus(env)).toEqual({
      configured: false,
      missing: ["AI_PROVIDER", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_VISION_MODEL"],
    });
  });
  it("treats blank values from .env.example as unset", () => {
    expect(getServerEnv({ AI_API_KEY: "", AI_TIMEOUT_MS: "" }).AI_TIMEOUT_MS).toBe(20000);
  });
  it("rejects an unknown AI_PROVIDER without echoing it", () => {
    try {
      getServerEnv({ AI_PROVIDER: "evil-provider-xyz" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      expect((e as Error).message).toContain("AI_PROVIDER");
      expect((e as Error).message).not.toContain("evil-provider-xyz");
    }
  });
  it("rejects AI_MAX_TOOL_STEPS above 4 (and below 1)", () => {
    expect(() => getServerEnv({ AI_MAX_TOOL_STEPS: "5" })).toThrow(EnvValidationError);
    expect(() => getServerEnv({ AI_MAX_TOOL_STEPS: "0" })).toThrow(EnvValidationError);
    expect(getServerEnv({ AI_MAX_TOOL_STEPS: "3" }).AI_MAX_TOOL_STEPS).toBe(3);
  });
  it("reports configured AI with typed values", () => {
    const status = getAiConfigStatus(getServerEnv(aiOk));
    expect(status).toMatchObject({ configured: true, provider: "openrouter", model: "m", visionModel: "mv" });
  });
  it("lists partially missing AI vars by name only", () => {
    const status = getAiConfigStatus(getServerEnv({ ...aiOk, AI_MODEL: undefined }));
    expect(status).toEqual({ configured: false, missing: ["AI_MODEL"] });
  });
  it("never echoes secret values in validation errors", () => {
    try {
      getServerEnv({ ...aiOk, AI_BASE_URL: SECRET, SUPABASE_SERVICE_ROLE_KEY: SECRET, AI_MAX_TOOL_STEPS: SECRET });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(SECRET);
      expect(JSON.stringify((e as EnvValidationError).issues)).not.toContain(SECRET);
    }
  });
});
