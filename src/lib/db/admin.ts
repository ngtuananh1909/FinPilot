import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/config/public-env";
import { getServerEnv } from "@/lib/config/server-env";
import { AppError } from "@/lib/errors";

/**
 * Service-role Supabase client. BYPASSES RLS.
 *
 * USE ONLY AFTER VERIFYING OWNER: call `requireUser()` first and scope every
 * query to that verified user id. Never take an owner id from a request body or URL.
 * Server-only; reserved for atomic quota operations and explicit admin actions.
 */
export function createSupabaseAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new AppError("config_missing");
  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
