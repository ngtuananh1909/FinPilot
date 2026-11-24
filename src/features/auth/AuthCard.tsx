import type { ReactNode } from "react";
import { BrandMark } from "@/features/welcome/WelcomeView";

/** Centered card used by /login, /signup and /onboarding. */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
      <BrandMark />
      <main id="main-content" className="rounded-sheet border border-outline-variant bg-surface-container-lowest p-6 shadow-sm">
        <h1 className="font-display text-headline-md text-on-surface">{title}</h1>
        {subtitle ? <p className="mt-1 text-body-md text-on-surface-variant">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </main>
      {footer ? <div className="text-center text-body-md text-on-surface-variant">{footer}</div> : null}
    </div>
  );
}
