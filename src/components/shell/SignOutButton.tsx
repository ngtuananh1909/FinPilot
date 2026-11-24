"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { FormAlert } from "@/components/ui/FormAlert";
import { BUTTON_DANGER, BUTTON_SECONDARY, FOCUS_RING } from "@/components/ui/classes";
import { createSupabaseBrowserClient } from "@/lib/db/browser";
import { createSubmitGuard } from "@/lib/demo/guest-flow";

const FAILED = "Không thể đăng xuất lúc này. Vui lòng thử lại.";

/** Signs out via Supabase, then returns to the welcome page. Guests confirm first (data is not recoverable). */
export function SignOutButton({ isGuest }: { isGuest: boolean }) {
  const router = useRouter();
  const guard = useRef(createSubmitGuard()).current;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (!guard.tryEnter()) return;
    setPending(true);
    setError(null);
    try {
      const { error: authError } = await createSupabaseBrowserClient().auth.signOut();
      if (authError) throw authError;
      router.push("/");
      router.refresh();
      return;
    } catch {
      setError(FAILED);
    }
    setPending(false);
    guard.leave();
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => (isGuest ? setConfirmOpen(true) : void signOut())}
        className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-control px-2 text-label-lg text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60 ${FOCUS_RING}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
        <span className="sr-only md:not-sr-only">{pending && !isGuest ? "Đang đăng xuất…" : "Đăng xuất"}</span>
      </button>
      {!isGuest && error ? (
        <div className="fixed inset-x-4 bottom-20 z-30 md:bottom-4 md:left-auto md:max-w-sm">
          <FormAlert message={error} />
        </div>
      ) : null}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        dismissible={!pending}
        title="Đăng xuất khỏi phiên Demo?"
        description="Dữ liệu Demo của phiên này sẽ không thể khôi phục sau khi đăng xuất. Bạn có thể bắt đầu một phiên Demo mới bất cứ lúc nào."
      >
        <FormAlert message={error} />
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" disabled={pending} onClick={() => void signOut()} className={BUTTON_DANGER}>
            {pending ? "Đang đăng xuất…" : "Đăng xuất và mất dữ liệu"}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirmOpen(false)} className={BUTTON_SECONDARY}>
            Ở lại
          </button>
        </div>
      </Dialog>
    </>
  );
}
