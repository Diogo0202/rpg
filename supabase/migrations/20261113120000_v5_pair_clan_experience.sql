-- V2 starting pairs keep every clan Discipline at its clan XP cost.
-- Approved V1 flat grants and V3 priority pools retain their existing costs.
create or replace function private.quote_advance_for(
  p_schema jsonb, p_values jsonb, p_trait text, p_target integer, p_item_name text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_system text := p_schema ->> 'system_key';
  v_field jsonb;
  v_category text;
  v_rule public.experience_cost_rules;
  v_clan text := p_values ->> 'cla';
  v_from integer := 0;
  v_to integer := p_target;
  v_item text := nullif(btrim(coalesce(p_item_name, '')), '');
  v_items jsonb;
  v_before text;
  v_value text;
  v_index integer;
  v_parsed text[];
  v_max integer;
begin
  if v_system is null then raise exception 'template has no system_key' using errcode = '22023'; end if;
  if p_trait is null or p_trait !~ '^[a-z][a-z0-9_]{1,63}$' then raise exception 'invalid trait' using errcode = '22023'; end if;
  if p_target is null or p_target < 1 or p_target > 20 then raise exception 'invalid target level' using errcode = '22023'; end if;
  select entry.value into v_field from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) as entry(value)
   where entry.value ->> 'id' = p_trait limit 1;
  select trait.category into v_category from public.experience_trait_categories trait
   where trait.system_key = v_system and trait.field_id = p_trait;
  if v_field is null or v_category is null then
    raise exception 'trait % cannot be bought with experience in this system', p_trait using errcode = '22023';
  end if;

  if v_category = 'discipline' then
    if v_clan = 'Caitiff' then
      v_category := 'caitiff_discipline';
    elsif v_clan is not null and (
      exists (  -- V5: all disciplines declared by the clan, including unselected starting pairs
        select 1 from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb)) as rules(item),
                      jsonb_array_elements(coalesce(rules.item -> 'cases', '[]'::jsonb)) as cases(item)
         where rules.item ->> 'type' = 'select_grants' and rules.item ->> 'field' = 'cla'
           and cases.item ->> 'equals' = v_clan
           and (
             (jsonb_typeof(cases.item -> 'add') = 'object' and (cases.item -> 'add') ? p_trait)
             or exists (
               select 1
                 from jsonb_array_elements(coalesce(cases.item -> 'choices', '[]'::jsonb)) as choices(item),
                      jsonb_array_elements(coalesce(choices.item -> 'options', '[]'::jsonb)) as options(item)
                where jsonb_typeof(options.item -> 'add') = 'object'
                  and (options.item -> 'add') ? p_trait
             )
           ))
      or exists (  -- V3: pool de Disciplinas permitidas pelo clã
        select 1 from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb)) as rules(item),
                      jsonb_array_elements(coalesce(rules.item -> 'pools', '[]'::jsonb)) as pools(item)
         where rules.item ->> 'type' = 'priority_points' and pools.item -> 'allowed' ->> 'field' = 'cla'
           and jsonb_typeof(pools.item -> 'allowed' -> 'cases' -> v_clan) = 'array'
           and (pools.item -> 'allowed' -> 'cases' -> v_clan) ? p_trait)
    ) then
      v_category := 'clan_discipline';
    else
      v_category := 'out_of_clan_discipline';
    end if;
  end if;

  select * into v_rule from public.experience_cost_rules cost
   where cost.system_key = v_system and cost.category = v_category;
  if not found then raise exception 'no experience cost for %', v_category using errcode = '22023'; end if;

  if v_field ->> 'kind' = 'number' then
    if v_item is not null then raise exception 'number traits take no item name' using errcode = '22023'; end if;
    if p_values ? p_trait and jsonb_typeof(p_values -> p_trait) not in ('number', 'null') then
      raise exception 'trait does not hold a number' using errcode = '22023';
    end if;
    if jsonb_typeof(p_values -> p_trait) = 'number' then
      if (p_values ->> p_trait)::numeric <> trunc((p_values ->> p_trait)::numeric) then
        raise exception 'trait does not hold an integer' using errcode = '22023';
      end if;
      v_from := (p_values ->> p_trait)::numeric::integer;
    end if;
    v_max := least(20, coalesce(case when jsonb_typeof(v_field -> 'max') = 'number' then (v_field ->> 'max')::numeric::integer end, 10));
    if v_to <= v_from then raise exception 'target must exceed the current level' using errcode = '22023'; end if;
    if v_to - v_from > 5 then raise exception 'buy at most five levels at once' using errcode = '22023'; end if;
    if v_to > v_max then raise exception 'trait % would leave its limit', p_trait using errcode = '23514'; end if;
  elsif v_field ->> 'kind' = 'collection' and v_rule.basis in ('flat', 'level', 'per_dot') then
    if v_item is null or char_length(v_item) > 120 or v_item ~ '[[:cntrl:]]' then
      raise exception 'item name must have 1 to 120 characters' using errcode = '22023';
    end if;
    v_items := case when jsonb_typeof(p_values -> p_trait) = 'array' then p_values -> p_trait else '[]'::jsonb end;
    if v_rule.basis = 'per_dot' then
      -- Vantagem "Nome ••" ou "Nome 2": comprar mais pontos substitui o item.
      v_item := private.advance_item_base(v_item);
      if v_item is null then raise exception 'item name must have 1 to 120 characters' using errcode = '22023'; end if;
      select entry.value #>> '{}', (entry.ordinality - 1)::integer into v_before, v_index
        from jsonb_array_elements(v_items) with ordinality as entry(value, ordinality)
       where jsonb_typeof(entry.value) = 'string'
         and lower(private.advance_item_base(entry.value #>> '{}')) = lower(v_item)
       limit 1;
      if v_before is not null then
        v_parsed := regexp_match(v_before, '(•+|\d+)$');
        v_from := case when v_parsed is null then 0 when v_parsed[1] ~ '^\d+$' then v_parsed[1]::integer else char_length(v_parsed[1]) end;
      end if;
      if v_to <= v_from then raise exception 'target must exceed the current dots' using errcode = '22023'; end if;
      if v_to > 5 then raise exception 'advantage would leave its limit' using errcode = '23514'; end if;
      v_value := v_item || ' ' || repeat('•', v_to);
    else
      if exists (select 1 from jsonb_array_elements(v_items) as entry(value)
                  where jsonb_typeof(entry.value) = 'string' and lower(btrim(entry.value #>> '{}')) = lower(v_item)) then
        raise exception 'item already on the sheet' using errcode = '22023';
      end if;
      if v_rule.basis = 'flat' and v_to <> 1 then raise exception 'flat purchases use target level 1' using errcode = '22023'; end if;
      if v_rule.basis = 'level' and v_to > 5 then raise exception 'item level must be 1 to 5' using errcode = '22023'; end if;
      v_value := v_item;
    end if;
    if v_before is null and jsonb_typeof(v_field -> 'max_items') = 'number'
       and jsonb_array_length(v_items) >= (v_field ->> 'max_items')::integer then
      raise exception 'collection % is full', p_trait using errcode = '23514';
    end if;
  else
    raise exception 'trait % cannot be bought with experience', p_trait using errcode = '22023';
  end if;

  return jsonb_build_object(
    'system_key', v_system, 'trait', p_trait, 'category', v_category, 'label', v_rule.label,
    'basis', v_rule.basis, 'multiplier', v_rule.multiplier, 'new_cost', v_rule.new_cost,
    'from_level', v_from, 'to_level', v_to,
    'cost', private.advance_cost(v_rule.basis, v_rule.multiplier, v_rule.new_cost, v_from, v_to),
    'item_name', v_item, 'item_value', v_value, 'item_before', v_before, 'item_index', v_index,
    'needs_book_check', v_rule.needs_book_check
  );
end;
$$;
revoke all on function private.quote_advance_for(jsonb, jsonb, text, integer, text) from public;
grant execute on function private.quote_advance_for(jsonb, jsonb, text, integer, text) to authenticated;
