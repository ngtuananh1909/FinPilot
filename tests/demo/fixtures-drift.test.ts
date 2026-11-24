import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DEMO_FIXTURES } from "@/lib/demo/fixtures.generated";

describe("generated demo fixtures", () => {
  it("match mock-data/* (run `npm run gen:demo-fixtures` after editing the sources)", () => {
    const out = execFileSync("node", ["tools/generate-demo-fixtures.mjs", "--check"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(out).toContain("up to date");
  });

  it("contain the three personas with seed-sized data", () => {
    expect(Object.keys(DEMO_FIXTURES.personas).sort()).toEqual(["at_risk", "student", "worker"]);
    for (const persona of Object.values(DEMO_FIXTURES.personas)) {
      expect(persona.transactions.length).toBeGreaterThanOrEqual(5);
      expect(persona.recurringItems.length).toBeGreaterThan(0);
      expect(persona.goal.targetVnd).toMatch(/^[1-9][0-9]*$/);
    }
  });
});
