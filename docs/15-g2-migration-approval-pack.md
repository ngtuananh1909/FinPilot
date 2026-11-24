# 15 · G2 migration approval pack (DRAFT, nothing executed)

> **Nothing in this document has been executed.** No connection was made to the hosted Supabase project, no credentials were read, and no SQL from this pack has been run against it. The owner must approve each numbered step below separately before it is run.

## 1. Target
- Supabase project ref: `<PROJECT_REF — owner to supply>` (the single shared project, DECISIONS D26)
- Database: `postgres`, schema `public` (plus read of `auth.users` by the new functions)
- Plan/backup capability: `<owner to confirm; free tier may have no PITR>`

## 2. Files and checksums (sha256 via `shasum -a 256`)
Re-run `shasum -a 256 <file>` immediately before G2. Any difference invalidates this approval request.

| File | Role | sha256 (at drafting time) |
|---|---|---|
| `supabase/migrations/202611230001_finpilot_initial.sql` | Base (candidate, **not applied**, unchanged) | `f0eb34b40d05f104ef7424b8b948b218823af460a738b824638f84bf784ead23` |
| `supabase/proposed/202611230002_finpilot_hardening.sql` | Proposed follow-up | `1c2bc21b9bb9d4d7f0eb5e4a6d4bea9c43eb51eec40463d315d292620db4fd01` |
| `supabase/proposed/202611230002_finpilot_hardening.rollback.sql` | Rollback (not a migration) | `09bfe3c47758b2464f49e848cd587c929575618c44e15b275ff22f63dc9ecb06` |

Review document: `docs/14-sql-review.md`. Tests: `tests/db/`.

The proposed file is **not** in `supabase/migrations/`, so `supabase db push` cannot pick it up. If approved, the move into `supabase/migrations/` is a separate, reviewed commit (the placement test `tests/db/sql-static.test.ts` must be updated in that commit).

## 3. Objects created or altered by `202611230002`
**Created**
- Tables: `public.reset_log`, `public.ai_quota_reservations` (RLS on; reservations have one select-own policy)
- Functions (all `service_role`-only EXECUTE): `set_updated_at`, `reserve_ai_quota`, `release_ai_quota`, `commit_ai_quota`, `bootstrap_profile`, `parse_safe_vnd`, `reset_user_to_persona`
- Triggers: `*_set_updated_at` on `financial_profiles`, `recurring_items`, `transactions`, `savings_goals`, `ai_conversations`
- Constraints: `financial_profiles_safe_amounts_check`, `financial_profiles_display_name_check`, `import_batches_idempotency_key_check`, `recurring_items_{safe_amount,label,category}_check`, `transactions_{safe_amount,category}_check`, `savings_goals_{safe_amounts,name}_check`
- Indexes: `transactions_owner_fingerprint_idx`, `ai_quota_reservations_owner_idx`

**Altered**
- `transactions_owner_recurring_fk`: dropped and re-added as `on delete no action` (only constraint dropped)
- `public.consume_ai_quota`: `create or replace` with NULL guards (same signature/grants)
- `recurring_items.start_date` default
- Privileges: revokes only (anon on all 9 base tables; truncate/references/trigger on client tables; write/truncate/references/trigger on AI tables for `authenticated`)

**Not done by this migration:** no table drop, truncate, row delete outside `reset_user_to_persona`, no seed, no Auth change, no data change. Both new tables start empty.

## 4. Read-only pre-checks (run only after the owner approves this step)
All are `SELECT`/`SHOW` statements. Run them in the Supabase SQL editor for the approved project, or through a read-only `psql` session with the approved connection string supplied securely by the owner (never committed or logged). Do not use `supabase db push`, `link --password`, or `reset`.

```sql
-- 1. PostgreSQL version. Must be >= 150000 (ON DELETE SET NULL (col) in the base file).
show server_version_num;
select version();

-- 2. Migration history (expect no 202611230001 / 202611230002 yet).
select version, name from supabase_migrations.schema_migrations order by version;

-- 3. Existing FinPilot tables (expect none of the 9 base tables or 2 new ones).
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('financial_profiles','import_batches','recurring_items','transactions',
    'savings_goals','ai_conversations','ai_messages','ai_proposals','ai_usage_daily',
    'reset_log','ai_quota_reservations');

-- 4. Existing policies and functions in public.
select schemaname, tablename, policyname from pg_policies where schemaname = 'public' order by 2, 3;
select p.proname, p.proowner::regrole as owner, p.prosecdef as security_definer,
       p.proconfig as config, p.proacl as acl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by 1;

-- 5. Default privileges that will apply to new public objects (explains F04/F05).
select defaclrole::regrole as role, defaclobjtype as objtype, defaclacl as acl
from pg_default_acl;

-- 6. Auth settings relevant to guests are checked in the dashboard (read-only view):
--    Anonymous sign-ins enabled; rate limits for anonymous sign-ins noted.
```
If check 1 returns < 150000, stop: follow the PG<15 path in `docs/14-sql-review.md` F03. If checks 2 or 3 show existing objects, stop and re-plan; this pack assumes a clean `public` schema.

After the base has been applied (step 6, if ever approved), repeat before applying the follow-up:
```sql
select count(*) from public.transactions;      -- expect 0
select count(*) from public.recurring_items;   -- expect 0
select conname, confdeltype from pg_constraint
where conname = 'transactions_owner_recurring_fk';   -- expect 'n' before, 'a' after
```

## 5. Dry-run procedure
1. Local only (already done once, informally, in a throwaway `postgres:16` container with stubs): apply base, apply proposed twice, apply rollback, re-apply. This does not substitute for step 2.
2. Hosted dry run, **only with approval**: `supabase db push --dry-run` lists which migration files the CLI would apply and does not execute them. It requires the project to be linked, which is itself a CLI action on the target. Ask for approval for `link` and `--dry-run` as a separate item, or skip and rely on the wrapped-transaction plan below.
3. Apply plan: run each file inside an explicit `begin; ... commit;` in the SQL editor (or one CLI migration per file). If any statement errors, `rollback;` and stop. Do not retry automatically.

## 6. Backup and rollback plan
1. Backup first, even though tables are empty:
   `pg_dump --schema=public --no-owner --file=finpilot-public-<date>.sql "<approved connection string>"` (run only after approval; store outside the repository). If the plan includes daily backups or PITR, note the latest restore point. Do not assume PITR on the free tier.
2. Base migration rollback (if base was applied in this operation and must be undone): needs its own drop script, not provided here because it drops tables. Request separate approval if needed. Since the tables would be empty, restoring from the `pg_dump` is the alternative.
3. Hardening rollback: `supabase/proposed/202611230002_finpilot_hardening.rollback.sql`. It removes only objects created by the hardening migration, restores the original recurring FK (PG15+) and original `consume_ai_quota`. It does not re-grant revoked privileges and deletes no base-table rows. Because `reset_log` and `ai_quota_reservations` are new and empty at apply time, rollback right after apply loses nothing. Rolling back later drops their contents; counters in `ai_usage_daily` stay.
4. Never use `db reset`, `DROP SCHEMA`, `TRUNCATE`, or unscoped `DELETE` to recover.

## 7. Post-apply verification (read-only SQL)
```sql
-- RLS enabled on all 11 tables (expect 11 rows, all true).
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('financial_profiles','import_batches','recurring_items',
  'transactions','savings_goals','ai_conversations','ai_messages','ai_proposals','ai_usage_daily',
  'reset_log','ai_quota_reservations');

-- Functions: DEFINER, empty search_path, owner, ACL must show service_role only (plus owner).
select p.proname, p.proowner::regrole, p.prosecdef, p.proconfig, p.proacl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by 1;

-- Nobody but the owner and service_role may execute them.
select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'execute') as can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
cross join (select oid, rolname from pg_roles where rolname in ('anon','authenticated','service_role')) r
where n.nspname = 'public' and p.proname in ('consume_ai_quota','reserve_ai_quota','release_ai_quota',
  'commit_ai_quota','bootstrap_profile','reset_user_to_persona','parse_safe_vnd','set_updated_at')
order by 1, 2;   -- expect can_execute = true only for service_role

-- Table privileges for clients.
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated') order by 1, 2, 3;
  -- expect: no anon rows; authenticated = select/insert/update/delete on the 5 client tables,
  --         select only on ai_* tables and ai_quota_reservations; nothing on reset_log.

-- Triggers and the FK action.
select tgname, tgrelid::regclass from pg_trigger where tgname like '%\_set\_updated\_at' order by 1;
select conname, confdeltype from pg_constraint where conname = 'transactions_owner_recurring_fk'; -- 'a'
```
Then, only if separately approved (G2 for test users), run the live suite described in `tests/db/README.md`. Until then the live suite is BLOCKED.

## 8. Approval items (each needs its own yes)
1. Read-only pre-checks (section 4) against `<PROJECT_REF>`.
2. `pg_dump` backup of `public` (section 6.1).
3. Apply base `202611230001` (only after pre-checks pass; PG >= 15).
4. Apply hardening `202611230002` (after moving it into `supabase/migrations/` in a reviewed commit).
5. Post-apply verification (section 7, read-only).
6. Live RLS/RPC suite with throwaway anonymous users (creates and deletes users by id; requires the service-role key supplied securely).
7. Any seed, demo-account creation or push/deploy remains a **separate** gate (G2 seed / G4).

## 9. Statement of non-execution
As of this document: no migration was applied, no SQL was run against any Supabase project, no Auth admin call was made, `.env` and `.env.local` were not read, and nothing was committed or pushed. The only database execution was a local, ephemeral container with stubbed `auth` objects, described in `docs/14-sql-review.md`.
