"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BUTTON_PRIMARY } from "@/components/ui/classes";

/** Re-runs the server component for the current route (router.refresh) without a full page reload. */
export function RetryButton({ label = "Thử lại" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" className={BUTTON_PRIMARY} disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? "Đang tải…" : label}
    </button>
  );
}
