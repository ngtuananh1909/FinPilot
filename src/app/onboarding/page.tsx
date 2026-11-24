import { redirect } from "next/navigation";
import { AuthCard } from "@/features/auth/AuthCard";
import { OnboardingWizard } from "@/features/onboarding/OnboardingWizard";
import { loadViewer } from "@/lib/auth/server-viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Thiết lập nhanh · FinPilot AI" };

// Auxiliary screen (not a main route): checks the session itself because middleware leaves it public.
export default async function OnboardingPage() {
  const viewer = await loadViewer({ withProfile: true });
  if (!viewer) redirect("/login?next=%2Fonboarding");
  if (viewer.isAnonymous) redirect("/dashboard"); // guests get their data from a demo persona
  return (
    <AuthCard title="Thiết lập nhanh" subtitle="Hai bước ngắn để dự báo dòng tiền 45 ngày chính xác hơn. Bạn có thể bỏ qua.">
      <OnboardingWizard profileExists={viewer.profile === "present"} />
    </AuthCard>
  );
}
