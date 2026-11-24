# DB tests (`tests/db/`)

## What runs by default
- `sql-static.test.ts` parses `supabase/migrations/202611230001_finpilot_initial.sql`, `supabase/proposed/202611230002_finpilot_hardening.sql` and the rollback file as text. It needs no database and proves **only** structural properties (RLS enabled, `search_path`, revoke/grant lists, no unscoped delete, trigger coverage, and similar). It does **not** prove database behaviour.
- `target-guard.test.ts` unit-tests the project-ref guard used by the live suite.
- `rls.live.test.ts` is **skipped** unless `RLS_TEST_ENABLED` is set. Status: **BLOCKED** until the owner grants a G2 approval for a specific target.

## Nothing runs without explicit G2 approval
`rls.live.test.ts` creates users, writes rows, calls privileged RPCs and deletes the users it created, all on a real Supabase project. FinPilot has exactly one shared Supabase project (DECISIONS D26), so every run is a remote write. Per `AGENTS.md` and `docs/15-g2-migration-approval-pack.md`, do not set `RLS_TEST_ENABLED` until the owner has approved this exact operation, and only after the hardening migration has been separately approved and applied.

## What a throwaway-user target needs
1. A Supabase project with `202611230001_finpilot_initial.sql` **and** `202611230002_finpilot_hardening.sql` applied (G2-approved).
2. Anonymous sign-ins enabled in Auth settings. The tests create their users through `signInAnonymously()`, so no email/password users and no admin user creation are needed. Anonymous users have the Postgres role `authenticated`.
3. The service-role key, used for fixture setup, concurrency calls and cleanup (`auth.admin.deleteUser` on the ids created by this run). Keep it out of the repository and out of logs.
4. Environment variables (never hard-coded, never committed):

| Variable | Meaning |
|---|---|
| `RLS_TEST_ENABLED` | Any non-empty value turns the suite on |
| `RLS_TEST_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `RLS_TEST_ALLOWED_PROJECT_REF` | The project ref the owner approved. The suite throws if the URL ref differs |
| `RLS_TEST_ANON_KEY` | Publishable/anon key |
| `RLS_TEST_SERVICE_ROLE_KEY` | Service-role key (server-side secret) |

Example (placeholders only):
```
RLS_TEST_ENABLED=1 RLS_TEST_ALLOWED_PROJECT_REF=<approved-ref> \
RLS_TEST_SUPABASE_URL=https://<approved-ref>.supabase.co \
RLS_TEST_ANON_KEY=<anon> RLS_TEST_SERVICE_ROLE_KEY=<service> \
npx vitest run tests/db/rls.live.test.ts
```

## Cleanup rules
- Cleanup deletes **only** the user ids created by the run (tracked in the `created` array). Cascades remove their rows. It never lists users, never matches on email patterns and never touches rows of other users.
- If cleanup fails, the failing user ids are printed. Remove them by id only, with approval.
- The cleanup also exercises `ON DELETE CASCADE` through the NO ACTION recurring FK. A cleanup error there is a real finding, not noise.

## Quota note
Test users are fresh, so the 20-per-day counters of real users are never touched. The concurrency test uses a limit of 20 with 50 parallel calls and expects exactly 20 grants.

## Migration 0003 tests
- `sql-static-0003.test.ts` parses the PROPOSED `supabase/proposed/202611230003_*.sql` (and its rollback) as text. Paths are registered in `sql-helpers.ts` (`proposed0003`, `rollback0003`). When 0003 is approved and moved into `supabase/migrations/`, move those two entries and the placement assertions in the same commit.
- `rls-0003.live.test.ts` is **skipped** unless both `RLS_TEST_ENABLED` and `RLS_TEST_MIGRATION_0003` are set (same target guard and environment variables as `rls.live.test.ts`). BLOCKED until a G2-approved target has 0003 applied.
- `repositories/csv-commit.test.ts` tests the unwired `commitCsvImportRpc` wrapper against fakes.
