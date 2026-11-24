# 18 · G2 approval pack for migration 0003 (DRAFT, nothing executed)

> **Nothing in this document has been executed.** No connection was made to the hosted Supabase project, no Supabase CLI command was run, no credentials were read, and nothing from this pack was applied. The owner approves each numbered step in section 8 separately.

Review text: `docs/14-sql-review.md` ("Migration 0003", findings F15, F16). Style follows `docs/15-g2-migration-approval-pack.md`.

## 1. Target
- Supabase project ref: `<PROJECT_REF — owner to supply>` (the single shared project, DECISIONS D26)
- Database `postgres`, schema `public`
- Precondition: migrations `202611230001` and `202611230002` are already applied there (0003 calls `public.parse_safe_vnd` and relies on the 0002 constraints).

## 2. Files and checksums (sha256 via `shasum -a 256`)
Re-run `shasum -a 256 <file>` immediately before G2. Any difference invalidates this request.

| File | Role | sha256 (at drafting time) |
|---|---|---|
| `supabase/migrations/202611230001_finpilot_initial.sql` | Applied, immutable | `f0eb34b40d05f104ef7424b8b948b218823af460a738b824638f84bf784ead23` |
| `supabase/migrations/202611230002_finpilot_hardening.sql` | Applied, immutable | `1c2bc21b9bb9d4d7f0eb5e4a6d4bea9c43eb51eec40463d315d292620db4fd01` |
| `supabase/proposed/202611230003_finpilot_profile_protection_and_csv_commit.sql` | **Proposed 0003** | `a058be50986fa4ac1ecef262723aefff72eedc755bd5b8efe6c18a5be9157f59` |
| `supabase/proposed/202611230003_finpilot_profile_protection_and_csv_commit_rollback.sql` | Rollback (not a migration) | `e73023713fd79e458eb0aad56748c59b8c2ad94cc0b3373f7a2bfc9632013f3e` |

**Placement (owner action, at approval time only).** The proposed file lives in `supabase/proposed/`, so `supabase db push` cannot see it. Move it to `supabase/migrations/` only when the owner approves the apply, in a separate reviewed commit. The rollback script never moves. In that same commit:
- move the `proposed0003` entry of `tests/db/sql-helpers.ts` and the placement assertions in `tests/db/sql-static-0003.test.ts` to the new location (the "not in supabase/migrations" assertion must flip), and
- update the file list in `tests/db/sql-static.test.ts` ("sits in supabase/migrations") to include the third file.

The preview command is `supabase db push --remote --dry-run`. It lists the migration files the CLI would apply and executes none of them. It needs the project to be linked, which is a CLI action on the target, so it needs its own approval (item 2 below). Do not use `--include-all`, `db reset`, or `link --password`.

## 3. Objects created or altered by 0003
**Created**
- Function `public.protect_profile_columns()` (trigger function, SECURITY INVOKER, `search_path = ''`; EXECUTE revoked from public/anon/authenticated, granted to `service_role`)
- Triggers `financial_profiles_protect_columns_insert` (BEFORE INSERT) and `financial_profiles_protect_columns_update` (BEFORE UPDATE) on `public.financial_profiles`
- Function `public.commit_csv_import(uuid,text,text,jsonb,integer)` (SECURITY DEFINER, `search_path = ''`; EXECUTE revoked from public/anon/authenticated, granted to `service_role`)

**Altered:** nothing. No table, column, constraint, index, policy, RLS setting or table privilege changes.
**Not done:** no DROP, TRUNCATE, UPDATE or DELETE statement; no seed; no Auth change; no data change. Existing profile rows are not rewritten (triggers act on future writes only).

**Behaviour change to be aware of.** After 0003, a client request (role `authenticated` or `anon`) that changes `user_id`, `persona_code` or `is_demo` on `financial_profiles`, or inserts a profile with a `persona_code` or `is_demo = true`, fails with SQLSTATE `42501`. The application does not do this today (`profileUpdateSchema` is strict and rejects those keys; `bootstrap_profile` and `reset_user_to_persona` run as the function owner).

## 4. Read-only pre-checks (run only after the owner approves item 1)
All are `SELECT`/`SHOW`. Run them in the Supabase SQL editor or a read-only `psql` session; the connection string is supplied securely by the owner and never committed or logged.

```sql
-- 1. Server version (0003 needs nothing newer than PG15, which 0001 already requires).
show server_version_num;

-- 2. Migration history: expect 202611230001 and 202611230002, and NOT 202611230003.
select version, name from supabase_migrations.schema_migrations order by version;

-- 3. The two dependencies exist, and 0003 objects do not yet.
select p.proname, p.prosecdef, p.proconfig, p.proowner::regrole as owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('parse_safe_vnd','set_updated_at','bootstrap_profile','reset_user_to_persona',
                    'protect_profile_columns','commit_csv_import')
order by 1;      -- expect the first four present, the last two absent

-- 4. Existing triggers on financial_profiles (expect only financial_profiles_set_updated_at).
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.financial_profiles'::regclass and not tgisinternal order by 1;

-- 5. Who may currently write protected columns, and the data 0003 will start protecting.
select count(*) as profiles,
       count(*) filter (where is_demo) as demo_profiles,
       count(*) filter (where persona_code is not null) as with_persona
from public.financial_profiles;

-- 6. import_batches idempotency check from 0002 is present.
select conname from pg_constraint
where conrelid = 'public.import_batches'::regclass and conname = 'import_batches_idempotency_key_check';

-- 7. Nothing in the application calls the new RPC yet (repository check, no SQL):
--    grep -rn "commit_csv_import\|csv-commit" src   -> only src/lib/db/repositories/server-only/csv-commit.ts
```
If check 2 shows 0003 already present, or check 3 shows a missing dependency, stop and re-plan.

## 5. Dry-run and apply commands (for the OWNER; the agent runs none of them)
```bash
# 0. Verify the files are exactly the reviewed ones.
shasum -a 256 supabase/proposed/202611230003_finpilot_profile_protection_and_csv_commit.sql \
              supabase/proposed/202611230003_finpilot_profile_protection_and_csv_commit_rollback.sql

# 1. Placement commit (reviewed): move, do not copy.
git mv supabase/proposed/202611230003_finpilot_profile_protection_and_csv_commit.sql supabase/migrations/
#    ...update tests/db/sql-helpers.ts, sql-static-0003.test.ts, sql-static.test.ts as in section 2,
#    then: npm run typecheck && npm run lint && npm test

# 2. Preview only. Executes nothing; lists the pending migration(s). Expect exactly 202611230003.
supabase db push --remote --dry-run

# 3. Apply (only after item 5 of section 8 is approved and the backup in section 6 exists).
supabase db push --remote
```
Alternative without the CLI: paste the file into the SQL editor inside `begin; ... commit;` (rollback on any error). The file is safe to run twice (`create or replace`, trigger creation guarded by `pg_trigger` lookups).

## 6. Backup and rollback plan
1. **Backup.** 0003 changes no data, but take a schema-level dump anyway: `pg_dump --schema=public --no-owner --file=finpilot-public-<date>.sql "<approved connection string>"`, stored outside the repository. Note the latest PITR/daily restore point if the plan has one; do not assume PITR on the free tier.
2. **Rollback.** Run `supabase/proposed/202611230003_finpilot_profile_protection_and_csv_commit_rollback.sql` (SQL editor, in a transaction). It drops only the two triggers and two functions created by 0003 (`drop ... if exists`, no `cascade`), deletes no rows, and leaves batches and transactions written by `commit_csv_import` in place. Rolling back removes the column protection (a security regression), so do it only to undo 0003.
3. **Migration history.** If 0003 was applied through the CLI, the rollback script does not delete its `schema_migrations` row. Reconcile it only with an approved, separately described step (`supabase migration repair --status reverted 202611230003`); do not edit the history table by hand.
4. Never use `db reset`, `DROP SCHEMA`, `TRUNCATE` or an unscoped `DELETE` to recover.

## 7. Post-apply verification (read-only SQL)
```sql
-- Triggers exist, are enabled and cover both operations (type bit 2 = row, 4 = delete, 8 = insert, 16 = update; BEFORE = 2 set).
select tgname, tgenabled, tgtype from pg_trigger
where tgrelid = 'public.financial_profiles'::regclass and not tgisinternal order by 1;
-- expect: financial_profiles_protect_columns_insert, financial_profiles_protect_columns_update,
--         financial_profiles_set_updated_at (all 'O')

-- Both functions: owner, search_path, DEFINER flag, ACL (service_role and owner only).
select p.proname, p.proowner::regrole, p.prosecdef, p.proconfig, p.proacl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('protect_profile_columns','commit_csv_import');
-- expect: protect_profile_columns prosecdef = false; commit_csv_import prosecdef = true; both {search_path=""}

select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'execute') as can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
cross join (select oid, rolname from pg_roles where rolname in ('anon','authenticated','service_role')) r
where n.nspname = 'public' and p.proname in ('protect_profile_columns','commit_csv_import')
order by 1, 2;     -- expect can_execute = true only for service_role

-- RLS and policies unchanged: 11 tables, rowsecurity true, same policy list as before 0003.
select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by 1;
select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2;

-- Migration history now lists 202611230003.
select version, name from supabase_migrations.schema_migrations order by version;
```
Behaviour checks need a database session and are therefore part of the live suite (`tests/db/rls-0003.live.test.ts`): column protection, insert guard, atomicity on a bad row, replay, 50-way concurrent same-key commit, and denial for `anon`/`authenticated`. Run them only after item 6 below is approved.

## 8. Approval items (each needs its own yes)
1. Read-only pre-checks (section 4) against `<PROJECT_REF>`.
2. Linking the CLI to the project and running `supabase db push --remote --dry-run` (preview only).
3. `pg_dump` schema backup (section 6.1).
4. The placement commit (section 2): move the file into `supabase/migrations/` and update the tests.
5. Apply 0003 (`supabase db push --remote`, or the SQL-editor transaction).
6. Post-apply verification (section 7) and the live suite with throwaway anonymous users (requires `RLS_TEST_ENABLED`, `RLS_TEST_MIGRATION_0003`, and the secrets supplied securely).
7. Wiring `commitCsvImportRpc` into the CSV commit route is a **separate code change** and review (not part of this pack). Any seed, push or deploy remains a separate gate (G2 seed / G4).

## 9. Statement of non-execution
As of this document: 0003 was not applied anywhere, no SQL was run against any Supabase project, no `supabase` CLI command was run, no remote endpoint was called, `.env` and `.env.local` were not read, nothing was committed or pushed, and `supabase/migrations/` was not edited. The only database execution was a local, ephemeral `postgres:16` container started with `--network none`, with stubbed `auth` objects and roles, removed afterwards (results in `docs/14-sql-review.md`, "Migration 0003").
