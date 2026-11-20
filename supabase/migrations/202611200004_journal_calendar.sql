begin;

-- Earlier Dime installs may have the fill tables without both FIFO helpers.
-- Use the definitions from the Dime migration when either helper is missing.
do $repair$
begin
  if to_regclass('public.trade_summaries') is null
    or to_regclass('public.dime_fills') is null
    or to_regclass('public.dime_records') is null
  then
    raise exception 'The trade summary and Dime tables must exist before installing the journal calendar.'
      using hint = 'Apply 202611200002_summary_import.sql and 202611200003_dime_import.sql in order if their tables are missing.';
  end if;

  if to_regprocedure('public.dime_allocations(uuid)') is null then
    execute $definition$
      create function public.dime_allocations(target_account uuid)
      returns table (sell_id uuid, buy_id uuid, units numeric, gross numeric, net numeric)
      language sql stable security invoker set search_path = '' as $$
        with ordered as (
          select f.*, dense_rank() over (order by symbol, option_type, strike, expiration) as contract,
            count(*) over (partition by symbol,option_type,strike,expiration,day,clock) > 1
              or (bool_or(minute_precision) over minute_window and count(*) over minute_window > 1) as uncertain
          from public.dime_fills f where f.account_id = target_account
          window minute_window as (partition by symbol,option_type,strike,expiration,day,left(clock::text,5))
        ), balances as (
          select *, row_number() over sequence as seq,
            sum(case when side = 'Buy' then quantity else -quantity end) over sequence as balance
          from ordered
          window sequence as (partition by contract order by day,clock,record_id rows unbounded preceding)
        ), corrected as (
          select *, balance - least(0,min(balance) over (partition by contract order by seq rows unbounded preceding)) as inventory,
            min(seq) filter (where uncertain) over (partition by contract) as first_tie
          from balances
        ), changes as (
          select *, lag(inventory,1,0) over (partition by contract order by seq) as previous_inventory
          from corrected
        ), ranges as (
          select *,
            sum(case when side = 'Buy' then quantity else 0 end) over sequence as buy_end,
            sum(case when side = 'Sell' then previous_inventory - inventory else 0 end) over sequence as sell_end
          from changes
          where first_tie is null or seq < first_tie
          window sequence as (partition by contract order by seq rows unbounded preceding)
        ), allocations as (
          select s.record_id as sell_id,b.record_id as buy_id,s.seq as sell_seq,b.seq as buy_seq,
            s.quantity,s.price,s.fee,b.price as basis,b.fee as buy_fee,b.quantity as buy_quantity,
            least(s.sell_end,b.buy_end) -
            greatest(s.sell_end-(s.previous_inventory-s.inventory),b.buy_end-b.quantity) as units
          from ranges s join ranges b on b.contract = s.contract and b.seq < s.seq
            and b.side = 'Buy' and s.side = 'Sell'
            and s.sell_end > b.buy_end-b.quantity and b.buy_end > s.sell_end-(s.previous_inventory-s.inventory)
        ), portions as (
          select *, sum(units) over (partition by sell_id order by buy_seq rows unbounded preceding) as sold_units,
            sum(units) over (partition by buy_id order by sell_seq rows unbounded preceding) as bought_units
          from allocations where units > 0
        )
        select a.sell_id,a.buy_id,a.units,a.units*(price-basis)*100,
          a.units*(price-basis)*100
            - (round(fee*sold_units/quantity,2) - round(fee*(sold_units-units)/quantity,2))
            - (round(buy_fee*bought_units/buy_quantity,2) - round(buy_fee*(bought_units-units)/buy_quantity,2))
        from portions a;
      $$;
    $definition$;
  end if;

  if to_regprocedure('public.dime_realized(uuid)') is null then
    execute $definition$
      create function public.dime_realized(target_account uuid)
      returns table (record_id uuid, matched numeric, gross numeric, net numeric)
      language sql stable security invoker set search_path = '' as $$
        select a.sell_id,sum(a.units),round(sum(a.gross),2),
          case when count(a.net) = count(*) then round(sum(a.net),2) end
        from public.dime_allocations(target_account) a group by a.sell_id;
      $$;
    $definition$;
  end if;
end;
$repair$;

-- Each CSV summary and each Dime sell with matched units counts as one closed trade.
-- Filter sell dates after FIFO allocation so positions can span calendar months.
create or replace function public.journal_closed_trades(target_account uuid, start_day date default null, end_day date default null)
returns table (
  id text, day date, symbol text, option_type text, strike text, expiration date, quantity integer,
  buy_time text, sell_time text, buy_price text, sell_price text, gross numeric, net numeric, source text, image_id uuid
)
language sql stable security invoker set search_path = '' as $$
  select s.import_id::text || '/' || s.source_trade_id, s.day, s.symbol, s.option_type, trim_scale(s.strike)::text,
    s.expiration, s.quantity, s.buy_time::text, s.sell_time::text, trim_scale(s.buy_price)::text,
    trim_scale(s.sell_price)::text, s.gross, null::numeric, s.source, null::uuid
  from public.trade_summaries s
  where s.account_id = target_account
    and (start_day is null or s.day >= start_day) and (end_day is null or s.day < end_day)
  union all
  select f.record_id::text, f.day, f.symbol, f.option_type, trim_scale(f.strike)::text, f.expiration, d.matched::integer,
    null::text, case when f.minute_precision then left(f.clock::text, 5) else f.clock::text end,
    null::text, trim_scale(f.price)::text, d.gross, d.net, 'dime', r.image_id
  from public.dime_realized(target_account) d
  join public.dime_fills f on f.record_id = d.record_id and f.account_id = target_account
  join public.dime_records r on r.id = f.record_id
  where (start_day is null or f.day >= start_day) and (end_day is null or f.day < end_day);
$$;

create or replace function public.journal_dashboard_totals(target_account uuid)
returns table (gross text, trades bigint, wins bigint, net text, latest_day date)
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(t.gross), 0)::text, count(*), count(*) filter (where t.gross > 0),
    case when count(t.net) = count(*) then coalesce(sum(t.net), 0)::text end, max(t.day)
  from public.journal_closed_trades(target_account) t;
$$;

revoke all on function public.dime_allocations(uuid), public.dime_realized(uuid),
  public.journal_closed_trades(uuid, date, date), public.journal_dashboard_totals(uuid) from public, anon, authenticated;
grant execute on function public.dime_allocations(uuid), public.dime_realized(uuid),
  public.journal_closed_trades(uuid, date, date), public.journal_dashboard_totals(uuid) to authenticated;

commit;
