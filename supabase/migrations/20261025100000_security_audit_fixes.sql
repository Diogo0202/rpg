-- Fixes from security audit run-1 (C:\Users\digme\security-audit-skill\rpg-github\run-1).
--   NV-1  sheet creation could start with XP or a pool currency the master never granted
--   NV-2  switching template_id escaped the XP/pool guard and the field limits
--   NV-10 private.apply_sheet_number_delta granted XP/pool without the master check
--   NV-5  portrait UPDATE/DELETE policies were not bound to campaign membership
--   NV-9  unbounded template schemas made every sheet write superlinear

-- NV-1, NV-2: the master-only rule now covers creation and template changes.
-- A non-manager creates a sheet with XP and pool currencies at zero (the master
-- grants them afterwards with increment_xp / spend_meta_currency) and may not
-- move an existing sheet to another template. Restoring a backup follows the
-- same rule; a manager can restore a sheet with its advanced values.
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
  previous numeric;
begin
  if current_setting('rpg.atomic_adjustment', true) = 'on' or private.can_manage_campaign(new.campaign_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.template_id is distinct from old.template_id then
    raise exception 'only the campaign master can change a sheet template' using errcode = '42501';
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
    previous := 0;
    if tg_op = 'UPDATE' and jsonb_typeof(old.values -> field_id) = 'number' then
      previous := (old.values ->> field_id)::numeric;
    end if;
    if jsonb_typeof(new.values -> field_id) = 'number' and (new.values ->> field_id)::numeric > previous then
      raise exception 'only the campaign master can raise %', field_id using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_managed_sheet_resources() from public;
drop trigger character_sheets_guard_managed_resources on public.character_sheets;
create trigger character_sheets_guard_managed_resources
  before insert or update of values, template_id on public.character_sheets
  for each row execute function private.guard_managed_sheet_resources();

-- A manager may still change the template; the new template's limits apply.
drop trigger character_sheets_validate_rules on public.character_sheets;
create trigger character_sheets_validate_rules
  before insert or update of values, template_id on public.character_sheets
  for each row execute function private.validate_sheet_rules();

-- NV-10: the helper checks the master-only rule itself instead of relying on
-- the public wrappers, so the guard bypass stays safe even if the private
-- schema is ever exposed through PostgREST.
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
  if p_delta > 0 and not private.can_manage_campaign(sheet.campaign_id) and (
    template_schema ->> 'experience_field' = p_field_id or exists (
      select 1 from jsonb_array_elements(coalesce(template_schema -> 'meta_currencies', '[]'::jsonb)) as currencies(currency)
       where currency ->> 'mode' = 'pool' and currency ->> 'field' = p_field_id
    )
  ) then
    raise exception 'only the campaign master can raise %', p_field_id using errcode = '42501';
  end if;
  if sheet.values ? p_field_id and jsonb_typeof(sheet.values -> p_field_id) <> 'number' then
    raise exception 'field % does not hold a number', p_field_id using errcode = '22023';
  end if;
  before_value := coalesce((sheet.values ->> p_field_id)::numeric, 0);
  after_value := before_value + p_delta;
  if (p_min is not null and after_value < p_min) or (p_max is not null and after_value > p_max) then
    raise exception 'field % would leave its allowed range', p_field_id using errcode = '23514';
  end if;
  -- Transaction-local marker read by guard_managed_sheet_resources.
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

-- NV-5: the client only uploads new portraits (upsert off) and never renames
-- or replaces them, so the UPDATE policy goes away. Deleting needs the uploader
-- to still be a player or manager of the campaign in the path.
drop policy "uploaders replace own portraits" on storage.objects;
drop policy "uploaders delete own portraits" on storage.objects;
create policy "uploaders delete own portraits" on storage.objects for delete to authenticated
  using (
    bucket_id = 'character-portraits'
    and (private.portrait_path_parts(name)).uploader_id = (select auth.uid())
    and (private.is_campaign_player((private.portrait_path_parts(name)).campaign_id)
         or private.can_manage_campaign((private.portrait_path_parts(name)).campaign_id))
  );

-- NV-9: bound the schema size, validate dependencies once when a template is
-- approved, and look fields up with a single jsonpath scan instead of
-- re-expanding the fields array at every dependency level.
alter table public.system_templates
  add constraint system_templates_schema_size check (octet_length(schema::text) <= 262144) not valid;

create or replace function private.validate_approved_template_dependencies()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
begin
  if new.status = 'approved' then
    perform private.validate_sheet_template_dependencies(new.schema);
  end if;
  return new;
end;
$$;
revoke all on function private.validate_approved_template_dependencies() from public;
create trigger system_templates_validate_dependencies
  before insert or update of schema, status on public.system_templates
  for each row execute function private.validate_approved_template_dependencies();

create or replace function private.sheet_creation_field_active(p_schema jsonb, p_values jsonb, p_field_id text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  current_id text := p_field_id;
  current_field jsonb;
  dependency jsonb;
  controller_id text;
  selected_value text;
  depth integer := 0;
begin
  loop
    depth := depth + 1;
    if depth > 200 then raise exception 'field dependency depth limit exceeded'; end if;
    current_field := jsonb_path_query_first(p_schema, '$.fields[*] ? (@.id == $id)', jsonb_build_object('id', current_id));
    if current_field is null then return false; end if;
    dependency := current_field -> 'depends_on';
    if dependency is null or jsonb_typeof(dependency) = 'null' then return true; end if;
    controller_id := dependency ->> 'field_id';
    if not (p_values ? controller_id)
       or jsonb_typeof(p_values -> controller_id) is distinct from 'string' then
      return false;
    end if;
    selected_value := p_values ->> controller_id;
    if not jsonb_path_exists(dependency, '$.cases[*] ? (@.equals == $value)', jsonb_build_object('value', selected_value)) then
      return false;
    end if;
    current_id := controller_id;
  end loop;
end;
$$;
revoke all on function private.sheet_creation_field_active(jsonb,jsonb,text) from public;
grant execute on function private.sheet_creation_field_active(jsonb,jsonb,text) to authenticated;
