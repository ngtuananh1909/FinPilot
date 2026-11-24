import type { DemoClientDeps } from "@/lib/demo/client";
import { createSupabaseBrowserClient } from "@/lib/db/browser";
import { requestJson } from "@/lib/http/client";

/** Real browser dependencies for the guest start flow. `onSignedIn` fires after a new anonymous identity exists. */
export function createBrowserDemoDeps(onSignedIn?: () => void): DemoClientDeps {
  return {
    async signInAnonymously() {
      const { error } = await createSupabaseBrowserClient().auth.signInAnonymously();
      if (!error) onSignedIn?.();
      return { error };
    },
    fetchJson: (url, body) => requestJson("POST", url, body),
    newKey: () => crypto.randomUUID(),
  };
}
