import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("npm run ai:probe (manual capability probe)", () => {
  it("prints BLOCKED and exits 3 when AI is not configured, without contacting any provider", () => {
    const r = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "--import",
        "./scripts/seed-ts-loader.mjs",
        "src/lib/ai/probe-cli.ts",
      ],
      { cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 30_000 },
    );
    expect(r.stdout).toContain("BLOCKED: AI is not configured");
    expect(r.status).toBe(3);
  });
});
