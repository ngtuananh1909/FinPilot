import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "@/lib/import/csv-parser";
import { ImportError } from "@/lib/import/errors";
import { csvLimits } from "@/lib/import/limits";

const reasonOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return (e as ImportError).reason;
  }
  return undefined;
};

describe("parseCsv", () => {
  it("parses a plain file", () => {
    const r = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
    expect(r.headers).toEqual(["a", "b", "c"]);
    expect(r.rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
    expect(r.delimiter).toBe(",");
  });

  it("strips a UTF-8 BOM so the first header is clean", () => {
    expect(parseCsv("\uFEFFdate,amount\n2026-11-01,45000").headers).toEqual(["date", "amount"]);
  });

  it("handles CRLF, bare CR and a missing final newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4").rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(parseCsv("a,b\r1,2\r3,4\r").rows).toHaveLength(2);
  });

  it("handles quoted delimiters, escaped quotes and embedded newlines", () => {
    const r = parseCsv('a,b\n"x, y","say ""hi"""\n"line1\nline2",z\n');
    expect(r.rows).toEqual([
      ["x, y", 'say "hi"'],
      ["line1\nline2", "z"],
    ]);
  });

  it("keeps a quote inside an unquoted cell literally and skips blank lines", () => {
    expect(parseCsv('a,b\n\n5" nail,x\n\n').rows).toEqual([['5" nail', "x"]]);
  });

  it("keeps empty cells and trailing delimiters", () => {
    expect(parseCsv("a,b,c\n1,,\n,,3").rows).toEqual([
      ["1", "", ""],
      ["", "", "3"],
    ]);
  });

  it("returns ragged rows unchanged (the analyser flags them)", () => {
    const r = parseCsv("a,b,c\n1,2\n1,2,3,4\n");
    expect(r.rows.map((x) => x.length)).toEqual([2, 4]);
  });

  it("detects ; and TAB delimiters", () => {
    expect(parseCsv("Ngày;Số tiền\n01/11/2026;45.000").delimiter).toBe(";");
    expect(parseCsv("date\tamount\n2026-11-01\t45000").delimiter).toBe("\t");
    expect(detectDelimiter("onlyoneColumn\nvalue")).toBe(",");
  });

  it("honours an explicit delimiter", () => {
    const r = parseCsv("a;b,c\n1;2,3", { delimiter: ";" });
    expect(r.headers).toEqual(["a", "b,c"]);
  });

  it("rejects empty and whitespace-only files", () => {
    expect(reasonOf(() => parseCsv(""))).toBe("empty_file");
    expect(reasonOf(() => parseCsv(" \n\r\n "))).toBe("empty_file");
    expect(reasonOf(() => parseCsv("\uFEFF"))).toBe("empty_file");
  });

  it("rejects a header-only file", () => {
    expect(reasonOf(() => parseCsv("date,amount\n"))).toBe("no_data_rows");
    expect(reasonOf(() => parseCsv("date,amount"))).toBe("no_data_rows");
  });

  it("rejects an all-empty header row", () => {
    expect(reasonOf(() => parseCsv(",,\n1,2,3"))).toBe("missing_header");
  });

  it("rejects NUL and other binary control bytes", () => {
    expect(reasonOf(() => parseCsv("a,b\n1,\u00002"))).toBe("binary_content");
    expect(reasonOf(() => parseCsv("a,b\n1,\u00012"))).toBe("binary_content");
  });

  it("rejects text containing the UTF-8 replacement character (undecodable bytes)", () => {
    expect(reasonOf(() => parseCsv("a,b\n1,\uFFFD"))).toBe("invalid_encoding");
  });

  it("rejects malformed quoting", () => {
    expect(reasonOf(() => parseCsv('a,b\n"open,2'))).toBe("unterminated_quote");
    expect(reasonOf(() => parseCsv('a,b\n"x"y,2'))).toBe("invalid_quote");
  });

  it("rejects oversize input by byte length (413) before parsing", () => {
    const limits = { ...csvLimits(), maxBytes: 20 };
    try {
      parseCsv("a,b\n" + "1,2\n".repeat(20), { limits });
      expect.unreachable();
    } catch (e) {
      expect((e as ImportError).reason).toBe("payload_too_large");
      expect((e as ImportError).httpStatus).toBe(413);
    }
    // multi-byte characters count as bytes, not code units
    expect(reasonOf(() => parseCsv("a\n" + "đ".repeat(10), { limits: { ...csvLimits(), maxBytes: 15 } }))).toBe(
      "payload_too_large",
    );
  });

  it("accepts 5000 data rows and rejects 5001", () => {
    const body = (n: number) => "a,b\n" + Array.from({ length: n }, (_, i) => `${i},x`).join("\n");
    expect(parseCsv(body(5000)).rows).toHaveLength(5000);
    expect(reasonOf(() => parseCsv(body(5001)))).toBe("too_many_rows");
  });

  it("rejects more than 30 columns and cells over 1000 characters", () => {
    const wide = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`).join(",");
    expect(parseCsv(`${wide(30)}\n${wide(30)}`).headers).toHaveLength(30);
    expect(reasonOf(() => parseCsv(`${wide(31)}\n${wide(31)}`))).toBe("too_many_columns");
    expect(parseCsv(`a\n${"x".repeat(1000)}`).rows[0]?.[0]).toHaveLength(1000);
    expect(reasonOf(() => parseCsv(`a\n${"x".repeat(1001)}`))).toBe("cell_too_long");
    expect(reasonOf(() => parseCsv(`a\n"${"x".repeat(1001)}"`))).toBe("cell_too_long");
  });

  it("never evaluates formula-looking cells: they stay plain text", () => {
    const cells = ["=HYPERLINK(\"http://evil\")", "+1+1", "-2+3", "@SUM(A1)", "=cmd|' /C calc'!A0"];
    const csv = "a\n" + cells.map((c) => `"${c.replace(/"/g, '""')}"`).join("\n");
    expect(parseCsv(csv).rows.map((r) => r[0])).toEqual(cells);
  });

  it("does not leak cell content in errors", () => {
    try {
      parseCsv('a\n"secret-value');
    } catch (e) {
      expect(JSON.stringify((e as ImportError).safeDetails)).not.toContain("secret");
      expect((e as ImportError).userMessage).not.toContain("secret");
    }
  });
});
