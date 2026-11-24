"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { FormAlert } from "@/components/ui/FormAlert";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FOCUS_RING } from "@/components/ui/classes";
import type { PersonaCode } from "@/lib/db/schema";
import { createSubmitGuard, runGuestStart } from "@/lib/demo/guest-flow";
import { createBrowserDemoDeps } from "./browser-deps";
import type { PersonaCardModel } from "./personas";

/** `guest`: anonymous session already exists. `user`: signed in with email. */
export type VisitorSession = "none" | "guest" | "user";

interface FailedAttempt {
  persona: PersonaCode;
  message: string;
  confirmReplace: boolean;
}

export function PersonaChooser({ personas, session }: { personas: PersonaCardModel[]; session: VisitorSession }) {
  const router = useRouter();
  const guard = useRef(createSubmitGuard()).current;
  const signedInHere = useRef(false);
  const [pending, setPending] = useState<PersonaCode | null>(null);
  const [failure, setFailure] = useState<FailedAttempt | null>(null);
  const [confirm, setConfirm] = useState<{ persona: PersonaCode; existing: PersonaCode | null } | null>(null);

  const nameOf = (code: PersonaCode | null) => personas.find((p) => p.code === code)?.name ?? null;

  async function start(persona: PersonaCode, confirmReplace = false) {
    if (session === "user" || !guard.tryEnter()) return;
    setPending(persona);
    setFailure(null);
    const deps = createBrowserDemoDeps(() => {
      signedInHere.current = true;
    });
    const outcome = await runGuestStart(deps, persona, {
      confirmReplace,
      reuseSession: session === "guest" || signedInHere.current,
    });
    if (outcome.kind === "started") {
      setConfirm(null);
      router.push("/dashboard");
      return; // keep buttons disabled while navigating
    }
    if (outcome.kind === "existing") {
      setConfirm({ persona, existing: outcome.personaCode });
    } else {
      setConfirm(null);
      setFailure({ persona, message: outcome.message, confirmReplace });
    }
    setPending(null);
    guard.leave();
  }

  const busy = pending !== null;

  return (
    <section id="demo-personas" tabIndex={-1} aria-labelledby="demo-personas-title" className="scroll-mt-4 focus:outline-none">
      <h2 id="demo-personas-title" className="text-title-lg text-on-surface">
        Chọn nhanh một hồ sơ demo
      </h2>
      <p className="mt-1 text-body-md text-on-surface-variant">
        Không cần tạo tài khoản. Bạn vào thẳng Dashboard với dữ liệu mẫu tổng hợp, chỉ của riêng phiên này.
      </p>

      {session === "guest" ? (
        <div className="mt-4 rounded-card border border-outline-variant bg-primary-container p-4 text-on-primary-container">
          <p className="text-body-md">Bạn đang có một phiên Demo. Có thể tiếp tục, hoặc chọn hồ sơ khác (sẽ hỏi xác nhận trước khi thay dữ liệu).</p>
          <Link href="/dashboard" className={`${BUTTON_PRIMARY} mt-3`}>
            Tiếp tục
          </Link>
        </div>
      ) : null}
      {session === "user" ? (
        <div className="mt-4 rounded-card border border-outline-variant bg-surface-container-low p-4">
          <p className="text-body-md text-on-surface">Bạn đã đăng nhập, nên không cần tạo phiên Demo mới.</p>
          <Link href="/dashboard" className={`${BUTTON_PRIMARY} mt-3`}>
            Tiếp tục
          </Link>
        </div>
      ) : null}

      <div className="mt-4">
        <FormAlert message={failure?.message ?? null} />
        {failure ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void start(failure.persona, failure.confirmReplace)}
            className={`${BUTTON_SECONDARY} mt-3`}
          >
            Thử lại
          </button>
        ) : null}
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {personas.map((p) => {
          const isPending = pending === p.code;
          return (
            <li key={p.code} className="flex">
              <article
                aria-labelledby={`persona-${p.code}`}
                className={`flex w-full flex-col justify-between gap-4 rounded-card border bg-surface-container-lowest p-4 ${
                  p.attention ? "border-warning/50" : "border-outline-variant"
                }`}
              >
                <div>
                  <h3 id={`persona-${p.code}`} className="text-title-md text-on-surface">
                    {p.name}
                  </h3>
                  <p className="mt-1 text-body-md text-on-surface-variant">{p.story}</p>
                  <p className={`mt-3 font-mono text-mono-md tabular-nums ${p.attention ? "text-warning" : "text-success"}`}>
                    Số dư mẫu: {p.balanceText}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || session === "user"}
                  aria-busy={isPending}
                  aria-label={`Trải nghiệm demo với hồ sơ ${p.name}`}
                  onClick={() => void start(p.code)}
                  className={`${BUTTON_PRIMARY} w-full`}
                >
                  {isPending ? "Đang chuẩn bị dữ liệu…" : "Trải nghiệm demo"}
                </button>
              </article>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        dismissible={!busy}
        title="Bạn đang có dữ liệu Demo"
        description={
          confirm
            ? `Phiên này đã có dữ liệu${confirm.existing ? ` của hồ sơ ${nameOf(confirm.existing)}` : ""}. Đặt lại sẽ thay toàn bộ dữ liệu Demo của phiên này bằng hồ sơ ${nameOf(confirm.persona)}. Dữ liệu cũ không thể khôi phục.`
            : undefined
        }
      >
        <FormAlert message={failure?.message ?? null} />
        <div className="mt-4 flex flex-col gap-2">
          <Link href="/dashboard" className={BUTTON_PRIMARY} aria-disabled={busy}>
            Tiếp tục dữ liệu hiện có
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={() => confirm && void start(confirm.persona, true)}
            className={BUTTON_SECONDARY}
          >
            {busy ? "Đang đặt lại…" : `Đặt lại về hồ sơ ${nameOf(confirm?.persona ?? null) ?? ""}`}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirm(null)}
            className={`min-h-[44px] rounded-control px-5 text-label-lg text-on-surface-variant hover:bg-surface-container-low ${FOCUS_RING}`}
          >
            Hủy
          </button>
        </div>
      </Dialog>
    </section>
  );
}
