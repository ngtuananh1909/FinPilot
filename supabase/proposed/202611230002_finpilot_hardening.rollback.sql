-- =====================================================================
-- PROPOSED - NOT APPLIED - requires G2 approval
-- =====================================================================
-- Rollback for 202611230002_finpilot_hardening.sql. Not a migration; never place it in
-- supabase/migrations. Run only with explicit G2 approval, after taking the pg_dump
-- described in docs/15-g2-migration-approval-pack.md.
--
-- Scope: removes ONLY objects created by the hardening migration and restores the original
-- FK and consume_ai_quota definition. It deletes no rows from base tables.
--   * public.reset_log and public.ai_quota_reservations are dropped with their contents.
--     Both are new, server-owned bookkeeping tables. Counters in ai_usage_daily are NOT
--     changed, so outstanding reservations simply become permanent usage for that day.
--   * Table-privilege REVOKEs (section 4 of the migration) are deliberately NOT reversed.
--     They only remove default over-grants; re-granting would weaken security.
--   * Restoring the original recurring FK restores a known defect (see docs/14 F02) and
--     requires PostgreSQL 15+.
-- =====================================================================

-- Functions created by the migration.
drop function if exists public.reset_user_to_persona(uuid,jsonb,text);
drop function if exists public.parse_safe_vnd(text,boolean);
drop function if exists public.bootstrap_profile(uuid,text,text);
drop function if exists public.commit_ai_quota(uuid,uuid);
drop function if exists public.release_ai_quota(uuid,uuid);
drop function if exists public.reserve_ai_quota(uuid,uuid,text,integer);

-- Tables created by the migration (policies and indexes go with them).
drop table if exists public.ai_quota_reservations;
drop table if exists public.reset_log;

-- Triggers and the trigger function.
drop trigger if exists financial_profiles_set_updated_at on public.financial_profiles;
drop trigger if exists recurring_items_set_updated_at on public.recurring_items;
drop trigger if exists transactions_set_updated_at on public.transactions;
drop trigger if exists savings_goals_set_updated_at on public.savings_goals;
drop trigger if exists ai_conversations_set_updated_at on public.ai_conversations;
drop function if exists public.set_updated_at();

-- Constraints, index and default added by the migration.
alter table public.financial_profiles drop constraint if exists financial_profiles_safe_amounts_check;
alter table public.financial_profiles drop constraint if exists financial_profiles_display_name_check;
alter table public.import_batches drop constraint if exists import_batches_idempotency_key_check;
alter table public.recurring_items drop constraint if exists recurring_items_safe_amount_check;
alter table public.recurring_items drop constraint if exists recurring_items_label_check;
alter table public.recurring_items drop constraint if exists recurring_items_category_check;
alter table public.transactions drop constraint if exists transactions_safe_amount_check;
alter table public.transactions drop constraint if exists transactions_category_check;
alter table public.savings_goals drop constraint if exists savings_goals_safe_amounts_check;
alter table public.savings_goals drop constraint if exists savings_goals_name_check;
drop index if exists public.transactions_owner_fingerprint_idx;
alter table public.recurring_items alter column start_date set default current_date;

-- Restore the original recurring FK (PG15+; restores the defect described in docs/14 F02).
alter table public.transactions drop constraint if exists transactions_owner_recurring_fk;
alter table public.transactions
  add constraint transactions_owner_recurring_fk
  foreign key (user_id, recurring_item_id)
  references public.recurring_items (user_id, id)
  on delete set null (recurring_item_id);

-- Restore the original consume_ai_quota body (without the NULL guards).
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
  if p_user_id is null or p_kind not in ('chat','scan') or p_limit <= 0 or p_limit > 100000 then
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
