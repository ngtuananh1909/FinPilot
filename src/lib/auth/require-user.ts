import type { User } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/db/server";

/** Minimal surface needed for verification; lets tests inject a fake. */
export interface AuthVerifier {
  auth: {
    getUser(): Promise<{ data: { user: User | null }; error: unknown }>;
  };
}

export interface AuthenticatedUser {
  /** Verified id from Supabase Auth. The only trusted source of owner identity. */
  readonly userId: string;
  readonly user: User;
  readonly isAnonymous: boolean;
}

export const isAnonymousUser = (user: Pick<User, "is_anonymous"> | null | undefined): boolean =>
  user?.is_anonymous === true;

/**
 * Derives the caller identity ONLY from `supabase.auth.getUser()` (server-verified).
 * Takes no request body/URL input by design. Throws AppError("unauthenticated").
 */
export async function requireUser(client?: AuthVerifier): Promise<AuthenticatedUser> {
  const supabase = client ?? (await createSupabaseServerClient());
  let result: Awaited<ReturnType<AuthVerifier["auth"]["getUser"]>>;
  try {
    result = await supabase.auth.getUser();
  } catch (cause) {
    throw new AppError("unauthenticated", { cause });
  }
  const user = result.error ? null : result.data?.user;
  if (!user || !user.id) throw new AppError("unauthenticated");
  return { userId: user.id, user, isAnonymous: isAnonymousUser(user) };
}
