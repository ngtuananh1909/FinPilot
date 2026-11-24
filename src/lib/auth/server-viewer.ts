import { createSupabaseServerClient } from "@/lib/db/server";
import { getViewer, type Viewer } from "./viewer";

/** Server-component helper: the verified viewer, or null if signed out or Supabase is not configured. */
export async function loadViewer(options: { withProfile: boolean }): Promise<Viewer | null> {
  try {
    return await getViewer(await createSupabaseServerClient(), options);
  } catch {
    return null;
  }
}
