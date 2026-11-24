import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, financeErrorToAppError, toAppError, toErrorResponse } from "@/lib/errors";
import { EnvValidationError } from "@/lib/config/env-core";
import { FinanceError } from "@/lib/finance";

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("error mapping", () => {
  it("maps FinanceError to a Vietnamese AppError exposing only the code", () => {
    const err = financeErrorToAppError(new FinanceError("invalid_amount", "internal detail 12345"));
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("finance_invalid_input");
    expect(err.httpStatus).toBe(422);
    expect(err.userMessage).toContain("Số tiền");
    expect(err.safeDetails).toEqual({ financeCode: "invalid_amount" });
    expect(err.userMessage).not.toContain("12345");
  });
  it("maps env validation errors to config_missing", () => {
    expect(toAppError(new EnvValidationError("server", [{ key: "K", reason: "r" }])).code).toBe("config_missing");
  });
  it("returns a generic response with no stack or secret for unknown errors", async () => {
    const res = toErrorResponse(new Error("db password=hunter2 at /srv/app/secret.ts:10"));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("secret.ts");
    expect(text).not.toContain("stack");
    expect(JSON.parse(text)).toEqual({ error: { code: "internal", message: expect.stringContaining("lỗi") } });
  });
  it("serializes AppError with status and safe details, never the cause", async () => {
    const res = toErrorResponse(new AppError("rate_limited", { safeDetails: { limit: 20 }, cause: new Error("hunter2") }));
    const text = await res.text();
    expect(res.status).toBe(429);
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text).error).toMatchObject({ code: "rate_limited", details: { limit: 20 } });
  });
  it("maps FinanceError through toErrorResponse", async () => {
    const res = toErrorResponse(new FinanceError("payday_unknown", "x"));
    expect(res.status).toBe(422);
    expect((await res.json()).error.details).toEqual({ financeCode: "payday_unknown" });
  });
});
