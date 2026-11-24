import { AppError } from "@/lib/errors";
import { requireUser, type AuthVerifier, type AuthenticatedUser } from "./require-user";

declare const ownerBrand: unique symbol;

/**
 * Proof that `userId` was verified by Supabase Auth. Repositories accept ONLY this type.
 *
 * - Type level: the unique-symbol brand cannot be written outside this module, so an
 *   object literal or a plain string is not assignable.
 * - Runtime: contexts are registered in a WeakSet when issued; `assertOwnerContext`
 *   rejects anything produced by a cast (`as unknown as OwnerContext`).
 */
export interface OwnerContext {
  readonly [ownerBrand]: true;
  readonly userId: string;
  readonly isAnonymous: boolean;
}

const issued = new WeakSet<object>();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The single factory for OwnerContext. Call it only with the result of `requireUser()`.
 * A static test (tests/db/repositories/owner-context.test.ts) fails if any file outside
 * `src/lib/auth` calls it; route handlers use `requireOwner()` below instead.
 */
export function ownerContextFromVerifiedUser(user: AuthenticatedUser): OwnerContext {
  const id = user?.userId;
  if (typeof id !== "string" || !UUID_PATTERN.test(id) || user.user?.id !== id) {
    throw new AppError("unauthenticated");
  }
  const context = Object.freeze({
    userId: id.toLowerCase(),
    isAnonymous: user.isAnonymous === true,
  }) as unknown as OwnerContext;
  issued.add(context);
  return context;
}

/** Verifies the session with `requireUser()` and returns the owner context. */
export async function requireOwner(client?: AuthVerifier): Promise<OwnerContext> {
  return ownerContextFromVerifiedUser(await requireUser(client));
}

export function isOwnerContext(value: unknown): value is OwnerContext {
  return typeof value === "object" && value !== null && issued.has(value);
}

/** Runtime guard used by every repository function. Defeats forged casts. */
export function assertOwnerContext(value: unknown): asserts value is OwnerContext {
  if (!isOwnerContext(value)) throw new AppError("unauthenticated");
}
