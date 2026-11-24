/** The five authenticated app routes. Pure so middleware logic is unit-testable. */
export const PROTECTED_ROUTES = [
  "/dashboard",
  "/transactions",
  "/assistant",
  "/simulator",
  "/settings",
] as const;

export function isProtectedPath(pathname: string): boolean {
  // Normalize trailing slashes; match the route itself and its sub-paths only.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PROTECTED_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}

/**
 * Public auxiliary entry screens. They are NOT main navigation items and are not protected by
 * middleware: each one decides for itself what to show for a signed-in or signed-out visitor.
 */
export const AUXILIARY_ROUTES = ["/", "/login", "/signup", "/onboarding", "/auth/callback"] as const;

/** Where a signed-in visitor of /login or /signup is sent. */
export const DEFAULT_SIGNED_IN_PATH = "/dashboard";
