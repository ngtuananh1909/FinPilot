import { NextResponse } from "next/server";
import { sanitizeNextPath } from "@/lib/auth/safe-redirect";
import { getPublicEnv } from "@/lib/config/public-env";
import { createSupabaseServerClient } from "@/lib/db/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Email-confirmation (PKCE) callback: exchanges `?code=` for a session cookie, then redirects.
 * `next` is accepted only as a same-origin relative path; the redirect base is the configured
 * app origin, never a request-supplied host.
 */
export async function GET(request: Request): Promise<Response> {
  let base: string;
  try {
    base = new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).origin;
  } catch {
    return new NextResponse("Hệ thống chưa được cấu hình.", { status: 503 });
  }
  const params = new URL(request.url).searchParams;
  const next = sanitizeNextPath(params.get("next"), "/onboarding");
  const code = params.get("code");
  const failure = NextResponse.redirect(new URL("/login?error=callback", base));
  if (!code) return failure;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure;
  } catch {
    return failure;
  }
  return NextResponse.redirect(new URL(next, base));
}
