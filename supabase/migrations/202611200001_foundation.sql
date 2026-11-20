create table public.trading_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (label = btrim(label) and char_length(label) between 1 and 80),
  broker text not null check (broker = btrim(broker) and char_length(broker) between 1 and 80),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  timezone text not null check (char_length(timezone) between 1 and 80),
  session_boundary time not null default '00:00' check (session_boundary < '24:00'),
  accounting_method text not null default 'fifo' check (accounting_method = 'fifo'),
  created_at timestamptz not null default now()
);

create unique index trading_accounts_owner_label
  on public.trading_accounts (user_id, lower(label));

create function public.validate_journal_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid reporting timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger validate_journal_timezone
before insert or update of timezone on public.trading_accounts
for each row execute function public.validate_journal_timezone();

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.trading_accounts(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_logs_account_time on public.audit_logs (account_id, created_at);

create function public.audit_journal_account_creation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs (account_id, actor_id, event_type)
  values (new.id, auth.uid(), 'account.created');
  return new;
end;
$$;

revoke all on function public.audit_journal_account_creation() from public, anon, authenticated;
create trigger audit_journal_account_creation
after insert on public.trading_accounts
for each row execute function public.audit_journal_account_creation();

alter table public.trading_accounts enable row level security;
alter table public.audit_logs enable row level security;
revoke all on public.trading_accounts, public.audit_logs from public, anon, authenticated;
grant select on public.trading_accounts, public.audit_logs to authenticated;
grant insert (user_id, label, broker, currency, timezone)
  on public.trading_accounts to authenticated;

create policy read_own_accounts on public.trading_accounts for select to authenticated
using (user_id = (select auth.uid()));
create policy create_own_accounts on public.trading_accounts for insert to authenticated
with check (user_id = (select auth.uid()));
create policy read_own_audit_logs on public.audit_logs for select to authenticated
using (exists (
  select 1 from public.trading_accounts account
  where account.id = account_id and account.user_id = (select auth.uid())
));
