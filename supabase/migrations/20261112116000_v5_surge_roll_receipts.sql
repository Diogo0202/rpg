-- A Surge receipt owns one stored roll, even after retained history has aged out.
create table private.v5_surge_roll_receipts (
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  operation_id uuid not null,
  actor_id uuid not null references auth.users(id),
  request jsonb not null,
  result jsonb not null,
  primary key(sheet_id, operation_id)
);
create unique index v5_surge_roll_receipts_turn_idx on private.v5_surge_roll_receipts(sheet_id,(request->>'turn_key'));
revoke all on private.v5_surge_roll_receipts from public, anon, authenticated;

create function public.v5_surge_roll_receipt(p_sheet_id uuid, p_operation_id uuid, p_base_pool integer, p_difficulty integer, p_turn_key text, p_context_tags jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, auth as $$
declare
  sheet public.character_sheets;
  receipt private.v5_surge_roll_receipts;
  envelope jsonb := jsonb_build_object('base_pool',p_base_pool,'difficulty',p_difficulty,'turn_key',btrim(p_turn_key),'context_tags',p_context_tags);
begin
  select * into sheet from public.character_sheets where id=p_sheet_id;
  if auth.uid() is null or sheet.id is null or not private.can_write_sheet(sheet) then
    raise exception 'sheet not writable' using errcode='42501';
  end if;
  select * into receipt from private.v5_surge_roll_receipts where sheet_id=p_sheet_id and operation_id=p_operation_id;
  if not found then
    select * into receipt from private.v5_surge_roll_receipts where sheet_id=p_sheet_id and request->>'turn_key'=btrim(p_turn_key);
  end if;
  if not found then return null; end if;
  if receipt.actor_id <> auth.uid() then raise exception 'receipt not writable' using errcode='42501'; end if;
  if receipt.request is distinct from envelope then raise exception 'Surge operation already used for another action' using errcode='23505'; end if;
  return receipt.result;
end;
$$;
revoke all on function public.v5_surge_roll_receipt(uuid,uuid,integer,integer,text,jsonb) from public,anon;
grant execute on function public.v5_surge_roll_receipt(uuid,uuid,integer,integer,text,jsonb) to authenticated;

alter function public.record_v5_roll(uuid,integer,integer,integer,jsonb) set schema private;
revoke all on function private.record_v5_roll(uuid,integer,integer,integer,jsonb) from public,anon,authenticated;
create function public.record_v5_roll(p_sheet_id uuid,p_pool integer,p_hunger integer,p_difficulty integer,p_details jsonb default '{}')
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, auth as $$
declare
  sheet public.character_sheets;
  v_operation_id uuid;
  prior jsonb;
  saved jsonb;
  surge public.v5_blood_events;
  base_pool integer;
  tags jsonb := coalesce(p_details->'context_tags','[]'::jsonb);
begin
  if p_details->'blood_surge'->>'operation_id' is null then
    return private.record_v5_roll(p_sheet_id,p_pool,p_hunger,p_difficulty,p_details);
  end if;
  v_operation_id := (p_details->'blood_surge'->>'operation_id')::uuid;
  base_pool := (p_details->>'base_pool')::integer;
  -- Serializes independent requests through the same sheet, including retries.
  select * into sheet from public.character_sheets where id=p_sheet_id for update;
  prior := public.v5_surge_roll_receipt(p_sheet_id,v_operation_id,base_pool,p_difficulty,p_details->'blood_surge'->>'turn_key',tags);
  if prior is not null then return prior; end if;
  select * into surge from public.v5_blood_events event where event.sheet_id=p_sheet_id and event.actor_id=auth.uid()
    and event.operation_id=v_operation_id and event.kind='surge';
  if not found or (surge.outcome->>'base_pool')::integer is distinct from base_pool
     or surge.outcome->>'turn_key' is distinct from btrim(p_details->'blood_surge'->>'turn_key') then
    raise exception 'matching Surge receipt required' using errcode='22023';
  end if;
  saved := private.record_v5_roll(p_sheet_id,p_pool,p_hunger,p_difficulty,p_details);
  insert into private.v5_surge_roll_receipts(sheet_id,operation_id,actor_id,request,result)
    values(p_sheet_id,v_operation_id,auth.uid(),jsonb_build_object('base_pool',base_pool,'difficulty',p_difficulty,'turn_key',btrim(p_details->'blood_surge'->>'turn_key'),'context_tags',tags),saved);
  return saved;
end;
$$;
revoke all on function public.record_v5_roll(uuid,integer,integer,integer,jsonb) from public,anon;
grant execute on function public.record_v5_roll(uuid,integer,integer,integer,jsonb) to authenticated;
