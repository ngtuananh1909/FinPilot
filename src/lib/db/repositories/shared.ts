import type { SupabaseClient } from "@supabase/supabase-js";
import { assertOwnerContext } from "@/lib/auth/owner-context";
import { DbError, mapDbError, type PostgrestLikeError } from "../errors";
import { parseInput, uuidSchema } from "../inputs";

/**
 * Structural client type. Tests pass a recording fake; production passes the RLS-bound
 * server client from `createSupabaseServerClient()` (never the admin client, which is
 * reserved for ./server-only).
 */
export type DbClient = Pick<SupabaseClient, "from">;

/**
 * Runtime check that `owner` is a genuine OwnerContext issued by the auth module, then returns the
 * verified id. Every repository function starts with this call, so a forged cast fails here.
 */
export function ownerIdOf(owner: unknown): string {
  assertOwnerContext(owner);
  return owner.userId;
}

/** Validates a row id taken from a route/tool argument. Ids select rows; they never select owners. */
export function rowId(id: unknown): string {
  return parseInput(uuidSchema, id);
}

export function throwIfError(error: PostgrestLikeError | null): void {
  if (error) throw mapDbError(error);
}

export function notFound(entity: string): DbError {
  return new DbError("not_found", { safeDetails: { entity } });
}

export interface Page<T> {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Fetches `limit + 1` rows via range(), so `hasMore` needs no count query. */
export function pageRange(offset: number, limit: number): [number, number] {
  return [offset, offset + limit];
}

export function toPage<T>(rows: T[], limit: number, offset: number): Page<T> {
  return { items: rows.slice(0, limit), limit, offset, hasMore: rows.length > limit };
}
