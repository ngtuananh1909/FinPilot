import { SettingsView } from "@/features/settings/SettingsView";
import { loadViewer } from "@/lib/auth/server-viewer";
export const metadata = { title: "Cài đặt · FinPilot AI" };
// The guest flag comes from the verified session on every request.
export const dynamic = "force-dynamic";
export default async function Page() {
  const viewer = await loadViewer({ withProfile: false });
  return <SettingsView isGuest={viewer?.isAnonymous ?? false} />;
}
