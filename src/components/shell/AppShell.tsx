"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NAV_ITEMS, isActivePath, type NavItem } from "./nav-items";
import { SignOutButton } from "./SignOutButton";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

function NavIcon({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

function NavLink({ item, pathname, layout }: { item: NavItem; pathname: string; layout: "tab" | "sidebar" }) {
  const active = isActivePath(pathname, item.href);
  const base = layout === "tab"
    ? "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs"
    : "flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm";
  const state = active
    ? layout === "tab" ? "font-semibold text-primary" : "bg-primary-container font-semibold text-primary"
    : "text-on-surface-variant hover:text-primary";
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={`${base} ${state} ${FOCUS}`}>
      <NavIcon path={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

export interface ShellSession {
  /** Anonymous Supabase user. Drives the sign-out warning. */
  isGuest: boolean;
  /** Guest or is_demo profile: shows the visible Demo badge. */
  isDemo: boolean;
  /** Short name for the avatar label; never required. */
  displayName: string | null;
  profile: "present" | "missing" | "unknown" | "not_loaded";
}

const DEFAULT_SESSION: ShellSession = { isGuest: false, isDemo: false, displayName: null, profile: "present" };

export function AppShell({ children, session = DEFAULT_SESSION }: { children: ReactNode; session?: ShellSession }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen md:flex">
      <a href="#main-content" className={`sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary ${FOCUS}`}>
        Bỏ qua điều hướng, đến nội dung chính
      </a>

      <aside className="hidden w-60 shrink-0 border-r border-outline-variant bg-surface-container-lowest p-4 md:block">
        <p className="px-3 pb-4 text-xl font-semibold text-primary">FinPilot AI</p>
        <nav aria-label="Điều hướng chính" className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} layout="sidebar" />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex min-h-[56px] items-center justify-between border-b border-outline-variant bg-surface-container-lowest px-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-primary md:hidden">FinPilot AI</span>
            {session.isDemo ? (
              <span className="rounded-full bg-primary-container px-2 py-0.5 text-xs font-medium text-primary">Demo</span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <SignOutButton isGuest={session.isGuest} />
            <Link
              href="/settings"
              aria-label={session.displayName ? `Cài đặt tài khoản của ${session.displayName}` : "Cài đặt tài khoản"}
              aria-current={isActivePath(pathname, "/settings") ? "page" : undefined}
              className={`flex h-11 w-11 items-center justify-center rounded-full bg-primary-container text-primary ${FOCUS}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
              </svg>
            </Link>
          </div>
        </header>
        {session.profile === "missing" ? (
          <div role="status" className="border-b border-warning/40 bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
            Hồ sơ tài chính của bạn chưa được thiết lập, nên dự báo chưa thể hiển thị.{" "}
            <Link href={session.isGuest ? "/" : "/onboarding"} className={`font-semibold underline ${FOCUS}`}>
              {session.isGuest ? "Chọn hồ sơ Demo" : "Thiết lập nhanh"}
            </Link>
          </div>
        ) : null}

        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 p-4 pb-24 focus:outline-none md:pb-8">
          {children}
        </main>

        <nav aria-label="Điều hướng chính" className="fixed inset-x-0 bottom-0 z-10 flex border-t border-outline-variant bg-surface-container-lowest md:hidden">
          {NAV_ITEMS.filter((i) => i.mobileTab).map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} layout="tab" />
          ))}
        </nav>
      </div>
    </div>
  );
}
