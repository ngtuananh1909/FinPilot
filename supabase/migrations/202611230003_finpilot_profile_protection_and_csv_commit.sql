-- =====================================================================
-- PROPOSED - NOT APPLIED - requires G2 approval
-- =====================================================================
-- FinPilot AI third migration (draft for review): profile column protection and the
-- atomic CSV commit RPC.
--
-- * Lives in supabase/proposed/ ON PURPOSE so the Supabase CLI can never apply it by
--   accident. It moves to supabase/migrations/ only at G2 approval time, in a separate
--   reviewed step (see docs/18-g2-approval-pack-0003.md).
-- * Migrations 202611230001 and 202611230002 are applied and immutable. This file does not
--   edit them. It only creates objects: 1 trigger function, 2 triggers, 1 RPC.
-- * Depends on 202611230002 (public.parse_safe_vnd, public.import_batches check
--   constraints, public.set_updated_at).
-- * Contains no DROP, no TRUNCATE, no UPDATE and no DELETE. It never touches RLS
--   (no ALTER TABLE ... ROW LEVEL SECURITY, no policy, no table GRANT/REVOKE).
-- * Rollback: supabase/proposed/202611230003_finpilot_profile_protection_and_csv_commit_rollback.sql
--
-- Findings and reasoning: docs/14-sql-review.md ("Migration 0003").
-- Nothing in this file has been executed against any Supabase project.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Profile column protection
-- ---------------------------------------------------------------------
-- PROBLEM. RLS (financial_profiles_update, with check auth.uid() = user_id) limits WHICH ROWS
-- a client may change, not WHICH COLUMNS. Through PostgREST an authenticated client
-- (including every anonymous guest) can PATCH its own row's persona_code and is_demo.
-- is_demo is a safety flag (the demo reset path refuses real accounts) and persona_code
-- selects the persona; both must be server-controlled. user_id is already pinned by the RLS
-- WITH CHECK; the trigger repeats that as defence in depth.
--
-- WHY A TRIGGER AND NOT COLUMN GRANTS.
--   * The base GRANT is table-level (`grant select,insert,update,delete on ... to
--     authenticated`). A column-level REVOKE does not remove a table-level privilege, so
--     column grants would first need a table-level REVOKE UPDATE and a hand-maintained
--     column allow-list that must be edited on every future column (a forgotten column is
--     silently read-only or, worse, a new sensitive column is silently writable if someone
--     re-grants at table level). That rewrites the privilege shape of an applied migration.
--   * PostgREST upserts (`INSERT ... ON CONFLICT DO UPDATE`) need INSERT and UPDATE rights
--     on every column named in the payload. With grants, a client that echoes the full row
--     back (a common SDK pattern) fails even when persona_code/is_demo are UNCHANGED. The
--     trigger compares OLD and NEW, so an unchanged value is accepted and only a real change
--     is rejected.
--   * Grants cannot express "insert allowed only with persona_code null and is_demo false".
--
-- WHICH ROLES ARE BLOCKED. PostgREST authenticates as `authenticator` and then runs
-- `set local role authenticated` (or `anon`), so inside a client request
-- current_user = 'authenticated'/'anon' while session_user stays 'authenticator'.
-- The guard therefore tests current_user, never session_user.
--
-- WHICH ROLES STILL WORK (verified by reading the code that writes these columns):
--   * service_role: current_user = 'service_role' -> not blocked.
--   * SECURITY DEFINER functions (bootstrap_profile, reset_user_to_persona): the function
--     body runs as its owner (postgres on Supabase), so current_user = owner inside the
--     trigger -> not blocked. bootstrap_profile inserts persona_code (possibly non-null)
--     and reset_user_to_persona upserts persona_code/is_demo = true; both keep working.
--   * Dashboard SQL editor / migrations (postgres, supabase_admin): not blocked.
-- A SECURITY INVOKER trigger function is deliberate: a DEFINER one would make
-- current_user the owner on every call and the check would never fire.
--
-- DECIDED, NOT PROTECTED: balance_snapshot_vnd / balance_snapshot_at stay client-editable.
-- They are the user's own declared starting balance (Settings page) and cannot cross an
-- owner boundary; the financial engine treats them as user input.
--
-- RESIDUAL (documented, unchanged): a client may DELETE its own profile row and insert a
-- fresh one (persona_code null, is_demo false). That is self-service downgrade of its own
-- demo state only; the server recovers the row with bootstrap_profile.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      -- A client may create its own plain profile only.
      if new.persona_code is not null or new.is_demo is distinct from false then
        raise exception 'persona_code and is_demo are server-controlled'
          using errcode = '42501';
      end if;
    elsif tg_op = 'UPDATE' then
      if new.user_id is distinct from old.user_id
         or new.persona_code is distinct from old.persona_code
         or new.is_demo is distinct from old.is_demo then
        raise exception 'user_id, persona_code and is_demo are server-controlled'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_profile_columns() from public;
revoke all on function public.protect_profile_columns() from anon;
revoke all on function public.protect_profile_columns() from authenticated;
grant execute on function public.protect_profile_columns() to service_role;

-- PostgreSQL checks EXECUTE on a trigger function only when the trigger is created, not
-- when it fires, so clients do not need EXECUTE (same shape as public.set_updated_at).
-- Trigger names sort before *_set_updated_at, so the guard runs first; the two are
-- independent.
do $do$
begin
  if not exists (select 1 from pg_trigger
                 where tgname = 'financial_profiles_protect_columns_insert'
                   and tgrelid = 'public.financial_profiles'::regclass) then
    create trigger financial_profiles_protect_columns_insert before insert on public.financial_profiles
      for each row execute function public.protect_profile_columns();
  end if;
  if not exists (select 1 from pg_trigger
                 where tgname = 'financial_profiles_protect_columns_update'
                   and tgrelid = 'public.financial_profiles'::regclass) then
    create trigger financial_profiles_protect_columns_update before update on public.financial_profiles
      for each row execute function public.protect_profile_columns();
  end if;
end
$do$;


-- ---------------------------------------------------------------------
-- 2. Atomic CSV commit
-- ---------------------------------------------------------------------
-- public.commit_csv_import(p_user_id, p_idempotency_key, p_filename, p_rows, p_rejected_count)
--
-- Replaces the current two-call flow (insert import_batches, then bulk insert transactions,
-- then mark the batch failed on error) with ONE transaction: a failure anywhere leaves no
-- batch and no transaction behind.
--
-- CALLER CONTRACT (not wired yet; the migration is not applied):
--   The Next.js route handler verifies the Supabase session (auth.getUser), builds the
--   OwnerContext, re-parses and re-classifies the CSV on the server (same as today), then calls
--   the typed wrapper commitCsvImportRpc(serviceClient, owner, { idempotencyKey, filename,
--   rows, rejectedCount }) from src/lib/db/repositories/server-only/csv-commit.ts. That wrapper
--   sends p_user_id = owner.userId. The browser never supplies p_user_id. EXECUTE is granted to
--   service_role only, so a guest cannot call this against its own id either.
--
-- p_rows: jsonb array, 1..5000 objects, ONLY these keys (any other key, such as user_id,
--   source or import_batch_id, is rejected):
--     occurred_at  string  ISO-8601 with offset (Z or +07:00)            required
--     kind         string  income | expense | excluded                   required
--     amount_vnd   string|number  integer 1..9007199254740991            required
--     category     string|null  blank/absent -> 'other', btrim length <= 50
--     merchant     string|null  length <= 200
--     description  string|null  length <= 500
--     fingerprint  string|null  non-blank, length <= 128
-- Stored amounts are positive; the sign is carried by `kind` (docs/05). The row bounds mirror
-- the table checks of 0001/0002; merchant/description caps mirror the TypeScript input schema
-- (the tables have no length check for them).
--
-- Returns {replayed, batch_id, accepted_count, rejected_count, status}. accepted_count is the
-- number of rows inserted; rejected_count is the caller's count of file rows that were not
-- imported (0..5000).
--
-- Concurrency and idempotency:
--   * pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0)) is the SAME lock key
--     reset_user_to_persona uses, so an import and a reset of one user are serialised and a
--     reset can never delete the batch an import is inserting rows for.
--   * With the lock held, (user, key) is looked up with a fresh READ COMMITTED snapshot: the
--     loser of a same-key race finds the winner's committed batch and returns replayed = true.
--     The unique (user_id, idempotency_key) constraint plus ON CONFLICT DO NOTHING is the
--     second line of defence.
--   * A replay returns the stored batch without re-validating or re-inserting rows. A replay
--     with a different payload therefore still returns the original result (same as the
--     current TypeScript service). A key stored by a receipt import is refused, not reused.
--
-- Safety: the owner is ONLY p_user_id. Every statement on a user table is filtered by or
-- written with p_user_id. The function never updates and never deletes rows.
create or replace function public.commit_csv_import(
  p_user_id uuid,
  p_idempotency_key text,
  p_filename text,
  p_rows jsonb,
  p_rejected_count integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.import_batches%rowtype;
  v_count integer;
  v_inserted integer;
  v_filename text := nullif(btrim(p_filename), '');
begin
  -- ---- argument checks (cheap, before taking the lock) ----
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' or length(p_idempotency_key) > 128 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if p_filename is not null and length(p_filename) > 255 then
    raise exception 'filename too long' using errcode = '22023';
  end if;
  if p_rejected_count is null or p_rejected_count < 0 or p_rejected_count > 5000 then
    raise exception 'invalid rejected count' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'rows must be a json array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 5000 then
    raise exception 'row count must be between 1 and 5000' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  -- ---- replay: the (user, key) batch already exists ----
  select * into v_batch
  from public.import_batches b
  where b.user_id = p_user_id
    and b.idempotency_key = p_idempotency_key;
  if found then
    if v_batch.source <> 'csv' then
      raise exception 'idempotency key belongs to another import source' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'replayed', true,
      'batch_id', v_batch.id,
      'accepted_count', v_batch.accepted_count,
      'rejected_count', v_batch.rejected_count,
      'status', v_batch.status
    );
  end if;

  -- ---- row validation: all or nothing (every failure raises and rolls everything back) ----
  if exists (select 1 from jsonb_array_elements(p_rows) e
             where jsonb_typeof(e) is distinct from 'object') then
    raise exception 'every row must be a json object' using errcode = '22023';
  end if;

  if exists (select 1 from jsonb_array_elements(p_rows) e, jsonb_object_keys(e) k
             where k not in ('occurred_at','kind','amount_vnd','category','merchant','description','fingerprint')) then
    raise exception 'unknown row key' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    where jsonb_typeof(e->'occurred_at') is distinct from 'string'
       or coalesce(e->>'occurred_at', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$'
       or coalesce(e->>'kind', '') not in ('income','expense','excluded')
       or coalesce(jsonb_typeof(e->'amount_vnd'), '') not in ('string','number')
       or coalesce(public.parse_safe_vnd(e->>'amount_vnd'), 0) < 1
       or coalesce(jsonb_typeof(e->'category'), 'null') not in ('string','null')
       or length(btrim(coalesce(e->>'category', ''))) > 50
       or coalesce(jsonb_typeof(e->'merchant'), 'null') not in ('string','null')
       or length(coalesce(e->>'merchant', '')) > 200
       or coalesce(jsonb_typeof(e->'description'), 'null') not in ('string','null')
       or length(coalesce(e->>'description', '')) > 500
       or coalesce(jsonb_typeof(e->'fingerprint'), 'null') not in ('string','null')
       or (e->>'fingerprint' is not null and (btrim(e->>'fingerprint') = '' or length(e->>'fingerprint') > 128))
  ) then
    raise exception 'invalid import row' using errcode = '22023';
  end if;

  -- ---- batch, then all rows, in this one transaction ----
  insert into public.import_batches (user_id, idempotency_key, source, filename, status, accepted_count, rejected_count)
  values (p_user_id, p_idempotency_key, 'csv', v_filename, 'committed', v_count, p_rejected_count)
  on conflict (user_id, idempotency_key) do nothing
  returning * into v_batch;

  if not found then
    -- Only reachable under REPEATABLE READ/SERIALIZABLE, where the lookup above could not see
    -- a concurrently committed winner. Fail closed; the caller retries and then replays.
    raise exception 'concurrent import with the same key, retry' using errcode = '40001';
  end if;

  insert into public.transactions (
    user_id, occurred_at, kind, amount_vnd, category, merchant, description,
    source, fingerprint, import_batch_id
  )
  select
    p_user_id,
    (e->>'occurred_at')::timestamptz,
    e->>'kind',
    public.parse_safe_vnd(e->>'amount_vnd'),
    coalesce(nullif(btrim(e->>'category'), ''), 'other'),
    nullif(btrim(e->>'merchant'), ''),
    nullif(btrim(e->>'description'), ''),
    'csv',
    e->>'fingerprint',
    v_batch.id
  from jsonb_array_elements(p_rows) e;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_count then
    raise exception 'inserted row count mismatch' using errcode = 'XX000';
  end if;

  return jsonb_build_object(
    'replayed', false,
    'batch_id', v_batch.id,
    'accepted_count', v_batch.accepted_count,
    'rejected_count', v_batch.rejected_count,
    'status', v_batch.status
  );
end;
$$;
revoke all on function public.commit_csv_import(uuid,text,text,jsonb,integer) from public;
revoke all on function public.commit_csv_import(uuid,text,text,jsonb,integer) from anon;
revoke all on function public.commit_csv_import(uuid,text,text,jsonb,integer) from authenticated;
grant execute on function public.commit_csv_import(uuid,text,text,jsonb,integer) to service_role;
-- End of proposed migration. Rollback: 202611230003_finpilot_profile_protection_and_csv_commit_rollback.sql
