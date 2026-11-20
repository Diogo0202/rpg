-- V5 creation rules still missing from the database mirror of
-- backend/app/services/creation_rules.py:
--   * select_grants.base_by: a base that follows a number field in bands (Blood
--     Potency by generation); a value in no band violates the rule.
--   * collection_points: the points of a collection's own items ("••" or a
--     trailing number such as "(2)") plus listed number fields must equal (or not
--     exceed) `points`; items an active select_grants case grants are extra.
-- Like the other creation rules these hold only when a sheet is created.

-- Same body as 20261025130000_creation_grants.sql, plus base_by.
create or replace function private.grant_rule_violations(p_schema jsonb, p_values jsonb)
returns text[]
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rules jsonb := coalesce((select jsonb_agg(value) from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb))
                           where value ->> 'type' = 'select_grants'), '[]'::jsonb);
  rule jsonb;
  grant_case jsonb;
  choice jsonb;
  chosen jsonb;
  grant_item jsonb;
  band jsonb;
  added record;
  granted record;
  item text;
  field_id text;
  expected jsonb := '{}'::jsonb;
  violations text[] := array[]::text[];
begin
  for rule in select value from jsonb_array_elements(rules) loop
    for field_id in select value from jsonb_array_elements_text(rule -> 'fields') loop
      expected := expected || jsonb_build_object(field_id,
        coalesce((expected ->> field_id)::numeric, 0) + coalesce((rule -> 'base' ->> field_id)::numeric, 0));
    end loop;
    if jsonb_typeof(rule -> 'base_by') = 'object' then
      band := null;
      if jsonb_typeof(p_values -> (rule -> 'base_by' ->> 'field')) = 'number' then
        select bands.value into band from jsonb_array_elements(rule -> 'base_by' -> 'bands') with ordinality as bands(value, position)
         where (p_values ->> (rule -> 'base_by' ->> 'field'))::numeric between (bands.value ->> 'min')::numeric and (bands.value ->> 'max')::numeric
         order by bands.position limit 1;
      end if;
      if band is null then
        violations := array_append(violations, rule ->> 'id');
      else
        for added in select key, value from jsonb_each(coalesce(band -> 'add', '{}'::jsonb)) loop
          expected := expected || jsonb_build_object(added.key, coalesce((expected ->> added.key)::numeric, 0) + (added.value #>> '{}')::numeric);
        end loop;
      end if;
    end if;
  end loop;

  for rule in select value from jsonb_array_elements(rules) loop
    select value into grant_case from jsonb_array_elements(rule -> 'cases')
     where jsonb_typeof(p_values -> (rule ->> 'field')) = 'string' and value ->> 'equals' = p_values ->> (rule ->> 'field') limit 1;
    if grant_case is null then continue; end if;
    -- The case itself, then the option picked for each of its choices.
    for grant_item in
      select grant_case
      union all
      select option from jsonb_array_elements(coalesce(grant_case -> 'choices', '[]'::jsonb)) as choices(choice_row),
             lateral (select value as option from jsonb_array_elements(choice_row -> 'options')
                       where jsonb_typeof(p_values -> (choice_row ->> 'field')) = 'string'
                         and value ->> 'label' = p_values ->> (choice_row ->> 'field') limit 1) as picked
    loop
      -- coalesce: a missing controlling value must fail the requirement, not yield null.
      if jsonb_typeof(grant_item -> 'requires') = 'object' and not coalesce(
           jsonb_typeof(p_values -> (grant_item -> 'requires' ->> 'field')) = 'string'
           and (grant_item -> 'requires' -> 'in') ? (p_values ->> (grant_item -> 'requires' ->> 'field')), false)
      then
        if not rule ->> 'id' = any(violations) then violations := array_append(violations, rule ->> 'id'); end if;
        continue;
      end if;
      for added in select key, value from jsonb_each(coalesce(grant_item -> 'add', '{}'::jsonb)) loop
        expected := expected || jsonb_build_object(added.key, coalesce((expected ->> added.key)::numeric, 0) + (added.value #>> '{}')::numeric);
      end loop;
      for granted in select key, value from jsonb_each(coalesce(grant_item -> 'items', '{}'::jsonb)) loop
        for item in select value from jsonb_array_elements_text(granted.value) loop
          if coalesce(jsonb_typeof(p_values -> granted.key), '') <> 'array' or not (p_values -> granted.key) ? item then
            if not rule ->> 'id' = any(violations) then violations := array_append(violations, rule ->> 'id'); end if;
          end if;
        end loop;
      end loop;
    end loop;
    -- Every choice of the selected case needs an existing option.
    for choice in select value from jsonb_array_elements(coalesce(grant_case -> 'choices', '[]'::jsonb)) loop
      select value into chosen from jsonb_array_elements(choice -> 'options')
       where jsonb_typeof(p_values -> (choice ->> 'field')) = 'string' and value ->> 'label' = p_values ->> (choice ->> 'field') limit 1;
      if chosen is null and not rule ->> 'id' = any(violations) then violations := array_append(violations, rule ->> 'id'); end if;
    end loop;
  end loop;

  for rule in select value from jsonb_array_elements(rules) loop
    for field_id in select value from jsonb_array_elements_text(rule -> 'fields') loop
      if (p_values ? field_id and jsonb_typeof(p_values -> field_id) <> 'number')
         or coalesce((p_values ->> field_id)::numeric, 0) <> (expected ->> field_id)::numeric then
        if not rule ->> 'id' = any(violations) then violations := array_append(violations, rule ->> 'id'); end if;
      end if;
    end loop;
  end loop;
  return violations;
end;
$$;
revoke all on function private.grant_rule_violations(jsonb, jsonb) from public;
grant execute on function private.grant_rule_violations(jsonb, jsonb) to authenticated;

-- "Aliados ••" -> 2, "Aliados (2)" / "Aliados 2" -> 2, otherwise 0 (item_points in the API).
create or replace function private.creation_item_points(p_item text)
returns integer
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case when length(p_item) > length(replace(p_item, '•', '')) then length(p_item) - length(replace(p_item, '•', ''))
              else coalesce(substring(p_item from '(?:^|[ (])([0-9]{1,2})\)? *$')::integer, 0) end
$$;
revoke all on function private.creation_item_points(text) from public;
grant execute on function private.creation_item_points(text) to authenticated;

-- Items the selected select_grants cases and their allowed chosen options put in a collection.
create or replace function private.granted_collection_items(p_schema jsonb, p_values jsonb, p_collection text)
returns text[]
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rule jsonb;
  grant_case jsonb;
  grant_item jsonb;
  result text[] := array[]::text[];
begin
  for rule in select value from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb))
               where value ->> 'type' = 'select_grants' loop
    select value into grant_case from jsonb_array_elements(rule -> 'cases')
     where jsonb_typeof(p_values -> (rule ->> 'field')) = 'string' and value ->> 'equals' = p_values ->> (rule ->> 'field') limit 1;
    if grant_case is null then continue; end if;
    for grant_item in
      select grant_case
      union all
      select option from jsonb_array_elements(coalesce(grant_case -> 'choices', '[]'::jsonb)) as choices(choice_row),
             lateral (select value as option from jsonb_array_elements(choice_row -> 'options')
                       where jsonb_typeof(p_values -> (choice_row ->> 'field')) = 'string'
                         and value ->> 'label' = p_values ->> (choice_row ->> 'field') limit 1) as picked
    loop
      if jsonb_typeof(grant_item -> 'requires') = 'object' and not coalesce(
           jsonb_typeof(p_values -> (grant_item -> 'requires' ->> 'field')) = 'string'
           and (grant_item -> 'requires' -> 'in') ? (p_values ->> (grant_item -> 'requires' ->> 'field')), false) then
        continue;
      end if;
      if jsonb_typeof(grant_item -> 'items' -> p_collection) = 'array' then
        result := result || array(select jsonb_array_elements_text(grant_item -> 'items' -> p_collection));
      end if;
    end loop;
  end loop;
  return result;
end;
$$;
revoke all on function private.granted_collection_items(jsonb, jsonb, text) from public;
grant execute on function private.granted_collection_items(jsonb, jsonb, text) to authenticated;

-- Violated collection_points rule ids.
create or replace function private.collection_point_violations(p_schema jsonb, p_values jsonb)
returns text[]
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rule jsonb;
  items jsonb;
  extra text[];
  spent numeric;
  violations text[] := array[]::text[];
begin
  for rule in select value from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb))
               where value ->> 'type' = 'collection_points' loop
    items := coalesce(p_values -> (rule ->> 'collection'), '[]'::jsonb);
    if jsonb_typeof(items) <> 'array'
       or exists (select 1 from jsonb_array_elements(items) where jsonb_typeof(value) <> 'string')
       or exists (select 1 from jsonb_array_elements_text(coalesce(rule -> 'fields', '[]'::jsonb)) as ids(id)
                   where p_values ? ids.id and jsonb_typeof(p_values -> ids.id) <> 'number') then
      violations := array_append(violations, rule ->> 'id');
      continue;
    end if;
    extra := private.granted_collection_items(p_schema, p_values, rule ->> 'collection');
    if exists (select 1 from jsonb_array_elements_text(items) as own(item)
                where not own.item = any(extra) and private.creation_item_points(own.item) = 0) then
      violations := array_append(violations, rule ->> 'id');
      continue;
    end if;
    spent := coalesce((select sum(private.creation_item_points(own.item)) from jsonb_array_elements_text(items) as own(item)
                        where not own.item = any(extra)), 0)
           + coalesce((select sum(coalesce((p_values ->> ids.id)::numeric, 0))
                         from jsonb_array_elements_text(coalesce(rule -> 'fields', '[]'::jsonb)) as ids(id)), 0);
    if spent > (rule ->> 'points')::numeric
       or (coalesce((rule ->> 'exact')::boolean, true) and spent <> (rule ->> 'points')::numeric) then
      violations := array_append(violations, rule ->> 'id');
    end if;
  end loop;
  return violations;
end;
$$;
revoke all on function private.collection_point_violations(jsonb, jsonb) from public;
grant execute on function private.collection_point_violations(jsonb, jsonb) to authenticated;

-- The previous validator stays as the base for every other rule type; this entry
-- point checks collection_points and base_by, then hands the rest to it.
alter function private.validate_template_creation_rules(jsonb) rename to validate_template_creation_rules_base;

create or replace function private.validate_template_creation_rules(p_schema jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rule jsonb;
  band jsonb;
  field_id text;
begin
  if coalesce(jsonb_typeof(p_schema -> 'creation_rules'), '') <> 'array' then
    perform private.validate_template_creation_rules_base(p_schema);
    return;
  end if;
  if jsonb_array_length(p_schema -> 'creation_rules') > 50 then
    raise exception 'creation_rules must be an array of at most 50 rules' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_schema -> 'creation_rules'))
     <> (select count(distinct value ->> 'id') from jsonb_array_elements(p_schema -> 'creation_rules')) then
    raise exception 'creation rule ids must be unique' using errcode = '22023';
  end if;
  for rule in select value from jsonb_array_elements(p_schema -> 'creation_rules') loop
    if jsonb_typeof(rule) = 'object' and rule ->> 'type' = 'collection_points' then
      if coalesce(rule ->> 'id', '') !~ '^[a-z][a-z0-9_]{1,63}$'
         or jsonb_typeof(rule -> 'collection') <> 'string'
         or not exists (select 1 from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) as fields(field)
                         where field ->> 'id' = rule ->> 'collection' and field ->> 'kind' = 'collection')
         or (rule ? 'fields' and (jsonb_typeof(rule -> 'fields') <> 'array' or jsonb_array_length(rule -> 'fields') > 20))
         or jsonb_typeof(rule -> 'points') <> 'number' or (rule ->> 'points')::numeric not between 0 and 100
         or (rule ->> 'points')::numeric <> trunc((rule ->> 'points')::numeric)
         or (rule ? 'exact' and jsonb_typeof(rule -> 'exact') not in ('boolean', 'null')) then
        raise exception 'invalid creation rule %', rule ->> 'id' using errcode = '22023';
      end if;
      for field_id in select value from jsonb_array_elements_text(coalesce(rule -> 'fields', '[]'::jsonb)) loop
        if not exists (select 1 from jsonb_array_elements(p_schema -> 'fields') as fields(field)
                        where field ->> 'id' = field_id and field ->> 'kind' = 'number') then
          raise exception 'creation rule % references a non-number field %', rule ->> 'id', field_id using errcode = '22023';
        end if;
      end loop;
    elsif jsonb_typeof(rule) = 'object' and rule ->> 'type' = 'select_grants'
          and rule ? 'base_by' and jsonb_typeof(rule -> 'base_by') <> 'null' then
      if jsonb_typeof(rule -> 'base_by') <> 'object' or jsonb_typeof(rule -> 'base_by' -> 'field') <> 'string'
         or not exists (select 1 from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) as fields(field)
                         where field ->> 'id' = rule -> 'base_by' ->> 'field' and field ->> 'kind' = 'number')
         or jsonb_typeof(rule -> 'base_by' -> 'bands') <> 'array' or jsonb_array_length(rule -> 'base_by' -> 'bands') not between 1 and 20 then
        raise exception 'invalid base_by in rule %', rule ->> 'id' using errcode = '22023';
      end if;
      for band in select value from jsonb_array_elements(rule -> 'base_by' -> 'bands') loop
        if jsonb_typeof(band) <> 'object' or jsonb_typeof(band -> 'min') <> 'number' or jsonb_typeof(band -> 'max') <> 'number'
           or (band ->> 'min')::numeric > (band ->> 'max')::numeric
           or (band ? 'add' and jsonb_typeof(band -> 'add') <> 'object')
           or exists (select 1 from jsonb_each(coalesce(band -> 'add', '{}'::jsonb)) as adds(key, value)
                       where jsonb_typeof(adds.value) <> 'number' or not (rule -> 'fields') ? adds.key) then
          raise exception 'invalid base_by band in rule %', rule ->> 'id' using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;
  perform private.validate_template_creation_rules_base(jsonb_set(p_schema, '{creation_rules}', coalesce((
    select jsonb_agg(listed.value order by listed.position)
      from jsonb_array_elements(p_schema -> 'creation_rules') with ordinality as listed(value, position)
     where not (jsonb_typeof(listed.value) = 'object' and listed.value ->> 'type' = 'collection_points')), '[]'::jsonb)));
end;
$$;
revoke all on function private.validate_template_creation_rules(jsonb) from public;
grant execute on function private.validate_template_creation_rules(jsonb) to authenticated;
revoke all on function private.validate_template_creation_rules_base(jsonb) from public;
grant execute on function private.validate_template_creation_rules_base(jsonb) to authenticated;

-- Same entry point as 20261025140000_priority_points.sql, plus collection_points.
create or replace function private.creation_rule_violations(p_schema jsonb, p_values jsonb)
returns text[]
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
begin
  return private.creation_rule_violations_base(p_schema, p_values)
      || private.priority_point_violations(p_schema, p_values)
      || private.collection_point_violations(p_schema, p_values);
end;
$$;
revoke all on function private.creation_rule_violations(jsonb, jsonb) from public;
grant execute on function private.creation_rule_violations(jsonb, jsonb) to authenticated;
