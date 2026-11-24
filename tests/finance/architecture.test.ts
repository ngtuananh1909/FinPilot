import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "src/lib/finance");
const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));

describe("finance module purity", () => {
  it("has source files to inspect", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)("%s only imports sibling modules (no AI, DB, network or framework code)", (file) => {
    const source = readFileSync(join(dir, file), "utf8");
    const specifiers = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const specifier of specifiers) expect(specifier.startsWith("./")).toBe(true);
  });

  it.each(files)("%s reads no clock, randomness, environment or network", (file) => {
    const source = readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/Date\.now\s*\(/);
    expect(source).not.toMatch(/new Date\s*\(\s*\)/);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/Intl\./);
  });
});
