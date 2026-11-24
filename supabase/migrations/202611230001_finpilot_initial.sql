-- FinPilot AI MVP candidate schema (2026-11-23).
-- REVIEW REQUIRED: this migration has NOT been applied to any Supabase project.
-- It is intentionally create-only. Never automatically apply to the one shared hosted DB.
-- Amounts are signed by `kind` in code; stored amount_vnd is always positive.

create table if not exists public.financial_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  persona_code text check (persona_code is null or persona_code in ('student','worker','at_risk')),
  display_name text not null default 'Người dùng',
  balance_snapshot_vnd bigint not null default 0,
  balance_snapshot_at timestamptz not null default now(),
  expected_monthly_income_vnd bigint not null default 0 check (expected_monthly_income_vnd >= 0),
  payday_day smallint check (payday_day between 1 and 31),
  expected_daily_expense_vnd bigint not null default 0 check (expected_daily_expense_vnd >= 0),
  projected_monthly_budget_vnd bigint not null default 0 check (projected_monthly_budget_vnd >= 0),
  minimum_reserve_vnd bigint not null default 0 check (minimum_reserve_vnd >= 0),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  source text not null check (source in ('csv','receipt')),
  filename text,
  status text not null default 'committed' check (status in ('committed','failed')),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  created_at timestamptz not null default now(),
  unique (user_id,id),
  unique (user_id,idempotency_key)
);

create table if not exists public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('income','expense')),
  amount_vnd bigint not null check (amount_vnd > 0),
  day_of_month smallint not null check (day_of_month between 1 and 31),
  category text not null default 'other',
  start_date date not null default current_date,
  end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,id),
  check (end_date is null or end_date >= start_date)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null,
  kind text not null check (kind in ('income','expense','excluded')),
  amount_vnd bigint not null check (amount_vnd > 0),
  category text not null default 'other',
  merchant text,
  description text,
  source text not null default 'manual' check (source in ('manual','csv','receipt','seed')),
  fingerprint text,
  import_batch_id uuid,
  recurring_item_id uuid,
  recurring_instance_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,id),
  constraint transactions_owner_batch_fk foreign key (user_id,import_batch_id)
    references public.import_batches(user_id,id) on delete set null (import_batch_id),
  constraint transactions_owner_recurring_fk foreign key (user_id,recurring_item_id)
    references public.recurring_items(user_id,id) on delete set null (recurring_item_id),
  constraint recurring_instance_pair_check check (
    (recurring_item_id is null and recurring_instance_date is null) or
    (recurring_item_id is not null and recurring_instance_date is not null)
  )
);

create unique index if not exists transactions_unique_recurring_posting
  on public.transactions(user_id,recurring_item_id,recurring_instance_date)
  where recurring_item_id is not null;
create index if not exists transactions_owner_date_idx
  on public.transactions(user_id,occurred_at desc);
create index if not exists recurring_owner_active_idx
  on public.recurring_items(user_id,active);

create table if not exists public.savings_goals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  target_vnd bigint not null check (target_vnd > 0),
  saved_vnd bigint not null default 0 check (saved_vnd >= 0),
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Cuộc trò chuyện',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,id)
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user','assistant','tool')),
  content text not null,
  tool_result jsonb,
  created_at timestamptz not null default now(),
  constraint messages_owner_conversation_fk foreign key (user_id,conversation_id)
    references public.ai_conversations(user_id,id) on delete cascade
);
create index if not exists ai_messages_owner_conversation_idx
  on public.ai_messages(user_id,conversation_id,created_at);

create table if not exists public.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid,
  kind text not null check (kind in ('budget_update','goal_update')),
  payload jsonb not null,
  baseline jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','expired')),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint proposals_owner_conversation_fk foreign key (user_id,conversation_id)
    references public.ai_conversations(user_id,id) on delete set null (conversation_id)
);
create index if not exists ai_proposals_owner_status_idx
  on public.ai_proposals(user_id,status,created_at desc);

create table if not exists public.ai_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  chat_calls integer not null default 0 check (chat_calls >= 0),
  scan_calls integer not null default 0 check (scan_calls >= 0),
  primary key (user_id,usage_date)
);

-- RLS for all business data. Note Supabase Auth anonymous users use authenticated role.
alter table public.financial_profiles enable row level security;
alter table public.import_batches enable row level security;
alter table public.recurring_items enable row level security;
alter table public.transactions enable row level security;
alter table public.savings_goals enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_proposals enable row level security;
alter table public.ai_usage_daily enable row level security;

-- Direct client CRUD is allowed only for core owner-owned finance records.
-- AI/conversation/proposal/quota writes go through server after verified authentication.
create policy financial_profiles_select on public.financial_profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy financial_profiles_insert on public.financial_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy financial_profiles_update on public.financial_profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy financial_profiles_delete on public.financial_profiles for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy import_batches_select on public.import_batches for select to authenticated
  using ((select auth.uid()) = user_id);
create policy import_batches_insert on public.import_batches for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy import_batches_update on public.import_batches for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy import_batches_delete on public.import_batches for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy recurring_items_select on public.recurring_items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy recurring_items_insert on public.recurring_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy recurring_items_update on public.recurring_items for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy recurring_items_delete on public.recurring_items for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy transactions_select on public.transactions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy transactions_insert on public.transactions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy transactions_update on public.transactions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy transactions_delete on public.transactions for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy savings_goals_select on public.savings_goals for select to authenticated
  using ((select auth.uid()) = user_id);
create policy savings_goals_insert on public.savings_goals for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy savings_goals_update on public.savings_goals for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy savings_goals_delete on public.savings_goals for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy ai_messages_select on public.ai_messages for select to authenticated
  using ((select auth.uid()) = user_id);
create policy ai_proposals_select on public.ai_proposals for select to authenticated
  using ((select auth.uid()) = user_id);
create policy ai_usage_daily_select on public.ai_usage_daily for select to authenticated
  using ((select auth.uid()) = user_id);

-- Restrict direct table access; service_role is for verified server-only operations.
grant select,insert,update,delete on public.financial_profiles,
  public.import_batches,public.recurring_items,public.transactions,public.savings_goals
  to authenticated;
grant select on public.ai_conversations,public.ai_messages,public.ai_proposals,
  public.ai_usage_daily to authenticated;
grant all on public.financial_profiles,public.import_batches,public.recurring_items,
  public.transactions,public.savings_goals,public.ai_conversations,public.ai_messages,
  public.ai_proposals,public.ai_usage_daily to service_role;

-- Atomic daily quota reservation. SERVER ONLY via service_role and after verifying caller.
-- In Supabase API, this is not callable by anon or authenticated roles.
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

-- This initial schema intentionally does not automatically populate any Auth users,
-- run data-destructive cleanup, create buckets, deploy functions or trigger releases.
