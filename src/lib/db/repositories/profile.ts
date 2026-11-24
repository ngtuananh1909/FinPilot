import { COLUMNS, mapProfileRow, toProfileUpdate, type ProfileRecord } from "../mappers";
import { parseInput, profileUpdateSchema } from "../inputs";
import { DbError } from "../errors";
import type { OwnerContext } from "@/lib/auth/owner-context";
import { ownerIdOf, throwIfError, type DbClient } from "./shared";

const TABLE = "financial_profiles";

/** The caller's profile, or null if none exists yet (created server-side via bootstrap_profile). */
export async function getProfile(client: DbClient, owner: OwnerContext): Promise<ProfileRecord | null> {
  const userId = ownerIdOf(owner);
  const { data, error } = await client.from(TABLE).select(COLUMNS.profile).eq("user_id", userId).maybeSingle();
  throwIfError(error);
  return data ? mapProfileRow(data) : null;
}

export async function requireProfile(client: DbClient, owner: OwnerContext): Promise<ProfileRecord> {
  const profile = await getProfile(client, owner);
  if (!profile) throw new DbError("profile_missing");
  return profile;
}

/**
 * Updates editable profile fields. `persona_code`, `is_demo` and `user_id` are not
 * accepted (strict schema): they are server-controlled.
 */
export async function updateProfile(client: DbClient, owner: OwnerContext, input: unknown): Promise<ProfileRecord> {
  const userId = ownerIdOf(owner);
  const payload = toProfileUpdate(parseInput(profileUpdateSchema, input));
  const { data, error } = await client
    .from(TABLE)
    .update(payload)
    .eq("user_id", userId)
    .select(COLUMNS.profile)
    .maybeSingle();
  throwIfError(error);
  if (!data) throw new DbError("profile_missing");
  return mapProfileRow(data);
}
