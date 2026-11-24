import { redirect } from "next/navigation";
import { SignupForm } from "@/features/auth/SignupForm";
import { AuthCard } from "@/features/auth/AuthCard";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/auth/routes";
import { loadViewer } from "@/lib/auth/server-viewer";
import { getPublicEnv } from "@/lib/config/public-env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Đăng ký · FinPilot AI" };

export default async function SignupPage() {
  const viewer = await loadViewer({ withProfile: false });
  if (viewer && !viewer.isAnonymous) redirect(DEFAULT_SIGNED_IN_PATH);
  let appUrl = "http://localhost:3000";
  try {
    appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
  } catch {
    // Missing config: the form falls back to localhost; Supabase rejects unknown redirects anyway.
  }
  return (
    <AuthCard title="Tạo tài khoản" subtitle="Đăng ký là tùy chọn. Bạn luôn có thể trải nghiệm demo không cần tài khoản.">
      <SignupForm appUrl={appUrl} />
    </AuthCard>
  );
}
