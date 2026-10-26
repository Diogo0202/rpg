-- Add a bounded top-N numeric base to priority_points for initial Willpower.
create or replace function private.validate_template_creation_rules(p_schema jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rule jsonb;
  pool jsonb;
  pool_group jsonb;
  field_definition jsonb;
  field_id text;
  seen text[] := array[]::text[];
  pool_seen text[];
  pool_ids text[];
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
       or coalesce(rule ->> 'type', '') not in ('group_distribution', 'group_sum', 'points_budget', 'select_grants', 'power_picks', 'priority_points')
       or coalesce(rule ->> 'id', '') !~ '^[a-z][a-z0-9_]{1,63}$'
       or jsonb_typeof(rule -> 'fields') <> 'array' or jsonb_array_length(rule -> 'fields') not between 1 and 100
       or (rule ->> 'type' = 'group_distribution' and (jsonb_typeof(rule -> 'options') <> 'array' or jsonb_array_length(rule -> 'options') not between 1 and 10))
       or (rule ->> 'type' = 'points_budget' and (jsonb_typeof(rule -> 'costs') <> 'object' or jsonb_typeof(rule -> 'budget') <> 'number'))
       or (rule ->> 'type' = 'select_grants' and (jsonb_typeof(rule -> 'field') <> 'string'
           or jsonb_typeof(rule -> 'cases') <> 'array' or jsonb_array_length(rule -> 'cases') not between 1 and 100))
       or (rule ->> 'type' = 'power_picks' and (jsonb_typeof(rule -> 'collection') <> 'string'
           or jsonb_typeof(rule -> 'sources') <> 'array' or jsonb_array_length(rule -> 'sources') not between 1 and 50))
       or (rule ->> 'type' = 'priority_points' and (jsonb_typeof(rule -> 'freebies') <> 'number'
           or jsonb_typeof(rule -> 'pools') <> 'array' or jsonb_array_length(rule -> 'pools') not between 1 and 10)) then
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

    if rule ->> 'type' = 'priority_points' then
      pool_seen := array[]::text[];
      pool_ids := array[]::text[];
      for pool in select value from jsonb_array_elements(rule -> 'pools') loop
        if jsonb_typeof(pool) <> 'object'
           or coalesce(pool ->> 'id', '') !~ '^[a-z][a-z0-9_]{1,63}$' or pool ->> 'id' = any(pool_ids)
           or jsonb_typeof(pool -> 'cost') <> 'number' or (pool ->> 'cost')::numeric not between 0 and 100
           or (pool ? 'base' and jsonb_typeof(pool -> 'base') <> 'number')
           or jsonb_typeof(pool -> 'groups') <> 'array' or jsonb_array_length(pool -> 'groups') not between 1 and 4
           or jsonb_typeof(pool -> 'budgets') <> 'array' or jsonb_array_length(pool -> 'budgets') <> jsonb_array_length(pool -> 'groups')
           or exists (select 1 from jsonb_array_elements(pool -> 'budgets') as budget(value)
                       where jsonb_typeof(budget.value) <> 'number' or (budget.value #>> '{}')::numeric not between 0 and 1000)
           or (pool ? 'base_from' and (jsonb_typeof(pool -> 'base_from') <> 'array' or jsonb_array_length(pool -> 'base_from') > 10))
           or (pool ? 'base_from_highest' and (jsonb_typeof(pool -> 'base_from_highest') <> 'array' or jsonb_array_length(pool -> 'base_from_highest') > 10))
           or (pool ? 'highest_count' and (jsonb_typeof(pool -> 'highest_count') <> 'number'
               or (pool ->> 'highest_count')::numeric <> trunc((pool ->> 'highest_count')::numeric)
               or (pool ->> 'highest_count')::numeric not between 0 and 10))
           or coalesce((pool ->> 'highest_count')::integer, 0) > jsonb_array_length(coalesce(pool -> 'base_from_highest', '[]'::jsonb))
           or (pool ? 'base_from_highest' and coalesce((pool ->> 'highest_count')::integer, 0) = 0)
           or (pool ? 'allowed' and jsonb_typeof(pool -> 'allowed') <> 'null'
               and (jsonb_typeof(pool -> 'allowed') <> 'object' or jsonb_typeof(pool -> 'allowed' -> 'field') <> 'string'
                    or jsonb_typeof(pool -> 'allowed' -> 'cases') <> 'object')) then
          raise exception 'invalid priority pool in rule %', rule ->> 'id' using errcode = '22023';
        end if;
        pool_ids := array_append(pool_ids, pool ->> 'id');
        for pool_group in select value from jsonb_array_elements(pool -> 'groups') loop
          if jsonb_typeof(pool_group) <> 'object' or jsonb_typeof(pool_group -> 'fields') <> 'array'
             or jsonb_array_length(pool_group -> 'fields') not between 1 and 100 then
            raise exception 'invalid priority group in rule %', rule ->> 'id' using errcode = '22023';
          end if;
          for field_id in select value from jsonb_array_elements_text(pool_group -> 'fields') loop
            if field_id = any(pool_seen) then
              raise exception 'priority rule % lists field % twice', rule ->> 'id', field_id using errcode = '22023';
            end if;
            pool_seen := array_append(pool_seen, field_id);
          end loop;
        end loop;
        for field_id in select value from jsonb_array_elements_text(coalesce(pool -> 'base_from', '[]'::jsonb) || coalesce(pool -> 'base_from_highest', '[]'::jsonb)) loop
          if not (rule -> 'fields') ? field_id then
            raise exception 'priority rule % must list base field % in fields', rule ->> 'id', field_id using errcode = '22023';
          end if;
          if not exists (select 1 from jsonb_array_elements(p_schema -> 'fields') as fields(field)
                          where field ->> 'id' = field_id and field ->> 'kind' = 'number') then
            raise exception 'priority rule % bases on a non-number field %', rule ->> 'id', field_id using errcode = '22023';
          end if;
        end loop;
        if pool ? 'allowed' and jsonb_typeof(pool -> 'allowed') = 'object' then
          if not exists (select 1 from jsonb_array_elements(p_schema -> 'fields') as fields(field)
                          where field ->> 'id' = pool -> 'allowed' ->> 'field' and field ->> 'kind' = 'select') then
            raise exception 'priority rule % limits by a field that is not a select', rule ->> 'id' using errcode = '22023';
          end if;
        end if;
      end loop;
      -- Every pool field must also be in the rule's field list, which was checked to be numeric above.
      if exists (select 1 from unnest(pool_seen) as listed(id) where not (rule -> 'fields') ? listed.id) then
        raise exception 'priority rule % must list every pool field in fields', rule ->> 'id' using errcode = '22023';
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function private.validate_template_creation_rules(jsonb) from public;
grant execute on function private.validate_template_creation_rules(jsonb) to authenticated;

create or replace function private.priority_point_violations(p_schema jsonb, p_values jsonb)
returns text[]
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rule jsonb;
  pool jsonb;
  pool_group jsonb;
  field_id text;
  field_value numeric;
  base numeric;
  permitted jsonb;
  has_allowed boolean;
  selected text;
  group_spent numeric;
  spent numeric[];
  budgets numeric[];
  sorted_spent numeric[];
  sorted_budgets numeric[];
  bonus numeric;
  bad boolean;
  index integer;
  violations text[] := array[]::text[];
begin
  for rule in select value from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb))
               where value ->> 'type' = 'priority_points' loop
    bad := false;
    bonus := 0;
    -- Non-numbers violate the rule, like the other numeric rules; missing fields count as 0.
    if exists (select 1 from jsonb_array_elements_text(rule -> 'fields') as ids(id)
                where p_values ? ids.id and jsonb_typeof(p_values -> ids.id) <> 'number') then
      violations := array_append(violations, rule ->> 'id');
      continue;
    end if;
    for pool in select value from jsonb_array_elements(rule -> 'pools') loop
      base := coalesce((pool ->> 'base')::numeric, 0) + coalesce((
        select sum(coalesce((p_values ->> source.id)::numeric, 0))
          from jsonb_array_elements_text(coalesce(pool -> 'base_from', '[]'::jsonb)) as source(id)), 0) + coalesce((
        select sum(coalesce((p_values ->> source.id)::numeric, 0))
          from (select value as id from jsonb_array_elements_text(coalesce(pool -> 'base_from_highest', '[]'::jsonb))
                order by coalesce((p_values ->> value)::numeric, 0) desc
                limit coalesce((pool ->> 'highest_count')::integer, 0)) as source), 0);
      has_allowed := jsonb_typeof(pool -> 'allowed') = 'object';
      permitted := '[]'::jsonb;
      if has_allowed then
        selected := case when jsonb_typeof(p_values -> (pool -> 'allowed' ->> 'field')) = 'string'
                         then p_values ->> (pool -> 'allowed' ->> 'field') end;
        permitted := coalesce(case when selected is not null then pool -> 'allowed' -> 'cases' -> selected end, '[]'::jsonb);
      end if;
      spent := array[]::numeric[];
      for pool_group in select value from jsonb_array_elements(pool -> 'groups') loop
        group_spent := 0;
        for field_id in select value from jsonb_array_elements_text(pool_group -> 'fields') loop
          field_value := coalesce((p_values ->> field_id)::numeric, 0);
          if field_value <> trunc(field_value) or field_value < base
             or (has_allowed and not (permitted ? field_id) and field_value <> base) then
            bad := true;
          end if;
          group_spent := group_spent + (field_value - base);
        end loop;
        spent := array_append(spent, group_spent);
      end loop;
      budgets := array(select (budget.value #>> '{}')::numeric from jsonb_array_elements(pool -> 'budgets') as budget(value));
      bonus := bonus + ((select coalesce(sum(item), 0) from unnest(spent) as item)
                        - (select coalesce(sum(item), 0) from unnest(budgets) as item)) * (pool ->> 'cost')::numeric;
      sorted_spent := array(select item from unnest(spent) as item order by item desc);
      sorted_budgets := array(select item from unnest(budgets) as item order by item desc);
      for index in 1 .. cardinality(sorted_budgets) loop
        if sorted_spent[index] < sorted_budgets[index] then bad := true; end if;
      end loop;
    end loop;
    if coalesce((rule ->> 'exact')::boolean, true) then
      if bonus <> (rule ->> 'freebies')::numeric then bad := true; end if;
    elsif bonus > (rule ->> 'freebies')::numeric then
      bad := true;
    end if;
    if bad then violations := array_append(violations, rule ->> 'id'); end if;
  end loop;
  return violations;
end;
$$;
revoke all on function private.priority_point_violations(jsonb, jsonb) from public;
grant execute on function private.priority_point_violations(jsonb, jsonb) to authenticated;
