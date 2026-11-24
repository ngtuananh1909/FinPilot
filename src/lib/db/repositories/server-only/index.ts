/**
 * Privileged (service-role) repository. SERVER ONLY. Every function takes an OwnerContext
 * and a client argument; none of them accepts a raw user id.
 *
 * UNUSABLE UNTIL G2: the RPCs below exist only in supabase/proposed/202611230002_finpilot_hardening.sql,
 * which has NOT been applied. Until then they throw DbError("rpc_unavailable").
 */
export * from "./guard";
export * from "./rpc";
export * from "./quota";
export * from "./admin-actions";
export * from "./ai-data";
