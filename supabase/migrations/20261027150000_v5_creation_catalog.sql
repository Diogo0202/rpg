-- V5 creation checks still missing from the database mirror of
-- backend/app/services/creation_rules.py (names and numbers only, no book text):
--   * collection_points.catalog: each of the player's own items ("Nome ••",
--     "Nome: detalhe (2)") must name a catalog entry at one of its costs, unless
--     the template sets allow_homebrew. Granted items stay extra.
--   * select_ranges: while a select holds a value, number fields stay in a range
--     and other selects avoid listed values (thin-blooded only at 14th-16th
--     generation and never with the Blood Potency predator; other clans 10th-13th).
--   * specialty_picks: free "Habilidade (especialização)" items, one per required
--     skill with dots plus `free` more, all in skills with dots.
-- Like the other creation rules these hold only when a sheet is created.
-- Starts from 20261026180000_v5_creation_points.sql: its validator is kept, renamed,
-- and still checks every other rule type.

-- "Aliados: polícia ••", "Aliados (polícia) (2)" and "Aliados 2" -> "Aliados" (item_name in the API).
create or replace function private.creation_item_name(p_item text)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case when detail is not null then btrim(detail) else name end
    from (select name, substring(name from '^(.+?) *\([^()]*\)$') as detail
            from (select btrim(split_part(btrim(regexp_replace(
                    case when position('•' in p_item) > 0 then replace(p_item, '•', '')
                         else regexp_replace(p_item, '(?:^|[ (])[0-9]{1,2}\)? *$', '') end,
                    '\s+', ' ', 'g')), ':', 1)) as name) as stripped) as parsed
$$;
revoke all on function private.creation_item_name(text) from public;
grant execute on function private.creation_item_name(text) to authenticated;

-- Violated catalogs: an own item outside the catalog (without allow_homebrew) or at a cost the entry refuses.
-- Items without points are already refused by collection_point_violations.
create or replace function private.collection_catalog_violations(p_schema jsonb, p_values jsonb)
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
  item text;
  entry jsonb;
  violations text[] := array[]::text[];
begin
  for rule in select value from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb))
               where value ->> 'type' = 'collection_points' and jsonb_typeof(value -> 'catalog') = 'array'
                 and jsonb_array_length(value -> 'catalog') > 0 loop
    items := coalesce(p_values -> (rule ->> 'collection'), '[]'::jsonb);
    if jsonb_typeof(items) <> 'array' or exists (select 1 from jsonb_array_elements(items) where jsonb_typeof(value) <> 'string') then
      continue;
    end if;
    extra := private.granted_collection_items(p_schema, p_values, rule ->> 'collection');
    for item in select own.item from jsonb_array_elements_text(items) as own(item)
                 where not own.item = any(extra) and private.creation_item_points(own.item) > 0 loop
      select listed.value into entry from jsonb_array_elements(rule -> 'catalog') as listed(value)
       where lower(private.creation_item_name(listed.value ->> 'name')) = lower(private.creation_item_name(item)) limit 1;
      if (entry is null and not coalesce((rule ->> 'allow_homebrew')::boolean, false))
         or (entry is not null and not (entry -> 'costs') @> to_jsonb(private.creation_item_points(item))) then
        violations := array_append(violations, rule ->> 'id');
        exit;
      end if;
    end loop;
  end loop;
  return violations;
end;
$$;
revoke all on function private.collection_catalog_violations(jsonb, jsonb) from public;
grant execute on function private.collection_catalog_violations(jsonb, jsonb) to authenticated;

-- Violated select_ranges rule ids; missing numbers count as 0, like the API.
create or replace function private.select_range_violations(p_schema jsonb, p_values jsonb)
returns text[]
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rule jsonb;
  chosen jsonb;
  limits record;
  refused record;
  violations text[] := array[]::text[];
begin
  for rule in select value from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb))
               where value ->> 'type' = 'select_ranges' loop
    if coalesce(jsonb_typeof(p_values -> (rule ->> 'field')), '') <> 'string' or p_values ->> (rule ->> 'field') = '' then continue; end if;
    chosen := null;
    select value into chosen from jsonb_array_elements(coalesce(rule -> 'cases', '[]'::jsonb))
     where (value -> 'equals') ? (p_values ->> (rule ->> 'field')) limit 1;
    if chosen is null and jsonb_typeof(rule -> 'default') = 'object' then chosen := rule -> 'default'; end if;
    if chosen is null then continue; end if;
    for limits in select key, value from jsonb_each(coalesce(chosen -> 'ranges', '{}'::jsonb)) loop
      if (p_values ? limits.key and jsonb_typeof(p_values -> limits.key) <> 'number')
         or coalesce((p_values ->> limits.key)::numeric, 0) not between (limits.value ->> 'min')::numeric and (limits.value ->> 'max')::numeric then
        violations := array_append(violations, rule ->> 'id');
        exit;
      end if;
    end loop;
    if rule ->> 'id' = any(violations) then continue; end if;
    for refused in select key, value from jsonb_each(coalesce(chosen -> 'exclude', '{}'::jsonb)) loop
      if jsonb_typeof(p_values -> refused.key) = 'string' and refused.value ? (p_values ->> refused.key) then
        violations := array_append(violations, rule ->> 'id');
        exit;
      end if;
    end loop;
  end loop;
  return violations;
end;
$$;
revoke all on function private.select_range_violations(jsonb, jsonb) from public;
grant execute on function private.select_range_violations(jsonb, jsonb) to authenticated;

-- Violated specialty_picks rule ids.
create or replace function private.specialty_violations(p_schema jsonb, p_values jsonb)
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
  own text[];
  item text;
  skill jsonb;
  prefix text;
  picked text[] := array[]::text[];
  due text[];
  bad boolean;
  violations text[] := array[]::text[];
begin
  for rule in select value from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb))
               where value ->> 'type' = 'specialty_picks' loop
    items := coalesce(p_values -> (rule ->> 'collection'), '[]'::jsonb);
    if jsonb_typeof(items) <> 'array' or exists (select 1 from jsonb_array_elements(items) where jsonb_typeof(value) <> 'string') then
      violations := array_append(violations, rule ->> 'id');
      continue;
    end if;
    extra := private.granted_collection_items(p_schema, p_values, rule ->> 'collection');
    own := array(select listed.item from jsonb_array_elements_text(items) as listed(item) where not listed.item = any(extra));
    bad := (select count(distinct lower(btrim(entry))) from unnest(own) as entry) <> cardinality(own);
    picked := array[]::text[];
    if not bad then
      foreach item in array own loop
        skill := null;
        for skill in select value from jsonb_array_elements(rule -> 'skills') loop
          prefix := lower(skill ->> 'label') || ' (';
          exit when starts_with(lower(btrim(item)), prefix) and right(btrim(item), 1) = ')'
                and btrim(substr(btrim(item), length(prefix) + 1, length(btrim(item)) - length(prefix) - 1)) <> '';
          skill := null;
        end loop;
        if skill is null or jsonb_typeof(p_values -> (skill ->> 'field')) is distinct from 'number'
           or (p_values ->> (skill ->> 'field'))::numeric < 1 then
          bad := true;
          exit;
        end if;
        picked := array_append(picked, skill ->> 'field');
      end loop;
    end if;
    if not bad then
      due := array(select required.id from jsonb_array_elements_text(coalesce(rule -> 'required', '[]'::jsonb)) as required(id)
                    where jsonb_typeof(p_values -> required.id) = 'number' and (p_values ->> required.id)::numeric >= 1);
      bad := exists (select 1 from unnest(due) as needed(id) where not needed.id = any(picked))
          or cardinality(own) <> cardinality(due) + coalesce((rule ->> 'free')::integer, 1);
    end if;
    if bad then violations := array_append(violations, rule ->> 'id'); end if;
  end loop;
  return violations;
end;
$$;
revoke all on function private.specialty_violations(jsonb, jsonb) from public;
grant execute on function private.specialty_violations(jsonb, jsonb) to authenticated;

-- Shape of a select_ranges case or default.
create or replace function private.valid_range_case(p_schema jsonb, p_case jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select jsonb_typeof(p_case) = 'object'
     and (not p_case ? 'ranges' or (jsonb_typeof(p_case -> 'ranges') = 'object' and not exists (
           select 1 from jsonb_each(p_case -> 'ranges') as ranges(key, value)
            where jsonb_typeof(ranges.value) <> 'object' or jsonb_typeof(ranges.value -> 'min') <> 'number'
               or jsonb_typeof(ranges.value -> 'max') <> 'number' or (ranges.value ->> 'min')::numeric > (ranges.value ->> 'max')::numeric
               or not exists (select 1 from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) as fields(field)
                               where field ->> 'id' = ranges.key and field ->> 'kind' = 'number'))))
     and (not p_case ? 'exclude' or (jsonb_typeof(p_case -> 'exclude') = 'object' and not exists (
           select 1 from jsonb_each(p_case -> 'exclude') as excluded(key, value)
            where jsonb_typeof(excluded.value) <> 'array'
               or exists (select 1 from jsonb_array_elements(excluded.value) where jsonb_typeof(value) <> 'string')
               or not exists (select 1 from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) as fields(field)
                               where field ->> 'id' = excluded.key and field ->> 'kind' = 'select'))))
$$;
revoke all on function private.valid_range_case(jsonb, jsonb) from public;
grant execute on function private.valid_range_case(jsonb, jsonb) to authenticated;

-- The 20261026180000 validator stays for every other rule type; this entry point
-- checks the new rule types and catalogs, then hands the rest to it.
alter function private.validate_template_creation_rules(jsonb) rename to validate_template_creation_rules_points;

create or replace function private.validate_template_creation_rules(p_schema jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rule jsonb;
  field_kind text;
begin
  if coalesce(jsonb_typeof(p_schema -> 'creation_rules'), '') <> 'array' then
    perform private.validate_template_creation_rules_points(p_schema);
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
    if jsonb_typeof(rule) <> 'object' then continue; end if;
    if rule ->> 'type' in ('select_ranges', 'specialty_picks') then
      field_kind := (select field ->> 'kind' from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) as fields(field)
                      where field ->> 'id' = coalesce(rule ->> 'field', rule ->> 'collection') limit 1);
      if coalesce(rule ->> 'id', '') !~ '^[a-z][a-z0-9_]{1,63}$'
         or (rule ? 'fields' and (jsonb_typeof(rule -> 'fields') <> 'array' or jsonb_array_length(rule -> 'fields') > 0)) then
        raise exception 'invalid creation rule %', rule ->> 'id' using errcode = '22023';
      end if;
    end if;
    if rule ->> 'type' = 'select_ranges' then
      if jsonb_typeof(rule -> 'field') <> 'string' or field_kind is distinct from 'select'
         or (rule ? 'cases' and (jsonb_typeof(rule -> 'cases') <> 'array' or jsonb_array_length(rule -> 'cases') > 100))
         or exists (select 1 from jsonb_array_elements(coalesce(rule -> 'cases', '[]'::jsonb)) as cases(item)
                     where jsonb_typeof(cases.item -> 'equals') <> 'array' or jsonb_array_length(cases.item -> 'equals') not between 1 and 100
                        or exists (select 1 from jsonb_array_elements(cases.item -> 'equals') where jsonb_typeof(value) <> 'string')
                        or not private.valid_range_case(p_schema, cases.item))
         or (rule ? 'default' and jsonb_typeof(rule -> 'default') <> 'null' and not private.valid_range_case(p_schema, rule -> 'default')) then
        raise exception 'invalid select_ranges rule %', rule ->> 'id' using errcode = '22023';
      end if;
    elsif rule ->> 'type' = 'specialty_picks' then
      if jsonb_typeof(rule -> 'collection') <> 'string' or field_kind is distinct from 'collection'
         or jsonb_typeof(rule -> 'skills') <> 'array' or jsonb_array_length(rule -> 'skills') not between 1 and 100
         or exists (select 1 from jsonb_array_elements(rule -> 'skills') as skills(item)
                     where jsonb_typeof(skills.item -> 'label') <> 'string' or jsonb_typeof(skills.item -> 'field') <> 'string'
                        or not exists (select 1 from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) as fields(field)
                                        where field ->> 'id' = skills.item ->> 'field' and field ->> 'kind' = 'number'))
         or (rule ? 'required' and (jsonb_typeof(rule -> 'required') <> 'array' or exists (
               select 1 from jsonb_array_elements(rule -> 'required') as required(item)
                where jsonb_typeof(required.item) <> 'string'
                   or not exists (select 1 from jsonb_array_elements(rule -> 'skills') as skills(item) where skills.item -> 'field' = required.item))))
         or (rule ? 'free' and (jsonb_typeof(rule -> 'free') <> 'number' or (rule ->> 'free')::numeric not between 0 and 20
             or (rule ->> 'free')::numeric <> trunc((rule ->> 'free')::numeric))) then
        raise exception 'invalid specialty_picks rule %', rule ->> 'id' using errcode = '22023';
      end if;
    elsif rule ->> 'type' = 'collection_points' then
      if (rule ? 'allow_homebrew' and jsonb_typeof(rule -> 'allow_homebrew') not in ('boolean', 'null'))
         or (rule ? 'catalog' and jsonb_typeof(rule -> 'catalog') <> 'null' and (jsonb_typeof(rule -> 'catalog') <> 'array'
             or jsonb_array_length(rule -> 'catalog') > 200
             or exists (select 1 from jsonb_array_elements(rule -> 'catalog') as listed(entry)
                         where jsonb_typeof(listed.entry) <> 'object' or jsonb_typeof(listed.entry -> 'name') <> 'string'
                            or length(listed.entry ->> 'name') not between 1 and 80
                            or jsonb_typeof(listed.entry -> 'costs') <> 'array' or jsonb_array_length(listed.entry -> 'costs') not between 1 and 20
                            or exists (select 1 from jsonb_array_elements(listed.entry -> 'costs') as costs(cost)
                                        where jsonb_typeof(costs.cost) <> 'number' or (costs.cost #>> '{}')::numeric not between 1 and 20
                                           or (costs.cost #>> '{}')::numeric <> trunc((costs.cost #>> '{}')::numeric))))) then
        raise exception 'invalid catalog in rule %', rule ->> 'id' using errcode = '22023';
      end if;
    end if;
  end loop;
  perform private.validate_template_creation_rules_points(jsonb_set(p_schema, '{creation_rules}', coalesce((
    select jsonb_agg(listed.value order by listed.position)
      from jsonb_array_elements(p_schema -> 'creation_rules') with ordinality as listed(value, position)
     where not (jsonb_typeof(listed.value) = 'object' and listed.value ->> 'type' in ('select_ranges', 'specialty_picks'))), '[]'::jsonb)));
end;
$$;
revoke all on function private.validate_template_creation_rules(jsonb) from public;
grant execute on function private.validate_template_creation_rules(jsonb) to authenticated;
revoke all on function private.validate_template_creation_rules_points(jsonb) from public;
grant execute on function private.validate_template_creation_rules_points(jsonb) to authenticated;

-- Same entry point as 20261026180000_v5_creation_points.sql, plus the three checks above.
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
      || private.specialty_violations(p_schema, p_values);
end;
$$;
revoke all on function private.creation_rule_violations(jsonb, jsonb) from public;
grant execute on function private.creation_rule_violations(jsonb, jsonb) to authenticated;
