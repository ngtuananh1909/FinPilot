import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GoalDto, ProfileDto } from "@/lib/settings/dto";
import type { BalanceSnapshotResult, SettingsDocument } from "@/lib/settings/service";
import type { RecurringDto, RecurringSuggestionDto } from "@/lib/transactions/dto";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/settings",
}));
vi.mock("@/lib/db/browser", () => ({ createSupabaseBrowserClient: () => ({ auth: {} }) }));
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
function expectReferencesResolve(html: string) {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/(?:aria-labelledby|aria-describedby|aria-controls|for)="([^"]+)"/g)) {
    for (const ref of (m[1] ?? "").split(" ")) expect(ids.has(ref), `missing id ${ref}`).toBe(true);
  }
}
const DISABLED_BUTTON = /<button\b[^>]*\sdisabled=""/g;
const profile = (over: Partial<ProfileDto> = {}): ProfileDto => ({
  displayName: "Minh",
  balanceSnapshot: { amountVnd: "4850000", at: "2026-03-01T00:00:00.000Z" },
  expectedMonthlyIncomeVnd: "7500000",
  paydayDay: 5,
  expectedDailyExpenseVnd: "150000",
  projectedMonthlyBudgetVnd: "6000000",
  minimumReserveVnd: "1000000",
  isDemo: true,
  personaCode: "student",
  updatedAt: "2026-03-01T00:00:00.000Z",
  ...over,
});
const goal: GoalDto = {
  name: "Quỹ laptop",
  targetVnd: "15000000",
  savedVnd: "6200000",
  targetDate: "2026-12-31",
  updatedAt: "x",
  reached: false,
  progress: { percent: 41, remainingVnd: "8800000" },
};
const item = (over: Partial<RecurringDto> = {}): RecurringDto => ({
  id: "22222222-2222-4222-8222-222222222222",
  label: "Tiền thuê phòng",
  kind: "expense",
  amountVnd: "3000000",
  dayOfMonth: 1,
  category: "rent",
  startDate: "2026-01-01",
  endDate: null,
  active: true,
  createdAt: "x",
  updatedAt: "x",
  ...over,
});
const doc = (over: Partial<SettingsDocument> = {}): SettingsDocument => ({
  profile: profile(),
  goal,
  recurringItems: [item(), item({ id: "b", label: "Gói 4G", active: false })],
  recurringTruncated: false,
  forecastReadiness: { complete: true, issues: [] },
  ...over,
});
const noop = () => undefined;
const handlers = { onProfileSaved: noop, onBalanceChanged: noop, onRecurringChanged: noop, onGoalChanged: noop, onReset: noop };
describe("Settings page states", () => {
  it("renders a labelled skeleton while loading", async () => {
    const { SettingsView } = await import("@/features/settings/SettingsView");
    const html = render(createElement(SettingsView, { isGuest: false }));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Đang tải Cài đặt");
    expect(html).toContain('role="status"');
  });
  it("renders all five cards with unique anchors when loaded", async () => {
    const { SettingsContent } = await import("@/features/settings/SettingsView");
    const html = render(createElement(SettingsContent, { doc: doc(), suggestions: { items: [], incomplete: false }, isGuest: false, ...handlers }));
    for (const id of ["settings-profile", "settings-balance", "settings-recurring", "settings-goal", "settings-account"]) {
      expect(html.match(new RegExp(`id="${id}"`, "g")), id).toHaveLength(1);
    }
    expect(html).not.toContain("Dự báo chưa đầy đủ");
    expectReferencesResolve(html);
  });
});
describe("incomplete forecast banner", () => {
  it("links each missing input to its field", async () => {
    const { SettingsContent } = await import("@/features/settings/SettingsView");
    const readiness = {
      complete: false,
      issues: [
        { field: "expected_monthly_income", problem: "zero" as const },
        { field: "recurring_items", problem: "missing" as const },
      ],
    };
    const html = render(createElement(SettingsContent, { doc: doc({ forecastReadiness: readiness }), suggestions: { items: [], incomplete: false }, isGuest: false, ...handlers }));
    expect(html).toContain("Dự báo chưa đầy đủ");
    expect(html).toContain('href="#set-income"');
    expect(html).toContain('href="#settings-recurring"');
    expect(html).toContain('id="set-income"'); // the link target exists
    expect(html).toContain('role="status"');
  });
  it("renders nothing for a complete forecast", async () => {
    const { ReadinessBanner } = await import("@/features/settings/ReadinessBanner");
    expect(render(createElement(ReadinessBanner, { readiness: { complete: true, issues: [] } }))).toBe("");
  });
});
describe("profile card", () => {
  it("has a labelled, numeric, 44px field per assumption and a save button", async () => {
    const { ProfileCard } = await import("@/features/settings/ProfileCard");
    const html = render(createElement(ProfileCard, { profile: profile(), onSaved: noop }));
    for (const id of ["set-name", "set-payday", "set-income", "set-daily", "set-budget", "set-reserve"]) {
      expect(html, id).toContain(`for="${id}"`);
    }
    expect(html).toContain('value="7.500.000"');
    expect(html).toContain('value="5"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("Lưu thay đổi");
    expect(html).not.toContain("Thay đổi chưa lưu"); // nothing edited yet
    expectReferencesResolve(html);
  });
});
describe("balance snapshot", () => {
  it("shows the amount and as-of time but no confirm button until the dialog's last step", async () => {
    const { BalanceCard } = await import("@/features/settings/BalanceCard");
    const html = render(createElement(BalanceCard, { profile: profile(), onChanged: noop }));
    expect(html).toContain("4.850.000 ₫");
    expect(html).toContain("01/03/2026 07:00");
    expect(html).toContain("Đặt số dư mới…");
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain("Xác nhận đặt số dư mới");
  });
  it("confirmation step states the anchor rule and has an explicit confirm button", async () => {
    const { BalanceConfirmStep } = await import("@/features/settings/BalanceCard");
    const html = render(createElement(BalanceConfirmStep, { profile: profile(), amountText: "5.200.000", pending: false, error: null, onConfirm: noop, onBack: noop }));
    expect(html).toContain("Xác nhận đặt số dư mới");
    expect(html).toContain("5.200.000 ₫");
    expect(html).toContain("hiện tại 4.850.000 ₫");
    expect(html).toContain("KHÔNG được cộng lại");
    expect(html.match(DISABLED_BUTTON)).toBeNull();
  });
  it("disables confirm while pending or when the amount is not valid", async () => {
    const { BalanceConfirmStep } = await import("@/features/settings/BalanceCard");
    const pending = render(createElement(BalanceConfirmStep, { profile: profile(), amountText: "5.200.000", pending: true, error: null, onConfirm: noop, onBack: noop }));
    expect(pending.match(DISABLED_BUTTON)).toHaveLength(2);
    const invalid = render(createElement(BalanceConfirmStep, { profile: profile(), amountText: "", pending: false, error: null, onConfirm: noop, onBack: noop }));
    expect(invalid.match(DISABLED_BUTTON)).toHaveLength(1);
  });
  it("shows previous snapshot and delta from the response", async () => {
    const { BalanceResult } = await import("@/features/settings/BalanceCard");
    const result: BalanceSnapshotResult = {
      profile: profile({ balanceSnapshot: { amountVnd: "5200000", at: "2026-03-10T05:30:00.000Z" } }),
      forecastReadiness: { complete: true, issues: [] },
      previousSnapshot: { amountVnd: "4850000", at: "2026-03-01T00:00:00.000Z" },
      deltaVnd: "350000",
      earlierTransactionsReapplied: false,
    };
    const html = render(createElement(BalanceResult, { result }));
    expect(html).toContain("5.200.000 ₫");
    expect(html).toContain("4.850.000 ₫");
    expect(html).toContain("+350.000 ₫");
    expect(html).toContain("không được cộng lại");
  });
});
describe("recurring items", () => {
  it("lists items with Sửa and Tắt/Bật lại but never a delete action", async () => {
    const { RecurringList } = await import("@/features/settings/RecurringCard");
    const html = render(createElement(RecurringList, { items: [item(), item({ id: "b", label: "Gói 4G", active: false })], onEdit: noop, onToggle: noop, busyId: null }));
    expect(html).toContain("Đang áp dụng");
    expect(html).toContain("Đã tắt");
    expect(html).toContain("Tắt<span");
    expect(html).toContain("Bật lại<span");
    expect(html).toContain("Ngày 1 hằng tháng");
    expect(html).not.toMatch(/Xóa/);
  });
  it("explains deactivation instead of deletion on the card", async () => {
    const { RecurringCard } = await import("@/features/settings/RecurringCard");
    const html = render(createElement(RecurringCard, { items: [item()], truncated: false, suggestions: [], suggestionsIncomplete: false, onChanged: noop }));
    expect(html).toContain("tắt một khoản (không xóa)");
    expect(html).toContain("Thêm khoản định kỳ");
    expect(html).not.toContain("Có thể khớp");
  });
  it("shows reconciliation suggestions as proposals with an explicit link button each", async () => {
    const { SuggestionList } = await import("@/features/settings/RecurringCard");
    const suggestions: RecurringSuggestionDto[] = [
      { itemId: "22222222-2222-4222-8222-222222222222", instanceDate: "2026-03-01", kind: "expense", expectedAmountVnd: "3000000", candidates: [
        { transactionId: "t1", transactionDate: "2026-03-02", dayDistance: 1, amountDifferenceVnd: "50000" },
        { transactionId: "t2", transactionDate: "2026-03-04", dayDistance: 3, amountDifferenceVnd: "0" },
      ] },
      { itemId: "22222222-2222-4222-8222-222222222222", instanceDate: "2026-02-01", kind: "expense", expectedAmountVnd: "3000000", candidates: [] },
    ];
    const html = render(createElement(SuggestionList, { suggestions, items: [item()], linkingKey: null, errors: {}, onLink: noop }));
    expect(html).toContain("Có thể khớp");
    expect(html).toContain("không có gì được liên kết cho đến khi bạn bấm");
    expect(html.match(/>Liên kết<\/button>/g)).toHaveLength(2);
    expect(html).toContain("Chưa thấy giao dịch nào khớp");
    expect(html).toContain("Tiền thuê phòng");
    expect(html).toContain("50.000 ₫");
  });
  it("renders nothing without suggestions and disables link buttons while one is linking", async () => {
    const { SuggestionList } = await import("@/features/settings/RecurringCard");
    expect(render(createElement(SuggestionList, { suggestions: [], items: [], linkingKey: null, errors: {}, onLink: noop }))).toBe("");
    const s: RecurringSuggestionDto[] = [{ itemId: "i", instanceDate: "2026-03-01", kind: "expense", expectedAmountVnd: "1", candidates: [{ transactionId: "t1", transactionDate: "2026-03-02", dayDistance: 1, amountDifferenceVnd: "0" }] }];
    const html = render(createElement(SuggestionList, { suggestions: s, items: [], linkingKey: "i:2026-03-01:t1", errors: {}, onLink: noop }));
    expect(html.match(DISABLED_BUTTON)).toHaveLength(1);
    expect(html).toContain("Đang liên kết…");
  });
});
describe("savings goal", () => {
  it("exposes progress through role=progressbar and aria-valuenow", async () => {
    const { GoalProgress } = await import("@/features/settings/GoalCard");
    const html = render(createElement(GoalProgress, { goal }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="41"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain("width:41%");
    expect(html).toContain("6.200.000 ₫");
    expect(html).toContain("Còn thiếu 8.800.000 ₫");
    expect(html).toContain("31/12/2026");
  });
  it("offers only edit and remove when a goal exists (no second goal)", async () => {
    const { GoalCard } = await import("@/features/settings/GoalCard");
    const html = render(createElement(GoalCard, { goal, onChanged: noop }));
    expect(html).toContain("Sửa mục tiêu");
    expect(html).toContain("Xóa mục tiêu");
    expect(html).not.toContain("Tạo mục tiêu");
    expect(html).not.toMatch(/Thêm mục tiêu/);
    expect(html).toContain("một mục tiêu tiết kiệm");
  });
  it("offers create when there is no goal and no progress bar", async () => {
    const { GoalCard } = await import("@/features/settings/GoalCard");
    const html = render(createElement(GoalCard, { goal: null, onChanged: noop }));
    expect(html).toContain("Tạo mục tiêu");
    expect(html).not.toContain("progressbar");
    expect(html).not.toContain("Xóa mục tiêu");
  });
  it("marks a reached goal", async () => {
    const { GoalProgress } = await import("@/features/settings/GoalCard");
    const html = render(createElement(GoalProgress, { goal: { ...goal, savedVnd: "15000000", reached: true, progress: { percent: 100, remainingVnd: "0" } } }));
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain("đã đạt mục tiêu");
  });
});
describe("account section", () => {
  it("offers the demo reset to guests, with the guest badge and sign-out", async () => {
    const { AccountCard } = await import("@/features/settings/AccountCard");
    const html = render(createElement(AccountCard, { profile: profile(), isGuest: true, onReset: noop }));
    expect(html).toContain("Khách (Demo)");
    expect(html).toContain("Đặt lại dữ liệu demo");
    expect(html).toContain("Đăng xuất");
    expect(html).toContain("Hồ sơ mẫu: Sinh viên");
  });
  it("offers the demo reset to sample email accounts", async () => {
    const { AccountCard } = await import("@/features/settings/AccountCard");
    const html = render(createElement(AccountCard, { profile: profile({ isDemo: true }), isGuest: false, onReset: noop }));
    expect(html).toContain("Tài khoản Demo mẫu");
    expect(html).toContain("Đặt lại dữ liệu demo");
  });
  it("hides the demo reset for real accounts", async () => {
    const { AccountCard } = await import("@/features/settings/AccountCard");
    const html = render(createElement(AccountCard, { profile: profile({ isDemo: false, personaCode: null }), isGuest: false, onReset: noop }));
    expect(html).toContain("Tài khoản của bạn");
    expect(html).not.toContain("Đặt lại dữ liệu demo");
    expect(html).not.toContain("Hồ sơ mẫu");
    expect(html).toContain("Đăng xuất");
  });
  it("keeps the reset confirmation closed until requested and states privacy and deletion plainly", async () => {
    const { AccountCard } = await import("@/features/settings/AccountCard");
    const html = render(createElement(AccountCard, { profile: profile(), isGuest: false, onReset: noop }));
    expect(html).not.toContain("<dialog");
    expect(html).toContain("dữ liệu mẫu tổng hợp");
    expect(html).toContain("không kết nối ngân hàng");
    expect(html).toContain("sắp có");
  });
  it("derives the account kind from guest and demo flags", async () => {
    const { accountKind } = await import("@/features/settings/AccountCard");
    expect(accountKind(true, true)).toBe("guest");
    expect(accountKind(false, true)).toBe("demo");
    expect(accountKind(false, false)).toBe("real");
  });
});
