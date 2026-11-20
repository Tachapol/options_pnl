begin;

create table public.summary_imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.trading_accounts(id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 255),
  raw_csv text not null check (octet_length(raw_csv) between 1 and 524288),
  file_hash bytea not null check (octet_length(file_hash) = 32),
  created_at timestamptz not null default now(),
  unique (account_id, file_hash),
  unique (account_id, id)
);

create table public.trade_summaries (
  account_id uuid not null,
  import_id uuid not null,
  source_trade_id text not null check (source_trade_id ~ '^[0-9]{1,16}$'),
  day date not null,
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,14}$'),
  option_type text not null check (option_type in ('Call','Put')),
  strike numeric(18,8) not null check (strike >= 0),
  expiration date not null,
  quantity integer not null check (quantity between 1 and 999999),
  buy_time text not null check (char_length(buy_time) between 1 and 500),
  sell_time text not null check (char_length(sell_time) between 1 and 500),
  buy_price numeric(18,8) not null check (buy_price >= 0),
  sell_price numeric(18,8) not null check (sell_price >= 0),
  cost numeric(14,2) not null check (cost >= 0),
  proceeds numeric(14,2) not null check (proceeds >= 0),
  gross numeric(15,2) generated always as (proceeds - cost) stored,
  source text not null check (source in ('original_csv','activity_screenshots')),
  note text not null,
  primary key (import_id, source_trade_id),
  foreign key (account_id, import_id) references public.summary_imports(account_id, id) on delete cascade
);
create index trade_summaries_account_day on public.trade_summaries(account_id, day desc);

alter table public.summary_imports enable row level security;
alter table public.trade_summaries enable row level security;
revoke all on public.summary_imports, public.trade_summaries from public, anon, authenticated;
grant select (id, account_id, filename, created_at) on public.summary_imports to authenticated;
grant select on public.trade_summaries to authenticated;
create policy read_summary_imports on public.summary_imports for select to authenticated
using (exists (select 1 from public.trading_accounts a where a.id = account_id and a.user_id = (select auth.uid())));
create policy read_trade_summaries on public.trade_summaries for select to authenticated
using (exists (select 1 from public.trading_accounts a where a.id = account_id and a.user_id = (select auth.uid())));

create function public.import_trade_summaries(
  target_account uuid, source_filename text, csv_text text, trade_rows jsonb
) returns text language plpgsql security definer set search_path = '' as $$
declare
  batch_id uuid;
  actor uuid := auth.uid();
begin
  perform 1 from public.trading_accounts
    where id = target_account and user_id = actor and currency = 'USD' for update;
  if not found then
    raise exception 'Account unavailable' using errcode = '42501';
  end if;
  if jsonb_typeof(trade_rows) is distinct from 'array' then
    raise exception 'Invalid import rows' using errcode = '22023';
  end if;
  if jsonb_array_length(trade_rows) not between 1 and 2000 then
    raise exception 'Invalid import row count' using errcode = '22023';
  end if;

  insert into public.summary_imports(account_id, filename, raw_csv, file_hash)
  values (target_account, source_filename, csv_text, sha256(convert_to(csv_text, 'UTF8')))
  on conflict (account_id, file_hash) do nothing returning id into batch_id;
  if batch_id is null then return 'duplicate'; end if;

  insert into public.trade_summaries (
    account_id, import_id, source_trade_id, day, symbol, option_type, strike, expiration, quantity,
    buy_time, sell_time, buy_price, sell_price, cost, proceeds, source, note
  )
  select target_account, batch_id, r.id, r.day, r.symbol, r.option_type, r.strike,
    r.expiration, r.quantity, r.buy_time, r.sell_time, r.buy_price, r.sell_price,
    r.cost, r.proceeds, r.source, r.note
  from jsonb_to_recordset(trade_rows) as r(
    id text, day date, symbol text, option_type text, strike numeric, expiration date,
    quantity integer, buy_time text, sell_time text, buy_price numeric, sell_price numeric,
    cost numeric, proceeds numeric, source text, note text
  );

  -- Treat same contract trades on any already-imported date as ambiguous unless same file.
  if exists (
    select 1 from public.trade_summaries fresh
    join public.trade_summaries prior on prior.account_id = target_account
      and prior.day = fresh.day and prior.symbol = fresh.symbol and prior.option_type = fresh.option_type
      and prior.strike = fresh.strike and prior.expiration = fresh.expiration
      and prior.import_id <> batch_id
    where fresh.import_id = batch_id
  ) then
    raise exception 'Possible overlap with another import' using errcode = 'P0001';
  end if;

  insert into public.audit_logs(account_id, actor_id, event_type, details)
    values (target_account, actor, 'summary.imported',
      jsonb_build_object('import_id', batch_id, 'rows', jsonb_array_length(trade_rows)));
  return 'imported';
end;
$$;

revoke all on function public.import_trade_summaries(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.import_trade_summaries(uuid,text,text,jsonb) to authenticated;

create function public.trade_summary_totals(target_account uuid)
returns table (gross text, trades bigint, wins bigint, losses bigint)
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(s.gross),0)::text, count(*),
    count(*) filter (where s.gross > 0), count(*) filter (where s.gross < 0)
  from public.trade_summaries s where s.account_id = target_account;
$$;
revoke all on function public.trade_summary_totals(uuid) from public, anon, authenticated;
grant execute on function public.trade_summary_totals(uuid) to authenticated;

commit;
