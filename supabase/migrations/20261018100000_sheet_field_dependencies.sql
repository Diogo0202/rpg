-- Declarative select dependencies are evaluated on every direct sheet write.
-- Dependencies are mechanical, so backup equivalence must compare them while
-- continuing to ignore only guided-creation presentation metadata.
create or replace function public.normalize_sheet_backup_fields(p_fields jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(p_fields) is distinct from 'array' then null
    else coalesce((
      select jsonb_agg(
        case when jsonb_typeof(field.value) = 'object'
          then field.value - array['creation_step', 'identity_kind', 'character_name']::text[]
          else field.value
        end
        order by field.ordinality
      )
      from jsonb_array_elements(p_fields) with ordinality as field(value, ordinality)
    ), '[]'::jsonb)
  end;
$$;
revoke all on function public.normalize_sheet_backup_fields(jsonb) from public, anon;
grant execute on function public.normalize_sheet_backup_fields(jsonb) to authenticated;

create or replace function private.validate_sheet_template_dependencies(p_schema jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  field_definition jsonb;
  dependency jsonb;
  controller_id text;
  controller jsonb;
  option_case jsonb;
  case_value text;
  option_value jsonb;
  seen_cases text[];
  seen_options text[];
  field_count integer;
  key_count integer;
begin
  if jsonb_typeof(p_schema -> 'fields') is distinct from 'array' then
    raise exception 'template schema must contain a fields array';
  end if;
  select count(*) into field_count from jsonb_array_elements(p_schema -> 'fields');
  if field_count > 200 or (
    select count(distinct field ->> 'id') from jsonb_array_elements(p_schema -> 'fields') as fields(field)
  ) <> field_count then
    raise exception 'template fields must have unique ids and at most 200 fields';
  end if;

  for field_definition in select field from jsonb_array_elements(p_schema -> 'fields') as fields(field)
  loop
    dependency := field_definition -> 'depends_on';
    if dependency is null or jsonb_typeof(dependency) = 'null' then
      continue;
    end if;
    if jsonb_typeof(dependency) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(dependency)) <> 2
       or not (dependency ? 'field_id' and dependency ? 'cases')
       or field_definition ->> 'kind' <> 'select'
       or field_definition -> 'options' is distinct from '[]'::jsonb
       or jsonb_typeof(dependency -> 'field_id') is distinct from 'string'
       or (dependency ->> 'field_id') !~ '^[a-z][a-z0-9_]{1,63}$'
       or jsonb_typeof(dependency -> 'cases') is distinct from 'array'
       or jsonb_array_length(dependency -> 'cases') < 1
       or jsonb_array_length(dependency -> 'cases') > 100 then
      raise exception 'invalid dependency declaration for field %', field_definition ->> 'id';
    end if;

    controller_id := dependency ->> 'field_id';
    if controller_id = field_definition ->> 'id' then
      raise exception 'a field cannot depend on itself: %', controller_id;
    end if;
    select field into controller
      from jsonb_array_elements(p_schema -> 'fields') as fields(field)
     where field ->> 'id' = controller_id
     limit 1;
    if controller is null or controller ->> 'kind' <> 'select' then
      raise exception 'dependency controller must be an existing select field: %', controller_id;
    end if;

    seen_cases := array[]::text[];
    for option_case in select value from jsonb_array_elements(dependency -> 'cases')
    loop
      if jsonb_typeof(option_case) is distinct from 'object'
         or (select count(*) from jsonb_object_keys(option_case)) <> 2
         or not (option_case ? 'equals' and option_case ? 'options')
         or jsonb_typeof(option_case -> 'equals') is distinct from 'string'
         or char_length(option_case ->> 'equals') not between 1 and 160
         or jsonb_typeof(option_case -> 'options') is distinct from 'array'
         or jsonb_array_length(option_case -> 'options') < 1
         or jsonb_array_length(option_case -> 'options') > 100 then
        raise exception 'invalid dependency case for field %', field_definition ->> 'id';
      end if;
      case_value := option_case ->> 'equals';
      if controller -> 'depends_on' is null or jsonb_typeof(controller -> 'depends_on') = 'null' then
        if not (coalesce(controller -> 'options', '[]'::jsonb) @> jsonb_build_array(to_jsonb(case_value))) then
          raise exception 'dependency case value is not an option of controller %', controller_id;
        end if;
      elsif not exists (
        select 1
          from jsonb_array_elements(controller -> 'depends_on' -> 'cases') as parent_cases(value)
          cross join jsonb_array_elements(parent_cases.value -> 'options') as parent_options(value)
         where parent_options.value = to_jsonb(case_value)
      ) then
        raise exception 'dependency case value is not a possible option of controller %', controller_id;
      end if;
      if case_value = any(seen_cases) then
        raise exception 'dependency case values must be unique for field %', field_definition ->> 'id';
      end if;
      seen_cases := array_append(seen_cases, case_value);
      seen_options := array[]::text[];
      for option_value in select value from jsonb_array_elements(option_case -> 'options')
      loop
        if jsonb_typeof(option_value) is distinct from 'string'
           or char_length(option_value #>> '{}') not between 1 and 160
           or (option_value #>> '{}') = any(seen_options) then
          raise exception 'dependency options must be unique nonempty strings of at most 160 characters';
        end if;
        seen_options := array_append(seen_options, option_value #>> '{}');
      end loop;
    end loop;
  end loop;

  if exists (
    with recursive dependency_walk(start_id, current_id, path, has_cycle) as (
      select field ->> 'id', field ->> 'id', array[field ->> 'id'], false
        from jsonb_array_elements(p_schema -> 'fields') as fields(field)
      union all
      select walk.start_id, parent.field_id, walk.path || parent.field_id,
             parent.field_id = any(walk.path)
        from dependency_walk walk
        join jsonb_array_elements(p_schema -> 'fields') as fields(field)
          on field ->> 'id' = walk.current_id
        cross join lateral jsonb_to_record(field -> 'depends_on') as parent(field_id text, cases jsonb)
       where jsonb_typeof(field -> 'depends_on') = 'object'
         and not walk.has_cycle
         and cardinality(walk.path) <= field_count
    )
    select 1 from dependency_walk where has_cycle
  ) then
    raise exception 'circular field dependencies are not allowed';
  end if;
end;
$$;
revoke all on function private.validate_sheet_template_dependencies(jsonb) from public;
grant execute on function private.validate_sheet_template_dependencies(jsonb) to authenticated;

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
  active_case boolean;
  depth integer := 0;
begin
  loop
    depth := depth + 1;
    if depth > 200 then raise exception 'field dependency depth limit exceeded'; end if;
    select field into current_field
      from jsonb_array_elements(p_schema -> 'fields') as fields(field)
     where field ->> 'id' = current_id
     limit 1;
    if current_field is null then return false; end if;
    dependency := current_field -> 'depends_on';
    if dependency is null or jsonb_typeof(dependency) = 'null' then return true; end if;
    controller_id := dependency ->> 'field_id';
    if not (p_values ? controller_id)
       or jsonb_typeof(p_values -> controller_id) is distinct from 'string' then
      return false;
    end if;
    selected_value := p_values ->> controller_id;
    select exists (
      select 1 from jsonb_array_elements(dependency -> 'cases') as cases(value)
       where value ->> 'equals' = selected_value
    ) into active_case;
    if not active_case then return false; end if;
    current_id := controller_id;
  end loop;
end;
$$;
revoke all on function private.sheet_creation_field_active(jsonb,jsonb,text) from public;
grant execute on function private.sheet_creation_field_active(jsonb,jsonb,text) to authenticated;

-- Versioning and campaign-membership checks remain in the original trigger.
create or replace function private.validate_character_sheet_values()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  template_schema jsonb;
  template_status public.extraction_status;
  campaign_owner_id uuid;
  field_definition jsonb;
  field_id text;
  field_kind text;
  field_value jsonb;
begin
  select schema, status into template_schema, template_status
    from public.system_templates
   where id = new.template_id and campaign_id = new.campaign_id;
  if not found then raise exception 'template must belong to the character sheet campaign'; end if;
  select owner_id into campaign_owner_id from public.campaigns where id = new.campaign_id;
  if campaign_owner_id is null or (
    new.owner_id <> campaign_owner_id and not exists (
      select 1 from public.campaign_members member
       where member.campaign_id = new.campaign_id and member.user_id = new.owner_id
    )
  ) then raise exception 'sheet owner must be a member of its campaign'; end if;
  if template_status <> 'approved' then raise exception 'character sheets require an approved template'; end if;
  perform private.validate_sheet_template_dependencies(template_schema);

  for field_definition in select field from jsonb_array_elements(template_schema -> 'fields') as fields(field)
  loop
    field_id := field_definition ->> 'id';
    if private.sheet_creation_field_active(template_schema, new.values, field_id)
       and field_definition ->> 'required' = 'true'
       and field_definition ->> 'kind' not in ('formula', 'roll') then
      if not (new.values ? field_id) then raise exception 'required field missing: %', field_id; end if;
      field_value := new.values -> field_id;
      if jsonb_typeof(field_value) = 'null'
         or (jsonb_typeof(field_value) = 'string' and btrim(field_value #>> '{}') = '')
         or (jsonb_typeof(field_value) = 'array' and field_value = '[]'::jsonb)
         or (field_definition ->> 'kind' = 'checkbox' and field_value <> 'true'::jsonb) then
        raise exception 'required field missing: %', field_id;
      end if;
    end if;
  end loop;

  for field_id, field_value in select key, value from jsonb_each(new.values)
  loop
    select field into field_definition
      from jsonb_array_elements(template_schema -> 'fields') as fields(field)
     where field ->> 'id' = field_id limit 1;
    if field_definition is null then raise exception 'unknown field id: %', field_id; end if;
    if not private.sheet_creation_field_active(template_schema, new.values, field_id) then
      raise exception 'inactive field cannot have a value: %', field_id;
    end if;
    field_kind := field_definition ->> 'kind';
    if field_kind = 'text' and jsonb_typeof(field_value) <> 'string' then
      raise exception 'field % must be text', field_id;
    elsif field_kind = 'number' and jsonb_typeof(field_value) <> 'number' then
      raise exception 'field % must be numeric', field_id;
    elsif field_kind = 'select' and jsonb_typeof(field_value) <> 'string' then
      raise exception 'field % must be text', field_id;
    elsif field_kind = 'checkbox' and jsonb_typeof(field_value) <> 'boolean' then
      raise exception 'field % must be boolean', field_id;
    elsif field_kind = 'collection' and jsonb_typeof(field_value) <> 'array' then
      raise exception 'field % must be an array', field_id;
    elsif field_kind in ('formula', 'roll') and field_value <> 'null'::jsonb then
      raise exception 'calculated field % cannot be persisted as an input', field_id;
    elsif field_kind not in ('text', 'number', 'select', 'checkbox', 'collection', 'formula', 'roll') then
      raise exception 'unsupported field kind for %', field_id;
    end if;
  end loop;

  if tg_op = 'UPDATE' then new.version := old.version + 1; else new.version := 1; end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.validate_character_sheet_values() from public;

-- This trigger enforces limits and the active option list for all PostgREST writes.
create or replace function private.validate_character_sheet_value_limits()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  template_schema jsonb;
  template_status public.extraction_status;
  field_definition jsonb;
  dependency jsonb;
  field_id text;
  field_kind text;
  field_value jsonb;
  options jsonb;
  collection_value jsonb;
begin
  if jsonb_typeof(new.values) is distinct from 'object' then raise exception 'sheet values must be an object'; end if;
  if (select count(*) from jsonb_object_keys(new.values)) > 200 or octet_length(new.values::text) > 32768 then
    raise exception 'sheet values exceed the storage limits';
  end if;
  select schema, status into template_schema, template_status
    from public.system_templates where id = new.template_id and campaign_id = new.campaign_id;
  if not found or template_status <> 'approved' then raise exception 'an approved campaign template is required'; end if;
  perform private.validate_sheet_template_dependencies(template_schema);

  for field_definition in select field from jsonb_array_elements(template_schema -> 'fields') as fields(field)
  loop
    field_id := field_definition ->> 'id';
    field_kind := field_definition ->> 'kind';
    if private.sheet_creation_field_active(template_schema, new.values, field_id)
       and field_definition ->> 'required' = 'true' and field_kind not in ('formula', 'roll') then
      if not (new.values ? field_id) then raise exception 'required field missing: %', field_id; end if;
      field_value := new.values -> field_id;
      if jsonb_typeof(field_value) = 'null'
         or (jsonb_typeof(field_value) = 'string' and (field_value #>> '{}') ~ '^[[:space:]]*$')
         or (jsonb_typeof(field_value) = 'array' and field_value = '[]'::jsonb)
         or (field_kind = 'checkbox' and field_value <> 'true'::jsonb) then
        raise exception 'required field missing: %', field_id;
      end if;
    end if;
  end loop;

  for field_id, field_value in select key, value from jsonb_each(new.values)
  loop
    select field into field_definition from jsonb_array_elements(template_schema -> 'fields') as fields(field)
     where field ->> 'id' = field_id limit 1;
    if field_definition is null then raise exception 'unknown field id: %', field_id; end if;
    if not private.sheet_creation_field_active(template_schema, new.values, field_id) then
      raise exception 'inactive field cannot have a value: %', field_id;
    end if;
    field_kind := field_definition ->> 'kind';
    if field_kind = 'text' then
      if jsonb_typeof(field_value) is distinct from 'string' or char_length(field_value #>> '{}') > 10000 then
        raise exception 'field % must be text of at most 10000 characters', field_id;
      end if;
    elsif field_kind = 'number' then
      if jsonb_typeof(field_value) is distinct from 'number' or abs((field_value #>> '{}')::numeric) > 1000000 then
        raise exception 'field % must be a finite number between -1000000 and 1000000', field_id;
      end if;
    elsif field_kind = 'select' then
      dependency := field_definition -> 'depends_on';
      if dependency is not null and jsonb_typeof(dependency) <> 'null' then
        select option_case -> 'options' into options
          from jsonb_array_elements(dependency -> 'cases') as cases(option_case)
         where option_case ->> 'equals' = new.values ->> (dependency ->> 'field_id') limit 1;
      else
        options := field_definition -> 'options';
      end if;
      if jsonb_typeof(options) is distinct from 'array' then raise exception 'field % has invalid options', field_id; end if;
      if jsonb_typeof(field_value) is distinct from 'string' or not (options @> jsonb_build_array(field_value)) then
        raise exception 'field % must match an active template option', field_id;
      end if;
    elsif field_kind = 'checkbox' then
      if jsonb_typeof(field_value) is distinct from 'boolean' then raise exception 'field % must be boolean', field_id; end if;
    elsif field_kind = 'collection' then
      if jsonb_typeof(field_value) is distinct from 'array' or jsonb_array_length(field_value) > 200 then
        raise exception 'field % must be an array of at most 200 strings', field_id;
      end if;
      for collection_value in select value from jsonb_array_elements(field_value)
      loop
        if jsonb_typeof(collection_value) is distinct from 'string' or char_length(collection_value #>> '{}') > 500 then
          raise exception 'field % contains an invalid collection value', field_id;
        end if;
      end loop;
    elsif field_kind in ('formula', 'roll') then
      if field_value <> 'null'::jsonb then raise exception 'calculated field % cannot be persisted as an input', field_id; end if;
    else
      raise exception 'unsupported field kind for %', field_id;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.validate_character_sheet_value_limits() from public;

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
  insert into public.character_sheets(campaign_id,template_id,owner_id,name,values,effects)
    values(p_campaign_id,p_template_id,auth.uid(),p_backup->>'name',p_backup->'values',p_backup->'effects') returning * into result;
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
