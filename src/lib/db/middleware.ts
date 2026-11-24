import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { PublicEnv } from "@/lib/config/public-env";

export interface SessionRefreshResult {
  readonly response: NextResponse;
  /** Verified by Supabase Auth (getUser), not decoded from the cookie. */
  readonly user: User | null;
}

/**
 * Refreshes Supabase auth cookies for a request and returns the verified user.
 * Uses only Web APIs, so it runs in the Next.js middleware sandbox.
 */
export async function refreshSession(
  request: NextRequest,
  env: Pick<PublicEnv, "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY">,
): Promise<SessionRefreshResult> {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });
  // Do not run code between client creation and getUser(): it validates and refreshes the session.
  const { data, error } = await supabase.auth.getUser();
  return { response, user: error ? null : data.user };
}
