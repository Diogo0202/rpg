-- Atomic numeric adjustments for character sheets.
-- Concurrent edits from the master (XP, meta currency) and the player (damage)
-- lock the row and add a delta to the current value instead of overwriting
-- the whole values object, so neither write is lost or rejected as stale.
-- Every adjustment leaves an append-only event for the table to audit.

-- Templates may declare system-neutral resources:
--   meta_currencies: [{ id, label, field, mode, max?, max_field? }]
--     mode 'pool'  -> spending lowers the field (D&D Inspiration, One Ring Hope)
--     mode 'track' -> spending raises a damage track (V5 Willpower)
--   experience_field: id of the number field that holds available XP.
create or replace function private.validate_sheet_template_resources(p_schema jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  currency jsonb;
  referenced jsonb;
  seen text[] := array[]::text[];
begin
  if p_schema ? 'experience_field' and jsonb_typeof(p_schema -> 'experience_field') <> 'null' then
    if jsonb_typeof(p_schema -> 'experience_field') is distinct from 'string' or not exists (
      select 1 from jsonb_array_elements(p_schema -> 'fields') as fields(field)
       where field ->> 'id' = p_schema ->> 'experience_field' and field ->> 'kind' = 'number'
    ) then
      raise exception 'experience_field must reference a number field';
    end if;
  end if;

  if not (p_schema ? 'meta_currencies') or jsonb_typeof(p_schema -> 'meta_currencies') = 'null' then
    return;
  end if;
  if jsonb_typeof(p_schema -> 'meta_currencies') is distinct from 'array'
     or jsonb_array_length(p_schema -> 'meta_currencies') > 10 then
    raise exception 'meta_currencies must be an array of at most 10 entries';
  end if;
  for currency in select value from jsonb_array_elements(p_schema -> 'meta_currencies')
  loop
    if jsonb_typeof(currency) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(currency) as keys(key)
                   where key not in ('id', 'label', 'field', 'mode', 'max', 'max_field'))
       or jsonb_typeof(currency -> 'id') is distinct from 'string'
       or (currency ->> 'id') !~ '^[a-z][a-z0-9_]{1,63}$'
       or jsonb_typeof(currency -> 'label') is distinct from 'string'
       or char_length(currency ->> 'label') not between 1 and 80
       or jsonb_typeof(currency -> 'field') is distinct from 'string'
       or currency ->> 'mode' is null or currency ->> 'mode' not in ('pool', 'track')
       or (currency ? 'max' and jsonb_typeof(currency -> 'max') <> 'null' and (
             jsonb_typeof(currency -> 'max') <> 'number'
             or (currency ->> 'max')::numeric <> trunc((currency ->> 'max')::numeric)
             or (currency ->> 'max')::numeric not between 0 and 1000))
       or (currency ? 'max_field' and jsonb_typeof(currency -> 'max_field') not in ('string', 'null')) then
      raise exception 'invalid meta currency declaration';
    end if;
    if (currency ->> 'id') = any(seen) then raise exception 'meta currency ids must be unique'; end if;
    seen := array_append(seen, currency ->> 'id');
    select field into referenced from jsonb_array_elements(p_schema -> 'fields') as fields(field)
     where field ->> 'id' = currency ->> 'field' limit 1;
    if referenced is null or referenced ->> 'kind' <> 'number' then
      raise exception 'meta currency % must reference a number field', currency ->> 'id';
    end if;
    if currency ->> 'max_field' is not null and not exists (
      select 1 from jsonb_array_elements(p_schema -> 'fields') as fields(field)
       where field ->> 'id' = currency ->> 'max_field' and field ->> 'kind' in ('number', 'formula')
    ) then
      raise exception 'meta currency % max_field must reference a number or formula field', currency ->> 'id';
    end if;
  end loop;
end;
$$;
revoke all on function private.validate_sheet_template_resources(jsonb) from public;
grant execute on function private.validate_sheet_template_resources(jsonb) to authenticated;

create or replace function private.validate_system_template_resources()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
begin
  perform private.validate_sheet_template_resources(new.schema);
  return new;
end;
$$;
revoke all on function private.validate_system_template_resources() from public;
create trigger system_templates_validate_resources
  before insert or update of schema on public.system_templates
  for each row execute function private.validate_system_template_resources();

create table public.character_sheet_events (
  id bigint generated always as identity primary key,
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('adjust', 'experience', 'meta_currency')),
  field_id text not null check (field_id ~ '^[a-z][a-z0-9_]{1,63}$'),
  currency_id text check (currency_id is null or currency_id ~ '^[a-z][a-z0-9_]{1,63}$'),
  delta integer not null check (delta <> 0 and abs(delta) <= 1000),
  value_before numeric not null,
  value_after numeric not null,
  sheet_version integer not null check (sheet_version > 0),
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
create index character_sheet_events_sheet_idx on public.character_sheet_events (sheet_id, id desc);
alter table public.character_sheet_events enable row level security;
revoke all on public.character_sheet_events from anon, authenticated;
grant select on public.character_sheet_events to authenticated;
-- Events are visible exactly when the sheet itself is visible through its RLS.
create policy "sheet readers read sheet events"
  on public.character_sheet_events for select to authenticated
  using (exists (select 1 from public.character_sheets sheet where sheet.id = sheet_id));

-- Only callable inside the transaction that just wrote the sheet (the sheet
-- trigger stamps updated_at with now(), fixed per transaction), and at most
-- once per sheet version, so a write cannot be logged twice.
create or replace function private.record_sheet_event(
  p_sheet_id uuid, p_kind text, p_field_id text, p_currency_id text,
  p_delta integer, p_before numeric, p_after numeric, p_reason text
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
  if not found or auth.uid() is null or exists (
    select 1 from public.character_sheet_events existing
     where existing.sheet_id = p_sheet_id and existing.sheet_version = sheet.version
  ) then
    raise exception 'events can only be recorded with a sheet write' using errcode = '42501';
  end if;
  insert into public.character_sheet_events
    (sheet_id, campaign_id, actor_id, kind, field_id, currency_id, delta, value_before, value_after, sheet_version, reason)
  values
    (sheet.id, sheet.campaign_id, auth.uid(), p_kind, p_field_id, p_currency_id, p_delta, p_before, p_after, sheet.version, p_reason)
  returning * into result;
  return result;
end;
$$;
revoke all on function private.record_sheet_event(uuid, text, text, text, integer, numeric, numeric, text) from public;
grant execute on function private.record_sheet_event(uuid, text, text, text, integer, numeric, numeric, text) to authenticated;

-- Security invoker: the row lock and the update both go through the sheet RLS,
-- so only the owning player or a campaign manager can adjust a sheet.
create or replace function private.apply_sheet_number_delta(
  p_sheet_id uuid, p_field_id text, p_delta integer, p_min numeric, p_max numeric,
  p_kind text, p_currency_id text, p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  template_schema jsonb;
  before_value numeric;
  after_value numeric;
  event public.character_sheet_events;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000 then
    raise exception 'delta must be a nonzero integer between -1000 and 1000' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(p_reason) > 200 then
    raise exception 'reason must have at most 200 characters' using errcode = '22023';
  end if;
  select * into sheet from public.character_sheets where id = p_sheet_id for update;
  if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  select schema into template_schema from public.system_templates
   where id = sheet.template_id and campaign_id = sheet.campaign_id and status = 'approved';
  if not exists (
    select 1 from jsonb_array_elements(template_schema -> 'fields') as fields(field)
     where field ->> 'id' = p_field_id and field ->> 'kind' = 'number'
  ) then
    raise exception 'field % is not a number field of this sheet', p_field_id using errcode = '22023';
  end if;
  if sheet.values ? p_field_id and jsonb_typeof(sheet.values -> p_field_id) <> 'number' then
    raise exception 'field % does not hold a number', p_field_id using errcode = '22023';
  end if;
  before_value := coalesce((sheet.values ->> p_field_id)::numeric, 0);
  after_value := before_value + p_delta;
  if (p_min is not null and after_value < p_min) or (p_max is not null and after_value > p_max) then
    raise exception 'field % would leave its allowed range', p_field_id using errcode = '23514';
  end if;
  -- Transaction-local marker read by guard_managed_sheet_resources. PostgREST
  -- cannot call set_config, so only these RPCs can set it.
  perform set_config('rpg.atomic_adjustment', 'on', true);
  update public.character_sheets
     set values = jsonb_set(values, array[p_field_id], to_jsonb(after_value))
   where id = p_sheet_id
  returning * into sheet;
  perform set_config('rpg.atomic_adjustment', 'off', true);
  if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  event := private.record_sheet_event(p_sheet_id, p_kind, p_field_id, p_currency_id, p_delta, before_value, after_value, p_reason);
  return jsonb_build_object('sheet', to_jsonb(sheet), 'event', to_jsonb(event));
end;
$$;
revoke all on function private.apply_sheet_number_delta(uuid, text, integer, numeric, numeric, text, text, text) from public;
grant execute on function private.apply_sheet_number_delta(uuid, text, integer, numeric, numeric, text, text, text) to authenticated;

-- Direct writes (PATCH of the whole values object) may not raise XP or a pool
-- currency unless the writer manages the campaign; grants go through the RPCs,
-- which apply the master-only rules and log the event.
create or replace function private.guard_managed_sheet_resources()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  template_schema jsonb;
  guarded text[];
  field_id text;
begin
  if current_setting('rpg.atomic_adjustment', true) = 'on' or private.can_manage_campaign(new.campaign_id) then
    return new;
  end if;
  select schema into template_schema from public.system_templates where id = new.template_id;
  guarded := array(
    select currency ->> 'field'
      from jsonb_array_elements(coalesce(template_schema -> 'meta_currencies', '[]'::jsonb)) as currencies(currency)
     where currency ->> 'mode' = 'pool'
  );
  if template_schema ->> 'experience_field' is not null then
    guarded := array_append(guarded, template_schema ->> 'experience_field');
  end if;
  foreach field_id in array guarded loop
    if jsonb_typeof(new.values -> field_id) = 'number'
       and (new.values ->> field_id)::numeric > coalesce(
         case when jsonb_typeof(old.values -> field_id) = 'number' then (old.values ->> field_id)::numeric end, 0) then
      raise exception 'only the campaign master can raise %', field_id using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_managed_sheet_resources() from public;
create trigger character_sheets_guard_managed_resources
  before update of values on public.character_sheets
  for each row execute function private.guard_managed_sheet_resources();

create or replace function private.sheet_template_schema(p_sheet_id uuid, out campaign_id uuid, out template_schema jsonb)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select sheet.campaign_id, template.schema
    from public.character_sheets sheet
    join public.system_templates template on template.id = sheet.template_id and template.campaign_id = sheet.campaign_id
   where sheet.id = p_sheet_id;
$$;
revoke all on function private.sheet_template_schema(uuid) from public;
grant execute on function private.sheet_template_schema(uuid) to authenticated;

-- Generic delta for plain number fields. XP and meta-currency fields have
-- their own entry points so the master-only grant rules cannot be bypassed.
create or replace function public.adjust_sheet_number(p_sheet_id uuid, p_field_id text, p_delta integer, p_reason text default null)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  info record;
begin
  select * into info from private.sheet_template_schema(p_sheet_id);
  if info.campaign_id is null then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  if info.template_schema ->> 'experience_field' = p_field_id or exists (
    select 1 from jsonb_array_elements(coalesce(info.template_schema -> 'meta_currencies', '[]'::jsonb)) as currencies(currency)
     where currency ->> 'field' = p_field_id
  ) then
    raise exception 'field % is managed by increment_xp or spend_meta_currency', p_field_id using errcode = '22023';
  end if;
  return private.apply_sheet_number_delta(p_sheet_id, p_field_id, p_delta, null, null, 'adjust', null, p_reason);
end;
$$;
revoke all on function public.adjust_sheet_number(uuid, text, integer, text) from public, anon;
grant execute on function public.adjust_sheet_number(uuid, text, integer, text) to authenticated;

-- Positive amounts grant XP and require a campaign manager; the owner may
-- only spend (negative amounts). Available XP never goes below zero.
create or replace function public.increment_xp(p_sheet_id uuid, p_amount integer, p_reason text default null)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  info record;
  field_id text;
begin
  select * into info from private.sheet_template_schema(p_sheet_id);
  if info.campaign_id is null then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  field_id := info.template_schema ->> 'experience_field';
  if field_id is null then raise exception 'template has no experience field' using errcode = '22023'; end if;
  if p_amount > 0 and not private.can_manage_campaign(info.campaign_id) then
    raise exception 'only the campaign master can grant experience' using errcode = '42501';
  end if;
  return private.apply_sheet_number_delta(p_sheet_id, field_id, p_amount, 0, null, 'experience', null, p_reason);
end;
$$;
revoke all on function public.increment_xp(uuid, integer, text) from public, anon;
grant execute on function public.increment_xp(uuid, integer, text) to authenticated;

-- Positive amounts spend the currency, negative amounts recover it. Granting
-- a pool currency (Inspiration, Hope) requires a campaign manager; clearing a
-- damage track (Willpower recovery) is allowed to the owner.
create or replace function public.spend_meta_currency(p_sheet_id uuid, p_currency_id text, p_amount integer, p_reason text default null)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  info record;
  currency jsonb;
  delta integer;
begin
  select * into info from private.sheet_template_schema(p_sheet_id);
  if info.campaign_id is null then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  select value into currency
    from jsonb_array_elements(coalesce(info.template_schema -> 'meta_currencies', '[]'::jsonb))
   where value ->> 'id' = p_currency_id limit 1;
  if currency is null then raise exception 'unknown meta currency %', p_currency_id using errcode = '22023'; end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'amount must be a nonzero integer' using errcode = '22023';
  end if;
  delta := case when currency ->> 'mode' = 'track' then p_amount else -p_amount end;
  if currency ->> 'mode' = 'pool' and delta > 0 and not private.can_manage_campaign(info.campaign_id) then
    raise exception 'only the campaign master can grant %', currency ->> 'label' using errcode = '42501';
  end if;
  return private.apply_sheet_number_delta(
    p_sheet_id, currency ->> 'field', delta, 0,
    case when jsonb_typeof(currency -> 'max') = 'number' then (currency ->> 'max')::numeric end,
    'meta_currency', p_currency_id, p_reason
  );
end;
$$;
revoke all on function public.spend_meta_currency(uuid, text, integer, text) from public, anon;
grant execute on function public.spend_meta_currency(uuid, text, integer, text) to authenticated;

comment on table public.character_sheet_events is
  'Append-only log of atomic sheet adjustments (XP, meta currencies, numeric deltas). Written only by the adjustment RPCs.';
