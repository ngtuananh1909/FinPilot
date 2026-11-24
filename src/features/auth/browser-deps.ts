import type { CredentialsDeps } from "@/lib/auth/credentials-flow";
import { createSupabaseBrowserClient } from "@/lib/db/browser";

export function createBrowserCredentialsDeps(): CredentialsDeps {
  const auth = () => createSupabaseBrowserClient().auth;
  return {
    signInWithPassword: (args) => auth().signInWithPassword(args),
    signUp: ({ email, password, emailRedirectTo }) =>
      auth().signUp({ email, password, options: { emailRedirectTo } }),
  };
}
