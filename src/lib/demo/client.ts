import type { PersonaCode } from "@/lib/db/schema";

/** Minimal browser-side surface, injectable for tests. */
export interface DemoClientDeps {
  signInAnonymously(): Promise<{ error: unknown }>;
  fetchJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }>;
  newKey(): string;
}

export interface DemoApiOutcome {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * Guest entry: creates a NEW anonymous Supabase identity, then asks the server to clone the
 * chosen persona into that identity's own rows. Returns `existing` (no write) when the
 * session already holds data; call again with `confirmReplace: true` after the user confirms.
 */
export async function startGuestSession(
  deps: DemoClientDeps,
  personaCode: PersonaCode,
  options: { confirmReplace?: boolean; reuseSession?: boolean } = {},
): Promise<DemoApiOutcome> {
  if (!options.reuseSession) {
    const { error } = await deps.signInAnonymously();
    if (error) return { ok: false, status: 401, body: { error: { code: "unauthenticated" } } };
  }
  const result = await deps.fetchJson("/api/demo/start", {
    personaCode,
    idempotencyKey: deps.newKey(),
    ...(options.confirmReplace ? { confirmReplace: true } : {}),
  });
  return { ok: result.ok, status: result.status, body: result.json };
}

/** Manual reset of the signed-in user's own demo data. The UI must confirm first. */
export async function resetDemo(deps: DemoClientDeps, personaCode?: PersonaCode): Promise<DemoApiOutcome> {
  const result = await deps.fetchJson("/api/demo/reset", {
    confirm: true,
    idempotencyKey: deps.newKey(),
    ...(personaCode ? { personaCode } : {}),
  });
  return { ok: result.ok, status: result.status, body: result.json };
}
