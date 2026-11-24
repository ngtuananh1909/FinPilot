/**
 * Safety guard for the live RLS/RPC tests. The tests may only run against the Supabase
 * project whose ref is explicitly listed in RLS_TEST_ALLOWED_PROJECT_REF. Pure function so
 * it can be unit tested without any network access.
 */
export function projectRefFromUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const m = /^([a-z0-9]{10,40})\.supabase\.co$/.exec(url.hostname);
  return m?.[1] ?? null;
}

export function assertTargetAllowed(rawUrl: string | undefined, allowedRef: string | undefined): string {
  if (!rawUrl) throw new Error("RLS_TEST_SUPABASE_URL is not set");
  if (!allowedRef || !/^[a-z0-9]{10,40}$/.test(allowedRef)) {
    throw new Error("RLS_TEST_ALLOWED_PROJECT_REF must be set to the explicitly approved project ref");
  }
  const ref = projectRefFromUrl(rawUrl);
  if (!ref) throw new Error("RLS_TEST_SUPABASE_URL is not an https://<ref>.supabase.co URL");
  if (ref !== allowedRef) {
    throw new Error("Refusing to run: Supabase URL project ref does not match RLS_TEST_ALLOWED_PROJECT_REF");
  }
  return ref;
}
