-- Creation-only choices and resource equality for priority templates.
create or replace function private.priority_choice_violations(p_schema jsonb, p_values jsonb)
returns text[]
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rule jsonb;
  pool jsonb;
  pair jsonb;
  group_row jsonb;
  field_id text;
  selected text;
  primary_field text;
  allowed jsonb;
  primary_rating numeric;
  highest_rating numeric;
  violations text[] := array[]::text[];
begin
  for rule in select value from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb))
               where value ->> 'type' = 'priority_points' loop
    for pair in select value from jsonb_array_elements(coalesce(rule -> 'initial_equal', '[]'::jsonb)) loop
      if (p_values -> (pair ->> 'field')) is distinct from (p_values -> (pair ->> 'source')) then
        violations := array_append(violations, rule ->> 'id');
      end if;
    end loop;
    for pool in select value from jsonb_array_elements(rule -> 'pools')
                where jsonb_typeof(value -> 'primary_choice') = 'object' loop
      selected := p_values ->> (pool -> 'primary_choice' ->> 'field');
      primary_field := pool -> 'primary_choice' -> 'options' ->> selected;
      allowed := pool -> 'allowed' -> 'cases' -> (p_values ->> (pool -> 'allowed' ->> 'field'));
      if primary_field is null or coalesce(jsonb_typeof(p_values -> primary_field), '') <> 'number'
         or not coalesce(allowed ? primary_field, false) then
        violations := array_append(violations, rule ->> 'id');
        continue;
      end if;
      primary_rating := (p_values ->> primary_field)::numeric;
      highest_rating := 0;
      for group_row in select value from jsonb_array_elements(pool -> 'groups') loop
        for field_id in select value from jsonb_array_elements_text(group_row -> 'fields') loop
          if jsonb_typeof(p_values -> field_id) = 'number' then
            highest_rating := greatest(highest_rating, (p_values ->> field_id)::numeric);
          end if;
        end loop;
      end loop;
      if primary_rating <= 0 or primary_rating < highest_rating then
        violations := array_append(violations, rule ->> 'id');
      end if;
    end loop;
  end loop;
  return violations;
end;
$$;
revoke all on function private.priority_choice_violations(jsonb, jsonb) from public;
grant execute on function private.priority_choice_violations(jsonb, jsonb) to authenticated;

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
      || private.collection_point_violations(p_schema, p_values)
      || private.collection_catalog_violations(p_schema, p_values)
      || private.select_range_violations(p_schema, p_values)
      || private.specialty_violations(p_schema, p_values)
      || private.priority_choice_violations(p_schema, p_values);
end;
$$;
revoke all on function private.creation_rule_violations(jsonb, jsonb) from public;
grant execute on function private.creation_rule_violations(jsonb, jsonb) to authenticated;
