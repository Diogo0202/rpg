-- Numeric field limits and declarative creation rules (mirrors
-- backend/app/services/creation_rules.py). Writes that bypass the API, such as
-- PostgREST updates or mobile sync, obey the same arithmetic:
--   * fields[].min / fields[].max hold on every insert and update of values;
--   * schema.creation_rules hold when a sheet is created (later advancement
--     through XP may legitimately leave the creation distribution).

create or replace function private.validate_template_creation_rules(p_schema jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rule jsonb;
  field_definition jsonb;
  field_id text;
  seen text[] := array[]::text[];
begin
  for field_definition in select value from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) loop
    if (field_definition ? 'min' and jsonb_typeof(field_definition -> 'min') <> 'null')
       or (field_definition ? 'max' and jsonb_typeof(field_definition -> 'max') <> 'null') then
      if field_definition ->> 'kind' <> 'number'
         or (field_definition ? 'min' and jsonb_typeof(field_definition -> 'min') not in ('number', 'null'))
         or (field_definition ? 'max' and jsonb_typeof(field_definition -> 'max') not in ('number', 'null'))
         or (jsonb_typeof(field_definition -> 'min') = 'number' and jsonb_typeof(field_definition -> 'max') = 'number'
             and (field_definition ->> 'min')::numeric > (field_definition ->> 'max')::numeric) then
        raise exception 'invalid limits on field %', field_definition ->> 'id' using errcode = '22023';
      end if;
    end if;
  end loop;

  if not (p_schema ? 'creation_rules') or jsonb_typeof(p_schema -> 'creation_rules') = 'null' then return; end if;
  if jsonb_typeof(p_schema -> 'creation_rules') <> 'array' or jsonb_array_length(p_schema -> 'creation_rules') > 50 then
    raise exception 'creation_rules must be an array of at most 50 rules' using errcode = '22023';
  end if;
  for rule in select value from jsonb_array_elements(p_schema -> 'creation_rules') loop
    if jsonb_typeof(rule) <> 'object'
       or coalesce(rule ->> 'type', '') not in ('group_distribution', 'group_sum', 'points_budget')
       or coalesce(rule ->> 'id', '') !~ '^[a-z][a-z0-9_]{1,63}$'
       or jsonb_typeof(rule -> 'fields') <> 'array' or jsonb_array_length(rule -> 'fields') not between 1 and 100
       or (rule ->> 'type' = 'group_distribution' and (jsonb_typeof(rule -> 'options') <> 'array' or jsonb_array_length(rule -> 'options') not between 1 and 10))
       or (rule ->> 'type' = 'points_budget' and (jsonb_typeof(rule -> 'costs') <> 'object' or jsonb_typeof(rule -> 'budget') <> 'number')) then
      raise exception 'invalid creation rule %', rule ->> 'id' using errcode = '22023';
    end if;
    if rule ->> 'id' = any(seen) then raise exception 'creation rule ids must be unique' using errcode = '22023'; end if;
    seen := array_append(seen, rule ->> 'id');
    for field_id in select value from jsonb_array_elements_text(rule -> 'fields') loop
      if not exists (select 1 from jsonb_array_elements(p_schema -> 'fields') as fields(field)
                      where field ->> 'id' = field_id and field ->> 'kind' = 'number') then
        raise exception 'creation rule % references a non-number field %', rule ->> 'id', field_id using errcode = '22023';
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function private.validate_template_creation_rules(jsonb) from public;
grant execute on function private.validate_template_creation_rules(jsonb) to authenticated;

create or replace function private.validate_system_template_creation_rules()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
begin
  perform private.validate_template_creation_rules(new.schema);
  return new;
end;
$$;
revoke all on function private.validate_system_template_creation_rules() from public;
create trigger system_templates_validate_creation_rules
  before insert or update of schema on public.system_templates
  for each row execute function private.validate_system_template_creation_rules();

-- Violated rule ids for a set of values; empty when the sheet may be created.
create or replace function private.creation_rule_violations(p_schema jsonb, p_values jsonb)
returns text[]
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rule jsonb;
  option jsonb;
  numbers numeric[];
  actual numeric[];
  expected numeric[];
  matched boolean;
  listed integer;
  total numeric;
  spent numeric;
  violations text[] := array[]::text[];
begin
  for rule in select value from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb)) loop
    -- Missing fields count as 0, like the API; non-numbers violate the rule.
    if exists (select 1 from jsonb_array_elements_text(rule -> 'fields') as ids(id)
                where p_values ? ids.id and jsonb_typeof(p_values -> ids.id) <> 'number') then
      violations := array_append(violations, rule ->> 'id');
      continue;
    end if;
    numbers := array(select coalesce((p_values ->> ids.id)::numeric, 0) from jsonb_array_elements_text(rule -> 'fields') as ids(id));

    if rule ->> 'type' = 'group_distribution' then
      actual := array(select item from unnest(numbers) as item order by item);
      matched := false;
      for option in select value from jsonb_array_elements(rule -> 'options') loop
        select coalesce(sum(count::integer), 0) into listed from jsonb_each_text(option -> 'counts') as counts(value, count);
        if listed > cardinality(numbers) then continue; end if;
        expected := array(
          select item from (
            select counts.value::numeric as item
              from jsonb_each_text(option -> 'counts') as counts(value, count), generate_series(1, counts.count::integer)
            union all
            select coalesce((option ->> 'rest')::numeric, 0) from generate_series(1, cardinality(numbers) - listed)
          ) as expanded order by item);
        if expected = actual then matched := true; exit; end if;
      end loop;
      if not matched then violations := array_append(violations, rule ->> 'id'); end if;
    elsif rule ->> 'type' = 'group_sum' then
      select sum(item) into total from unnest(numbers) as item;
      if (jsonb_typeof(rule -> 'min') = 'number' and total < (rule ->> 'min')::numeric)
         or (jsonb_typeof(rule -> 'max') = 'number' and total > (rule ->> 'max')::numeric) then
        violations := array_append(violations, rule ->> 'id');
      end if;
    elsif rule ->> 'type' = 'points_budget' then
      if exists (select 1 from unnest(numbers) as item where item <> trunc(item) or not (rule -> 'costs') ? (item::bigint)::text) then
        violations := array_append(violations, rule ->> 'id');
        continue;
      end if;
      select sum((rule -> 'costs' ->> (item::bigint)::text)::numeric) into spent from unnest(numbers) as item;
      if spent > (rule ->> 'budget')::numeric
         or (coalesce((rule ->> 'exact')::boolean, true) and spent <> (rule ->> 'budget')::numeric) then
        violations := array_append(violations, rule ->> 'id');
      end if;
    end if;
  end loop;
  return violations;
end;
$$;
revoke all on function private.creation_rule_violations(jsonb, jsonb) from public;
grant execute on function private.creation_rule_violations(jsonb, jsonb) to authenticated;

create or replace function private.validate_sheet_rules()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  template_schema jsonb;
  field_definition jsonb;
  field_value jsonb;
  violations text[];
begin
  select schema into template_schema from public.system_templates
   where id = new.template_id and campaign_id = new.campaign_id;
  if template_schema is null then return new; end if;  -- the existing value triggers reject this case

  for field_definition in select value from jsonb_array_elements(coalesce(template_schema -> 'fields', '[]'::jsonb)) loop
    field_value := new.values -> (field_definition ->> 'id');
    if field_definition ->> 'kind' = 'number' and jsonb_typeof(field_value) = 'number' then
      if (jsonb_typeof(field_definition -> 'min') = 'number' and (field_value #>> '{}')::numeric < (field_definition ->> 'min')::numeric)
         or (jsonb_typeof(field_definition -> 'max') = 'number' and (field_value #>> '{}')::numeric > (field_definition ->> 'max')::numeric) then
        raise exception 'field % is outside its limits', field_definition ->> 'id' using errcode = '23514';
      end if;
    end if;
  end loop;

  -- Restoring a backup re-creates a sheet that may already have advanced past
  -- its creation distribution; restore_character_backup sets this marker. A
  -- backup is a client-supplied file, so only a campaign manager may skip the rules.
  if tg_op = 'INSERT' and not (current_setting('rpg.restoring_backup', true) = 'on'
                               and private.can_manage_campaign(new.campaign_id)) then
    violations := private.creation_rule_violations(template_schema, new.values);
    if cardinality(violations) > 0 then
      raise exception 'creation rules violated: %', array_to_string(violations, ', ') using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_sheet_rules() from public;
create trigger character_sheets_validate_rules
  before insert or update of values on public.character_sheets
  for each row execute function private.validate_sheet_rules();

-- Restores keep the field limits but skip creation rules (see validate_sheet_rules).
-- Restoration delegates required and dependency checks to the same sheet triggers.
create or replace function public.restore_character_backup(p_campaign_id uuid,p_template_id uuid,p_backup jsonb)
returns public.character_sheets
language plpgsql security invoker set search_path=pg_catalog,public,auth as $$
declare template_schema jsonb; result public.character_sheets; inventory jsonb; item jsonb;
begin
  if auth.uid() is null then raise exception 'session required' using errcode='42501'; end if;
  if p_backup is null or jsonb_typeof(p_backup)<>'object' or octet_length(p_backup::text)>1048576
    or p_backup->>'format' is distinct from 'rpg-nexus-sheet'
    or p_backup->>'format_version' is distinct from '1'
    or jsonb_typeof(p_backup->'name') is distinct from 'string'
    or jsonb_typeof(p_backup->'values') is distinct from 'object'
    or jsonb_typeof(p_backup->'effects') is distinct from 'array' then
    raise exception 'invalid backup format';
  end if;
  select schema into template_schema from public.system_templates
    where id=p_template_id and campaign_id=p_campaign_id and status='approved';
  if not found or jsonb_typeof(template_schema->'fields') is distinct from 'array'
    or jsonb_typeof(p_backup->'template'->'fields') is distinct from 'array'
    or public.normalize_sheet_backup_fields(template_schema->'fields')
      is distinct from public.normalize_sheet_backup_fields(p_backup->'template'->'fields') then
    raise exception 'an identical approved campaign template is required';
  end if;
  inventory:=coalesce(p_backup->'inventory','[]'::jsonb);
  if jsonb_typeof(inventory)<>'array' or jsonb_array_length(inventory)>500 then raise exception 'invalid inventory'; end if;
  perform set_config('rpg.restoring_backup','on',true);
  insert into public.character_sheets(campaign_id,template_id,owner_id,name,values,effects)
    values(p_campaign_id,p_template_id,auth.uid(),p_backup->>'name',p_backup->'values',p_backup->'effects') returning * into result;
  perform set_config('rpg.restoring_backup','off',true);
  for item in select value from jsonb_array_elements(inventory) loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'name') is distinct from 'string'
      or jsonb_typeof(item->'notes') is distinct from 'string'
      or jsonb_typeof(item->'acquired') is distinct from 'boolean'
      or jsonb_typeof(item->'equipped') is distinct from 'boolean' then raise exception 'invalid inventory item'; end if;
    insert into public.character_inventory(sheet_id,campaign_id,name,category,quantity,resource_cost,damage_bonus,protection,notes,acquired,equipped,sort_order)
      values(result.id,p_campaign_id,item->>'name',item->>'category',(item->>'quantity')::integer,(item->>'resource_cost')::integer,
        (item->>'damage_bonus')::integer,(item->>'protection')::integer,item->>'notes',(item->>'acquired')::boolean,(item->>'equipped')::boolean,(item->>'sort_order')::integer);
  end loop;
  return result;
end;
$$;
revoke all on function public.restore_character_backup(uuid,uuid,jsonb) from public,anon;
grant execute on function public.restore_character_backup(uuid,uuid,jsonb) to authenticated;
