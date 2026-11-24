import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/dashboard",
}));
vi.mock("@/lib/db/browser", () => ({ createSupabaseBrowserClient: () => ({ auth: {} }) }));

/** createElement with children passed separately (keeps component prop types strict). */
function h<P>(type: ComponentType<P>, props: Omit<P, "children">, children?: ReactNode) {
  return createElement(type as ComponentType<Record<string, unknown>>, Object.assign({}, props, { children }));
}

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

/** Every id referenced by aria-labelledby/describedby/htmlFor must exist in the markup. */
function expectReferencesResolve(html: string) {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/(?:aria-labelledby|aria-describedby|for)="([^"]+)"/g)) {
    for (const ref of (m[1] ?? "").split(" ")) expect(ids.has(ref), `missing id ${ref}`).toBe(true);
  }
}

// A real `disabled` attribute (not the "disabled:" Tailwind variant inside class names).
const DISABLED_BUTTON = /<button\b[^>]*\sdisabled=""/g;

const personas = [
  { code: "student", name: "Sinh viên", story: "Câu chuyện 1", balanceText: "4.850.000 ₫", attention: false },
  { code: "worker", name: "Người mới đi làm", story: "Câu chuyện 2", balanceText: "9.420.000 ₫", attention: false },
  { code: "at_risk", name: "Dòng tiền cần chú ý", story: "Câu chuyện 3", balanceText: "1.820.000 ₫", attention: true },
] as const;

describe("Welcome page", () => {
  it("has one h1, CTAs, three persona cards and the disclaimers", async () => {
    const { WelcomeView } = await import("@/features/welcome/WelcomeView");
    const html = render(createElement(WelcomeView, { personas: [...personas], session: "none" }));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('href="#demo-personas"');
    expect(html).toContain("Trải nghiệm demo");
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/signup"');
    expect(html.match(/<article/g)).toHaveLength(3);
    for (const p of personas) expect(html).toContain(p.name);
    expect(html).toMatch(/dữ liệu mẫu tổng hợp/);
    expect(html).toMatch(/không phải ngân hàng/);
    expect(html).toMatch(/ước tính/);
    expect(html).not.toContain("<dialog"); // closed dialogs add nothing
    expect(html).toContain('role="alert"'); // always-mounted live region
    expectReferencesResolve(html);
  });

  it("offers Tiếp tục and disables demo buttons for a signed-in user", async () => {
    const { WelcomeView } = await import("@/features/welcome/WelcomeView");
    const html = render(createElement(WelcomeView, { personas: [...personas], session: "user" }));
    expect(html).toContain("Tiếp tục");
    expect(html.match(DISABLED_BUTTON)).toHaveLength(3);
  });

  it("offers Tiếp tục for an existing guest session without disabling personas", async () => {
    const { WelcomeView } = await import("@/features/welcome/WelcomeView");
    const html = render(createElement(WelcomeView, { personas: [...personas], session: "guest" }));
    expect(html).toContain('href="/dashboard"');
    expect(html.match(DISABLED_BUTTON)).toBeNull();
  });
});

describe("Dialog", () => {
  it("renders a labelled native dialog only when open", async () => {
    const { Dialog } = await import("@/components/ui/Dialog");
    const base = { onClose: () => undefined, title: "Tiêu đề", description: "Mô tả" };
    expect(render(h(Dialog, { ...base, open: false }, "x"))).toBe("");
    const html = render(h(Dialog, { ...base, open: true }, "nội dung"));
    expect(html).toMatch(/<dialog[^>]*aria-labelledby=/);
    expect(html).toMatch(/<dialog[^>]*aria-describedby=/);
    expectReferencesResolve(html);
  });
});

describe("Auth forms", () => {
  it("login form: labelled inputs, autocomplete, live error region, 44px submit", async () => {
    const { LoginForm } = await import("@/features/auth/LoginForm");
    const html = render(createElement(LoginForm, { next: "/dashboard", callbackError: false }));
    expect(html).toMatch(/<label[^>]*for="login-email"[^>]*>Email<\/label>/);
    expect(html).toMatch(/<label[^>]*for="login-password"[^>]*>Mật khẩu<\/label>/);
    expect(html).toMatch(/autocomplete="email"/i);
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toContain('type="password"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain('href="/signup"');
    expectReferencesResolve(html);
  });

  it("login form shows the callback failure inside the alert region", async () => {
    const { LoginForm } = await import("@/features/auth/LoginForm");
    const html = render(createElement(LoginForm, { next: "/dashboard", callbackError: true }));
    expect(html).toMatch(/role="alert"[^>]*><p[^>]*>Liên kết xác nhận/);
  });

  it("signup form: new-password autocomplete and a described password hint", async () => {
    const { SignupForm } = await import("@/features/auth/SignupForm");
    const html = render(createElement(SignupForm, { appUrl: "https://app.example.com" }));
    expect(html).toMatch(/autocomplete="new-password"/i);
    expect(html).toMatch(/aria-describedby="signup-password-hint"/);
    expect(html).toContain("Ít nhất 8 ký tự");
    expectReferencesResolve(html);
  });
});

describe("Field", () => {
  it("wires error and hint to the input", async () => {
    const { Field } = await import("@/components/ui/Field");
    const html = render(createElement(Field, { id: "f", label: "Tên", error: "Sai rồi", hint: "Gợi ý" }));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="f-hint f-error"');
    expectReferencesResolve(html);
  });
  it("has no invalid state without an error", async () => {
    const { Field } = await import("@/components/ui/Field");
    expect(render(createElement(Field, { id: "f", label: "Tên" }))).not.toContain("aria-invalid");
  });
});

describe("Onboarding wizard", () => {
  it("starts on step 1 with a skip button, a time-of-balance note and labelled input", async () => {
    const { OnboardingWizard } = await import("@/features/onboarding/OnboardingWizard");
    const html = render(createElement(OnboardingWizard, { profileExists: true }));
    expect(html).toContain("Bước 1/2");
    expect(html).toContain('for="onb-balance"');
    expect(html).toContain("tại thời điểm");
    expect(html).toContain("Bỏ qua");
    expectReferencesResolve(html);
  });
  it("shows a preparing status while the profile is bootstrapped", async () => {
    const { OnboardingWizard } = await import("@/features/onboarding/OnboardingWizard");
    const html = render(createElement(OnboardingWizard, { profileExists: false }));
    expect(html).toContain("Đang chuẩn bị hồ sơ");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*\sdisabled=""/);
  });
});

describe("App shell", () => {
  const base = { isGuest: false, isDemo: false, displayName: null, profile: "present" as const };
  it("shows the Demo badge, settings avatar link and sign-out for a guest", async () => {
    const { AppShell } = await import("@/components/shell/AppShell");
    const html = render(h(AppShell, { session: { ...base, isGuest: true, isDemo: true } }, "nội dung"));
    expect(html).toContain(">Demo<");
    expect(html).toContain('href="/settings"');
    expect(html).toContain("Đăng xuất");
    expect(html).not.toContain("Hồ sơ tài chính của bạn chưa được thiết lập");
  });
  it("hides the Demo badge for real users", async () => {
    const { AppShell } = await import("@/components/shell/AppShell");
    expect(render(h(AppShell, { session: base }, "x"))).not.toContain(">Demo<");
  });
  it("shows an incomplete-profile hint (not a crash) when the profile is missing", async () => {
    const { AppShell } = await import("@/components/shell/AppShell");
    const html = render(h(AppShell, { session: { ...base, profile: "missing" } }, "x"));
    expect(html).toContain('role="status"');
    expect(html).toContain('href="/onboarding"');
    const guest = render(h(AppShell, { session: { ...base, isGuest: true, isDemo: true, profile: "missing" } }, "x"));
    expect(guest).toContain("Chọn hồ sơ Demo");
  });
  it("keeps exactly one main landmark and a skip link", async () => {
    const { AppShell } = await import("@/components/shell/AppShell");
    const html = render(h(AppShell, { session: base }, "x"));
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html).toContain('href="#main-content"');
  });
});
