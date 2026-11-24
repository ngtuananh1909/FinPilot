import { expect, test } from "@playwright/test";
import { screenshot } from "./support/helpers";

/** AC-03 in a browser: each seeded email account logs in and sees its own persona. Opt-in: credentials in env. Read-only. */
const accounts = [1, 2, 3].map((i) => ({ i, email: process.env[`SEED_USER_${i}_EMAIL`], password: process.env[`SEED_USER_${i}_PASSWORD`] }));
test.skip(accounts.some((a) => !a.email || !a.password), "demo account credentials not provided");

for (const a of accounts) {
  test(`demo account ${a.i} logs in and sees its own data`, async ({ page }, info) => {
    await page.goto("/login");
    await page.getByLabel(/Email/i).fill(a.email!);
    await page.getByLabel(/Mật khẩu/i).fill(a.password!);
    await page.getByRole("button", { name: /Đăng nhập/ }).last().click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Tổng quan" })).toBeVisible();
    await expect(page.getByText(/₫/).first()).toBeVisible();
    await expect(page.getByText("Demo").first()).toBeVisible();
    await screenshot(page, info, `70-demo-account-${a.i}`);
  });
}
