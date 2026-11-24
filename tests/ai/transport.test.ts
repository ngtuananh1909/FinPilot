import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProviderAmbiguousError, ProviderPreResultError } from "@/lib/ai/errors";
import { createChatCompletion, MAX_RESPONSE_BYTES, redact } from "@/lib/ai/transport";
import { toErrorResponse } from "@/lib/errors";
import { FAKE_KEY, completion, configFor, json, startFakeProvider } from "./support/fake-provider-server";

let server: Awaited<ReturnType<typeof startFakeProvider>>;
beforeAll(async () => {
  server = await startFakeProvider((_req, res) => json(res, 200, completion({ content: "xin chào" })));
});
afterAll(async () => server.close());

const call = (over = {}) =>
  createChatCompletion(configFor(server.url, over), { model: "test/model", messages: [{ role: "user", content: "hi" }] });

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected failure");
}

describe("createChatCompletion (OpenAI-compatible transport)", () => {
  it("posts to {base}/chat/completions with bearer auth, non-streaming, capped tokens", async () => {
    server.setHandler((_req, res) => json(res, 200, completion({ content: "xin chào" })));
    const before = server.requests.length;
    const r = await call();
    expect(r).toMatchObject({ content: "xin chào", toolCalls: [], finishReason: "stop" });
    expect(r.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    const req = server.requests[before]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/v1/chat/completions");
    expect(req.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(req.body).toMatchObject({ model: "test/model", stream: false });
    expect(req.body.max_tokens).toBeLessThanOrEqual(4096);
  });

  it("sends OpenRouter attribution headers only for openrouter", async () => {
    const before = server.requests.length;
    await call({ provider: "openrouter" });
    await call({ provider: "gemini" });
    expect(server.requests[before]!.headers["x-title"]).toBe("FinPilot AI");
    expect(server.requests[before]!.headers["http-referer"]).toBe("http://localhost:3000");
    expect(server.requests[before + 1]!.headers["x-title"]).toBeUndefined();
    expect(server.requests[before + 1]!.headers["http-referer"]).toBeUndefined();
  });

  it("normalises tool calls (missing ids get stable ids) and sends tools with tool_choice auto", async () => {
    server.setHandler((_req, res) =>
      json(res, 200, completion({ content: null, tool_calls: [{ type: "function", function: { name: "forecast_cashflow", arguments: "{}" } }] }, "tool_calls")),
    );
    const before = server.requests.length;
    const r = await createChatCompletion(configFor(server.url), {
      model: "m",
      messages: [{ role: "user", content: "x" }],
      tools: [{ type: "function", function: { name: "forecast_cashflow", description: "d", parameters: { type: "object" } } }],
    });
    expect(r.toolCalls).toEqual([{ id: "call_1", type: "function", function: { name: "forecast_cashflow", arguments: "{}" } }]);
    expect(server.requests[before]!.body.tool_choice).toBe("auto");
  });

  it("keeps provider extra_content (Gemini thought_signature) so it can be echoed back", async () => {
    const extra = { google: { thought_signature: "sig-abc123" } };
    server.setHandler((_req, res) =>
      json(res, 200, completion({ content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_savings_goal", arguments: "{}" }, extra_content: extra }] }, "tool_calls")),
    );
    const r = await call();
    expect(r.toolCalls[0]).toEqual({ id: "c1", type: "function", function: { name: "get_savings_goal", arguments: "{}" }, extra_content: extra });
  });

  it("rejects an oversized extra_content as an invalid response", async () => {
    server.setHandler((_req, res) =>
      json(res, 200, completion({ content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "x", arguments: "{}" }, extra_content: { google: { thought_signature: "s".repeat(20_000) } } }] })),
    );
    const err = (await failure(call())) as ProviderAmbiguousError;
    expect(err.reason).toBe("invalid_response");
  });

  it.each([
    [400, "provider_rejected"],
    [404, "provider_rejected"],
    [422, "provider_rejected"],
    [401, "invalid_config"],
    [403, "invalid_config"],
    [429, "rate_limited"],
  ])("HTTP %i is a definitive pre-result failure (%s): quota is released", async (status, reason) => {
    server.setHandler((_req, res) => json(res, status, { error: { message: `bad request for key ${FAKE_KEY}` } }));
    const err = await failure(call());
    expect(err).toBeInstanceOf(ProviderPreResultError);
    expect((err as ProviderPreResultError).reason).toBe(reason);
    expect((err as ProviderPreResultError).providerStatus).toBe(status);
  });

  it("classifies 'model does not support tools/images' as unsupported_capability", async () => {
    server.setHandler((_req, res) => json(res, 400, { error: { message: "This model does not support tool use" } }));
    const err = (await failure(call())) as ProviderPreResultError;
    expect(err.reason).toBe("unsupported_capability");
  });

  it.each([500, 502, 504])("HTTP %i is ambiguous: quota is kept, no retry", async (status) => {
    let hits = 0;
    server.setHandler((_req, res) => {
      hits += 1;
      json(res, status, "oops");
    });
    const err = (await failure(call())) as ProviderAmbiguousError;
    expect(err).toBeInstanceOf(ProviderAmbiguousError);
    expect(err.reason).toBe("server_error");
    expect(hits).toBe(1);
  });

  it("HTTP 503 (overloaded) is retried exactly once, then reported as pre-result (quota released)", async () => {
    let hits = 0;
    server.setHandler((_req, res) => {
      hits += 1;
      json(res, 503, { error: { code: 503, status: "UNAVAILABLE", message: "high demand" } });
    });
    const err = (await failure(call({ timeoutMs: 10_000 }))) as ProviderPreResultError;
    expect(err).toBeInstanceOf(ProviderPreResultError);
    expect(err.reason).toBe("provider_overloaded");
    expect(hits).toBe(2);
  });

  it("a 503 followed by success returns the second answer", async () => {
    let hits = 0;
    server.setHandler((_req, res) => {
      hits += 1;
      if (hits === 1) json(res, 503, { error: { status: "UNAVAILABLE" } });
      else json(res, 200, completion({ content: "ok sau khi thử lại" }));
    });
    const r = await call({ timeoutMs: 10_000 });
    expect(r.content).toBe("ok sau khi thử lại");
    expect(hits).toBe(2);
  });

  it("does not retry a 503 when the timeout budget is too small", async () => {
    let hits = 0;
    server.setHandler((_req, res) => {
      hits += 1;
      json(res, 503, { error: { status: "UNAVAILABLE" } });
    });
    await failure(call({ timeoutMs: 2_500 }));
    expect(hits).toBe(1);
  });

  it("asks Gemini for low reasoning effort and a 4096-token budget; OpenRouter gets no reasoning field", async () => {
    server.setHandler((_req, res) => json(res, 200, completion({ content: "x" })));
    const before = server.requests.length;
    await call({ provider: "gemini" });
    await call({ provider: "openrouter" });
    expect(server.requests[before]!.body).toMatchObject({ reasoning_effort: "low", max_tokens: 4096 });
    expect(server.requests[before + 1]!.body).not.toHaveProperty("reasoning_effort");
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["empty choices", { choices: [] }],
    ["wrong shape", { choices: [{ nope: true }] }],
    ["empty body", ""],
  ])("%s is an ambiguous invalid_response", async (_label, body) => {
    server.setHandler((_req, res) => json(res, 200, body));
    const err = (await failure(call())) as ProviderAmbiguousError;
    expect(err).toBeInstanceOf(ProviderAmbiguousError);
    expect(err.reason).toBe("invalid_response");
  });

  it("rejects an oversized body as ambiguous without buffering it all", async () => {
    server.setHandler((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("x".repeat(MAX_RESPONSE_BYTES + 10));
    });
    const err = (await failure(call())) as ProviderAmbiguousError;
    expect(err.reason).toBe("invalid_response");
  });

  it("times out a hanging provider as ambiguous_timeout", async () => {
    server.setHandler(() => undefined); // never answers
    const err = (await failure(call({ timeoutMs: 150 }))) as ProviderAmbiguousError;
    expect(err).toBeInstanceOf(ProviderAmbiguousError);
    expect(err.reason).toBe("ambiguous_timeout");
  });

  it("a refused connection is an ambiguous network failure", async () => {
    const err = (await failure(call({ baseUrl: "http://127.0.0.1:9/v1/" }))) as ProviderAmbiguousError;
    expect(err).toBeInstanceOf(ProviderAmbiguousError);
    expect(err.reason).toBe("network");
  });

  it("never leaks the API key into errors, causes or HTTP error responses", async () => {
    server.setHandler((_req, res) => json(res, 400, { error: { message: `invalid key ${FAKE_KEY} Bearer ${FAKE_KEY}` } }));
    const err = await failure(call());
    const everything = [err.message, String((err as { cause?: Error }).cause?.message), JSON.stringify((err as { safeDetails?: unknown }).safeDetails)];
    for (const text of everything) expect(text).not.toContain(FAKE_KEY);
    const res = toErrorResponse(err);
    expect(await res.text()).not.toContain(FAKE_KEY);
  });

  it("redact() strips the key and bearer tokens and caps length", () => {
    expect(redact(`a ${FAKE_KEY} b Bearer abc.def`, FAKE_KEY)).toBe("a [redacted] b Bearer [redacted]");
    expect(redact("x".repeat(1000), FAKE_KEY).length).toBe(200);
  });
});
