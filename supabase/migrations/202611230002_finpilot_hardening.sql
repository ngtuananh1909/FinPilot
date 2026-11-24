-- =====================================================================
-- PROPOSED - NOT APPLIED - requires G2 approval
-- =====================================================================
-- FinPilot AI follow-up hardening migration (draft for review).
--
-- * Lives in supabase/proposed/ ON PURPOSE so the Supabase CLI can never apply it
--   by accident. It moves to supabase/migrations/ only after review AND an explicit
--   G2 approval for the exact remote operation (see docs/15-g2-migration-approval-pack.md).
-- * Base migration 202611230001_finpilot_initial.sql is treated as immutable and is
--   NOT edited. This file only creates or alters objects. It contains no DROP TABLE,
--   no TRUNCATE and no DELETE except the owner-scoped deletes inside
--   public.reset_user_to_persona (every one has `where user_id = p_user_id`).
-- * The only DROP in this file is `drop constraint` on transactions_owner_recurring_fk.
-- * Requires PostgreSQL 15+ because the BASE migration uses `ON DELETE SET NULL (col)`.
--   Check `show server_version_num;` (>= 150000) BEFORE applying the base migration.
-- * Rollback: supabase/proposed/202611230002_finpilot_hardening.rollback.sql
--
-- Findings and reasoning: docs/14-sql-review.md
-- Nothing in this file has been executed against any database (local or remote).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. updated_at maintenance (finding F01)
-- ---------------------------------------------------------------------
-- Forces updated_at = now() on every UPDATE so clients cannot forge it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.set_updated_at() from public;
revoke all on function public.set_updated_at() from anon;
revoke all on function public.set_updated_at() from authenticated;
grant execute on function public.set_updated_at() to service_role;

do $do$
begin
  if not exists (select 1 from pg_trigger
                 where tgname = 'financial_profiles_set_updated_at'
                   and tgrelid = 'public.financial_profiles'::regclass) then
    create trigger financial_profiles_set_updated_at before update on public.financial_profiles
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger
                 where tgname = 'recurring_items_set_updated_at'
                   and tgrelid = 'public.recurring_items'::regclass) then
    create trigger recurring_items_set_updated_at before update on public.recurring_items
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger
                 where tgname = 'transactions_set_updated_at'
                   and tgrelid = 'public.transactions'::regclass) then
    create trigger transactions_set_updated_at before update on public.transactions
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger
                 where tgname = 'savings_goals_set_updated_at'
                   and tgrelid = 'public.savings_goals'::regclass) then
    create trigger savings_goals_set_updated_at before update on public.savings_goals
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger
                 where tgname = 'ai_conversations_set_updated_at'
                   and tgrelid = 'public.ai_conversations'::regclass) then
    create trigger ai_conversations_set_updated_at before update on public.ai_conversations
      for each row execute function public.set_updated_at();
  end if;
end
$do$;


-- ---------------------------------------------------------------------
-- 2. Recurring-item FK (finding F02)
-- ---------------------------------------------------------------------
-- BASE: foreign key (user_id, recurring_item_id) ... on delete set null (recurring_item_id)
-- would null ONLY recurring_item_id and leave recurring_instance_date set, which violates
-- recurring_instance_pair_check. Deleting a referenced recurring item therefore errors
-- with a confusing check violation, and deleting an auth user may fail depending on the
-- order in which cascades run.
--
-- NEW: ON DELETE NO ACTION (not RESTRICT). NO ACTION is evaluated at the end of the
-- statement, so cascading deletion of an auth user (which also deletes that user's
-- transactions) still succeeds, while deleting a recurring item that a transaction still
-- references is rejected. App rule: recurring items are DEACTIVATED (active = false),
-- never deleted, once any transaction references them.
--
-- ROLLBACK: the rollback file drops this constraint and re-adds the original
-- `on delete set null (recurring_item_id)` definition (requires PG15+; restores the
-- known defect).
-- Only this one constraint is dropped/re-added. Idempotent: no-op once the action is 'a'.
do $do$
declare
  v_action "char";
begin
  select c.confdeltype into v_action
  from pg_constraint c
  where c.conname = 'transactions_owner_recurring_fk'
    and c.conrelid = 'public.transactions'::regclass;

  if v_action is distinct from 'a' then
    if v_action is not null then
      alter table public.transactions drop constraint transactions_owner_recurring_fk;
    end if;
    alter table public.transactions
      add constraint transactions_owner_recurring_fk
      foreign key (user_id, recurring_item_id)
      references public.recurring_items (user_id, id)
      on delete no action;
  end if;
end
$do$;


-- ---------------------------------------------------------------------
-- 3. Sanity constraints (finding F09, F10)
-- ---------------------------------------------------------------------
-- 9007199254740991 = Number.MAX_SAFE_INTEGER, the JS safe-integer boundary.
-- Constraints are added only if missing (checked by name). Existing rows are validated by
-- ADD CONSTRAINT; the G2 pre-check counts violating rows first (expected: tables empty).
do $do$
declare
  c record;
begin
  for c in
    select * from (values
      ('financial_profiles', 'financial_profiles_safe_amounts_check',
       $c$balance_snapshot_vnd between -9007199254740991 and 9007199254740991
          and expected_monthly_income_vnd <= 9007199254740991
          and expected_daily_expense_vnd <= 9007199254740991
          and projected_monthly_budget_vnd <= 9007199254740991
          and minimum_reserve_vnd <= 9007199254740991$c$),
      ('financial_profiles', 'financial_profiles_display_name_check',
       $c$btrim(display_name) <> '' and length(display_name) <= 80$c$),
      ('import_batches', 'import_batches_idempotency_key_check',
       $c$btrim(idempotency_key) <> '' and length(idempotency_key) <= 128$c$),
      ('recurring_items', 'recurring_items_safe_amount_check',
       $c$amount_vnd <= 9007199254740991$c$),
      ('recurring_items', 'recurring_items_label_check',
       $c$btrim(label) <> '' and length(label) <= 100$c$),
      ('recurring_items', 'recurring_items_category_check',
       $c$btrim(category) <> '' and length(category) <= 50$c$),
      ('transactions', 'transactions_safe_amount_check',
       $c$amount_vnd <= 9007199254740991$c$),
      ('transactions', 'transactions_category_check',
       $c$btrim(category) <> '' and length(category) <= 50$c$),
      ('savings_goals', 'savings_goals_safe_amounts_check',
       $c$target_vnd <= 9007199254740991 and saved_vnd <= 9007199254740991$c$),
      ('savings_goals', 'savings_goals_name_check',
       $c$btrim(name) <> '' and length(name) <= 100$c$)
    ) as t(tbl, conname, expr)
  loop
    if not exists (select 1 from pg_constraint k
                   where k.conname = c.conname
                     and k.conrelid = format('public.%I', c.tbl)::regclass) then
      execute format('alter table public.%I add constraint %I check (%s)',
                     c.tbl, c.conname, c.expr);
    end if;
  end loop;
end
$do$;

-- Duplicate-review lookups (finding F08). Deliberately NON-unique: duplicates are
-- surfaced to the user in the import preview, never silently rejected by the database.
create index if not exists transactions_owner_fingerprint_idx
  on public.transactions (user_id, fingerprint)
  where fingerprint is not null;

-- current_date follows the DB session time zone (UTC on Supabase). The product day is
-- Asia/Ho_Chi_Minh (finding F11).
alter table public.recurring_items
  alter column start_date set default ((now() at time zone 'Asia/Ho_Chi_Minh')::date);


-- ---------------------------------------------------------------------
-- 4. Table privileges (finding F05)
-- ---------------------------------------------------------------------
-- Supabase default privileges can pre-grant ALL (including TRUNCATE, which RLS does not
-- cover) on new public tables to anon and authenticated. Make the grants explicit.
-- RLS stays the primary control; this is defence in depth. Revokes only; nothing is added.
revoke all on public.financial_profiles, public.import_batches, public.recurring_items,
  public.transactions, public.savings_goals, public.ai_conversations, public.ai_messages,
  public.ai_proposals, public.ai_usage_daily from anon;

revoke truncate, references, trigger on public.financial_profiles, public.import_batches,
  public.recurring_items, public.transactions, public.savings_goals from authenticated;

-- AI tables, proposals and quota counters are select-only for clients.
revoke insert, update, delete, truncate, references, trigger on public.ai_conversations,
  public.ai_messages, public.ai_proposals, public.ai_usage_daily from authenticated;


-- ---------------------------------------------------------------------
-- 5. New tables (server-owned bookkeeping)
-- ---------------------------------------------------------------------
-- 5a. Reset idempotency log. RLS enabled, NO client policies, NO client grants.
create table if not exists public.reset_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 128),
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);
alter table public.reset_log enable row level security;
revoke all on public.reset_log from public;
revoke all on public.reset_log from anon;
revoke all on public.reset_log from authenticated;
grant all on public.reset_log to service_role;

-- 5b. Quota reservations keyed by request id. usage_date is the Asia/Ho_Chi_Minh date
-- of the RESERVATION so a later release decrements the right day's counter.
create table if not exists public.ai_quota_reservations (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  kind text not null check (kind in ('chat','scan')),
  status text not null default 'reserved' check (status in ('reserved','released','committed')),
  created_at timestamptz not null default now()
);
create index if not exists ai_quota_reservations_owner_idx
  on public.ai_quota_reservations (user_id, usage_date);
alter table public.ai_quota_reservations enable row level security;

do $do$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public'
                   and tablename = 'ai_quota_reservations'
                   and policyname = 'ai_quota_reservations_select') then
    create policy ai_quota_reservations_select on public.ai_quota_reservations
      for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end
$do$;

revoke all on public.ai_quota_reservations from public;
revoke all on public.ai_quota_reservations from anon;
revoke all on public.ai_quota_reservations from authenticated;
grant select on public.ai_quota_reservations to authenticated;
grant all on public.ai_quota_reservations to service_role;


-- ---------------------------------------------------------------------
-- 6. Privileged functions. ALL are service_role-only (finding F04).
-- ---------------------------------------------------------------------
-- Every SECURITY DEFINER function: set search_path = '', fully qualified names, owner =
-- the migration role (postgres on Supabase), EXECUTE revoked from public/anon/authenticated
-- and granted to service_role only. Callers (server route handlers) must verify the
-- Supabase session first and pass the verified user id; clients never choose p_user_id.
-- Anonymous Auth users are the `authenticated` role, so revoking from `authenticated`
-- is what blocks guests from calling these via the Data API.

-- 6a. consume_ai_quota: REDEFINED with null guards (finding F06).
-- Base version: `p_kind not in (...)` and `p_limit <= 0` evaluate to NULL (not true) when
-- p_kind or p_limit is NULL, so the guard did not raise; a NULL kind then inserted a row
-- with 0/0 counts and returned TRUE ("granted" without counting). The logic is otherwise
-- unchanged. New code should call reserve_ai_quota instead (the policy needs release).
create or replace function public.consume_ai_quota(
  p_user_id uuid,
  p_kind text,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_granted boolean := false;
  v_date date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if p_user_id is null or p_kind is null or p_limit is null
     or p_kind not in ('chat','scan') or p_limit <= 0 or p_limit > 100000 then
    raise exception 'invalid quota parameters';
  end if;
  insert into public.ai_usage_daily (user_id, usage_date, chat_calls, scan_calls)
  values (p_user_id, v_date,
    case when p_kind = 'chat' then 1 else 0 end,
    case when p_kind = 'scan' then 1 else 0 end)
  on conflict (user_id,usage_date) do update set
    chat_calls = public.ai_usage_daily.chat_calls + excluded.chat_calls,
    scan_calls = public.ai_usage_daily.scan_calls + excluded.scan_calls
  where (p_kind = 'chat' and public.ai_usage_daily.chat_calls < p_limit)
     or (p_kind = 'scan' and public.ai_usage_daily.scan_calls < p_limit)
  returning true into v_granted;
  return coalesce(v_granted,false);
end;
$$;
revoke all on function public.consume_ai_quota(uuid,text,integer) from public;
revoke all on function public.consume_ai_quota(uuid,text,integer) from anon;
revoke all on function public.consume_ai_quota(uuid,text,integer) from authenticated;
grant execute on function public.consume_ai_quota(uuid,text,integer) to service_role;


-- 6b. reserve_ai_quota
-- Atomically reserves ONE unit for (user, request id) in a single transaction:
--   * serialises on the request id (advisory xact lock), so replays are safe;
--   * replay of a 'reserved'/'committed' request returns TRUE and does NOT increment again;
--   * a 'released' request returns FALSE (a retry must use a NEW request id: at most one
--     reservation per request id; ambiguous timeouts keep their reservation);
--   * same request id with another user or another kind raises (never touches that row);
--   * otherwise increments the (user, Vietnam-date) counter only while below p_limit
--     (row-locked upsert, same technique as consume_ai_quota) and records the reservation;
--     returns FALSE when the limit is reached.
-- Release policy (enforced by the caller, documented here): release on clear pre-result
-- failures (invalid configuration, definitive provider rejection); keep the reservation on
-- ambiguous timeouts; commit_ai_quota once a usable result is delivered.
create or replace function public.reserve_ai_quota(
  p_user_id uuid,
  p_request_id uuid,
  p_kind text,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_existing public.ai_quota_reservations%rowtype;
  v_granted boolean := false;
begin
  if p_user_id is null or p_request_id is null or p_kind is null or p_limit is null
     or p_kind not in ('chat','scan') or p_limit <= 0 or p_limit > 100000 then
    raise exception 'invalid quota parameters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 1));

  select * into v_existing
  from public.ai_quota_reservations r
  where r.request_id = p_request_id;

  if found then
    if v_existing.user_id <> p_user_id then
      raise exception 'request id belongs to another user' using errcode = '42501';
    end if;
    if v_existing.kind <> p_kind then
      raise exception 'request id reused with a different kind' using errcode = '22023';
    end if;
    return v_existing.status in ('reserved','committed');
  end if;

  insert into public.ai_usage_daily (user_id, usage_date, chat_calls, scan_calls)
  values (p_user_id, v_date,
    case when p_kind = 'chat' then 1 else 0 end,
    case when p_kind = 'scan' then 1 else 0 end)
  on conflict (user_id,usage_date) do update set
    chat_calls = public.ai_usage_daily.chat_calls + excluded.chat_calls,
    scan_calls = public.ai_usage_daily.scan_calls + excluded.scan_calls
  where (p_kind = 'chat' and public.ai_usage_daily.chat_calls < p_limit)
     or (p_kind = 'scan' and public.ai_usage_daily.scan_calls < p_limit)
  returning true into v_granted;

  if not coalesce(v_granted, false) then
    return false;
  end if;

  insert into public.ai_quota_reservations (request_id, user_id, usage_date, kind, status)
  values (p_request_id, p_user_id, v_date, p_kind, 'reserved');
  return true;
end;
$$;
revoke all on function public.reserve_ai_quota(uuid,uuid,text,integer) from public;
revoke all on function public.reserve_ai_quota(uuid,uuid,text,integer) from anon;
revoke all on function public.reserve_ai_quota(uuid,uuid,text,integer) from authenticated;
grant execute on function public.reserve_ai_quota(uuid,uuid,text,integer) to service_role;


-- 6c. release_ai_quota
-- Idempotent. Only the first call on a 'reserved' row owned by p_user_id flips it to
-- 'released' and decrements the counter by exactly 1, on the RESERVATION's usage_date
-- (not today's date), so a release after midnight Asia/Ho_Chi_Minh hits the right day.
-- The status flip is one UPDATE ... WHERE status = 'reserved', so concurrent duplicate
-- releases cannot both succeed. Returns FALSE (no effect) for unknown ids, ids owned by
-- another user, and already released/committed reservations.
create or replace function public.release_ai_quota(
  p_user_id uuid,
  p_request_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage_date date;
  v_kind text;
begin
  if p_user_id is null or p_request_id is null then
    raise exception 'invalid quota parameters' using errcode = '22023';
  end if;

  update public.ai_quota_reservations r
  set status = 'released'
  where r.request_id = p_request_id
    and r.user_id = p_user_id
    and r.status = 'reserved'
  returning r.usage_date, r.kind into v_usage_date, v_kind;

  if not found then
    return false;
  end if;

  update public.ai_usage_daily u
  set chat_calls = case when v_kind = 'chat' then greatest(u.chat_calls - 1, 0) else u.chat_calls end,
      scan_calls = case when v_kind = 'scan' then greatest(u.scan_calls - 1, 0) else u.scan_calls end
  where u.user_id = p_user_id
    and u.usage_date = v_usage_date;

  return true;
end;
$$;
revoke all on function public.release_ai_quota(uuid,uuid) from public;
revoke all on function public.release_ai_quota(uuid,uuid) from anon;
revoke all on function public.release_ai_quota(uuid,uuid) from authenticated;
grant execute on function public.release_ai_quota(uuid,uuid) to service_role;


-- 6d. commit_ai_quota
-- Marks a 'reserved' reservation owned by p_user_id as 'committed' so it can no longer be
-- released. Idempotent: TRUE if the row is committed after the call (now or earlier),
-- FALSE for unknown ids, other owners, and released reservations.
create or replace function public.commit_ai_quota(
  p_user_id uuid,
  p_request_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_request_id is null then
    raise exception 'invalid quota parameters' using errcode = '22023';
  end if;

  update public.ai_quota_reservations r
  set status = 'committed'
  where r.request_id = p_request_id
    and r.user_id = p_user_id
    and r.status = 'reserved';
  if found then
    return true;
  end if;

  return exists (
    select 1 from public.ai_quota_reservations r
    where r.request_id = p_request_id
      and r.user_id = p_user_id
      and r.status = 'committed'
  );
end;
$$;
revoke all on function public.commit_ai_quota(uuid,uuid) from public;
revoke all on function public.commit_ai_quota(uuid,uuid) from anon;
revoke all on function public.commit_ai_quota(uuid,uuid) from authenticated;
grant execute on function public.commit_ai_quota(uuid,uuid) to service_role;


-- 6e. bootstrap_profile
-- Idempotent: creates the default financial_profiles row for a user if missing and
-- returns TRUE only when it created one. Never overwrites an existing profile.
-- p_user_id must come from the verified server session.
create or replace function public.bootstrap_profile(
  p_user_id uuid,
  p_persona_code text default null,
  p_display_name text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(nullif(btrim(p_display_name), ''), 'Người dùng');
  v_rows integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;
  if p_persona_code is not null and p_persona_code not in ('student','worker','at_risk') then
    raise exception 'invalid persona code' using errcode = '22023';
  end if;
  if length(v_name) > 80 then
    raise exception 'display name too long' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  insert into public.financial_profiles (user_id, persona_code, display_name)
  values (p_user_id, p_persona_code, v_name)
  on conflict (user_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke all on function public.bootstrap_profile(uuid,text,text) from public;
revoke all on function public.bootstrap_profile(uuid,text,text) from anon;
revoke all on function public.bootstrap_profile(uuid,text,text) from authenticated;
grant execute on function public.bootstrap_profile(uuid,text,text) to service_role;


-- 6f. parse_safe_vnd: internal helper for template validation (not a DEFINER function).
-- Returns NULL unless the text is a plain base-10 integer (no sign unless allowed, no
-- decimals/exponent, <= 16 digits) within +/- 9007199254740991.
create or replace function public.parse_safe_vnd(
  p_text text,
  p_allow_negative boolean default false
) returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_text ~ (case when coalesce(p_allow_negative, false) then '^-?[0-9]{1,16}$' else '^[0-9]{1,16}$' end)
      then (case when abs(p_text::bigint) <= 9007199254740991 then p_text::bigint end)
  end;
$$;
revoke all on function public.parse_safe_vnd(text,boolean) from public;
revoke all on function public.parse_safe_vnd(text,boolean) from anon;
revoke all on function public.parse_safe_vnd(text,boolean) from authenticated;
grant execute on function public.parse_safe_vnd(text,boolean) to service_role;


-- 6g. reset_user_to_persona
-- Atomic, owner-scoped reset + persona clone in ONE transaction (the function body).
--
-- Caller contract: p_user_id is the id of the VERIFIED server session, never client input.
-- Dates in the template are already shifted by the server (mock-data/README.md).
--
-- p_template shape (extra top-level keys are rejected):
--   { "persona_code": "student|worker|at_risk",
--     "profile": { display_name, balance_snapshot_vnd, balance_snapshot_at (ISO with offset),
--                  expected_monthly_income_vnd, payday_day, expected_daily_expense_vnd,
--                  projected_monthly_budget_vnd, minimum_reserve_vnd, is_demo },
--     "recurring_items": [ {label, kind, amount_vnd, day_of_month, category, start_date,
--                           end_date?, active?} ]            (<= 50),
--     "transactions":    [ {occurred_at (ISO with offset), kind, amount_vnd, category,
--                           merchant?, description?} ]       (<= 500),
--     "goal": {name, target_vnd, saved_vnd, target_date?} }
-- Amounts may be JSON numbers or decimal strings; each must be an integer within the JS
-- safe-integer range (profile.balance_snapshot_vnd may be negative; the rest >= 0, and
-- transaction/recurring/goal-target amounts >= 1).
--
-- Exactly which rows are DELETED (all `where user_id = p_user_id`):
--   ai_messages, ai_proposals, ai_conversations, transactions, recurring_items,
--   import_batches, savings_goals.
-- Rows UPSERTED: financial_profiles (one row). Rows INSERTED: recurring_items,
--   transactions (source = 'seed'), savings_goals, reset_log.
-- NEVER touched: ai_usage_daily, ai_quota_reservations (a reset must not refill quota).
-- Chat history and pending proposals are removed because they describe the replaced data.
--
-- Concurrency: pg_advisory_xact_lock on the user id serialises resets for one user.
-- Idempotency: (user, key) is recorded in reset_log in the same transaction; a repeat of
-- a key returns {"applied": false, "replay": true} without touching any data. Use a NEW
-- key for each deliberate reset. Any error rolls back everything, including the log row.
create or replace function public.reset_user_to_persona(
  p_user_id uuid,
  p_template jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_persona text;
  v_profile jsonb;
  v_recurring jsonb;
  v_tx jsonb;
  v_goal jsonb;
  v_rows integer;
  v_deleted_transactions integer;
  v_deleted_recurring integer;
  v_inserted_recurring integer;
  v_inserted_transactions integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' or length(p_idempotency_key) > 128 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if p_template is null or jsonb_typeof(p_template) is distinct from 'object' then
    raise exception 'template must be a json object' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  insert into public.reset_log (user_id, idempotency_key)
  values (p_user_id, p_idempotency_key)
  on conflict (user_id, idempotency_key) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('applied', false, 'replay', true);
  end if;

  -- ---- template validation (every failure raises and rolls everything back) ----
  if exists (select 1 from jsonb_object_keys(p_template) k
             where k not in ('persona_code','profile','recurring_items','transactions','goal')) then
    raise exception 'unknown template key' using errcode = '22023';
  end if;

  v_persona := p_template->>'persona_code';
  if coalesce(v_persona, '') not in ('student','worker','at_risk') then
    raise exception 'invalid persona code' using errcode = '22023';
  end if;

  v_profile := p_template->'profile';
  v_recurring := p_template->'recurring_items';
  v_tx := p_template->'transactions';
  v_goal := p_template->'goal';
  if jsonb_typeof(v_profile) is distinct from 'object'
     or jsonb_typeof(v_recurring) is distinct from 'array'
     or jsonb_typeof(v_tx) is distinct from 'array'
     or jsonb_typeof(v_goal) is distinct from 'object' then
    raise exception 'template sections have the wrong json type' using errcode = '22023';
  end if;
  if jsonb_array_length(v_tx) > 500 or jsonb_array_length(v_recurring) > 50 then
    raise exception 'template has too many rows' using errcode = '22023';
  end if;

  if public.parse_safe_vnd(v_profile->>'balance_snapshot_vnd', true) is null
     or public.parse_safe_vnd(v_profile->>'expected_monthly_income_vnd') is null
     or public.parse_safe_vnd(v_profile->>'expected_daily_expense_vnd') is null
     or public.parse_safe_vnd(v_profile->>'projected_monthly_budget_vnd') is null
     or public.parse_safe_vnd(v_profile->>'minimum_reserve_vnd') is null
     or coalesce(btrim(v_profile->>'display_name'), '') = ''
     or length(v_profile->>'display_name') > 80
     or coalesce(v_profile->>'balance_snapshot_at', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$'
     or (v_profile->>'payday_day' is not null and v_profile->>'payday_day' !~ '^[0-9]{1,2}$') then
    raise exception 'invalid template profile' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_recurring) e
    where coalesce(btrim(e->>'label'), '') = ''
       or length(e->>'label') > 100
       or coalesce(e->>'kind', '') not in ('income','expense')
       or coalesce(public.parse_safe_vnd(e->>'amount_vnd'), 0) < 1
       or coalesce(e->>'day_of_month', '') !~ '^[0-9]{1,2}$'
       or coalesce(e->>'start_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or (e->>'end_date' is not null and e->>'end_date' !~ '^\d{4}-\d{2}-\d{2}$')
       or length(coalesce(e->>'category', '')) > 50
  ) then
    raise exception 'invalid template recurring item' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_tx) e
    where coalesce(e->>'occurred_at', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$'
       or coalesce(e->>'kind', '') not in ('income','expense','excluded')
       or coalesce(public.parse_safe_vnd(e->>'amount_vnd'), 0) < 1
       or length(coalesce(e->>'category', '')) > 50
       or length(coalesce(e->>'merchant', '')) > 200
       or length(coalesce(e->>'description', '')) > 500
  ) then
    raise exception 'invalid template transaction' using errcode = '22023';
  end if;

  if coalesce(btrim(v_goal->>'name'), '') = ''
     or length(v_goal->>'name') > 100
     or coalesce(public.parse_safe_vnd(v_goal->>'target_vnd'), 0) < 1
     or public.parse_safe_vnd(v_goal->>'saved_vnd') is null
     or (v_goal->>'target_date' is not null and v_goal->>'target_date' !~ '^\d{4}-\d{2}-\d{2}$') then
    raise exception 'invalid template goal' using errcode = '22023';
  end if;

  -- ---- owner-scoped deletes: children before parents, every one filtered by owner ----
  delete from public.ai_messages where user_id = p_user_id;
  delete from public.ai_proposals where user_id = p_user_id;
  delete from public.ai_conversations where user_id = p_user_id;
  delete from public.transactions where user_id = p_user_id;
  get diagnostics v_deleted_transactions = row_count;
  delete from public.recurring_items where user_id = p_user_id;
  get diagnostics v_deleted_recurring = row_count;
  delete from public.import_batches where user_id = p_user_id;
  delete from public.savings_goals where user_id = p_user_id;

  -- ---- profile upsert, then clone ----
  insert into public.financial_profiles (
    user_id, persona_code, display_name, balance_snapshot_vnd, balance_snapshot_at,
    expected_monthly_income_vnd, payday_day, expected_daily_expense_vnd,
    projected_monthly_budget_vnd, minimum_reserve_vnd, is_demo
  ) values (
    p_user_id,
    v_persona,
    btrim(v_profile->>'display_name'),
    public.parse_safe_vnd(v_profile->>'balance_snapshot_vnd', true),
    (v_profile->>'balance_snapshot_at')::timestamptz,
    public.parse_safe_vnd(v_profile->>'expected_monthly_income_vnd'),
    (v_profile->>'payday_day')::smallint,
    public.parse_safe_vnd(v_profile->>'expected_daily_expense_vnd'),
    public.parse_safe_vnd(v_profile->>'projected_monthly_budget_vnd'),
    public.parse_safe_vnd(v_profile->>'minimum_reserve_vnd'),
    coalesce((v_profile->>'is_demo')::boolean, true)
  )
  on conflict (user_id) do update set
    persona_code = excluded.persona_code,
    display_name = excluded.display_name,
    balance_snapshot_vnd = excluded.balance_snapshot_vnd,
    balance_snapshot_at = excluded.balance_snapshot_at,
    expected_monthly_income_vnd = excluded.expected_monthly_income_vnd,
    payday_day = excluded.payday_day,
    expected_daily_expense_vnd = excluded.expected_daily_expense_vnd,
    projected_monthly_budget_vnd = excluded.projected_monthly_budget_vnd,
    minimum_reserve_vnd = excluded.minimum_reserve_vnd,
    is_demo = excluded.is_demo;

  insert into public.recurring_items (
    user_id, label, kind, amount_vnd, day_of_month, category, start_date, end_date, active
  )
  select
    p_user_id,
    btrim(e->>'label'),
    e->>'kind',
    public.parse_safe_vnd(e->>'amount_vnd'),
    (e->>'day_of_month')::smallint,
    coalesce(nullif(btrim(e->>'category'), ''), 'other'),
    (e->>'start_date')::date,
    nullif(e->>'end_date', '')::date,
    coalesce((e->>'active')::boolean, true)
  from jsonb_array_elements(v_recurring) e;
  get diagnostics v_inserted_recurring = row_count;

  insert into public.transactions (
    user_id, occurred_at, kind, amount_vnd, category, merchant, description, source
  )
  select
    p_user_id,
    (e->>'occurred_at')::timestamptz,
    e->>'kind',
    public.parse_safe_vnd(e->>'amount_vnd'),
    coalesce(nullif(btrim(e->>'category'), ''), 'other'),
    nullif(e->>'merchant', ''),
    nullif(e->>'description', ''),
    'seed'
  from jsonb_array_elements(v_tx) e;
  get diagnostics v_inserted_transactions = row_count;

  insert into public.savings_goals (user_id, name, target_vnd, saved_vnd, target_date)
  values (
    p_user_id,
    btrim(v_goal->>'name'),
    public.parse_safe_vnd(v_goal->>'target_vnd'),
    public.parse_safe_vnd(v_goal->>'saved_vnd'),
    nullif(v_goal->>'target_date', '')::date
  );

  return jsonb_build_object(
    'applied', true,
    'replay', false,
    'deleted_transactions', v_deleted_transactions,
    'deleted_recurring_items', v_deleted_recurring,
    'inserted_transactions', v_inserted_transactions,
    'inserted_recurring_items', v_inserted_recurring
  );
end;
$$;
revoke all on function public.reset_user_to_persona(uuid,jsonb,text) from public;
revoke all on function public.reset_user_to_persona(uuid,jsonb,text) from anon;
revoke all on function public.reset_user_to_persona(uuid,jsonb,text) from authenticated;
grant execute on function public.reset_user_to_persona(uuid,jsonb,text) to service_role;

-- End of proposed migration. Rollback: 202611230002_finpilot_hardening.rollback.sql
