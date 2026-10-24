-- Stable operation IDs make offline adjustment retries safe after a lost reply.
alter table public.character_sheet_events add column operation_id uuid;
create unique index character_sheet_events_operation_idx
  on public.character_sheet_events (actor_id, campaign_id, sheet_id, operation_id)
  where operation_id is not null;

create or replace function private.record_sheet_adjustment_event(
  p_sheet_id uuid, p_operation_id uuid, p_field_id text, p_delta integer,
  p_before numeric, p_after numeric, p_reason text
)
returns public.character_sheet_events
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  result public.character_sheet_events;
begin
  select * into sheet from public.character_sheets where id = p_sheet_id and updated_at = now();
  if not found or auth.uid() is null then
    raise exception 'events can only be recorded with a sheet write' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.character_sheet_events existing
     where existing.sheet_id = p_sheet_id and existing.sheet_version = sheet.version
  ) then
    raise exception 'sheet version already has an event' using errcode = '23505';
  end if;
  insert into public.character_sheet_events
    (sheet_id, campaign_id, actor_id, kind, field_id, delta, value_before, value_after,
     sheet_version, reason, operation_id)
  values
    (sheet.id, sheet.campaign_id, auth.uid(), 'adjust', p_field_id, p_delta, p_before,
     p_after, sheet.version, p_reason, p_operation_id)
  returning * into result;
  return result;
end;
$$;
revoke all on function private.record_sheet_adjustment_event(uuid, uuid, text, integer, numeric, numeric, text) from public;
grant execute on function private.record_sheet_adjustment_event(uuid, uuid, text, integer, numeric, numeric, text) to authenticated;

create or replace function public.adjust_sheet_number_idempotent(
  p_sheet_id uuid, p_operation_id uuid, p_field_id text, p_delta integer, p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  template_schema jsonb;
  prior_event public.character_sheet_events;
  before_value numeric;
  after_value numeric;
  event public.character_sheet_events;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_operation_id is null or p_delta is null or p_delta = 0 or abs(p_delta) > 1000 then
    raise exception 'invalid operation ID or delta' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(p_reason) > 200 then
    raise exception 'reason must have at most 200 characters' using errcode = '22023';
  end if;

  -- The row lock serializes duplicate requests for this sheet and preserves concurrent deltas.
  select * into sheet from public.character_sheets where id = p_sheet_id for update;
  if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  select * into prior_event from public.character_sheet_events
   where sheet_id = p_sheet_id and campaign_id = sheet.campaign_id and actor_id = auth.uid()
     and operation_id = p_operation_id;
  if found then
    if prior_event.kind <> 'adjust' or prior_event.field_id <> p_field_id
       or prior_event.delta <> p_delta or prior_event.reason is distinct from p_reason then
      raise exception 'operation ID was already used for another adjustment' using errcode = '23505';
    end if;
    return jsonb_build_object('sheet', to_jsonb(sheet), 'event', to_jsonb(prior_event));
  end if;

  select schema into template_schema from public.system_templates
   where id = sheet.template_id and campaign_id = sheet.campaign_id and status = 'approved';
  if not exists (
    select 1 from jsonb_array_elements(template_schema -> 'fields') as fields(field)
     where field ->> 'id' = p_field_id and field ->> 'kind' = 'number'
  ) then
    raise exception 'field is not a number field of this sheet' using errcode = '22023';
  end if;
  if template_schema ->> 'experience_field' = p_field_id or exists (
    select 1 from jsonb_array_elements(coalesce(template_schema -> 'meta_currencies', '[]'::jsonb)) as currencies(currency)
     where currency ->> 'field' = p_field_id
  ) then
    raise exception 'field has a dedicated adjustment endpoint' using errcode = '22023';
  end if;
  if sheet.values ? p_field_id and jsonb_typeof(sheet.values -> p_field_id) <> 'number' then
    raise exception 'field does not hold a number' using errcode = '22023';
  end if;
  before_value := coalesce((sheet.values ->> p_field_id)::numeric, 0);
  after_value := before_value + p_delta;
  if abs(after_value) > 1000000 then raise exception 'field would leave its allowed range' using errcode = '23514'; end if;

  perform set_config('rpg.atomic_adjustment', 'on', true);
  update public.character_sheets
     set values = jsonb_set(values, array[p_field_id], to_jsonb(after_value))
   where id = p_sheet_id returning * into sheet;
  perform set_config('rpg.atomic_adjustment', 'off', true);
  if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  event := private.record_sheet_adjustment_event(p_sheet_id, p_operation_id, p_field_id, p_delta, before_value, after_value, p_reason);
  return jsonb_build_object('sheet', to_jsonb(sheet), 'event', to_jsonb(event));
end;
$$;
revoke all on function public.adjust_sheet_number_idempotent(uuid, uuid, text, integer, text) from public, anon;
grant execute on function public.adjust_sheet_number_idempotent(uuid, uuid, text, integer, text) to authenticated;

comment on column public.character_sheet_events.operation_id is
  'Client operation UUID used to replay an offline delta without applying it twice.';
