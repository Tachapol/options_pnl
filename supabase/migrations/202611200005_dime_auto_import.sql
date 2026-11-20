begin;

create function public.auto_import_dime_image(source_image uuid)
returns table (imported integer, duplicates integer, needs_review integer, unexecuted integer)
language plpgsql security definer set search_path = '' as $$
declare
  target_account uuid;
  item record;
  candidate jsonb;
  overlap text;
begin
  -- Serialize with manual confirmation, CSV imports and other images for this account.
  select a.id into target_account
  from public.dime_images i join public.trading_accounts a on a.id = i.account_id
  where i.id = source_image and a.user_id = auth.uid()
  for update of a;
  if not found then raise exception 'Image unavailable' using errcode = '42501'; end if;

  for item in
    select r.id, r.extracted from public.dime_records r
    where r.image_id = source_image and r.decision is null
    order by r.ordinal
  loop
    candidate := item.extracted;
    if candidate->>'status' in ('pending', 'cancelled') then
      if candidate->>'quantity' is not null or candidate->>'price' is not null then continue; end if;
    elsif not (
      coalesce(candidate->>'status' in ('filled', 'partial'), false)
      and coalesce(candidate->>'side' in ('Buy', 'Sell'), false)
      and jsonb_strip_nulls(candidate) ?& array['symbol', 'option_type', 'strike', 'expiration', 'day', 'clock', 'quantity', 'price']
    ) then
      continue;
    else
      -- An order snapshot with a partially filled quantity can change over time.
      if candidate->>'status' = 'partial' and candidate->>'fill_id' is null then continue; end if;
    end if;

    begin
      if candidate->>'status' in ('filled', 'partial') then
        overlap := public.dime_overlap(target_account, candidate);
        if overlap in ('csv', 'fill') then continue; end if;
        if overlap = 'broker_id' and not exists (
          select 1 from public.dime_fills f
          where f.account_id = target_account and f.broker_fill_id = candidate->>'fill_id'
            and (f.symbol, f.option_type, f.strike, f.expiration, f.day, f.side, f.quantity, f.price) =
              (candidate->>'symbol', candidate->>'option_type', (candidate->>'strike')::numeric,
               (candidate->>'expiration')::date, (candidate->>'day')::date, candidate->>'side',
               (candidate->>'quantity')::integer, (candidate->>'price')::numeric)
            and (f.clock = (candidate->>'clock')::time or (
              (f.minute_precision or length(candidate->>'clock') = 5)
              and left(f.clock::text, 5) = left(candidate->>'clock', 5)
            ))
        ) then
          continue;
        end if;
      end if;

      perform public.confirm_dime_records(source_image, jsonb_build_array(
        jsonb_build_object('id', item.id, 'row', candidate, 'resolution', 'auto')
      ));
    exception when data_exception or check_violation or not_null_violation then
      -- Keep an invalid extraction available for review and continue with the other rows.
      continue;
    end;
  end loop;

  return query select
    count(*) filter (where r.decision = 'confirmed')::integer,
    count(*) filter (where r.decision = 'duplicate')::integer,
    count(*) filter (where r.decision is null)::integer,
    count(*) filter (where r.decision = 'unexecuted')::integer
  from public.dime_records r where r.image_id = source_image;
end;
$$;

revoke all on function public.auto_import_dime_image(uuid) from public, anon, authenticated;
grant execute on function public.auto_import_dime_image(uuid) to authenticated;

commit;
