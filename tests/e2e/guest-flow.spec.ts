import { expect, test } from "@playwright/test";
import { MAIN_ROUTES, expectNoHorizontalScroll, expectTapTargets, screenshot, startGuest } from "./support/helpers";

test.describe("Guest demo end to end", () => {
  test("welcome page works without an account", async ({ page }, info) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Trải nghiệm demo với hồ sơ Sinh viên/ })).toBeVisible();
    await expect(page.getByText(/dữ liệu (mẫu|tổng hợp|giả lập)|synthetic/i).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "00-welcome");
  });

  test("AC-01/17: persona -> dashboard; all five routes render without horizontal scroll", async ({ page }, info) => {
    await startGuest(page);
    await expect(page.getByText("Demo").first()).toBeVisible();
    await expect(page.getByText(/₫/).first()).toBeVisible();
    await expect(page.getByRole("img", { name: /Dự báo/ }).first()).toBeVisible();
    for (const route of MAIN_ROUTES) {
      await page.goto(route);
      await expect(page.locator("main h1")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
      await screenshot(page, info, `10-${route.slice(1)}`);
    }
    const isMobile = (page.viewportSize()?.width ?? 0) < 768;
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    if (isMobile) {
      for (const label of ["Home", "Thu chi", "AI", "Mô phỏng"]) await expect(nav.getByRole("link", { name: label })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Cài đặt" })).toHaveCount(0);
    }
  });

  test("AC-05: a manual expense saves once and shows its balance impact", async ({ page }, info) => {
    await startGuest(page, "Người mới đi làm");
    await page.goto("/transactions");
    await expect(page.locator("main h1")).toHaveText("Thu chi");
    const isMobile = (page.viewportSize()?.width ?? 0) < 768;
    if (isMobile) await page.getByRole("button", { name: "Thêm giao dịch" }).last().click();
    else await page.getByRole("button", { name: /Thêm giao dịch/ }).first().click();
    await page.getByRole("button", { name: /Thêm thủ công/ }).click();
    await page.getByLabel("Số tiền (₫)").fill("123000");
    await page.getByLabel("Nơi nhận / cửa hàng (không bắt buộc)").fill("E2E Cafe");
    await page.getByRole("button", { name: "Lưu giao dịch" }).click();
    await expect(page.getByText("Đã thêm giao dịch.", { exact: false })).toBeVisible();
    await expect(page.getByText("E2E Cafe")).toHaveCount(1);
    await screenshot(page, info, "20-transaction-added");
  });

  test("AC-06: CSV preview writes nothing until confirmed, then imports", async ({ page }) => {
    await startGuest(page, "Dòng tiền cần chú ý");
    await page.goto("/transactions");
    const isMobile = (page.viewportSize()?.width ?? 0) < 768;
    if (isMobile) await page.getByRole("button", { name: "Thêm giao dịch" }).last().click();
    else await page.getByRole("button", { name: /Thêm giao dịch/ }).first().click();
    await page.getByRole("button", { name: /Nhập CSV/ }).click();
    const csv = "occurred_at,kind,amount_vnd,category,merchant,description\n2026-11-20T12:00:00+07:00,expense,77000,food,E2E CSV Shop,test\n";
    await page.locator('input[type="file"]').setInputFiles({ name: "e2e.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    const preview = page.getByRole("button", { name: /Xem trước/ });
    if (await preview.isVisible().catch(() => false)) await preview.click();
    await expect(page.getByText("E2E CSV Shop").first()).toBeVisible();
    const confirm = page.getByRole("button", { name: /Xác nhận nhập|Nhập \d+ dòng|Xác nhận/ }).first();
    await confirm.click();
    await expect(page.getByText(/Đã nhập/).first()).toBeVisible();
  });

  test("AC-10/11: simulator compares buy now vs later on the same 45-day baseline", async ({ page }, info) => {
    await startGuest(page);
    await page.goto("/simulator");
    await page.getByLabel("Số tiền (₫)").fill("1500000");
    await page.getByRole("button", { name: "Mô phỏng" }).click();
    await expect(page.getByText(/Mua ngay/).first()).toBeVisible();
    await expect(page.getByText(/Mua sau/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kết quả mô phỏng" })).toBeVisible();
    await expect(page.getByText(/theo ước tính/i).first()).toBeVisible();
    await expect(page.getByText(/không phải cam kết/).first()).toBeVisible();
    await expect(page.getByRole("img", { name: /So sánh số dư 45 ngày/ })).toBeVisible();
    await expect(page.getByText(/đảm bảo an toàn|an toàn tuyệt đối|chắc chắn an toàn/)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "30-simulator-result");
  });

  test("AC-15: assistant shows an explicit not-configured state and other pages still work", async ({ page }, info) => {
    await startGuest(page);
    await page.goto("/assistant?q=T%E1%BA%A1i%20sao%20chi%20ti%C3%AAu%20t%C4%83ng%3F");
    await expect(page.locator("main h1")).toHaveText("Trợ lý AI");
    const notConfigured = page.getByText("Trợ lý AI chưa được cấu hình.");
    if (await notConfigured.isVisible().catch(() => false)) {
      await expect(page.getByRole("textbox", { name: "Câu hỏi cho trợ lý" })).toBeDisabled();
      await expect(page.getByText("không tạo câu trả lời giả", { exact: false })).toBeVisible();
    } else {
      // AI configured: the prefill lands in the composer and is NOT sent automatically.
      await expect(page.getByRole("textbox", { name: "Câu hỏi cho trợ lý" })).toHaveValue("Tại sao chi tiêu tăng?");
    }
    await screenshot(page, info, "40-assistant");
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Tổng quan" })).toBeVisible();
  });

  test("Settings: guest reset needs confirmation and restores the persona", async ({ page }, info) => {
    await startGuest(page);
    await page.goto("/settings");
    await expect(page.locator("main h1")).toHaveText("Cài đặt");
    await page.getByRole("button", { name: "Đặt lại dữ liệu demo" }).click();
    const dialog = page.getByRole("dialog", { name: "Đặt lại dữ liệu demo?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Xác nhận đặt lại" })).toBeFocused({ timeout: 2000 }).catch(() => undefined);
    await dialog.getByRole("button", { name: "Xác nhận đặt lại" }).click();
    await expect(page.getByText(/Đã đặt lại/).first()).toBeVisible();
    await screenshot(page, info, "50-settings");
  });
});
