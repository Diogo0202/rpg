-- Reserve XP for pending advances. The sheet lock serializes requests, approvals and cancellations.
-- Pending costs remain reserved while status = 'pending'; reject/cancel releases them.

create or replace function public.quote_advance(
  p_sheet_id uuid, p_trait text, p_target_level integer, p_item_name text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_sheet public.character_sheets;
  v_schema jsonb;
  v_xp_field text;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  select * into v_sheet from public.character_sheets where id = p_sheet_id;
  if not found or not private.can_buy_advance(v_sheet.owner_id, v_sheet.campaign_id) then
    raise exception 'sheet not found or not writable' using errcode = '42501';
  end if;
  v_schema := private.advance_sheet_schema(v_sheet.template_id, v_sheet.campaign_id);
  if v_schema is null then raise exception 'sheet template is not approved' using errcode = '22023'; end if;
  v_xp_field := v_schema ->> 'experience_field';
  return private.quote_advance_for(v_schema, v_sheet.values, p_trait, p_target_level, p_item_name) || jsonb_build_object(
    'xp_available', case when v_xp_field is null then null else greatest(0, coalesce((v_sheet.values ->> v_xp_field)::numeric, 0)::integer - coalesce((select sum(a.cost) from public.character_advances a where a.sheet_id = p_sheet_id and a.status = 'pending'), 0)::integer) end,
    'sheet_version', v_sheet.version,
    'requires_approval', private.advance_requires_approval(v_sheet.campaign_id)
  );
end;
$$;
revoke all on function public.quote_advance(uuid, text, integer, text) from public, anon;
grant execute on function public.quote_advance(uuid, text, integer, text) to authenticated;

create or replace function public.purchase_advance(
  p_sheet_id uuid, p_trait text, p_target_level integer, p_expected_version integer,
  p_operation_id uuid, p_item_name text default null, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_sheet public.character_sheets;
  v_schema jsonb;
  v_quote jsonb;
  v_prior public.character_advances;
  v_advance public.character_advances;
  v_xp_field text;
  v_xp integer;
  v_pending boolean;
  v_reserved integer;
begin
  if v_actor is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_operation_id is null then raise exception 'operation ID required' using errcode = '22023'; end if;
  if p_reason is not null and char_length(p_reason) > 200 then
    raise exception 'reason must have at most 200 characters' using errcode = '22023';
  end if;
  -- The row lock serializes concurrent purchases and replays of the same operation.
  select * into v_sheet from public.character_sheets where id = p_sheet_id for update;
  if not found or not private.can_buy_advance(v_sheet.owner_id, v_sheet.campaign_id) then
    raise exception 'sheet not found or not writable' using errcode = '42501';
  end if;

  select * into v_prior from public.character_advances advance
   where advance.actor_id = v_actor and advance.sheet_id = p_sheet_id and advance.operation_id = p_operation_id;
  if found then
    if v_prior.trait <> p_trait or v_prior.to_level <> p_target_level
       or (v_prior.item_name is distinct from nullif(btrim(coalesce(p_item_name, '')), '')
           and v_prior.item_name is distinct from private.advance_item_base(p_item_name)) then
      raise exception 'operation ID was already used for another purchase' using errcode = '23505';
    end if;
    return jsonb_build_object('advance', to_jsonb(v_prior), 'sheet', to_jsonb(v_sheet), 'replayed', true);
  end if;

  if p_expected_version is null or v_sheet.version <> p_expected_version then
    raise exception 'sheet changed since version %', p_expected_version using errcode = '40001';
  end if;
  v_schema := private.advance_sheet_schema(v_sheet.template_id, v_sheet.campaign_id);
  if v_schema is null then raise exception 'sheet template is not approved' using errcode = '22023'; end if;
  v_xp_field := v_schema ->> 'experience_field';
  if v_xp_field is null then raise exception 'template has no experience field' using errcode = '22023'; end if;
  v_quote := private.quote_advance_for(v_schema, v_sheet.values, p_trait, p_target_level, p_item_name);
  v_xp := coalesce((v_sheet.values ->> v_xp_field)::numeric, 0)::integer;
  select coalesce(sum(advance.cost), 0)::integer into v_reserved
    from public.character_advances advance where advance.sheet_id = p_sheet_id and advance.status = 'pending';
  if v_xp - v_reserved < (v_quote ->> 'cost')::integer then
    raise exception 'not enough unreserved experience' using errcode = 'XP001';
  end if;

  v_pending := private.advance_requires_approval(v_sheet.campaign_id);
  if v_pending then
    if (select count(*) from public.character_advances advance
         where advance.sheet_id = p_sheet_id and advance.status = 'pending') >= 20 then
      raise exception 'too many pending advances' using errcode = '23514';
    end if;
  else
    v_sheet := private.apply_advance_quote(p_sheet_id, v_schema, v_quote);
  end if;

  insert into public.character_advances
    (sheet_id, campaign_id, actor_id, operation_id, system_key, trait, category, item_name, item_value, item_before,
     from_level, to_level, cost, status, xp_before, xp_after, sheet_version, reason)
  values
    (v_sheet.id, v_sheet.campaign_id, v_actor, p_operation_id, v_quote ->> 'system_key', p_trait, v_quote ->> 'category',
     v_quote ->> 'item_name', v_quote ->> 'item_value', v_quote ->> 'item_before',
     (v_quote ->> 'from_level')::integer, (v_quote ->> 'to_level')::integer, (v_quote ->> 'cost')::integer,
     case when v_pending then 'pending' else 'applied' end,
     case when v_pending then null else v_xp end,
     case when v_pending then null else v_xp - (v_quote ->> 'cost')::integer end,
     case when v_pending then null else v_sheet.version end, p_reason)
  returning * into v_advance;
  return jsonb_build_object('advance', to_jsonb(v_advance), 'sheet', to_jsonb(v_sheet), 'replayed', false);
end;
$$;
revoke all on function public.purchase_advance(uuid, text, integer, integer, uuid, text, text) from public, anon;
grant execute on function public.purchase_advance(uuid, text, integer, integer, uuid, text, text) to authenticated;

create or replace function public.review_advance(p_advance_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_advance public.character_advances;
  v_sheet public.character_sheets;
  v_schema jsonb;
  v_quote jsonb;
  v_xp integer;
  v_reserved integer;
begin
  if v_actor is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'decision required' using errcode = '22023'; end if;
  if p_note is not null and char_length(p_note) > 200 then raise exception 'note too long' using errcode = '22023'; end if;
  select * into v_advance from public.character_advances advance where advance.id = p_advance_id;
  if not found or not exists (select 1 from public.character_sheets sheet where sheet.id = v_advance.sheet_id
                               and private.can_buy_advance(sheet.owner_id, sheet.campaign_id)) then
    raise exception 'advance not found' using errcode = 'P0002';
  end if;
  if not private.can_manage_campaign(v_advance.campaign_id) and not (v_advance.actor_id = v_actor and not p_approve) then
    raise exception 'only the campaign master can review advances' using errcode = '42501';
  end if;
  select * into v_sheet from public.character_sheets where id = v_advance.sheet_id for update;
  select * into v_advance from public.character_advances advance where advance.id = p_advance_id for update;
  if v_advance.status <> 'pending' then raise exception 'advance is not pending' using errcode = '22023'; end if;

  if not p_approve then
    update public.character_advances advance
       set status = 'rejected', reviewed_by = v_actor, reviewed_at = now(), review_note = p_note
     where advance.id = p_advance_id returning * into v_advance;
    return jsonb_build_object('advance', to_jsonb(v_advance), 'sheet', to_jsonb(v_sheet));
  end if;

  v_schema := private.advance_sheet_schema(v_sheet.template_id, v_sheet.campaign_id);
  if v_schema is null then raise exception 'sheet template is not approved' using errcode = '22023'; end if;
  v_quote := private.quote_advance_for(v_schema, v_sheet.values, v_advance.trait, v_advance.to_level, v_advance.item_name);
  if (v_quote ->> 'from_level')::integer <> v_advance.from_level then
    raise exception 'trait changed since the request' using errcode = '40001';
  end if;
  v_xp := coalesce((v_sheet.values ->> (v_schema ->> 'experience_field'))::numeric, 0)::integer;
  select coalesce(sum(advance.cost), 0)::integer into v_reserved
    from public.character_advances advance
   where advance.sheet_id = v_sheet.id and advance.status = 'pending' and advance.id <> v_advance.id;
  if v_xp - v_reserved < (v_quote ->> 'cost')::integer then
    raise exception 'reserved experience is no longer available' using errcode = 'XP001';
  end if;
  -- Release this reservation within the same transaction before the guarded debit.
  -- Any failure below rolls this status change back with the sheet write.
  update public.character_advances set status = 'applied' where id = v_advance.id;
  v_sheet := private.apply_advance_quote(v_sheet.id, v_schema, v_quote);
  update public.character_advances advance
     set status = 'applied', category = v_quote ->> 'category', cost = (v_quote ->> 'cost')::integer,
         item_value = v_quote ->> 'item_value', item_before = v_quote ->> 'item_before',
         xp_before = v_xp, xp_after = v_xp - (v_quote ->> 'cost')::integer,
         sheet_version = v_sheet.version, reviewed_by = v_actor, reviewed_at = now(), review_note = p_note
   where advance.id = p_advance_id returning * into v_advance;
  return jsonb_build_object('advance', to_jsonb(v_advance), 'sheet', to_jsonb(v_sheet));
end;
$$;
revoke all on function public.review_advance(uuid, boolean, text) from public, anon;
grant execute on function public.review_advance(uuid, boolean, text) to authenticated;

-- Every sheet write, including generic XP adjustment RPCs, respects pending reservations.
create or replace function private.guard_reserved_advance_xp()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  reserved numeric;
  xp_field text;
begin
  select coalesce(sum(cost), 0) into reserved from public.character_advances
   where sheet_id = new.id and status = 'pending';
  if reserved = 0 then return new; end if;
  xp_field := private.advance_sheet_schema(new.template_id, new.campaign_id) ->> 'experience_field';
  if xp_field is null or coalesce((new.values ->> xp_field)::numeric, 0) < reserved then
    raise exception 'pending advances reserve this experience' using errcode = 'XP001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_reserved_advance_xp() from public, anon, authenticated;
create trigger character_sheets_guard_reserved_advance_xp
before update on public.character_sheets
for each row execute function private.guard_reserved_advance_xp();
