import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/config/public-env";
import { isProtectedPath } from "@/lib/auth/routes";
import { refreshSession } from "@/lib/db/middleware";

export async function middleware(request: NextRequest) {
  const protectedPath = isProtectedPath(request.nextUrl.pathname);

  let env;
  try {
    env = getPublicEnv();
  } catch {
    // Fail safe: never serve protected pages without auth; other pages (and the build) keep working.
    if (protectedPath) {
      return new NextResponse("Hệ thống chưa được cấu hình Supabase. Vui lòng liên hệ quản trị viên.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    return NextResponse.next();
  }

  const { response, user } = await refreshSession(request, env);
  if (protectedPath && !user) {
    const redirect = NextResponse.redirect(new URL("/", request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
