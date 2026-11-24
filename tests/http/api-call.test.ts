import { describe, expect, it } from "vitest";
import { callApi, NETWORK_ERROR_MESSAGE, type FetchLike } from "@/lib/http/api-call";
const reply = (status: number, json: unknown): FetchLike => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => json,
});
describe("callApi", () => {
  it("returns data on success and sends JSON bodies with the right method", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return { ok: true, status: 201, json: async () => ({ ok: 1 }) };
    };
    const res = await callApi<{ ok: number }>(f, "DELETE", "/api/x", { confirm: true });
    expect(res).toEqual({ ok: true, status: 201, data: { ok: 1 } });
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(calls[0]?.init?.body).toBe('{"confirm":true}');
  });
  it("sends no body for GET", async () => {
    let init: RequestInit | undefined;
    await callApi(async (_u, i) => {
      init = i;
      return { ok: true, status: 200, json: async () => ({}) };
    }, "GET", "/api/x");
    expect(init?.body).toBeUndefined();
  });
  it("maps the error envelope including field, rule and reason", async () => {
    const res = await callApi(
      reply(400, { error: { code: "validation_failed", message: "Sai rồi", details: { field: "amountVnd", rule: "invalid_amount", reason: "invalid_input" } } }),
      "POST",
      "/api/x",
      {},
    );
    expect(res).toMatchObject({ ok: false, status: 400, code: "validation_failed", message: "Sai rồi", field: "amountVnd", rule: "invalid_amount", reason: "invalid_input" });
  });
  it("falls back to a Vietnamese default for malformed error bodies", async () => {
    const res = await callApi(reply(500, "<html>"), "GET", "/api/x");
    expect(res).toMatchObject({ ok: false, status: 500, code: "internal", field: null });
    if (!res.ok) expect(res.message).toMatch(/lỗi/i);
  });
  it("turns a thrown fetch into a network failure with status 0", async () => {
    const res = await callApi(async () => { throw new TypeError("offline"); }, "GET", "/api/x");
    expect(res).toMatchObject({ ok: false, status: 0, code: "network", message: NETWORK_ERROR_MESSAGE });
  });
  it("treats a 200 without a JSON object as a failure instead of returning garbage", async () => {
    const res = await callApi(reply(200, null), "GET", "/api/x");
    expect(res.ok).toBe(false);
  });
});
