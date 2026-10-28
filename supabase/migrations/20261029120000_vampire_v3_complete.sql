-- Vampiro: A Máscara Revisado (V3), frente F3. Names and numbers only, no book text; every number is
-- marked for checking in the book (same rules as backend/app/services/v3_vampire.py and
-- frontend/lib/v3-rules.ts).
--
-- Creation (mirror of backend/app/services/creation_rules.py):
--   * priority_points.freebie_items: points of the `spend` collections (Merits) cost freebies 1:1 and the
--     points of the `earn` collection (Flaws) add freebies up to `max` (7), so the exact rule accepts
--     15 + Flaws (at most 7) spent. Starts from 20261025170000_demon_highest_virtues.sql.
--   * specialty_picks.min_value: the rating a skill needs to owe or take a specialty (V3: 4).
--     Starts from 20261027150000_v5_creation_catalog.sql.
--   The template validator gains checks for both keys and hands the rest to the previous one.
--   private.creation_rule_violations keeps calling these functions by name, so later migrations that
--   redefine it (20261029150000_demon_initial_choices.sql) keep the V3 checks.
--
-- Play (atomic, one locked row per call, idempotent by operation id, audited in character_sheet_events,
-- pattern of 20261022100000_sheet_atomic_adjustments.sql and 20261025110000_sheet_adjust_idempotency.sql):
--   v3_spend_willpower, v3_spend_blood (limit per turn by generation), v3_heal (1 blood per bashing or
--   lethal level), v3_apply_damage (bashing halved for vampires), v3_set_initial_blood (1d10 or a value
--   the narrator sets), v3_frenzy_test (Frenesi with Autocontrole/Instintos, Rötschreck with Coragem) and
--   v3_degeneration_test (Consciência/Convicção; failure lowers the Path). Dice come from
--   gen_random_uuid() bytes, so the client cannot pick the result. Each test is kept in v3_sheet_tests.

-- ---------------------------------------------------------------------------------------------------
-- Creation rules
-- ---------------------------------------------------------------------------------------------------

-- Points of a collection's string items ("Nome ••", "Nome (2)").
create or replace function private.collection_item_points_total(p_values jsonb, p_collection text)
returns integer
language sql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
  select coalesce(sum(private.creation_item_points(items.item)), 0)::integer
    from jsonb_array_elements_text(case when jsonb_typeof(p_values -> p_collection) = 'array'
                                        then (select coalesce(jsonb_agg(value), '[]'::jsonb) from jsonb_array_elements(p_values -> p_collection)
                                               where jsonb_typeof(value) = 'string')
                                        else '[]'::jsonb end) as items(item)
$$;
revoke all on function private.collection_item_points_total(jsonb, text) from public;
grant execute on function private.collection_item_points_total(jsonb, text) to authenticated;

-- Same body as 20261025170000_demon_highest_virtues.sql, plus freebie_items.
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
  available numeric;
  bad boolean;
  index integer;
  violations text[] := array[]::text[];
begin
  for rule in select value from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb))
               where value ->> 'type' = 'priority_points' loop
    bad := false;
    bonus := 0;
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
    -- V3: Merits cost freebies; Flaws add them up to the cap.
    available := (rule ->> 'freebies')::numeric;
    if jsonb_typeof(rule -> 'freebie_items') = 'object' then
      bonus := bonus + coalesce((select sum(private.collection_item_points_total(p_values, spend.id))
                                   from jsonb_array_elements_text(coalesce(rule -> 'freebie_items' -> 'spend', '[]'::jsonb)) as spend(id)), 0);
      if jsonb_typeof(rule -> 'freebie_items' -> 'earn') = 'object' then
        available := available + least((rule -> 'freebie_items' -> 'earn' ->> 'max')::numeric,
          private.collection_item_points_total(p_values, rule -> 'freebie_items' -> 'earn' ->> 'collection'));
      end if;
    end if;
    if coalesce((rule ->> 'exact')::boolean, true) then
      if bonus <> available then bad := true; end if;
    elsif bonus > available then
      bad := true;
    end if;
    if bad then violations := array_append(violations, rule ->> 'id'); end if;
  end loop;
  return violations;
end;
$$;
revoke all on function private.priority_point_violations(jsonb, jsonb) from public;
grant execute on function private.priority_point_violations(jsonb, jsonb) to authenticated;

-- Same body as 20261027150000_v5_creation_catalog.sql, with min_value in place of 1.
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
  minimum numeric;
  picked text[] := array[]::text[];
  due text[];
  bad boolean;
  violations text[] := array[]::text[];
begin
  for rule in select value from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb))
               where value ->> 'type' = 'specialty_picks' loop
    minimum := coalesce((rule ->> 'min_value')::numeric, 1);
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
           or (p_values ->> (skill ->> 'field'))::numeric < minimum then
          bad := true;
          exit;
        end if;
        picked := array_append(picked, skill ->> 'field');
      end loop;
    end if;
    if not bad then
      due := array(select required.id from jsonb_array_elements_text(coalesce(rule -> 'required', '[]'::jsonb)) as required(id)
                    where jsonb_typeof(p_values -> required.id) = 'number' and (p_values ->> required.id)::numeric >= minimum);
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

-- The previous validator stays for everything else; this entry point checks the two new keys.
alter function private.validate_template_creation_rules(jsonb) rename to validate_template_creation_rules_pre_v3;

create or replace function private.validate_template_creation_rules(p_schema jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  rule jsonb;
  collection_id text;
begin
  if jsonb_typeof(p_schema -> 'creation_rules') = 'array' then
    for rule in select value from jsonb_array_elements(p_schema -> 'creation_rules') loop
      if jsonb_typeof(rule) <> 'object' then continue; end if;
      if rule ->> 'type' = 'specialty_picks' and rule ? 'min_value'
         and (jsonb_typeof(rule -> 'min_value') <> 'number' or (rule ->> 'min_value')::numeric not between 1 and 10
              or (rule ->> 'min_value')::numeric <> trunc((rule ->> 'min_value')::numeric)) then
        raise exception 'invalid specialty_picks rule %', rule ->> 'id' using errcode = '22023';
      end if;
      if rule ->> 'type' = 'priority_points' and rule ? 'freebie_items' and jsonb_typeof(rule -> 'freebie_items') <> 'null' then
        if jsonb_typeof(rule -> 'freebie_items') <> 'object'
           or exists (select 1 from jsonb_object_keys(rule -> 'freebie_items') as keys(key) where key not in ('spend', 'earn'))
           or (rule -> 'freebie_items' ? 'spend' and (jsonb_typeof(rule -> 'freebie_items' -> 'spend') <> 'array'
               or jsonb_array_length(rule -> 'freebie_items' -> 'spend') > 5
               or exists (select 1 from jsonb_array_elements(rule -> 'freebie_items' -> 'spend') where jsonb_typeof(value) <> 'string')))
           or (rule -> 'freebie_items' ? 'earn' and jsonb_typeof(rule -> 'freebie_items' -> 'earn') <> 'null'
               and (jsonb_typeof(rule -> 'freebie_items' -> 'earn') <> 'object'
                    or jsonb_typeof(rule -> 'freebie_items' -> 'earn' -> 'collection') <> 'string'
                    or jsonb_typeof(rule -> 'freebie_items' -> 'earn' -> 'max') <> 'number'
                    or (rule -> 'freebie_items' -> 'earn' ->> 'max')::numeric not between 0 and 100
                    or (rule -> 'freebie_items' -> 'earn' ->> 'max')::numeric <> trunc((rule -> 'freebie_items' -> 'earn' ->> 'max')::numeric))) then
          raise exception 'invalid freebie_items in rule %', rule ->> 'id' using errcode = '22023';
        end if;
        for collection_id in
          select value from jsonb_array_elements_text(coalesce(rule -> 'freebie_items' -> 'spend', '[]'::jsonb))
          union all
          select rule -> 'freebie_items' -> 'earn' ->> 'collection' where jsonb_typeof(rule -> 'freebie_items' -> 'earn') = 'object'
        loop
          if not exists (select 1 from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) as fields(field)
                          where field ->> 'id' = collection_id and field ->> 'kind' = 'collection') then
            raise exception 'priority rule % counts a field that is not a collection', rule ->> 'id' using errcode = '22023';
          end if;
        end loop;
      end if;
    end loop;
  end if;
  perform private.validate_template_creation_rules_pre_v3(p_schema);
end;
$$;
revoke all on function private.validate_template_creation_rules(jsonb) from public;
grant execute on function private.validate_template_creation_rules(jsonb) to authenticated;
revoke all on function private.validate_template_creation_rules_pre_v3(jsonb) from public;
grant execute on function private.validate_template_creation_rules_pre_v3(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Dice and derived numbers
-- ---------------------------------------------------------------------------------------------------

-- One d10 from the random bytes of gen_random_uuid() (bytes 0-5 are random in a v4 UUID); bytes of
-- 250 or more are rejected so every face has the same chance.
create or replace function private.v3_d10()
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  raw bytea;
  byte_index integer;
  byte_value integer;
begin
  loop
    raw := uuid_send(gen_random_uuid());
    for byte_index in 0 .. 5 loop
      byte_value := get_byte(raw, byte_index);
      if byte_value < 250 then return byte_value % 10 + 1; end if;
    end loop;
  end loop;
end;
$$;
revoke all on function private.v3_d10() from public;
grant execute on function private.v3_d10() to authenticated;

-- Reads a rolled pool: each die at or above the difficulty is a success, each 1 cancels one, and a
-- botch is no success at all with at least one 1 (same as v3_outcome in the API).
create or replace function private.v3_read_dice(p_dice integer[], p_difficulty integer)
returns jsonb
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'dice', to_jsonb(coalesce(p_dice, array[]::integer[])), 'difficulty', p_difficulty,
    'raw_successes', raw, 'ones', ones, 'successes', greatest(0, raw - ones),
    'botch', raw = 0 and ones > 0, 'success', raw - ones > 0)
    from (select count(*) filter (where die >= p_difficulty)::integer as raw,
                 count(*) filter (where die = 1)::integer as ones
            from unnest(coalesce(p_dice, array[]::integer[])) as dice(die)) as counted
$$;
revoke all on function private.v3_read_dice(integer[], integer) from public;
grant execute on function private.v3_read_dice(integer[], integer) to authenticated;

create or replace function private.v3_roll(p_pool integer, p_difficulty integer)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  dice integer[] := array[]::integer[];
  index integer;
begin
  for index in 1 .. greatest(0, least(p_pool, 30)) loop
    dice := array_append(dice, private.v3_d10());
  end loop;
  return private.v3_read_dice(dice, p_difficulty);
end;
$$;
revoke all on function private.v3_roll(integer, integer) from public;
grant execute on function private.v3_roll(integer, integer) to authenticated;

-- Number in a sheet's values, 0 when missing or not a number.
create or replace function private.v3_number(p_values jsonb, p_field text)
returns integer
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case when jsonb_typeof(p_values -> p_field) = 'number' then (p_values ->> p_field)::numeric::integer else 0 end
$$;
revoke all on function private.v3_number(jsonb, text) from public;
grant execute on function private.v3_number(jsonb, text) to authenticated;

-- Blood pool and blood per turn for 13th..8th generation (Generation background 0..5), conferir.
create or replace function private.v3_blood_limits(p_values jsonb, out blood_max integer, out per_turn integer)
language sql
immutable
security invoker
set search_path = pg_catalog, private
as $$
  select 10 + generation, 1 + (generation / 4) * (generation - 3)
    from (select least(5, greatest(0, private.v3_number(p_values, 'ant_geracao'))) as generation) as background
$$;
revoke all on function private.v3_blood_limits(jsonb) from public;
grant execute on function private.v3_blood_limits(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Test log
-- ---------------------------------------------------------------------------------------------------

create table public.v3_sheet_tests (
  id bigint generated always as identity primary key,
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  kind text not null check (kind in ('frenesi', 'rotschreck', 'degeneracao', 'sangue_inicial')),
  trait text check (trait is null or trait ~ '^[a-z][a-z0-9_]{1,63}$'),
  pool integer not null check (pool between 0 and 30),
  difficulty integer check (difficulty is null or difficulty between 2 and 10),
  roll jsonb not null,
  outcome text not null check (char_length(outcome) <= 80),
  created_at timestamptz not null default now(),
  unique (actor_id, sheet_id, operation_id)
);
create index v3_sheet_tests_sheet_idx on public.v3_sheet_tests (sheet_id, id desc);
alter table public.v3_sheet_tests enable row level security;
revoke all on public.v3_sheet_tests from anon, authenticated;
grant select on public.v3_sheet_tests to authenticated;
create policy "sheet readers read v3 tests"
  on public.v3_sheet_tests for select to authenticated
  using (exists (select 1 from public.character_sheets sheet where sheet.id = sheet_id));
comment on table public.v3_sheet_tests is
  'V3 tests rolled by the database (Frenesi, Rötschreck, degeneração, sangue inicial); written only by the v3_* RPCs.';

-- Only the v3_* RPCs below write here, inside the call that rolled.
create or replace function private.v3_record_test(
  p_sheet public.character_sheets, p_operation_id uuid, p_kind text, p_trait text, p_pool integer,
  p_difficulty integer, p_roll jsonb, p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  result public.v3_sheet_tests;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  insert into public.v3_sheet_tests (sheet_id, campaign_id, actor_id, operation_id, kind, trait, pool, difficulty, roll, outcome)
  values (p_sheet.id, p_sheet.campaign_id, auth.uid(), p_operation_id, p_kind, p_trait, p_pool, p_difficulty, p_roll, p_outcome)
  returning * into result;
  return to_jsonb(result);
end;
$$;
revoke all on function private.v3_record_test(public.character_sheets, uuid, text, text, integer, integer, jsonb, text) from public;
grant execute on function private.v3_record_test(public.character_sheets, uuid, text, text, integer, integer, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Atomic writes
-- ---------------------------------------------------------------------------------------------------

-- Locks a V3 sheet the caller may write (RLS of the invoker) on an approved V3 template.
create or replace function private.v3_lock_sheet(p_sheet_id uuid)
returns public.character_sheets
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  select * into sheet from public.character_sheets where id = p_sheet_id for update;
  if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  if not exists (select 1 from public.system_templates template
                  where template.id = sheet.template_id and template.campaign_id = sheet.campaign_id
                    and template.status = 'approved' and template.schema ->> 'system_key' = 'vampire-v3') then
    raise exception 'sheet is not a Vampire V3 sheet' using errcode = '22023';
  end if;
  return sheet;
end;
$$;
revoke all on function private.v3_lock_sheet(uuid) from public;
grant execute on function private.v3_lock_sheet(uuid) to authenticated;

-- A prior write of this actor with this operation id, or null.
create or replace function private.v3_prior_event(p_sheet public.character_sheets, p_operation_id uuid)
returns public.character_sheet_events
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select * from public.character_sheet_events
   where sheet_id = p_sheet.id and campaign_id = p_sheet.campaign_id and actor_id = auth.uid() and operation_id = p_operation_id
$$;
revoke all on function private.v3_prior_event(public.character_sheets, uuid) from public;
grant execute on function private.v3_prior_event(public.character_sheets, uuid) to authenticated;

-- Writes `p_patch` over the values of a locked sheet and records one event for `p_field`.
create or replace function private.v3_write(
  p_sheet public.character_sheets, p_operation_id uuid, p_patch jsonb, p_field text, p_delta integer, p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  before_value numeric := private.v3_number(p_sheet.values, p_field);
  event public.character_sheet_events;
begin
  perform set_config('rpg.atomic_adjustment', 'on', true);
  update public.character_sheets set values = values || p_patch where id = p_sheet.id returning * into sheet;
  perform set_config('rpg.atomic_adjustment', 'off', true);
  if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  event := private.record_sheet_adjustment_event(sheet.id, p_operation_id, p_field, p_delta, before_value, before_value + p_delta, p_reason);
  return jsonb_build_object('sheet', to_jsonb(sheet), 'event', to_jsonb(event), 'replayed', false);
end;
$$;
revoke all on function private.v3_write(public.character_sheets, uuid, jsonb, text, integer, text) from public;
grant execute on function private.v3_write(public.character_sheets, uuid, jsonb, text, integer, text) to authenticated;

create or replace function private.v3_replay(p_sheet public.character_sheets, p_event public.character_sheet_events, p_reason text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_event.reason is distinct from p_reason then
    raise exception 'operation ID was already used for another adjustment' using errcode = '23505';
  end if;
  return jsonb_build_object('sheet', to_jsonb(p_sheet), 'event', to_jsonb(p_event), 'replayed', true);
end;
$$;
revoke all on function private.v3_replay(public.character_sheets, public.character_sheet_events, text) from public;
grant execute on function private.v3_replay(public.character_sheets, public.character_sheet_events, text) to authenticated;

-- One Willpower point for an automatic success (the roller in the API calls this before rolling).
create or replace function public.v3_spend_willpower(p_sheet_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  prior public.character_sheet_events;
  reason text := 'v3 vontade sucesso automatico';
begin
  if p_operation_id is null then raise exception 'operation ID required' using errcode = '22023'; end if;
  sheet := private.v3_lock_sheet(p_sheet_id);
  prior := private.v3_prior_event(sheet, p_operation_id);
  if prior.id is not null then return private.v3_replay(sheet, prior, reason); end if;
  if private.v3_number(sheet.values, 'vontade_gasta') >= private.v3_number(sheet.values, 'forca_vontade') then
    raise exception 'no Willpower left' using errcode = '23514';
  end if;
  return private.v3_write(sheet, p_operation_id,
    jsonb_build_object('vontade_gasta', private.v3_number(sheet.values, 'vontade_gasta') + 1), 'vontade_gasta', 1, reason);
end;
$$;
revoke all on function public.v3_spend_willpower(uuid, uuid) from public, anon;
grant execute on function public.v3_spend_willpower(uuid, uuid) to authenticated;

-- Blood already spent in a turn: blood events whose reason ends with " turno:<key>".
create or replace function private.v3_blood_spent_in_turn(p_sheet_id uuid, p_turn text)
returns integer
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(-sum(delta), 0)::integer from public.character_sheet_events
   where sheet_id = p_sheet_id and field_id = 'pontos_sangue' and delta < 0
     and p_turn is not null and right(reason, char_length(' turno:' || p_turn)) = ' turno:' || p_turn
$$;
revoke all on function private.v3_blood_spent_in_turn(uuid, text) from public;
grant execute on function private.v3_blood_spent_in_turn(uuid, text) to authenticated;

create or replace function private.v3_check_blood(p_sheet public.character_sheets, p_amount integer, p_turn text)
returns void
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  limits record;
begin
  if p_amount is null or p_amount < 1 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if p_turn is not null and (char_length(p_turn) not between 1 and 80 or p_turn !~ '^[A-Za-z0-9:._-]+$') then
    raise exception 'turn key must have 1 to 80 letters, digits or :._-' using errcode = '22023';
  end if;
  select * into limits from private.v3_blood_limits(p_sheet.values);
  if p_amount + private.v3_blood_spent_in_turn(p_sheet.id, p_turn) > limits.per_turn then
    raise exception 'blood per turn is % for this generation', limits.per_turn using errcode = '23514';
  end if;
  if p_amount > private.v3_number(p_sheet.values, 'pontos_sangue') then
    raise exception 'not enough blood' using errcode = '23514';
  end if;
end;
$$;
revoke all on function private.v3_check_blood(public.character_sheets, integer, text) from public;
grant execute on function private.v3_check_blood(public.character_sheets, integer, text) to authenticated;

-- Spends blood within the generation's limit per turn; `p_turn` (combat and round) joins spends of one turn.
create or replace function public.v3_spend_blood(p_sheet_id uuid, p_operation_id uuid, p_amount integer, p_turn text default null)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  prior public.character_sheet_events;
  reason text := 'v3 sangue' || coalesce(' turno:' || p_turn, '');
begin
  if p_operation_id is null then raise exception 'operation ID required' using errcode = '22023'; end if;
  sheet := private.v3_lock_sheet(p_sheet_id);
  prior := private.v3_prior_event(sheet, p_operation_id);
  if prior.id is not null then return private.v3_replay(sheet, prior, reason); end if;
  perform private.v3_check_blood(sheet, p_amount, p_turn);
  return private.v3_write(sheet, p_operation_id,
    jsonb_build_object('pontos_sangue', private.v3_number(sheet.values, 'pontos_sangue') - p_amount), 'pontos_sangue', -p_amount, reason);
end;
$$;
revoke all on function public.v3_spend_blood(uuid, uuid, integer, text) from public, anon;
grant execute on function public.v3_spend_blood(uuid, uuid, integer, text) to authenticated;

-- Heals bashing levels first, then lethal, one blood each; aggravated damage is not healed here (conferir).
create or replace function public.v3_heal(p_sheet_id uuid, p_operation_id uuid, p_levels integer, p_turn text default null)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  prior public.character_sheet_events;
  bashing integer;
  lethal integer;
  bashing_healed integer;
  reason text := 'v3 cura' || coalesce(' turno:' || p_turn, '');
begin
  if p_operation_id is null then raise exception 'operation ID required' using errcode = '22023'; end if;
  sheet := private.v3_lock_sheet(p_sheet_id);
  prior := private.v3_prior_event(sheet, p_operation_id);
  if prior.id is not null then return private.v3_replay(sheet, prior, reason); end if;
  bashing := private.v3_number(sheet.values, 'dano_contundente');
  lethal := private.v3_number(sheet.values, 'dano_letal');
  if p_levels is null or p_levels < 1 or p_levels > bashing + lethal then
    raise exception 'there are not that many bashing or lethal levels to heal' using errcode = '22023';
  end if;
  perform private.v3_check_blood(sheet, p_levels, p_turn);
  bashing_healed := least(bashing, p_levels);
  return private.v3_write(sheet, p_operation_id, jsonb_build_object(
    'pontos_sangue', private.v3_number(sheet.values, 'pontos_sangue') - p_levels,
    'dano_contundente', bashing - bashing_healed,
    'dano_letal', lethal - (p_levels - bashing_healed)), 'pontos_sangue', -p_levels, reason);
end;
$$;
revoke all on function public.v3_heal(uuid, uuid, integer, text) from public, anon;
grant execute on function public.v3_heal(uuid, uuid, integer, text) to authenticated;

-- Damage after soak: bashing is halved for vampires (rounded down, conferir); the track holds 7 levels
-- and what does not fit is dropped (Incapacitado; torpor and Final Death stay with the narrator).
create or replace function public.v3_apply_damage(p_sheet_id uuid, p_operation_id uuid, p_kind text, p_amount integer)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  prior public.character_sheet_events;
  field_id text;
  applied integer;
  marked integer;
  reason text;
begin
  if p_operation_id is null then raise exception 'operation ID required' using errcode = '22023'; end if;
  if p_kind not in ('contundente', 'letal', 'agravado') or p_amount is null or p_amount not between 1 and 20 then
    raise exception 'damage needs a kind (contundente, letal, agravado) and 1 to 20 levels' using errcode = '22023';
  end if;
  reason := 'v3 dano ' || p_kind || ' ' || p_amount;
  field_id := 'dano_' || p_kind;
  sheet := private.v3_lock_sheet(p_sheet_id);
  prior := private.v3_prior_event(sheet, p_operation_id);
  if prior.id is not null then return private.v3_replay(sheet, prior, reason); end if;
  marked := private.v3_number(sheet.values, 'dano_contundente') + private.v3_number(sheet.values, 'dano_letal')
          + private.v3_number(sheet.values, 'dano_agravado');
  applied := least(case when p_kind = 'contundente' then p_amount / 2 else p_amount end, greatest(0, 7 - marked));
  if applied = 0 then
    return jsonb_build_object('sheet', to_jsonb(sheet), 'event', null, 'replayed', false, 'applied', 0);
  end if;
  return private.v3_write(sheet, p_operation_id,
    jsonb_build_object(field_id, private.v3_number(sheet.values, field_id) + applied), field_id, applied, reason)
    || jsonb_build_object('applied', applied);
end;
$$;
revoke all on function public.v3_apply_damage(uuid, uuid, text, integer) from public, anon;
grant execute on function public.v3_apply_damage(uuid, uuid, text, integer) to authenticated;

-- Starting blood: 1d10 capped at the generation's pool, or a value the narrator sets. A player rolls once.
create or replace function public.v3_set_initial_blood(p_sheet_id uuid, p_operation_id uuid, p_value integer default null)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  prior public.v3_sheet_tests;
  limits record;
  die integer;
  target integer;
  test jsonb;
  written jsonb;
  current integer;
begin
  if p_operation_id is null then raise exception 'operation ID required' using errcode = '22023'; end if;
  sheet := private.v3_lock_sheet(p_sheet_id);
  select * into prior from public.v3_sheet_tests
   where sheet_id = sheet.id and actor_id = auth.uid() and operation_id = p_operation_id;
  if found then
    return jsonb_build_object('sheet', to_jsonb(sheet), 'test', to_jsonb(prior), 'replayed', true);
  end if;
  select * into limits from private.v3_blood_limits(sheet.values);
  if p_value is not null then
    if not private.can_manage_campaign(sheet.campaign_id) then
      raise exception 'only the campaign master can set the starting blood' using errcode = '42501';
    end if;
    if p_value not between 0 and limits.blood_max then
      raise exception 'starting blood must be between 0 and %', limits.blood_max using errcode = '22023';
    end if;
    target := p_value;
  else
    if not private.can_manage_campaign(sheet.campaign_id) and exists (
      select 1 from public.v3_sheet_tests where sheet_id = sheet.id and kind = 'sangue_inicial') then
      raise exception 'the starting blood was already rolled' using errcode = '42501';
    end if;
    die := private.v3_d10();
    target := least(die, limits.blood_max);
  end if;
  test := private.v3_record_test(sheet, p_operation_id, 'sangue_inicial', 'pontos_sangue', case when die is null then 0 else 1 end, null,
    jsonb_build_object('dice', case when die is null then '[]'::jsonb else jsonb_build_array(die) end, 'value', target), 'definido ' || target);
  current := private.v3_number(sheet.values, 'pontos_sangue');
  if target = current then
    return jsonb_build_object('sheet', to_jsonb(sheet), 'test', test, 'replayed', false);
  end if;
  written := private.v3_write(sheet, p_operation_id, jsonb_build_object('pontos_sangue', target), 'pontos_sangue', target - current, 'v3 sangue inicial');
  return written || jsonb_build_object('test', test);
end;
$$;
revoke all on function public.v3_set_initial_blood(uuid, uuid, integer) from public, anon;
grant execute on function public.v3_set_initial_blood(uuid, uuid, integer) to authenticated;

-- Virtue the sheet's Path uses in place of Consciência/Autocontrole (from the template's virtue pool).
create or replace function private.v3_path_virtue(p_sheet public.character_sheets, p_kind text)
returns text
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select case
    when p_kind = 'coragem' then 'coragem'
    when p_kind = 'consciencia' then case when coalesce(opened ? 'conviccao', false) then 'conviccao' else 'consciencia' end
    else case when coalesce(opened ? 'instintos', false) then 'instintos' else 'autocontrole' end end
    from (select (select pool -> 'allowed' -> 'cases' -> (p_sheet.values ->> 'trilha')
                    from jsonb_array_elements(template.schema -> 'creation_rules') as rules(rule),
                         jsonb_array_elements(case when rule ->> 'type' = 'priority_points' then rule -> 'pools' else '[]'::jsonb end) as pools(pool)
                   where pool -> 'allowed' ->> 'field' = 'trilha' limit 1) as opened
            from public.system_templates template where template.id = p_sheet.template_id) as path
$$;
revoke all on function private.v3_path_virtue(public.character_sheets, text) from public;
grant execute on function private.v3_path_virtue(public.character_sheets, text) to authenticated;

-- Frenesi (Autocontrole or Instintos) or Rötschreck (Coragem) against the narrator's difficulty. At least
-- `p_required` successes resist (default 1, conferir: o Revisado pede sucessos acumulados); otherwise the
-- sheet enters the state, which the table clears by editing the sheet.
create or replace function public.v3_frenzy_test(p_sheet_id uuid, p_operation_id uuid, p_kind text, p_difficulty integer, p_required integer default 1)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  prior public.v3_sheet_tests;
  trait text;
  pool integer;
  roll jsonb;
  resisted boolean;
  flag text;
  test jsonb;
begin
  if p_operation_id is null then raise exception 'operation ID required' using errcode = '22023'; end if;
  if p_kind not in ('frenesi', 'rotschreck') or p_difficulty is null or p_difficulty not between 2 and 10
     or p_required is null or p_required not between 1 and 10 then
    raise exception 'test needs frenesi or rotschreck, difficulty 2 to 10 and 1 to 10 successes' using errcode = '22023';
  end if;
  sheet := private.v3_lock_sheet(p_sheet_id);
  select * into prior from public.v3_sheet_tests where sheet_id = sheet.id and actor_id = auth.uid() and operation_id = p_operation_id;
  if found then return jsonb_build_object('sheet', to_jsonb(sheet), 'test', to_jsonb(prior), 'replayed', true); end if;
  trait := private.v3_path_virtue(sheet, case when p_kind = 'rotschreck' then 'coragem' else 'autocontrole' end);
  pool := least(30, greatest(0, private.v3_number(sheet.values, trait)));
  roll := private.v3_roll(pool, p_difficulty);
  resisted := (roll ->> 'successes')::integer >= p_required;
  test := private.v3_record_test(sheet, p_operation_id, p_kind, trait, pool, p_difficulty, roll || jsonb_build_object('required', p_required),
    case when resisted then 'resistiu' when (roll ->> 'botch')::boolean then 'falha crítica' else 'cedeu' end);
  flag := case when p_kind = 'frenesi' then 'em_frenesi' else 'em_rotschreck' end;
  if resisted or coalesce((sheet.values ->> flag)::boolean, false) then
    return jsonb_build_object('sheet', to_jsonb(sheet), 'test', test, 'replayed', false, 'resisted', resisted);
  end if;
  -- The event needs a nonzero delta: the state goes from 0 to 1.
  return private.v3_write(sheet, p_operation_id, jsonb_build_object(flag, true), flag, 1, 'v3 ' || p_kind)
    || jsonb_build_object('test', test, 'resisted', false);
end;
$$;
revoke all on function public.v3_frenzy_test(uuid, uuid, text, integer, integer) from public, anon;
grant execute on function public.v3_frenzy_test(uuid, uuid, text, integer, integer) to authenticated;

-- Degeneration: a sin against the Path asks for Consciência (or Convicção) at the narrator's difficulty;
-- without a success the Path rating loses one point (conferir: a falha crítica pode dar Perturbação).
create or replace function public.v3_degeneration_test(p_sheet_id uuid, p_operation_id uuid, p_difficulty integer)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  prior public.v3_sheet_tests;
  trait text;
  pool integer;
  roll jsonb;
  test jsonb;
  rating integer;
begin
  if p_operation_id is null then raise exception 'operation ID required' using errcode = '22023'; end if;
  if p_difficulty is null or p_difficulty not between 2 and 10 then
    raise exception 'difficulty must be between 2 and 10' using errcode = '22023';
  end if;
  sheet := private.v3_lock_sheet(p_sheet_id);
  select * into prior from public.v3_sheet_tests where sheet_id = sheet.id and actor_id = auth.uid() and operation_id = p_operation_id;
  if found then return jsonb_build_object('sheet', to_jsonb(sheet), 'test', to_jsonb(prior), 'replayed', true); end if;
  trait := private.v3_path_virtue(sheet, 'consciencia');
  pool := least(30, greatest(0, private.v3_number(sheet.values, trait)));
  roll := private.v3_roll(pool, p_difficulty);
  rating := private.v3_number(sheet.values, 'humanidade');
  test := private.v3_record_test(sheet, p_operation_id, 'degeneracao', trait, pool, p_difficulty, roll,
    case when (roll ->> 'success')::boolean then 'manteve a Trilha' when (roll ->> 'botch')::boolean then 'falha crítica' else 'perdeu 1 ponto' end);
  if (roll ->> 'success')::boolean or rating <= 0 then
    return jsonb_build_object('sheet', to_jsonb(sheet), 'test', test, 'replayed', false, 'lost', 0);
  end if;
  return private.v3_write(sheet, p_operation_id, jsonb_build_object('humanidade', rating - 1), 'humanidade', -1, 'v3 degeneracao')
    || jsonb_build_object('test', test, 'lost', 1);
end;
$$;
revoke all on function public.v3_degeneration_test(uuid, uuid, integer) from public, anon;
grant execute on function public.v3_degeneration_test(uuid, uuid, integer) to authenticated;
