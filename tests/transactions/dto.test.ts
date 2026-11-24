import { describe, expect, it } from "vitest";
import { mapRecurringRow, mapTransactionRow } from "@/lib/db/mappers";
import { recurringRow, transactionRow } from "../db/repositories/support/fake-client";
import {
  impactToDto,
  pageToDto,
  recurringToDto,
  suggestionToDto,
  transactionToDto,
} from "@/lib/transactions/dto";
import { computeTransactionImpact } from "@/lib/transactions/impact";

describe("DTO serialisers", () => {
  it("transactionToDto uses strings for amounts, ISO dates, and hides user_id and fingerprint", () => {
    const record = mapTransactionRow(transactionRow({ fingerprint: "abc", amount_vnd: 45000 }));
    const dto = transactionToDto(record);
    expect(dto.amountVnd).toBe("45000");
    expect(dto.occurredAt).toBe("2026-11-20T05:30:00.000Z");
    expect(dto.localDate).toBe("2026-11-20");
    expect(dto).not.toHaveProperty("fingerprint");
    expect(dto).not.toHaveProperty("userId");
    expect(dto).not.toHaveProperty("user_id");
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it("localDate is the Vietnam date for late-UTC instants", () => {
    const dto = transactionToDto(mapTransactionRow(transactionRow({ occurred_at: "2026-11-20T18:30:00+00:00" })));
    expect(dto.localDate).toBe("2026-11-21");
  });

  it("serialises large VND amounts without bigint leaking", () => {
    const dto = transactionToDto(mapTransactionRow(transactionRow({ amount_vnd: "9007199254740991" })));
    expect(dto.amountVnd).toBe("9007199254740991");
    expect(JSON.stringify(dto)).toContain('"9007199254740991"');
  });

  it("maps null recurring link to null", () => {
    const dto = transactionToDto(mapTransactionRow(transactionRow()));
    expect(dto.recurringItemId).toBeNull();
    expect(dto.recurringInstanceDate).toBeNull();
  });

  it("recurringToDto stringifies the amount", () => {
    const dto = recurringToDto(mapRecurringRow(recurringRow()));
    expect(dto).toMatchObject({ amountVnd: "1500000", dayOfMonth: 5, active: true, endDate: null });
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it("impactToDto stringifies delta and carries a Vietnamese message", () => {
    const impact = computeTransactionImpact(
      { occurredAt: new Date("2026-11-10T00:00:00Z"), kind: "expense", amountVnd: 5n },
      new Date("2026-11-15T03:00:00Z"),
      new Date("2026-11-24T05:00:00Z"),
    );
    const dto = impactToDto(impact);
    expect(dto.balanceDeltaVnd).toBe("0");
    expect(dto.reason).toBe("before_snapshot");
    expect(dto.messageVi).toMatch(/phân tích/);
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it("suggestionToDto stringifies bigint fields", () => {
    const dto = suggestionToDto({
      itemId: "i",
      instanceDate: "2026-11-05",
      kind: "expense",
      expectedAmountVnd: 1_500_000n,
      candidates: [{ transactionId: "t", transactionDate: "2026-11-06", dayDistance: 1, amountDifferenceVnd: 10_000n }],
    });
    expect(dto.expectedAmountVnd).toBe("1500000");
    expect(dto.candidates[0]!.amountDifferenceVnd).toBe("10000");
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it("pageToDto maps items and keeps paging fields", () => {
    const page = pageToDto({ items: [1, 2], limit: 2, offset: 4, hasMore: true }, (n) => ({ n }));
    expect(page).toEqual({ items: [{ n: 1 }, { n: 2 }], limit: 2, offset: 4, hasMore: true });
  });
});
