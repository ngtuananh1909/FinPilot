import { describe, expect, it } from "vitest";
import { getAiRuntimeConfig, normaliseBaseUrl } from "@/lib/ai/config";
import { getServerEnv } from "@/lib/config/server-env";
import { AppError } from "@/lib/errors";

const full = {
  AI_PROVIDER: "gemini",
  AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
  AI_API_KEY: "sk-secret-value-123",
  AI_MODEL: "chat-model",
  AI_VISION_MODEL: "vision-model",
};

describe("getAiRuntimeConfig", () => {
  it("resolves a full configuration with a normalised base URL and capped tool steps", () => {
    const c = getAiRuntimeConfig(getServerEnv({ ...full, AI_MAX_TOOL_STEPS: "4" }), null);
    expect(c.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai/");
    expect(c.maxToolSteps).toBe(4);
    expect(c.provider).toBe("gemini");
  });

  it("rejects AI_MAX_TOOL_STEPS above 4 at env validation", () => {
    expect(() => getServerEnv({ ...full, AI_MAX_TOOL_STEPS: "9" })).toThrow();
  });

  it("raises ai_not_configured with variable NAMES only when anything is missing", () => {
    try {
      getAiRuntimeConfig(getServerEnv({ AI_PROVIDER: "openrouter", AI_API_KEY: "sk-secret-value-123" }), null);
      throw new Error("expected");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const e = error as AppError;
      expect(e.code).toBe("ai_not_configured");
      expect(e.httpStatus).toBe(503);
      expect(String(e.safeDetails?.missing)).toBe("AI_BASE_URL,AI_MODEL,AI_VISION_MODEL");
      expect(JSON.stringify(e.safeDetails)).not.toContain("sk-secret");
    }
  });

  it("requires https except for loopback", () => {
    expect(() => normaliseBaseUrl("http://api.example.com/v1")).toThrow();
    expect(normaliseBaseUrl("http://127.0.0.1:8080/v1")).toBe("http://127.0.0.1:8080/v1/");
    expect(normaliseBaseUrl("https://openrouter.ai/api/v1/?x=1#y")).toBe("https://openrouter.ai/api/v1/");
  });
});
