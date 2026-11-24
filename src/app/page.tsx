import { loadViewer } from "@/lib/auth/server-viewer";
import { buildPersonaCards } from "@/features/welcome/personas";
import { WelcomeView } from "@/features/welcome/WelcomeView";
import type { VisitorSession } from "@/features/welcome/PersonaChooser";

// Depends on the visitor's cookies (resume vs. new session).
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const viewer = await loadViewer({ withProfile: false });
  const session: VisitorSession = !viewer ? "none" : viewer.isAnonymous ? "guest" : "user";
  return <WelcomeView personas={buildPersonaCards()} session={session} />;
}
