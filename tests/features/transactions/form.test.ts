import { describe, expect, it } from "vitest";
import { transactionCreateBodySchema, transactionPatchBodySchema } from "@/lib/transactions/schemas";
import type { RecurringDto, TransactionDto } from "@/lib/transactions/dto";
import { toApiFailure } from "@/lib/http/api-call";
import {
  buildCreateBody,
  buildPatchBody,
  emptyFormValues,
  linkableItems,
  mapTransactionFailure,
  nearestOccurrence,
  occurrenceOptions,
  validateTransactionForm,
  valuesFromTransaction,
} from "@/features/transactions/form";
const NOW = new Date("2026-03-10T05:30:00Z"); // 2026-03-10 12:30 in Vietnam
const filled = () => ({ ...emptyFormValues(NOW), amount: "1.500.000", merchant: "  Cơm tấm  ", description: "" });
const tx = (over: Partial<TransactionDto> = {}): TransactionDto => ({
  id: "11111111-1111-4111-8111-111111111111",
  occurredAt: "2026-03-09T03:00:00.000Z",
  localDate: "2026-03-09",
  kind: "expense",
  amountVnd: "65000",
  category: "food",
  merchant: "Cơm tấm Cali",
  description: null,
  source: "manual",
  importBatchId: null,
  recurringItemId: null,
  recurringInstanceDate: null,
  createdAt: "2026-03-09T03:00:00.000Z",
  updatedAt: "2026-03-09T03:00:00.000Z",
  ...over,
});
const item = (over: Partial<RecurringDto> = {}): RecurringDto => ({
  id: "22222222-2222-4222-8222-222222222222",
  label: "Tiền trọ",
  kind: "expense",
  amountVnd: "3000000",
  dayOfMonth: 31,
  category: "rent",
  startDate: "2025-01-01",
  endDate: null,
  active: true,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  ...over,
});
describe("manual form defaults and validation", () => {
  it("defaults to an expense dated now in Vietnam with the other category", () => {
    const v = emptyFormValues(NOW);
    expect(v).toMatchObject({ kind: "expense", occurredAt: "2026-03-10T12:30", category: "other", recurringItemId: "" });
  });
  it("flags missing amount, zero amount and bad date", () => {
    expect(validateTransactionForm({ ...emptyFormValues(NOW) }).amount).toMatch(/nhập/);
    expect(validateTransactionForm({ ...filled(), amount: "0" }).amount).toMatch(/lớn hơn 0/);
    expect(validateTransactionForm({ ...filled(), occurredAt: "" }).occurredAt).toBeDefined();
    expect(validateTransactionForm({ ...filled(), occurredAt: "2026-02-30T10:00" }).occurredAt).toBeDefined();
    expect(validateTransactionForm(filled())).toEqual({});
  });
  it("requires an instance date when an item is chosen and blocks links on excluded", () => {
    expect(validateTransactionForm({ ...filled(), recurringItemId: "x" }).recurringInstanceDate).toBeDefined();
    expect(validateTransactionForm({ ...filled(), kind: "excluded", recurringItemId: "x", recurringInstanceDate: "2026-03-01" }).recurringItemId).toBeDefined();
  });
});
describe("request bodies", () => {
  it("builds a create body the server schema accepts, with a decimal string amount and +07:00", () => {
    const body = buildCreateBody(filled());
    expect(body).toEqual({
      kind: "expense",
      amountVnd: "1500000",
      occurredAt: "2026-03-10T12:30:00+07:00",
      category: "other",
      merchant: "Cơm tấm",
      source: "manual",
    });
    expect(typeof body.amountVnd).toBe("string");
    const parsed = transactionCreateBodySchema.parse(body);
    expect(parsed.amountVnd).toBe(1500000n);
    expect(parsed.occurredAt.toISOString()).toBe("2026-03-10T05:30:00.000Z");
  });
  it("sends the link as a pair", () => {
    const body = buildCreateBody({ ...filled(), recurringItemId: "22222222-2222-4222-8222-222222222222", recurringInstanceDate: "2026-02-28" });
    expect(transactionCreateBodySchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ recurringItemId: "22222222-2222-4222-8222-222222222222", recurringInstanceDate: "2026-02-28" });
  });
  it("builds a patch with only the changed fields and no stray keys", () => {
    const original = valuesFromTransaction(tx());
    expect(buildPatchBody(original, original)).toBeNull();
    const patch = buildPatchBody({ ...original, amount: "70.000", merchant: "" }, original);
    expect(patch).toEqual({ amountVnd: "70000", merchant: null });
    expect(transactionPatchBodySchema.safeParse(patch).success).toBe(true);
  });
  it("sends both link keys when linking and clearing", () => {
    const original = valuesFromTransaction(tx());
    const link = buildPatchBody({ ...original, recurringItemId: "22222222-2222-4222-8222-222222222222", recurringInstanceDate: "2026-02-28" }, original);
    expect(link).toEqual({ recurringItemId: "22222222-2222-4222-8222-222222222222", recurringInstanceDate: "2026-02-28" });
    expect(transactionPatchBodySchema.safeParse(link).success).toBe(true);
    const linked = valuesFromTransaction(tx({ recurringItemId: "22222222-2222-4222-8222-222222222222", recurringInstanceDate: "2026-02-28" }));
    const clear = buildPatchBody({ ...linked, recurringItemId: "", recurringInstanceDate: "" }, linked);
    expect(clear).toEqual({ recurringItemId: null, recurringInstanceDate: null });
    expect(transactionPatchBodySchema.safeParse(clear).success).toBe(true);
  });
  it("does not resend an unchanged instant even after the seconds were dropped by the input", () => {
    const original = valuesFromTransaction(tx({ occurredAt: "2026-03-09T03:00:45.000Z" }));
    expect(buildPatchBody({ ...original }, original)).toBeNull();
  });
});
describe("error envelope mapping", () => {
  const fail = (status: number, error: object) => toApiFailure(status, { error });
  it("attaches a field error to the amount input", () => {
    const m = mapTransactionFailure(fail(400, { code: "validation_failed", message: "generic", details: { field: "amountVnd", rule: "invalid_amount" } }));
    expect(m.fieldErrors.amount).toMatch(/lớn hơn 0/);
    expect(m.general).toBeNull();
  });
  it("explains the recurring link rules in Vietnamese", () => {
    const m = mapTransactionFailure(fail(400, { code: "validation_failed", message: "generic", details: { field: "recurringInstanceDate", rule: "not_an_occurrence" } }));
    expect(m.fieldErrors.recurringInstanceDate).toMatch(/không phải một kỳ/);
  });
  it("shows the server's own message for unmapped failures", () => {
    const m = mapTransactionFailure(fail(409, { code: "validation_failed", message: "Khoản định kỳ này đã được ghi nhận cho ngày đó.", details: { reason: "db_conflict" } }));
    expect(m).toMatchObject({ fieldErrors: {}, general: "Khoản định kỳ này đã được ghi nhận cho ngày đó.", notFound: false });
  });
  it("maps 404 to the deleted-or-missing message", () => {
    const m = mapTransactionFailure(fail(404, { code: "not_found", message: "Không tìm thấy" }));
    expect(m).toMatchObject({ notFound: true, general: "Giao dịch đã bị xóa hoặc không tồn tại." });
  });
  it("shows a network failure as a general message", () => {
    const m = mapTransactionFailure({ ok: false, status: 0, code: "network", message: "offline", field: null, rule: null, reason: null });
    expect(m.general).toBe("offline");
  });
});
describe("recurring link options", () => {
  it("offers the clamped 28th for a day-31 item in non-leap February", () => {
    const dates = occurrenceOptions(item(), new Date("2026-03-10T05:30:00Z"));
    expect(dates).toContain("2026-02-28");
    expect(dates).toContain("2026-01-31");
    expect(dates).not.toContain("2026-02-31");
    expect([...dates]).toEqual([...dates].sort().reverse());
  });
  it("uses Feb 29 in a leap year", () => {
    expect(occurrenceOptions(item(), new Date("2028-03-10T05:30:00Z"))).toContain("2028-02-29");
  });
  it("respects start and end dates", () => {
    const dates = occurrenceOptions(item({ dayOfMonth: 5, startDate: "2026-02-01", endDate: "2026-02-28" }), NOW);
    expect(dates).toEqual(["2026-02-05"]);
  });
  it("always keeps an already linked instance selectable", () => {
    expect(occurrenceOptions(item({ dayOfMonth: 5, startDate: "2026-02-01", endDate: "2026-02-28" }), NOW, "2025-06-05")).toContain("2025-06-05");
  });
  it("picks the occurrence nearest to the transaction date", () => {
    expect(nearestOccurrence(["2026-03-01", "2026-02-01", "2026-04-01"], "2026-03-05")).toBe("2026-03-01");
    expect(nearestOccurrence(["2026-03-01", "2026-02-01", "2026-04-01"], "2026-03-25")).toBe("2026-04-01");
    expect(nearestOccurrence([], "2026-03-25")).toBeNull();
  });
  it("lists only active items of the same kind and none for excluded", () => {
    const items = [item(), item({ id: "b", kind: "income" }), item({ id: "c", active: false })];
    expect(linkableItems(items, "expense").map((i) => i.id)).toEqual([item().id]);
    expect(linkableItems(items, "income").map((i) => i.id)).toEqual(["b"]);
    expect(linkableItems(items, "excluded")).toEqual([]);
    expect(linkableItems(items, "expense", "c").map((i) => i.id)).toEqual([item().id, "c"]);
  });
});
