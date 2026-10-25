-- Clan and predator packages (select_grants) and locked power lists
-- (power_picks), mirroring backend/app/services/creation_rules.py so writes that
-- bypass the API (PostgREST, mobile sync) cannot hand a new sheet off-clan
-- disciplines, free dots or powers outside the template's lists.
--   * select_grants: every listed number field equals the sum of each rule's
--     base plus the adds of the selected case and of the options chosen in its
--     choice fields; granted collection items must be present.
--   * power_picks: each "<source label>: <power>" item names a listed power at
--     or below the allowed level, and each source holds exactly its count.
-- Like the other creation rules these hold only when a sheet is created.

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
       or coalesce(rule ->> 'type', '') not in ('group_distribution', 'group_sum', 'points_budget', 'select_grants', 'power_picks')
       or coalesce(rule ->> 'id', '') !~ '^[a-z][a-z0-9_]{1,63}$'
       or jsonb_typeof(rule -> 'fields') <> 'array' or jsonb_array_length(rule -> 'fields') not between 1 and 100
       or (rule ->> 'type' = 'group_distribution' and (jsonb_typeof(rule -> 'options') <> 'array' or jsonb_array_length(rule -> 'options') not between 1 and 10))
       or (rule ->> 'type' = 'points_budget' and (jsonb_typeof(rule -> 'costs') <> 'object' or jsonb_typeof(rule -> 'budget') <> 'number'))
       or (rule ->> 'type' = 'select_grants' and (jsonb_typeof(rule -> 'field') <> 'string'
           or jsonb_typeof(rule -> 'cases') <> 'array' or jsonb_array_length(rule -> 'cases') not between 1 and 100))
       or (rule ->> 'type' = 'power_picks' and (jsonb_typeof(rule -> 'collection') <> 'string'
           or jsonb_typeof(rule -> 'sources') <> 'array' or jsonb_array_length(rule -> 'sources') not between 1 and 50)) then
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

-- Violated select_grants rule ids; all such rules are summed together.
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

-- Violated power_picks rule ids.
create or replace function private.power_rule_violations(p_schema jsonb, p_values jsonb)
returns text[]
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rule jsonb;
  source jsonb;
  power jsonb;
  items jsonb;
  item text;
  dots numeric;
  allowed numeric;
  max_level numeric;
  counts jsonb;
  bad boolean;
  violations text[] := array[]::text[];
begin
  for rule in select value from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb))
               where value ->> 'type' = 'power_picks' loop
    items := coalesce(p_values -> (rule ->> 'collection'), '[]'::jsonb);
    bad := jsonb_typeof(items) <> 'array'
        or exists (select 1 from jsonb_array_elements(items) where jsonb_typeof(value) <> 'string')
        or (select count(*) from jsonb_array_elements_text(items)) <> (select count(distinct value) from jsonb_array_elements_text(items));
    counts := '{}'::jsonb;
    if not bad then
      for item in select value from jsonb_array_elements_text(items) loop
        select value into source from jsonb_array_elements(rule -> 'sources')
         where left(item, length(value ->> 'label') + 2) = (value ->> 'label') || ': ' limit 1;
        if source is null then bad := true; exit; end if;
        select value into power from jsonb_array_elements(source -> 'powers')
         where value ->> 'name' = substr(item, length(source ->> 'label') + 3) limit 1;
        dots := case when jsonb_typeof(p_values -> (source ->> 'field')) = 'number' then (p_values ->> (source ->> 'field'))::numeric else 0 end;
        max_level := case when coalesce(source ->> 'max_level', 'dots') = 'dots' then dots
                          when dots > 0 then (source ->> 'max_level')::numeric else 0 end;
        if power is null or (power ->> 'level')::numeric > max_level
           or (jsonb_typeof(power -> 'requires') = 'object'
               and coalesce(case when jsonb_typeof(p_values -> (power -> 'requires' ->> 'field')) = 'number'
                                 then (p_values ->> (power -> 'requires' ->> 'field'))::numeric end, 0)
                   < (power -> 'requires' ->> 'min')::numeric) then
          bad := true; exit;
        end if;
        counts := counts || jsonb_build_object(source ->> 'label', coalesce((counts ->> (source ->> 'label'))::numeric, 0) + 1);
      end loop;
    end if;
    if not bad then
      for source in select value from jsonb_array_elements(rule -> 'sources') loop
        dots := case when jsonb_typeof(p_values -> (source ->> 'field')) = 'number' then (p_values ->> (source ->> 'field'))::numeric else 0 end;
        allowed := case when coalesce(source ->> 'count', 'dots') = 'dots' then dots
                        when dots > 0 then (source ->> 'count')::numeric else 0 end;
        if coalesce((counts ->> (source ->> 'label'))::numeric, 0) <> allowed then bad := true; exit; end if;
      end loop;
    end if;
    if bad then violations := array_append(violations, rule ->> 'id'); end if;
  end loop;
  return violations;
end;
$$;
revoke all on function private.power_rule_violations(jsonb, jsonb) from public;
grant execute on function private.power_rule_violations(jsonb, jsonb) to authenticated;

-- Same body as 20261024100000_creation_rules.sql, plus the two checks above.
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
  for rule in select value from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb))
               where value ->> 'type' in ('group_distribution', 'group_sum', 'points_budget') loop
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
  return violations || private.grant_rule_violations(p_schema, p_values) || private.power_rule_violations(p_schema, p_values);
end;
$$;
revoke all on function private.creation_rule_violations(jsonb, jsonb) from public;
grant execute on function private.creation_rule_violations(jsonb, jsonb) to authenticated;
