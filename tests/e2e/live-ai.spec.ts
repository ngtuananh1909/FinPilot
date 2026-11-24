import { expect, test } from "@playwright/test";
import { screenshot, startGuest } from "./support/helpers";

/**
 * LIVE AI checks (real provider, real quota). Opt-in: E2E_LIVE_AI=1. Uses a throwaway guest that
 * global teardown deletes by id. Desktop only, to spend as few provider calls as possible.
 */
test.skip(!process.env.E2E_LIVE_AI, "live AI tests are opt-in (E2E_LIVE_AI=1)");
test.describe.configure({ timeout: 180_000 });

const RECEIPT_HTML = `<!doctype html><html><body style="margin:0;background:#fff;font-family:monospace;width:360px;padding:24px;color:#000">
<h2 style="text-align:center;margin:0">CIRCLE K</h2><p style="text-align:center;margin:4px 0">123 Nguyen Trai, Q1, TP.HCM</p>
<p>Ngay: 2026-11-23 &nbsp; Gio: 08:15</p><hr/>
<p>Banh mi ............ 25.000</p><p>Tra dao ............ 20.000</p><hr/>
<h3>TONG CONG: 45.000 VND</h3><p style="text-align:center">Cam on quy khach</p></body></html>`;

test("AC-12/13: assistant answers with a real tool call and a confirmable proposal", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1280", "desktop only");
  await startGuest(page, "Dòng tiền cần chú ý");
  await page.goto("/assistant");
  await expect(page.getByText("Trợ lý AI chưa được cấu hình.")).toHaveCount(0);

  const box = page.getByRole("textbox", { name: "Câu hỏi cho trợ lý" });
  await box.fill("Tôi có đủ tiền đóng trọ tháng tới không? Hãy dùng dự báo 45 ngày.");
  await page.getByRole("button", { name: "Gửi" }).click();
  const answer = page.locator("ol[aria-label='Cuộc trò chuyện'] > li").filter({ hasText: "Dữ liệu đã tra cứu" }).last();
  await expect(answer).toBeVisible({ timeout: 120_000 });
  await answer.getByText(/Dữ liệu đã tra cứu/).click();
  await expect(answer.getByText(/Dự báo dòng tiền 45 ngày|Tình hình tài chính hiện tại/).first()).toBeVisible();
  await expect(page.getByText(/Còn \d+\/20 lượt hôm nay/)).toContainText("19/20");
  await screenshot(page, info, "60-live-assistant");

  await box.fill("Hãy đề xuất giảm ngân sách chi tiêu tháng của tôi xuống 6.000.000 đồng. Chỉ tạo đề xuất để tôi xác nhận.");
  await page.getByRole("button", { name: "Gửi" }).click();
  const card = page.getByRole("region", { name: "Đề xuất thay đổi" }).last();
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(card.getByText("Chờ xác nhận")).toBeVisible();
  await card.getByRole("button", { name: "Xác nhận" }).click();
  await expect(card.getByText("Đã áp dụng")).toBeVisible({ timeout: 30_000 });
  await screenshot(page, info, "61-live-proposal-approved");
  await page.goto("/settings");
  await expect(page.locator("input[value='6.000.000']").first()).toBeVisible();
});

test("AC-07: receipt scan returns an editable draft that is saved once", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop-1280", "desktop only");
  const render = await browser.newPage({ viewport: { width: 408, height: 420 } });
  await render.setContent(RECEIPT_HTML);
  const image = await render.screenshot({ type: "png" });
  await render.close();

  await startGuest(page, "Sinh viên");
  await page.goto("/transactions");
  await page.getByRole("button", { name: /Thêm giao dịch/ }).first().click();
  await page.getByRole("button", { name: /^Quét biên lai/ }).click();
  await page.locator("input[type='file']").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: image });
  await expect(page.getByText("Đây là bản nháp do AI đọc, chưa được lưu.")).toBeVisible({ timeout: 90_000 });
  const amount = page.getByLabel("Số tiền (₫)");
  await expect(amount).toHaveValue("45.000");
  await expect(page.getByLabel("Cửa hàng")).toHaveValue(/circle k/i);
  await screenshot(page, info, "62-live-receipt-draft");
  await page.getByRole("button", { name: "Lưu giao dịch" }).click();
  const dialog = page.getByRole("dialog", { name: "Quét biên lai" });
  await expect(dialog.getByRole("status")).toHaveText("Đã lưu giao dịch từ biên lai.");
  await dialog.getByRole("button", { name: "Đóng" }).click();
  await expect(page.getByText(/circle k/i)).toHaveCount(1);
});
