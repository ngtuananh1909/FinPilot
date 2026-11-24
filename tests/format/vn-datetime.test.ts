import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/db/time";
import {
  dayHeadingVi,
  formatDateTimeVi,
  formatLocalDateVi,
  formatVnTime,
  isoToVnInput,
  toVnInputValue,
  vnInputToIso,
} from "@/lib/format/vn-datetime";
// vitest runs with TZ=America/New_York, so these also prove independence from the host timezone.
describe("Asia/Ho_Chi_Minh date-time conversion", () => {
  it("renders the Vietnam wall clock of an instant", () => {
    expect(toVnInputValue(new Date("2026-03-10T05:30:00Z"))).toBe("2026-03-10T12:30");
  });
  it("crosses the day boundary at 17:00 UTC", () => {
    expect(toVnInputValue(new Date("2026-01-31T16:59:00Z"))).toBe("2026-01-31T23:59");
    expect(toVnInputValue(new Date("2026-01-31T17:00:00Z"))).toBe("2026-02-01T00:00");
    expect(toVnInputValue(new Date("2025-12-31T17:00:00Z"))).toBe("2026-01-01T00:00");
  });
  it("converts input text to an ISO instant with +07:00", () => {
    const iso = vnInputToIso("2026-02-01T00:00");
    expect(iso).toBe("2026-02-01T00:00:00+07:00");
    expect(parseInstant(iso)?.toISOString()).toBe("2026-01-31T17:00:00.000Z");
    expect(parseInstant(vnInputToIso("2026-02-28T23:59"))?.toISOString()).toBe("2026-02-28T16:59:00.000Z");
  });
  it("rejects malformed or impossible values", () => {
    for (const bad of ["", "2026-02-30T10:00", "2026-13-01T10:00", "2026-02-01T24:00", "2026-02-01T10:60", "2026-02-01 10:00", "2026-02-01"]) {
      expect(vnInputToIso(bad), bad).toBeNull();
    }
  });
  it("accepts leap day only in leap years", () => {
    expect(vnInputToIso("2028-02-29T08:00")).toBe("2028-02-29T08:00:00+07:00");
    expect(vnInputToIso("2026-02-29T08:00")).toBeNull();
  });
  it("round-trips ISO <-> input for any offset", () => {
    expect(isoToVnInput("2026-02-01T00:00:00+07:00")).toBe("2026-02-01T00:00");
    expect(isoToVnInput("2026-01-31T17:00:00.000Z")).toBe("2026-02-01T00:00");
    expect(isoToVnInput("nonsense")).toBe("");
    const now = new Date("2026-06-15T03:07:00Z");
    expect(parseInstant(vnInputToIso(toVnInputValue(now)))?.getTime()).toBe(now.getTime());
  });
  it("formats times and dates for display", () => {
    expect(formatVnTime("2026-01-31T17:05:00Z")).toBe("00:05");
    expect(formatLocalDateVi("2026-11-23")).toBe("23/11/2026");
    expect(formatDateTimeVi("2026-01-31T17:05:00Z")).toBe("01/02/2026 00:05");
    expect(formatDateTimeVi("x")).toBe("—");
  });
  it("labels today and yesterday relative to Vietnam midnight", () => {
    const justAfterMidnightVn = new Date("2026-03-09T17:30:00Z"); // 2026-03-10 00:30 in Vietnam
    expect(dayHeadingVi("2026-03-10", justAfterMidnightVn)).toBe("Hôm nay · 10/03/2026");
    expect(dayHeadingVi("2026-03-09", justAfterMidnightVn)).toBe("Hôm qua · 09/03/2026");
    expect(dayHeadingVi("2026-03-08", justAfterMidnightVn)).toBe("08/03/2026");
  });
});
