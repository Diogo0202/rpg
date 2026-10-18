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
  field_id text;
  field_kind text;
  field_value jsonb;
  collection_value jsonb;
begin
  if jsonb_typeof(new.values) is distinct from 'object' then
    raise exception 'sheet values must be an object';
  end if;
  if (select count(*) from jsonb_object_keys(new.values)) > 200
     or octet_length(new.values::text) > 32768 then
    raise exception 'sheet values exceed the storage limits';
  end if;

  select schema, status into template_schema, template_status
    from public.system_templates
   where id = new.template_id and campaign_id = new.campaign_id;
  if not found or template_status <> 'approved'
     or jsonb_typeof(template_schema -> 'fields') is distinct from 'array' then
    raise exception 'an approved campaign template is required';
  end if;

  for field_definition in
    select field from jsonb_array_elements(template_schema -> 'fields') as fields(field)
  loop
    field_id := field_definition ->> 'id';
    field_kind := field_definition ->> 'kind';
    if field_definition ->> 'required' = 'true'
       and field_kind not in ('formula', 'roll') then
      if not (new.values ? field_id) then
        raise exception 'required field missing: %', field_id;
      end if;
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
    select field into field_definition
      from jsonb_array_elements(template_schema -> 'fields') as fields(field)
     where field ->> 'id' = field_id
     limit 1;
    if field_definition is null then
      raise exception 'unknown field id: %', field_id;
    end if;
    field_kind := field_definition ->> 'kind';

    if field_kind = 'text' then
      if jsonb_typeof(field_value) is distinct from 'string' then
        raise exception 'field % must be text of at most 10000 characters', field_id;
      end if;
      if char_length(field_value #>> '{}') > 10000 then
        raise exception 'field % must be text of at most 10000 characters', field_id;
      end if;
    elsif field_kind = 'number' then
      if jsonb_typeof(field_value) is distinct from 'number' then
        raise exception 'field % must be a finite number between -1000000 and 1000000', field_id;
      end if;
      if abs((field_value #>> '{}')::numeric) > 1000000 then
        raise exception 'field % must be a finite number between -1000000 and 1000000', field_id;
      end if;
    elsif field_kind = 'select' then
      if jsonb_typeof(field_definition -> 'options') is distinct from 'array' then
        raise exception 'field % has invalid template options', field_id;
      end if;
      if jsonb_typeof(field_value) is distinct from 'string'
         or not ((field_definition -> 'options') @> jsonb_build_array(field_value)) then
        raise exception 'field % must match a template option', field_id;
      end if;
    elsif field_kind = 'checkbox' then
      if jsonb_typeof(field_value) is distinct from 'boolean' then
        raise exception 'field % must be boolean', field_id;
      end if;
    elsif field_kind = 'collection' then
      if jsonb_typeof(field_value) is distinct from 'array' then
        raise exception 'field % must be an array of at most 200 strings', field_id;
      end if;
      if jsonb_array_length(field_value) > 200 then
        raise exception 'field % must be an array of at most 200 strings', field_id;
      end if;
      for collection_value in select value from jsonb_array_elements(field_value)
      loop
        if jsonb_typeof(collection_value) is distinct from 'string'
           or char_length(collection_value #>> '{}') > 500 then
          raise exception 'field % contains an invalid collection value', field_id;
        end if;
      end loop;
    elsif field_kind in ('formula', 'roll') then
      if field_value <> 'null'::jsonb then
        raise exception 'calculated field % cannot be persisted as an input', field_id;
      end if;
    else
      raise exception 'unsupported field kind for %', field_id;
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function private.validate_character_sheet_value_limits() from public;
create trigger character_sheets_values_limits
  before insert or update of values, template_id, campaign_id on public.character_sheets
  for each row execute function private.validate_character_sheet_value_limits();
