import { describe, expect, it } from "vitest";
import { sanitizeSearchTerm } from "@/lib/db/inputs";
import { EMPTY_FILTERS, buildListQuery, hasActiveFilters, sanitizeSearch, validateFilters } from "@/features/transactions/filters";
import { groupByLocalDate } from "@/features/transactions/grouping";
describe("buildListQuery", () => {
  it("always carries paging and omits empty filters", () => {
    expect(buildListQuery(EMPTY_FILTERS, { limit: 30, offset: 0 })).toBe("limit=30&offset=0");
  });
  it("includes every active filter", () => {
    const q = new URLSearchParams(
      buildListQuery(
        { search: "cơm tấm", kind: "expense", category: "food", fromDate: "2026-11-01", toDate: "2026-11-30" },
        { limit: 30, offset: 60 },
      ),
    );
    expect(Object.fromEntries(q)).toEqual({
      limit: "30",
      offset: "60",
      search: "cơm tấm",
      kind: "expense",
      category: "food",
      fromDate: "2026-11-01",
      toDate: "2026-11-30",
    });
  });
  it("cannot be used to inject parameters through the search text", () => {
    const query = buildListQuery({ ...EMPTY_FILTERS, search: "a&kind=income#x=1,(or)%_\\" }, { limit: 30, offset: 0 });
    const parsed = new URLSearchParams(query);
    expect([...parsed.keys()].sort()).toEqual(["limit", "offset", "search"]);
    expect(parsed.get("search")).toBe("a kind income x 1 or");
    expect(query).not.toMatch(/[#,()\\]/);
  });
  it("percent-encodes a category value", () => {
    const q = buildListQuery({ ...EMPTY_FILTERS, category: "a&b=c" }, { limit: 1, offset: 0 });
    expect(new URLSearchParams(q).get("category")).toBe("a&b=c");
    expect([...new URLSearchParams(q).keys()]).toEqual(["limit", "offset", "category"]);
  });
  it("drops a search that sanitizes to nothing (the API would answer 400)", () => {
    expect(buildListQuery({ ...EMPTY_FILTERS, search: "%%%___" }, { limit: 30, offset: 0 })).toBe("limit=30&offset=0");
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: "  %% " })).toBe(false);
  });
  it("sanitizes exactly like the server whitelist", () => {
    for (const raw of ["Highlands Coffee", "O'Brien-x.y", "a,b(c)\"d*e=f&g:h", "tiếng Việt 123", "%_\\", "  spaced   out  "]) {
      expect(sanitizeSearch(raw), raw).toBe(sanitizeSearchTerm(raw));
    }
  });
  it("validates the date range", () => {
    expect(validateFilters({ ...EMPTY_FILTERS, fromDate: "2026-02-02", toDate: "2026-02-01" })).toMatch(/trước/);
    expect(validateFilters({ ...EMPTY_FILTERS, fromDate: "2026-02-01", toDate: "2026-02-01" })).toBeNull();
    expect(validateFilters({ ...EMPTY_FILTERS, fromDate: "02/01/2026" })).toMatch(/chưa hợp lệ/);
  });
});
describe("groupByLocalDate", () => {
  const tx = (id: string, localDate: string) => ({ id, localDate });
  it("groups consecutive rows by local date and keeps order", () => {
    const groups = groupByLocalDate([tx("1", "2026-03-02"), tx("2", "2026-03-02"), tx("3", "2026-03-01")]);
    expect(groups.map((g) => [g.localDate, g.items.map((i) => i.id)])).toEqual([
      ["2026-03-02", ["1", "2"]],
      ["2026-03-01", ["3"]],
    ]);
  });
  it("drops duplicate ids when a later page overlaps", () => {
    const groups = groupByLocalDate([tx("1", "2026-03-02"), tx("2", "2026-03-01"), tx("2", "2026-03-01"), tx("3", "2026-03-01")]);
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(["1", "2", "3"]);
  });
  it("handles an empty list", () => {
    expect(groupByLocalDate([])).toEqual([]);
  });
});
