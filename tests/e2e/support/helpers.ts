import { mkdirSync } from "node:fs";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { recordCreatedUser } from "./cleanup";

export const MAIN_ROUTES = ["/dashboard", "/transactions", "/assistant", "/simulator", "/settings"] as const;

/** Fails if the page can scroll horizontally (AC-17). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page must not scroll horizontally").toBeLessThanOrEqual(1);
}

export async function screenshot(page: Page, info: TestInfo, name: string): Promise<void> {
  mkdirSync("docs/evidence/screenshots", { recursive: true });
  await page.screenshot({ path: `docs/evidence/screenshots/${info.project.name}-${name}.png`, fullPage: true });
}

/** Welcome -> persona -> Dashboard as a NEW anonymous guest; the user id is recorded for cleanup. */
export async function startGuest(page: Page, personaName = "Sinh viên"): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: `Trải nghiệm demo với hồ sơ ${personaName}` }).click();
  await page.waitForURL("**/dashboard", { timeout: 45_000 });
  await recordCreatedUser(page.context());
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan" })).toBeVisible();
}

/** Every visible button/link in `main` and the navigation has a touch target of at least 40 px. */
export async function expectTapTargets(page: Page): Promise<void> {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("main button, main a, nav a, nav button"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || el.closest("p, li p, td")) continue; // inline text links
      if (r.height < 40 && r.width < 40) out.push(`${el.tagName}:${(el.textContent ?? "").trim().slice(0, 30)}`);
    }
    return out;
  });
  expect(small, "tap targets under 40px").toEqual([]);
}
