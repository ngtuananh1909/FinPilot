import { getProfile } from "@/lib/db/repositories/profile";
import type { DbClient } from "@/lib/db/repositories/shared";
import { ownerContextFromVerifiedUser } from "./owner-context";
import { requireUser, type AuthVerifier } from "./require-user";

/** What the UI needs to know about the verified session. Contains no ids or tokens. */
export interface Viewer {
  isAnonymous: boolean;
  email: string | null;
  displayName: string | null;
  /** `unknown` means the profile read failed; the UI must not claim the profile is missing. */
  profile: "present" | "missing" | "unknown" | "not_loaded";
  /** Guest or a profile flagged is_demo (sample accounts): shows the visible Demo badge. */
  isDemo: boolean;
}

/**
 * Returns the verified viewer, or null when nobody is signed in (or verification fails).
 * Identity comes only from `auth.getUser()`. Never throws.
 */
export async function getViewer(
  client: AuthVerifier & Partial<DbClient>,
  options: { withProfile: boolean },
): Promise<Viewer | null> {
  let user;
  try {
    user = await requireUser(client);
  } catch {
    return null;
  }
  const viewer: Viewer = {
    isAnonymous: user.isAnonymous,
    email: user.user.email ?? null,
    displayName: null,
    profile: "not_loaded",
    isDemo: user.isAnonymous,
  };
  if (!options.withProfile) return viewer;
  try {
    const profile = await getProfile(client as DbClient, ownerContextFromVerifiedUser(user));
    if (!profile) return { ...viewer, profile: "missing" };
    return {
      ...viewer,
      profile: "present",
      displayName: profile.displayName || null,
      isDemo: user.isAnonymous || profile.isDemo,
    };
  } catch {
    return { ...viewer, profile: "unknown" };
  }
}
