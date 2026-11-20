begin;

create table public.dime_images (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.trading_accounts on delete cascade,
  filename text not null check (length(filename) between 1 and 255),
  mime text not null check (mime in ('image/png','image/jpeg','image/webp')),
  bytes bytea not null check (octet_length(bytes) between 1 and 8388608),
  hash bytea generated always as (sha256(bytes)) stored,
  model text,
  created_at timestamptz not null default now(),
  unique (account_id, hash)
);

create table public.dime_records (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null references public.dime_images on delete cascade,
  ordinal integer not null,
  extracted jsonb not null,
  verified jsonb,
  resolution text,
  decision text check (decision in ('confirmed','duplicate','unexecuted')),
  unique (image_id, ordinal)
);

create table public.dime_fills (
  record_id uuid primary key references public.dime_records on delete cascade,
  account_id uuid not null references public.trading_accounts on delete cascade,
  broker_fill_id text,
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,14}$'),
  option_type text not null check (option_type in ('Call','Put')),
  strike numeric(18,8) not null check (strike >= 0),
  expiration date not null,
  day date not null,
  clock time not null,
  minute_precision boolean not null,
  side text not null check (side in ('Buy','Sell')),
  quantity integer not null check (quantity between 1 and 999999),
  price numeric(18,8) not null check (price >= 0),
  fee numeric(18,8) check (fee >= 0),
  unique (account_id, broker_fill_id)
);

create index dime_fills_contract on public.dime_fills(account_id,symbol,option_type,strike,expiration,day,clock);

alter table public.dime_images enable row level security;
alter table public.dime_records enable row level security;
alter table public.dime_fills enable row level security;
revoke all on public.dime_images, public.dime_records, public.dime_fills from public, anon, authenticated;
grant select (id, account_id, filename, mime, bytes, model, created_at) on public.dime_images to authenticated;
grant select on public.dime_records, public.dime_fills to authenticated;
create policy dime_images_owner on public.dime_images for select to authenticated
  using (exists (select 1 from public.trading_accounts a where a.id = account_id and a.user_id = (select auth.uid())));
create policy dime_records_owner on public.dime_records for select to authenticated
  using (exists (select 1 from public.dime_images i where i.id = image_id));
create policy dime_fills_owner on public.dime_fills for select to authenticated
  using (exists (select 1 from public.trading_accounts a where a.id = account_id and a.user_id = (select auth.uid())));

create function public.register_dime_image(target_account uuid, source_filename text, source_mime text, source_bytes text)
returns table (image_id uuid, extracted boolean)
language plpgsql security definer set search_path = '' as $$
declare
  content bytea := decode(source_bytes, 'base64');
begin
  perform 1 from public.trading_accounts where id = target_account and user_id = auth.uid()
    and currency = 'USD' and lower(broker) = 'dime' for update;
  if not found then raise exception 'Dime account unavailable' using errcode = '42501'; end if;
  return query insert into public.dime_images as i(account_id,filename,mime,bytes)
    values (target_account,source_filename,source_mime,content)
    on conflict (account_id,hash) do update set filename = i.filename
    returning i.id,i.model is not null;
end;
$$;

create function public.save_dime_extraction(source_image uuid, vision_model text, extracted_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.dime_images i join public.trading_accounts a on a.id = i.account_id
    where i.id = source_image and a.user_id = auth.uid() for update of i;
  if not found then raise exception 'Image unavailable' using errcode = '42501'; end if;
  if coalesce(jsonb_array_length(extracted_rows),0) not between 1 and 40 or coalesce(length(vision_model),0) = 0 then
    raise exception 'Invalid extraction';
  end if;
  update public.dime_images set model = vision_model where id = source_image and model is null;
  if found then
    insert into public.dime_records(image_id,ordinal,extracted)
      select source_image, n, row from jsonb_array_elements(extracted_rows) with ordinality r(row,n);
  end if;
end;
$$;

-- CSV clock strings may cross midnight and summary prices may average several fills.
create function public.dime_overlap(target_account uuid, candidate jsonb)
returns text language sql stable security invoker set search_path = '' as $$
  select case
    when exists (
      select 1 from public.dime_fills f
      where f.account_id = target_account and f.broker_fill_id = candidate->>'fill_id'
    ) then 'broker_id'
    when exists (
      select 1 from public.trade_summaries s
      where s.account_id = target_account and s.symbol = candidate->>'symbol'
        and s.option_type = candidate->>'option_type' and s.strike = (candidate->>'strike')::numeric
        and s.expiration = (candidate->>'expiration')::date
        and abs(s.day - (candidate->>'day')::date) <= 1
    ) then 'csv'
    when exists (
      select 1 from public.dime_fills f join public.dime_records r on r.id = f.record_id
      where f.account_id = target_account
        and (f.broker_fill_id is null or candidate->>'fill_id' is null)
        and (f.symbol,f.option_type,f.strike,f.expiration,f.day,f.side) =
          (candidate->>'symbol',candidate->>'option_type',(candidate->>'strike')::numeric,
           (candidate->>'expiration')::date,(candidate->>'day')::date,candidate->>'side')
        and (left(f.clock::text,5) = left(candidate->>'clock',5)
          or r.verified->>'order_id' = candidate->>'order_id')
    ) then 'fill'
  end;
$$;

create function public.confirm_dime_records(source_image uuid, reviews jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  target_account uuid;
  review jsonb;
  candidate jsonb;
  record uuid;
  outcome text;
  overlap text;
  saved integer := 0;
begin
  select a.id into target_account from public.dime_images i join public.trading_accounts a on a.id = i.account_id
    where i.id = source_image and a.user_id = auth.uid() for update of a;
  if not found then raise exception 'Image unavailable' using errcode = '42501'; end if;
  if coalesce(jsonb_array_length(reviews),0) not between 1 and 40 then raise exception 'Invalid reviews'; end if;
  for review in select value from jsonb_array_elements(reviews) loop
    record := (review->>'id')::uuid;
    candidate := review->'row';
    perform 1 from public.dime_records where id = record and image_id = source_image and decision is null;
    if not found then continue; end if;
    outcome := 'confirmed';
    if candidate->>'status' in ('pending','cancelled') then
      if candidate->>'quantity' is not null or candidate->>'price' is not null then
        raise exception 'Unexecuted order contains execution evidence';
      end if;
      outcome := 'unexecuted';
    elsif review->>'resolution' = 'duplicate' then
      outcome := 'duplicate';
    else
      if coalesce(candidate->>'status','') not in ('filled','partial') then raise exception 'Execution status required'; end if;
      overlap := public.dime_overlap(target_account,candidate);
      if overlap = 'broker_id' then
        outcome := 'duplicate';
      elsif overlap is not null and review->>'resolution' is distinct from 'distinct' then
        raise exception 'Possible overlap. Review this row and choose a resolution.' using errcode = 'P0001', detail = record::text || ':' || overlap;
      else
        insert into public.dime_fills(record_id,account_id,broker_fill_id,symbol,option_type,strike,expiration,day,clock,
          minute_precision,side,quantity,price,fee)
        values (record,target_account,candidate->>'fill_id',candidate->>'symbol',candidate->>'option_type',
          (candidate->>'strike')::numeric,(candidate->>'expiration')::date,(candidate->>'day')::date,
          (candidate->>'clock')::time,length(candidate->>'clock') = 5,candidate->>'side',
          (candidate->>'quantity')::integer,(candidate->>'price')::numeric,(candidate->>'fee')::numeric);
      end if;
    end if;
    update public.dime_records set verified = candidate, decision = outcome, resolution = review->>'resolution' where id = record;
    saved := saved + 1;
  end loop;
  if saved > 0 then
    insert into public.audit_logs(account_id,actor_id,event_type,details)
      values (target_account,auth.uid(),'dime.reviewed',jsonb_build_object('image_id',source_image,'rows',saved));
  end if;
  return saved;
end;
$$;

create function public.check_csv_dime_overlap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.dime_fills f where f.account_id = new.account_id
    and (f.symbol,f.option_type,f.strike,f.expiration) = (new.symbol,new.option_type,new.strike,new.expiration)
    and abs(f.day - new.day) <= 1) then
    raise exception 'Possible overlap with Dime fills' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger check_csv_dime_overlap before insert on public.trade_summaries
for each row execute function public.check_csv_dime_overlap();

-- Running inventory clips sells without an evidenced opening lot. Interval
-- intersections then allocate each matched sell against its oldest open buys.
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

create function public.dime_realized(target_account uuid)
returns table (record_id uuid, matched numeric, gross numeric, net numeric)
language sql stable security invoker set search_path = '' as $$
  select a.sell_id,sum(a.units),round(sum(a.gross),2),
    case when count(a.net) = count(*) then round(sum(a.net),2) end
  from public.dime_allocations(target_account) a group by a.sell_id;
$$;

create function public.dime_history(target_account uuid)
returns table (record_id uuid, image_id uuid, day date, clock text, symbol text, strike text, option_type text,
  expiration date, side text, quantity integer, price text, matched numeric, gross text, open_quantity numeric)
language sql stable security invoker set search_path = '' as $$
  with allocations as materialized (select * from public.dime_allocations(target_account)),
  sold as (select sell_id,sum(units) as units,round(sum(gross),2) as gross from allocations group by sell_id),
  bought as (select buy_id,sum(units) as units from allocations group by buy_id)
  select f.record_id,r.image_id,f.day,case when f.minute_precision then left(f.clock::text,5) else f.clock::text end,
    f.symbol,trim_scale(f.strike)::text,f.option_type,f.expiration,f.side,f.quantity,trim_scale(f.price)::text,
    s.units,s.gross::text,
    case when f.side = 'Buy' then f.quantity - coalesce(b.units,0) end
  from public.dime_fills f join public.dime_records r on r.id = f.record_id
    left join sold s on s.sell_id = f.record_id left join bought b on b.buy_id = f.record_id
  where f.account_id = target_account order by f.day desc,f.clock desc,f.record_id limit 50;
$$;

create function public.journal_totals(target_account uuid)
returns table(gross text, trades bigint, wins bigint, net text)
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(t.gross),0)::text,count(*),count(*) filter (where t.gross > 0),
    case when count(t.net) = count(*) then coalesce(sum(t.net),0)::text end
  from (
    select s.gross,null::numeric as net from public.trade_summaries s where s.account_id = target_account
    union all
    select d.gross,d.net from public.dime_realized(target_account) d
  ) t;
$$;

revoke all on function public.register_dime_image(uuid,text,text,text),
  public.save_dime_extraction(uuid,text,jsonb),public.dime_overlap(uuid,jsonb),
  public.confirm_dime_records(uuid,jsonb),public.check_csv_dime_overlap(),
  public.dime_allocations(uuid),public.dime_history(uuid),public.dime_realized(uuid),public.journal_totals(uuid) from public,anon,authenticated;
grant execute on function public.register_dime_image(uuid,text,text,text),
  public.save_dime_extraction(uuid,text,jsonb),public.dime_overlap(uuid,jsonb),
  public.confirm_dime_records(uuid,jsonb),public.dime_allocations(uuid),public.dime_history(uuid),public.dime_realized(uuid),
  public.journal_totals(uuid) to authenticated;
commit;
