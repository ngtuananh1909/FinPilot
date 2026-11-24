import { describe, expect, it } from "vitest";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";

const req = (init: RequestInit & { headers?: Record<string, string> }, url = "http://localhost:3000/api/demo/start") =>
  new Request(url, { method: "POST", ...init });

describe("assertSameOrigin", () => {
  const APP = "https://app.example.com";
  it("accepts the configured origin", () => {
    expect(() => assertSameOrigin(req({ headers: { origin: APP } }), APP)).not.toThrow();
    expect(() => assertSameOrigin(req({ headers: { origin: APP } }), `${APP}/some/path`)).not.toThrow();
  });
  it.each([
    ["missing", {}],
    ["other site", { origin: "https://evil.example.com" }],
    ["scheme downgrade", { origin: "http://app.example.com" }],
    ["subdomain", { origin: "https://x.app.example.com" }],
    ["null origin", { origin: "null" }],
  ])("rejects %s origin", (_l, headers) => {
    expect(() => assertSameOrigin(req({ headers }), APP)).toThrowError(expect.objectContaining({ code: "forbidden" }));
  });
  it("fails closed on a broken app url", () => {
    expect(() => assertSameOrigin(req({ headers: { origin: APP } }), "not a url")).toThrowError(
      expect.objectContaining({ code: "config_missing" }),
    );
  });
});

describe("readJsonObject", () => {
  it("parses a small object", async () => {
    expect(await readJsonObject(req({ body: JSON.stringify({ a: 1 }) }))).toEqual({ a: 1 });
  });
  it.each([["not json", "{nope"], ["array", "[1]"], ["null", "null"], ["string", '"x"'], ["empty", ""]])(
    "rejects %s",
    async (_l, body) => {
      await expect(readJsonObject(req({ body }))).rejects.toMatchObject({ code: "validation_failed" });
    },
  );
  it("rejects oversize bodies", async () => {
    await expect(readJsonObject(req({ body: JSON.stringify({ a: "x".repeat(200) }) }), 100)).rejects.toMatchObject({
      code: "validation_failed",
    });
  });
});
