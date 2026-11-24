"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { FormAlert } from "@/components/ui/FormAlert";
import { BUTTON_PRIMARY, FOCUS_RING } from "@/components/ui/classes";
import { submitSignup } from "@/lib/auth/credentials-flow";
import { MIN_PASSWORD_LENGTH, type AuthFieldErrors } from "@/lib/auth/validation";
import { createSubmitGuard } from "@/lib/demo/guest-flow";
import { createBrowserCredentialsDeps } from "./browser-deps";

export function SignupForm({ appUrl }: { appUrl: string }) {
  const router = useRouter();
  const guard = useRef(createSubmitGuard()).current;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!guard.tryEnter()) return;
    setPending(true);
    setMessage(null);
    const outcome = await submitSignup(createBrowserCredentialsDeps(), { email, password }, appUrl);
    if (outcome.ok && outcome.needsEmailConfirmation) {
      setConfirmationSent(true);
    } else if (outcome.ok) {
      router.replace("/onboarding");
      router.refresh();
      return;
    } else {
      setFieldErrors(outcome.fieldErrors);
      setMessage(outcome.message);
    }
    setPending(false);
    guard.leave();
  }

  if (confirmationSent) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <p className="text-body-lg text-on-surface">
          Chúng tôi đã gửi thư xác nhận tới <strong>{email.trim()}</strong>. Hãy mở thư và bấm vào liên kết để hoàn tất đăng ký.
        </p>
        <Link href="/login" className={BUTTON_PRIMARY}>
          Quay lại đăng nhập
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={pending} className="flex flex-col gap-4">
      <FormAlert message={message} />
      <Field
        id="signup-email"
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
        id="signup-password"
        label="Mật khẩu"
        type="password"
        name="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={`Ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`}
        error={fieldErrors.password}
        disabled={pending}
      />
      <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
        {pending ? "Đang tạo tài khoản…" : "Đăng ký"}
      </button>
      <p className="text-center text-body-md text-on-surface-variant">
        Đã có tài khoản?{" "}
        <Link href="/login" className={`rounded-sm font-semibold text-primary underline underline-offset-2 ${FOCUS_RING}`}>
          Đăng nhập
        </Link>
      </p>
    </form>
  );
}
