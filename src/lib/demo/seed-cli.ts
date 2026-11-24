import { pathToFileURL } from "node:url";
import {
  SeedError,
  assertApplyAllowed,
  formatReport,
  planSeed,
  runSeed,
  type SeedAdmin,
  type SeedEnv,
} from "./seed-accounts";
import { createFakeSeedAdmin } from "./seed-fake-admin";

/**
 * Entry for `npm run seed:demo` / `npm run seed:demo:apply` (see docs/17-demo-account-seeding.md).
 *
 * Default = dry-run with NO network access. The real Supabase admin adapter is imported and
 * constructed only when `--apply` is present, the project-ref gate passed, and `--fake` is absent.
 * Output contains masked e-mails and persona names only: never passwords, tokens or keys.
 */

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

export interface CliDeps {
  /** Overridable in tests. Default dynamically imports the real adapter. */
  createRealAdmin?: (env: SeedEnv) => Promise<SeedAdmin>;
  now?: () => Date;
}

const USAGE = [
  "Usage: seed-demo-accounts [--apply] [--force] [--fake]",
  "  (default)  dry-run: validates env and prints the plan, no network, no writes",
  "  --apply    perform writes; needs SEED_ALLOWED_PROJECT_REF and SEED_CONFIRM_PROJECT_REF",
  "  --force    re-clone persona data for accounts that are already seeded",
  "  --fake     use an in-memory admin (offline rehearsal); never contacts Supabase",
];

/** Dry-run without --fake must stay offline: any accidental call is a bug. */
const offlineAdmin: SeedAdmin = {
  async findUserByEmail() {
    throw new Error("offline dry-run must not look up users");
  },
  async createUser() {
    throw new Error("offline dry-run must not create users");
  },
  async findProfile() {
    throw new Error("offline dry-run must not read profiles");
  },
  async callResetRpc() {
    throw new Error("offline dry-run must not call RPCs");
  },
};

async function defaultCreateRealAdmin(env: SeedEnv): Promise<SeedAdmin> {
  const { createSupabaseSeedAdmin } = await import("./seed-supabase-admin");
  return createSupabaseSeedAdmin(env);
}

export async function main(argv: readonly string[], env: SeedEnv, io: CliIo, deps: CliDeps = {}): Promise<number> {
  const known = new Set(["--apply", "--force", "--fake", "--help"]);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0 || argv.includes("--help")) {
    // Unknown arguments are not echoed back (they could be mistyped secrets).
    if (unknown.length > 0) io.err("error: unknown argument(s)");
    for (const line of USAGE) io.out(line);
    return unknown.length > 0 ? 2 : 0;
  }
  const apply = argv.includes("--apply");
  const force = argv.includes("--force");
  const fake = argv.includes("--fake");
  const now = (deps.now ?? (() => new Date()))();

  try {
    const plan = planSeed(env);

    let admin: SeedAdmin;
    let lookup: boolean;
    if (fake) {
      admin = createFakeSeedAdmin();
      lookup = true;
      io.out("FAKE MODE: in-memory admin, no Supabase access.");
    } else if (apply) {
      const ref = assertApplyAllowed(env);
      io.out(`Project ref check passed (${ref}). Applying with the real Supabase Auth admin.`);
      admin = await (deps.createRealAdmin ?? defaultCreateRealAdmin)(env);
      lookup = true;
    } else {
      admin = offlineAdmin;
      lookup = false;
    }

    const report = await runSeed(admin, plan, now, { apply, force, lookup });
    for (const line of formatReport(report)) io.out(line);
    return report.entries.some((e) => e.status === "blocked") ? 1 : 0;
  } catch (error) {
    if (error instanceof SeedError) io.err(`error: ${error.message}`);
    else io.err(`error: unexpected failure (${error instanceof Error ? error.name : "unknown"})`);
    return 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main(
    process.argv.slice(2),
    process.env,
    { out: (l) => console.log(l), err: (l) => console.error(l) },
  ).then((code) => {
    process.exitCode = code;
  });
}
