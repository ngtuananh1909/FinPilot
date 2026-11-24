import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/config/public-env";

/** Browser Supabase client. Uses only the publishable key; RLS protects all data. */
export function createSupabaseBrowserClient() {
  const env = getPublicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
