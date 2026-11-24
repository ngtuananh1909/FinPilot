import { createClient } from "@supabase/supabase-js";
import { resetPersonaForSeededUser } from "../db/repositories/server-only/seed-admin";
import type { PersonaCode } from "../db/schema";
import type { SeedAdmin, SeedEnv } from "./seed-accounts";

/**
 * REAL admin adapter (service-role). Constructed by seed-cli.ts ONLY for `--apply` after the
 * project-ref gate passed. It never deletes users and never updates a user's password.
 * Errors thrown here carry fixed text only: provider messages can echo e-mail addresses.
 */

const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const PERSONAS: readonly string[] = ["student", "worker", "at_risk"];

class AdminCallError extends Error {
  constructor(step: string) {
    super(step);
    this.name = "AdminCallError";
  }
}

export function createSupabaseSeedAdmin(env: SeedEnv): SeedAdmin {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new AdminCallError("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  return {
    async findUserByEmail(email) {
      // supabase-js 2.119 has no get-by-email admin call: page through listUsers.
      const wanted = email.toLowerCase();
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
        if (error) throw new AdminCallError("auth.admin.listUsers failed");
        const hit = data.users.find((u) => u.email?.toLowerCase() === wanted);
        if (hit) return { id: hit.id };
        if (data.users.length < PAGE_SIZE || data.nextPage === null) return null;
      }
      throw new AdminCallError("auth.admin.listUsers exceeded page limit");
    },

    async createUser({ email, password, emailConfirm }) {
      const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: emailConfirm });
      if (error || !data.user) throw new AdminCallError("auth.admin.createUser failed");
      return { id: data.user.id };
    },

    async findProfile(userId) {
      const { data, error } = await client
        .from("financial_profiles")
        .select("persona_code,is_demo")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new AdminCallError("financial_profiles lookup failed");
      if (!data) return null;
      const persona = data.persona_code;
      return {
        isDemo: data.is_demo === true,
        personaCode: typeof persona === "string" && PERSONAS.includes(persona) ? (persona as PersonaCode) : null,
      };
    },

    callResetRpc(userId, input) {
      return resetPersonaForSeededUser(client, userId, {
        template: input.template,
        idempotencyKey: input.idempotencyKey,
      });
    },
  };
}
