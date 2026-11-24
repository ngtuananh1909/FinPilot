"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { FormAlert } from "@/components/ui/FormAlert";
import { BUTTON_PRIMARY, FOCUS_RING } from "@/components/ui/classes";
import { submitLogin } from "@/lib/auth/credentials-flow";
import type { AuthFieldErrors } from "@/lib/auth/validation";
import { createSubmitGuard } from "@/lib/demo/guest-flow";
import { createBrowserCredentialsDeps } from "./browser-deps";

const CALLBACK_ERROR = "Liên kết xác nhận không còn hiệu lực. Vui lòng đăng nhập hoặc đăng ký lại.";

export function LoginForm({ next, callbackError }: { next: string; callbackError: boolean }) {
  const router = useRouter();
  const guard = useRef(createSubmitGuard()).current;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [message, setMessage] = useState<string | null>(callbackError ? CALLBACK_ERROR : null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!guard.tryEnter()) return;
    setPending(true);
    setMessage(null);
    const outcome = await submitLogin(createBrowserCredentialsDeps(), { email, password });
    if (outcome.ok) {
      router.replace(next);
      router.refresh();
      return; // stay disabled while navigating
    }
    setFieldErrors(outcome.fieldErrors);
    setMessage(outcome.message);
    setPending(false);
    guard.leave();
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={pending} className="flex flex-col gap-4">
      <FormAlert message={message} />
      <Field
        id="login-email"
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder="ban@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldErrors.email}
        disabled={pending}
      />
      <Field
        id="login-password"
        label="Mật khẩu"
        type="password"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldErrors.password}
        disabled={pending}
      />
      <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
        {pending ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
      <p className="text-center text-body-md text-on-surface-variant">
        Chưa có tài khoản?{" "}
        <Link href="/signup" className={`rounded-sm font-semibold text-primary underline underline-offset-2 ${FOCUS_RING}`}>
          Đăng ký
        </Link>
      </p>
    </form>
  );
}
