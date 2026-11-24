import { redirect } from "next/navigation";
import { LoginForm } from "@/features/auth/LoginForm";
import { AuthCard } from "@/features/auth/AuthCard";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/auth/routes";
import { sanitizeNextPath } from "@/lib/auth/safe-redirect";
import { loadViewer } from "@/lib/auth/server-viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Đăng nhập · FinPilot AI" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = sanitizeNextPath(rawNext);
  const viewer = await loadViewer({ withProfile: false });
  // A real signed-in user has nothing to do here. A guest may still sign in to a real account.
  if (viewer && !viewer.isAnonymous) redirect(DEFAULT_SIGNED_IN_PATH);
  return (
    <AuthCard title="Đăng nhập FinPilot AI" subtitle="Dùng email và mật khẩu của bạn.">
      <LoginForm next={next} callbackError={params.error === "callback"} />
    </AuthCard>
  );
}
