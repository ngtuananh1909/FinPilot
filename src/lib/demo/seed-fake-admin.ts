import type { PersonaCode } from "../db/schema";
import type { SeedAdmin } from "./seed-accounts";

/** In-memory SeedAdmin for `--fake` runs and tests. Never touches a network or a database. */
export interface FakeSeedAdmin extends SeedAdmin {
  readonly users: Map<string, { id: string; password: string }>;
  readonly profiles: Map<string, { isDemo: boolean; personaCode: PersonaCode | null }>;
  readonly calls: string[];
  readonly resetKeys: string[];
}

export function createFakeSeedAdmin(
  initial: { users?: { email: string; id: string; password?: string }[] } = {},
): FakeSeedAdmin {
  const users = new Map<string, { id: string; password: string }>();
  for (const u of initial.users ?? []) users.set(u.email.toLowerCase(), { id: u.id, password: u.password ?? "pre-existing" });
  const profiles = new Map<string, { isDemo: boolean; personaCode: PersonaCode | null }>();
  const calls: string[] = [];
  const resetKeys: string[] = [];
  let counter = 0;

  return {
    users,
    profiles,
    calls,
    resetKeys,
    async findUserByEmail(email) {
      calls.push("findUserByEmail");
      const hit = users.get(email.toLowerCase());
      return hit ? { id: hit.id } : null;
    },
    async createUser({ email, password }) {
      calls.push("createUser");
      counter += 1;
      const id = `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
      users.set(email.toLowerCase(), { id, password });
      return { id };
    },
    async findProfile(userId) {
      calls.push("findProfile");
      return profiles.get(userId) ?? null;
    },
    async callResetRpc(userId, input) {
      calls.push("callResetRpc");
      if (input.idempotencyKey.length > 128) throw new Error("key too long");
      if (resetKeys.includes(`${userId}|${input.idempotencyKey}`)) return { applied: false, replay: true };
      resetKeys.push(`${userId}|${input.idempotencyKey}`);
      profiles.set(userId, { isDemo: true, personaCode: input.template.persona_code });
      return { applied: true, replay: false };
    },
  };
}
