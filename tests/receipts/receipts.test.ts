import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownerContextFromVerifiedUser } from "@/lib/auth/owner-context";
import type { AiRuntimeConfig } from "@/lib/ai/config";
import { ProviderAmbiguousError, ProviderPreResultError } from "@/lib/ai/errors";
import type { AIProvider } from "@/lib/ai/provider";
import { extractReceiptForOwner, type ReceiptDeps } from "@/lib/receipts/extract";
import { MIN_RECEIPT_BYTES, assertReceiptImage, readReceiptBytes, sniffImageType } from "@/lib/receipts/upload";
import { buildReceiptBody, checkReceiptFile, draftToFormValues } from "@/features/transactions/receipt";
import { transactionCreateBodySchema } from "@/lib/transactions/schemas";
import { OWNER_ID } from "../db/repositories/support/fake-client";
import { createMemoryDb, type MemoryDb } from "../assistant/support/memory-db";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(MIN_RECEIPT_BYTES).fill(1)]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(MIN_RECEIPT_BYTES).fill(0)]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, ...new Array(MIN_RECEIPT_BYTES).fill(0)]);
const PDF = new TextEncoder().encode(`%PDF-1.7 ${"x".repeat(100)}`);
const NOW = new Date("2026-11-24T05:00:00Z");

const req = (body: Uint8Array | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/receipts/extract", { method: "POST", headers, body: body as unknown as BodyInit });

describe("receipt upload validation", () => {
  it("sniffs JPEG, PNG and WebP from magic bytes", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    expect(sniffImageType(PDF)).toBeNull();
  });

  it("rejects a declared type that does not match the bytes (renamed or polyglot files)", () => {
    expect(() => assertReceiptImage("image/png", JPEG)).toThrowError(expect.objectContaining({ httpStatus: 415 }));
    expect(() => assertReceiptImage("image/jpeg", PDF)).toThrowError(expect.objectContaining({ httpStatus: 415 }));
    expect(() => assertReceiptImage("image/svg+xml", JPEG)).toThrowError(expect.objectContaining({ httpStatus: 415 }));
    expect(assertReceiptImage("image/jpeg; charset=binary", JPEG)).toBe("image/jpeg");
  });

  it("enforces the byte cap while reading and rejects empty or tiny bodies", async () => {
    await expect(readReceiptBytes(req(new Uint8Array(2000)), 1000)).rejects.toMatchObject({ httpStatus: 413 });
    await expect(readReceiptBytes(req(new Uint8Array(10), { "content-length": "999999" }), 1000)).rejects.toMatchObject({ httpStatus: 413 });
    await expect(readReceiptBytes(req(new Uint8Array(0)), 1000)).rejects.toMatchObject({ httpStatus: 415 });
    await expect(readReceiptBytes(req(new Uint8Array(10)), 1000)).rejects.toMatchObject({ httpStatus: 415 });
    expect((await readReceiptBytes(req(JPEG), 5_242_880)).byteLength).toBe(JPEG.byteLength);
  });
});

describe("extractReceiptForOwner (quota policy)", () => {
  let db: MemoryDb;
  const owner = ownerContextFromVerifiedUser({ userId: OWNER_ID, user: { id: OWNER_ID } as User, isAnonymous: true });
  const config = { maxToolSteps: 4 } as AiRuntimeConfig;
  const provider = (impl: AIProvider["extractReceipt"]): AIProvider => ({
    chatWithTools: async () => {
      throw new Error("unused");
    },
    extractReceipt: impl,
    checkCapabilities: async () => ({ tools: false, vision: true }),
  });
  const deps = (p: AIProvider): ReceiptDeps => ({ client: db.client as never, admin: db.admin as never, config, provider: p });
  const draft = { merchant: "Circle K", occurredAt: "2026-11-23T08:15:00+07:00", totalVnd: "45000", category: "food", confidence: 0.8, warnings: [] };

  beforeEach(() => {
    vi.stubEnv("GUEST_SCAN_DAILY_LIMIT", "5");
    db = createMemoryDb();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns a draft that requires confirmation, writes no transaction, uses one scan unit", async () => {
    const r = await extractReceiptForOwner(deps(provider(async () => draft)), owner, JPEG, "image/jpeg", NOW);
    expect(r).toMatchObject({ draft, requiresConfirmation: true, quota: { limit: 5, used: 1, remaining: 4 } });
    expect(db.tables.transactions ?? []).toHaveLength(0);
    expect(db.rpcLog.map((x) => x.fn)).toEqual(["reserve_ai_quota", "commit_ai_quota"]);
    expect(db.rpcLog[0]!.args).toMatchObject({ p_kind: "scan", p_user_id: OWNER_ID, p_limit: 5 });
  });

  it("AC-14: the 6th scan of the day is blocked server-side before the provider is called", async () => {
    db.tables.ai_usage_daily = [{ user_id: OWNER_ID, usage_date: "2026-11-24", chat_calls: 0, scan_calls: 5 }];
    let called = false;
    await expect(
      extractReceiptForOwner(deps(provider(async () => ((called = true), draft))), owner, JPEG, "image/jpeg", NOW),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(called).toBe(false);
  });

  it("releases the unit on a definitive rejection, keeps it on a timeout, never invents a draft", async () => {
    await expect(
      extractReceiptForOwner(deps(provider(async () => Promise.reject(new ProviderPreResultError("unsupported_capability")))), owner, JPEG, "image/jpeg", NOW),
    ).rejects.toBeInstanceOf(ProviderPreResultError);
    expect(db.tables.ai_usage_daily![0]!.scan_calls).toBe(0);
    await expect(
      extractReceiptForOwner(deps(provider(async () => Promise.reject(new ProviderAmbiguousError()))), owner, JPEG, "image/jpeg", NOW),
    ).rejects.toBeInstanceOf(ProviderAmbiguousError);
    expect(db.tables.ai_usage_daily![0]!.scan_calls).toBe(1);
  });
});

describe("receipt review form helpers", () => {
  it("checks file type and size on the client too", () => {
    expect(checkReceiptFile({ size: 10, type: "image/jpeg" })).toBeNull();
    expect(checkReceiptFile({ size: 6 * 1024 * 1024, type: "image/jpeg" })).toMatch(/5 MB/);
    expect(checkReceiptFile({ size: 10, type: "application/pdf" })).toMatch(/JPEG/);
    expect(checkReceiptFile({ size: 0, type: "image/png" })).toMatch(/trống/);
  });

  it("prefills an editable expense, falling back to now and 'other' for missing fields", () => {
    const v = draftToFormValues({ merchant: null, occurredAt: null, totalVnd: null, category: "weird", confidence: null, warnings: ["total_missing"] }, NOW);
    expect(v).toMatchObject({ kind: "expense", amount: "", merchant: "", category: "other", occurredAt: "2026-11-24T12:00" });
    const w = draftToFormValues({ merchant: "Circle K", occurredAt: "2026-11-23T08:15:00+07:00", totalVnd: "45000", category: "food", confidence: 0.9, warnings: [] }, NOW);
    expect(w).toMatchObject({ amount: "45.000", merchant: "Circle K", category: "food", occurredAt: "2026-11-23T08:15" });
  });

  it("saves through the normal transactions schema with source 'receipt'", () => {
    const v = draftToFormValues({ merchant: "Circle K", occurredAt: "2026-11-23T08:15:00+07:00", totalVnd: "45000", category: "food", confidence: 0.9, warnings: [] }, NOW);
    const body = buildReceiptBody(v);
    expect(body).toMatchObject({ source: "receipt", amountVnd: "45000", kind: "expense", merchant: "Circle K" });
    expect(transactionCreateBodySchema.safeParse(body).success).toBe(true);
  });
});
