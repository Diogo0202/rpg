-- F1: ciclo do Sangue de Vampiro: A Máscara 5ª ed.
-- Rouse Check, Despertar, Teste de Remorso, Frenesi, Compulsão ativa e Torpor
-- como RPCs atômicas. Os dados são gerados no banco (private.v5_random_die),
-- nunca recebidos do cliente. Cada chamada leva um operation_id: repetir a
-- mesma operação devolve o registro anterior sem rolar de novo. Cada operação
-- deixa um evento de auditoria em v5_blood_events com a versão da ficha.
-- Os números de regra (tabela de Potência, divisor de Humanidade no Frenesi,
-- tabela de Compulsões e de duração do Torpor) estão marcados para conferência
-- no livro; espelhos: backend/app/services/v5_blood.py e frontend/lib/v5-blood.ts.

create table public.v5_blood_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  operation_id uuid not null,
  kind text not null check (kind in ('rouse', 'awaken', 'remorse', 'frenzy', 'compulsion', 'torpor')),
  dice integer[] not null default '{}' check (cardinality(dice) <= 40),
  outcome jsonb not null check (jsonb_typeof(outcome) = 'object' and pg_column_size(outcome) <= 4096),
  sheet_version integer not null check (sheet_version > 0),
  created_at timestamptz not null default clock_timestamp()
);
create unique index v5_blood_events_operation_idx on public.v5_blood_events (actor_id, sheet_id, operation_id);
create index v5_blood_events_sheet_idx on public.v5_blood_events (sheet_id, id desc);
alter table public.v5_blood_events enable row level security;
revoke all on public.v5_blood_events from anon, authenticated;
grant select on public.v5_blood_events to authenticated;
-- Compulsão e Fome podem ser privadas: só o dono da ficha e o narrador leem.
create policy "sheet owner and master read blood events"
  on public.v5_blood_events for select to authenticated
  using (private.can_manage_campaign(campaign_id) or exists (
    select 1 from public.character_sheets sheet where sheet.id = sheet_id and sheet.owner_id = auth.uid()));
comment on table public.v5_blood_events is
  'Eventos do ciclo do Sangue V5 (Rouse, Despertar, Remorso, Frenesi, Compulsão, Torpor). Escritos só pelas RPCs v5_*; os 200 mais novos por ficha ficam.';

-- Tabela da Potência de Sangue 0-10 (conferir no livro). animal_slake: quanto
-- sangue animal/ensacado sacia (full, half, none); human_slake_penalty: Fome a
-- menos saciada por humano; kill_to_reduce_below: abaixo deste valor de Fome
-- só drenando e matando um humano.
create or replace function private.v5_blood_potency(p_potency integer)
returns jsonb
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select jsonb_build_object('potency', t.bp, 'surge', t.surge, 'mend', t.mend, 'power_bonus', t.bonus,
    'rouse_reroll_level', t.reroll, 'bane_severity', t.bane,
    'animal_slake', case when t.bp <= 1 then 'full' when t.bp = 2 then 'half' else 'none' end,
    'human_slake_penalty', t.human, 'kill_to_reduce_below', t.kill)
    from (values
      (0, 1, 1, 0, 0, 0, 0, null::integer), (1, 2, 1, 0, 1, 2, 0, null), (2, 2, 2, 1, 1, 2, 0, null),
      (3, 3, 2, 1, 2, 3, 0, null), (4, 3, 3, 2, 2, 3, 1, null), (5, 4, 3, 2, 3, 4, 1, 2),
      (6, 4, 3, 3, 3, 4, 2, 2), (7, 5, 3, 3, 4, 5, 2, 2), (8, 5, 4, 4, 4, 5, 2, 3),
      (9, 6, 4, 4, 5, 6, 2, 3), (10, 6, 5, 5, 5, 6, 3, 3)
    ) as t(bp, surge, mend, bonus, reroll, bane, human, kill)
   where t.bp = greatest(0, least(10, coalesce(p_potency, 0)));
$$;
revoke all on function private.v5_blood_potency(integer) from public;
grant execute on function private.v5_blood_potency(integer) to authenticated;

create or replace function private.v5_sheet_int(p_values jsonb, p_key text, p_default integer)
returns integer
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case when jsonb_typeof(p_values -> p_key) = 'number'
              then trunc((p_values ->> p_key)::numeric)::integer else p_default end;
$$;
revoke all on function private.v5_sheet_int(jsonb, text, integer) from public;

create or replace function private.v5_template_field(p_schema jsonb, p_field text)
returns jsonb
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select field from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) as fields(field)
   where field ->> 'id' = p_field limit 1;
$$;
revoke all on function private.v5_template_field(jsonb, text) from public;
grant execute on function private.v5_template_field(jsonb, text) to authenticated;

-- A V5 vampire sheet: its approved template has Hunger, Humanity, Stains and Blood Potency as numbers.
create or replace function private.v5_is_vampire_schema(p_schema jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog, private
as $$
  select (select count(*) from unnest(array['fome', 'humanidade', 'manchas', 'potencia_sangue']) as wanted(id)
           where private.v5_template_field(p_schema, wanted.id) ->> 'kind' = 'number') = 4;
$$;
revoke all on function private.v5_is_vampire_schema(jsonb) from public;
grant execute on function private.v5_is_vampire_schema(jsonb) to authenticated;

-- Locks a writable V5 vampire sheet and returns it with its approved template schema.
create or replace function private.v5_lock_blood_sheet(p_sheet_id uuid, out sheet public.character_sheets, out template_schema jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  select * into sheet from public.character_sheets where id = p_sheet_id for update;
  if not found or not private.can_write_sheet(sheet) then
    raise exception 'sheet not found or not writable' using errcode = '42501';
  end if;
  select schema into template_schema from public.system_templates
   where id = sheet.template_id and campaign_id = sheet.campaign_id and status = 'approved';
  if template_schema is null or not private.v5_is_vampire_schema(template_schema) then
    raise exception 'sheet is not a V5 vampire sheet' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.v5_lock_blood_sheet(uuid) from public;

create or replace function private.v5_blood_replay(p_sheet public.character_sheets, p_operation_id uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  prior public.v5_blood_events;
begin
  if p_operation_id is null then raise exception 'operation ID required' using errcode = '22023'; end if;
  select * into prior from public.v5_blood_events
   where actor_id = auth.uid() and sheet_id = p_sheet.id and operation_id = p_operation_id;
  if not found then return null; end if;
  if prior.kind <> p_kind then
    raise exception 'operation ID was already used for another adjustment' using errcode = '23505';
  end if;
  return jsonb_build_object('sheet', to_jsonb(p_sheet), 'event', to_jsonb(prior), 'replayed', true,
    'outcome', prior.outcome, 'dice', to_jsonb(prior.dice));
end;
$$;
revoke all on function private.v5_blood_replay(public.character_sheets, uuid, text) from public;

create or replace function private.v5_write_blood_values(p_sheet_id uuid, p_patch jsonb)
returns public.character_sheets
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  sheet public.character_sheets;
begin
  perform set_config('rpg.atomic_adjustment', 'on', true);
  update public.character_sheets set values = values || p_patch where id = p_sheet_id returning * into sheet;
  perform set_config('rpg.atomic_adjustment', 'off', true);
  if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  return sheet;
end;
$$;
revoke all on function private.v5_write_blood_values(uuid, jsonb) from public;

create or replace function private.v5_record_blood_event(
  p_sheet public.character_sheets, p_operation_id uuid, p_kind text, p_dice integer[], p_outcome jsonb
)
returns public.v5_blood_events
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  saved public.v5_blood_events;
begin
  insert into public.v5_blood_events (campaign_id, sheet_id, actor_id, operation_id, kind, dice, outcome, sheet_version)
  values (p_sheet.campaign_id, p_sheet.id, auth.uid(), p_operation_id, p_kind, coalesce(p_dice, '{}'), p_outcome, p_sheet.version)
  returning * into saved;
  delete from public.v5_blood_events old
   where old.sheet_id = p_sheet.id
     and old.id not in (select keep.id from public.v5_blood_events keep where keep.sheet_id = p_sheet.id
                         order by keep.id desc limit 200);
  return saved;
end;
$$;
revoke all on function private.v5_record_blood_event(public.character_sheets, uuid, text, integer[], jsonb) from public;

create or replace function private.v5_blood_result(p_sheet public.character_sheets, p_event public.v5_blood_events)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object('sheet', to_jsonb(p_sheet), 'event', to_jsonb(p_event), 'replayed', false,
    'outcome', p_event.outcome, 'dice', to_jsonb(p_event.dice));
$$;
revoke all on function private.v5_blood_result(public.character_sheets, public.v5_blood_events) from public;

-- Rouse Check: one d10, 6+ keeps Hunger; otherwise Hunger +1. Blood Potency
-- lets a Discipline power of level <= its reroll level roll a second die.
-- At Hunger 5 a failed check cannot raise Hunger: it flags a hunger frenzy test.
create or replace function private.v5_rouse(p_sheet_id uuid, p_operation_id uuid, p_kind text, p_level integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  locked record;
  sheet public.character_sheets;
  replay jsonb;
  potency jsonb;
  bp integer;
  reroll boolean;
  dice integer[];
  success boolean;
  hunger integer;
  hunger_after integer;
  outcome jsonb;
  event public.v5_blood_events;
begin
  if p_level is not null and p_level not between 1 and 10 then
    raise exception 'discipline level must be between 1 and 10' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(p_reason) > 120 then
    raise exception 'reason must have at most 120 characters' using errcode = '22023';
  end if;
  select * into locked from private.v5_lock_blood_sheet(p_sheet_id);
  sheet := locked.sheet;
  replay := private.v5_blood_replay(sheet, p_operation_id, p_kind);
  if replay is not null then return replay; end if;
  if p_kind = 'awaken' and sheet.values -> 'torpor' = 'true'::jsonb then
    raise exception 'a vampire in torpor does not wake at sunset' using errcode = '22023';
  end if;
  bp := greatest(0, least(10, private.v5_sheet_int(sheet.values, 'potencia_sangue', 0)));
  potency := private.v5_blood_potency(bp);
  reroll := p_kind = 'rouse' and p_level is not null and p_level <= (potency ->> 'rouse_reroll_level')::integer;
  dice := array[private.v5_random_die()];
  if dice[1] < 6 and reroll then dice := dice || private.v5_random_die(); end if;
  success := exists (select 1 from unnest(dice) as face where face >= 6);
  hunger := greatest(0, least(5, private.v5_sheet_int(sheet.values, 'fome', 0)));
  hunger_after := case when success then hunger else least(5, hunger + 1) end;
  if hunger_after <> hunger then
    sheet := private.v5_write_blood_values(sheet.id, jsonb_build_object('fome', hunger_after));
  end if;
  outcome := jsonb_build_object(
    'success', success, 'hunger_before', hunger, 'hunger_after', hunger_after,
    'hunger_frenzy_test', not success and hunger = 5,
    'reroll_allowed', reroll, 'rerolled', cardinality(dice) > 1,
    'discipline_level', p_level, 'blood_potency', bp, 'reason', p_reason);
  event := private.v5_record_blood_event(sheet, p_operation_id, p_kind, dice, outcome);
  return private.v5_blood_result(sheet, event);
end;
$$;
revoke all on function private.v5_rouse(uuid, uuid, text, integer, text) from public;

create or replace function public.v5_rouse_check(
  p_sheet_id uuid, p_operation_id uuid, p_discipline_level integer default null, p_reason text default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select private.v5_rouse(p_sheet_id, p_operation_id, 'rouse', p_discipline_level, p_reason);
$$;
revoke all on function public.v5_rouse_check(uuid, uuid, integer, text) from public, anon;
grant execute on function public.v5_rouse_check(uuid, uuid, integer, text) to authenticated;

-- Despertar: the Rouse Check at sunset (no Discipline reroll).
create or replace function public.v5_awaken(p_sheet_id uuid, p_operation_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select private.v5_rouse(p_sheet_id, p_operation_id, 'awaken', null, 'Despertar');
$$;
revoke all on function public.v5_awaken(uuid, uuid) from public, anon;
grant execute on function public.v5_awaken(uuid, uuid) to authenticated;

-- Teste de Remorso: dice = 10 - Humanity - Stains (minimum 1); any 6+ keeps
-- Humanity, otherwise Humanity -1. Stains are cleared either way.
create or replace function public.v5_remorse_check(p_sheet_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  locked record;
  sheet public.character_sheets;
  replay jsonb;
  humanity integer;
  stains integer;
  pool integer;
  dice integer[] := '{}';
  success boolean;
  humanity_after integer;
  outcome jsonb;
  event public.v5_blood_events;
begin
  select * into locked from private.v5_lock_blood_sheet(p_sheet_id);
  sheet := locked.sheet;
  replay := private.v5_blood_replay(sheet, p_operation_id, 'remorse');
  if replay is not null then return replay; end if;
  humanity := greatest(0, least(10, private.v5_sheet_int(sheet.values, 'humanidade', 7)));
  stains := greatest(0, least(10, private.v5_sheet_int(sheet.values, 'manchas', 0)));
  if stains = 0 then raise exception 'no stains to test remorse' using errcode = '22023'; end if;
  pool := greatest(1, 10 - humanity - stains);
  for i in 1 .. pool loop dice := dice || private.v5_random_die(); end loop;
  success := exists (select 1 from unnest(dice) as face where face >= 6);
  humanity_after := case when success then humanity else greatest(0, humanity - 1) end;
  sheet := private.v5_write_blood_values(sheet.id, jsonb_build_object('humanidade', humanity_after, 'manchas', 0));
  outcome := jsonb_build_object('success', success, 'pool', pool, 'humanity_before', humanity,
    'humanity_after', humanity_after, 'stains_before', stains, 'stains_after', 0);
  event := private.v5_record_blood_event(sheet, p_operation_id, 'remorse', dice, outcome);
  return private.v5_blood_result(sheet, event);
end;
$$;
revoke all on function public.v5_remorse_check(uuid, uuid) from public, anon;
grant execute on function public.v5_remorse_check(uuid, uuid) to authenticated;

-- Resistir ao Frenesi: current Willpower + Humanity / 3 (rounded down; conferir).
-- Brujah subtract their Bane Severity against fury frenzy (conferir). The
-- difficulty comes from the narrator; the sheet only records the event.
create or replace function public.v5_frenzy_check(p_sheet_id uuid, p_operation_id uuid, p_difficulty integer, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  locked record;
  sheet public.character_sheets;
  replay jsonb;
  willpower_max integer;
  willpower_current integer;
  humanity integer;
  bane_penalty integer := 0;
  pool integer;
  dice integer[] := '{}';
  result jsonb;
  outcome jsonb;
  event public.v5_blood_events;
begin
  if p_difficulty is null or p_difficulty not between 1 and 10 then
    raise exception 'difficulty must be between 1 and 10' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('fury', 'hunger', 'terror') then
    raise exception 'frenzy kind must be fury, hunger or terror' using errcode = '22023';
  end if;
  select * into locked from private.v5_lock_blood_sheet(p_sheet_id);
  sheet := locked.sheet;
  replay := private.v5_blood_replay(sheet, p_operation_id, 'frenzy');
  if replay is not null then return replay; end if;
  willpower_max := greatest(0, least(30, private.v5_sheet_int(sheet.values, 'autocontrole', 0) + private.v5_sheet_int(sheet.values, 'resolucao', 0)));
  willpower_current := greatest(0, willpower_max - greatest(0, private.v5_sheet_int(sheet.values, 'vontade_superficial', 0))
    - greatest(0, private.v5_sheet_int(sheet.values, 'vontade_agravada', 0)));
  humanity := greatest(0, least(10, private.v5_sheet_int(sheet.values, 'humanidade', 7)));
  if p_kind = 'fury' and sheet.values ->> 'cla' = 'Brujah' then
    bane_penalty := (private.v5_blood_potency(private.v5_sheet_int(sheet.values, 'potencia_sangue', 0)) ->> 'bane_severity')::integer;
  end if;
  pool := greatest(0, least(30, willpower_current + humanity / 3 - bane_penalty));
  for i in 1 .. pool loop dice := dice || private.v5_random_die(); end loop;
  result := private.v5_roll_outcome(dice, '{}', p_difficulty);
  outcome := jsonb_build_object('kind', p_kind, 'difficulty', p_difficulty, 'pool', pool,
    'willpower_current', willpower_current, 'humanity_bonus', humanity / 3, 'bane_penalty', bane_penalty,
    'successes', (result ->> 'successes')::integer, 'success', (result ->> 'success')::boolean,
    'frenzy', not (result ->> 'success')::boolean);
  event := private.v5_record_blood_event(sheet, p_operation_id, 'frenzy', dice, outcome);
  return private.v5_blood_result(sheet, event);
end;
$$;
revoke all on function public.v5_frenzy_check(uuid, uuid, integer, text) from public, anon;
grant execute on function public.v5_frenzy_check(uuid, uuid, integer, text) to authenticated;

-- Clan compulsion names (conferir no livro); Caitiff and thin-bloods have none.
create or replace function private.v5_clan_compulsion(p_clan text)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case p_clan
    when 'Banu Haqim' then 'Julgamento' when 'Brujah' then 'Rebeldia' when 'Gangrel' then 'Impulsos Ferais'
    when 'Hecata' then 'Morbidez' when 'Lasombra' then 'Implacabilidade' when 'Malkaviano' then 'Delírio'
    when 'Ministério' then 'Transgressão' when 'Nosferatu' then 'Criptofilia' when 'Ravnos' then 'Tentar o Destino'
    when 'Salubri' then 'Empatia Afetiva' when 'Toreador' then 'Obsessão' when 'Tremere' then 'Perfeccionismo'
    when 'Tzimisce' then 'Cobiça' when 'Ventrue' then 'Arrogância'
  end;
$$;
revoke all on function private.v5_clan_compulsion(text) from public;

-- Compulsão ativa: a named compulsion from the field's options, 'Nenhuma' to
-- clear, or null to roll the d10 table (1-3 Fome, 4-5 Dominação,
-- 6-7 Destruição, 8 Paranoia, 9-10 clã; conferir). Without a clan compulsion the
-- 9-10 result is rolled again.
create or replace function public.v5_set_compulsion(p_sheet_id uuid, p_operation_id uuid, p_compulsion text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  locked record;
  sheet public.character_sheets;
  replay jsonb;
  field jsonb;
  clan_name text;
  value text := p_compulsion;
  face integer;
  dice integer[] := '{}';
  outcome jsonb;
  event public.v5_blood_events;
begin
  select * into locked from private.v5_lock_blood_sheet(p_sheet_id);
  sheet := locked.sheet;
  replay := private.v5_blood_replay(sheet, p_operation_id, 'compulsion');
  if replay is not null then return replay; end if;
  field := private.v5_template_field(locked.template_schema, 'compulsao_atual');
  if field is null or field ->> 'kind' <> 'select' then
    raise exception 'template has no compulsion field' using errcode = '22023';
  end if;
  clan_name := private.v5_clan_compulsion(sheet.values ->> 'cla');
  if value is null then
    for attempt in 1 .. 20 loop
      face := private.v5_random_die();
      dice := dice || face;
      value := case when face <= 3 then 'Fome' when face <= 5 then 'Dominação' when face <= 7 then 'Destruição'
                    when face = 8 then 'Paranoia' when clan_name is not null then 'Compulsão do clã' end;
      exit when value is not null;
    end loop;
    if value is null then value := 'Fome'; end if;
  end if;
  if not exists (select 1 from jsonb_array_elements_text(coalesce(field -> 'options', '[]'::jsonb)) as options(option)
                  where option = value) then
    raise exception 'compulsion is not an option of this sheet' using errcode = '22023';
  end if;
  if value = 'Compulsão do clã' and clan_name is null then
    raise exception 'this clan has no clan compulsion' using errcode = '22023';
  end if;
  outcome := jsonb_build_object('compulsion', value, 'previous', sheet.values ->> 'compulsao_atual',
    'clan_compulsion', case when value = 'Compulsão do clã' then clan_name end, 'rolled', cardinality(dice) > 0);
  sheet := private.v5_write_blood_values(sheet.id, jsonb_build_object('compulsao_atual', value));
  event := private.v5_record_blood_event(sheet, p_operation_id, 'compulsion', dice, outcome);
  return private.v5_blood_result(sheet, event);
end;
$$;
revoke all on function public.v5_set_compulsion(uuid, uuid, text) from public, anon;
grant execute on function public.v5_set_compulsion(uuid, uuid, text) to authenticated;

-- Torpor length by Humanity (conferir no livro).
create or replace function private.v5_torpor_duration(p_humanity integer)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select (array['um milênio ou mais', 'cinco séculos', 'um século', 'cinco décadas', 'uma década', 'um ano',
                'um mês', 'duas semanas', 'uma semana', 'três dias', 'um dia'])[greatest(0, least(10, coalesce(p_humanity, 0))) + 1];
$$;
revoke all on function private.v5_torpor_duration(integer) from public;

-- Entrar/sair de Torpor: requires a 'torpor' checkbox field in the template.
create or replace function public.v5_set_torpor(p_sheet_id uuid, p_operation_id uuid, p_in_torpor boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  locked record;
  sheet public.character_sheets;
  replay jsonb;
  field jsonb;
  humanity integer;
  outcome jsonb;
  event public.v5_blood_events;
begin
  if p_in_torpor is null then raise exception 'torpor state required' using errcode = '22023'; end if;
  select * into locked from private.v5_lock_blood_sheet(p_sheet_id);
  sheet := locked.sheet;
  replay := private.v5_blood_replay(sheet, p_operation_id, 'torpor');
  if replay is not null then return replay; end if;
  field := private.v5_template_field(locked.template_schema, 'torpor');
  if field is null or field ->> 'kind' <> 'checkbox' then
    raise exception 'template has no torpor field' using errcode = '22023';
  end if;
  if coalesce(sheet.values -> 'torpor' = 'true'::jsonb, false) = p_in_torpor then
    raise exception 'sheet is already in that torpor state' using errcode = '22023';
  end if;
  humanity := greatest(0, least(10, private.v5_sheet_int(sheet.values, 'humanidade', 7)));
  sheet := private.v5_write_blood_values(sheet.id, jsonb_build_object('torpor', p_in_torpor));
  outcome := jsonb_build_object('in_torpor', p_in_torpor, 'humanity', humanity,
    'duration', case when p_in_torpor then private.v5_torpor_duration(humanity) end);
  event := private.v5_record_blood_event(sheet, p_operation_id, 'torpor', '{}', outcome);
  return private.v5_blood_result(sheet, event);
end;
$$;
revoke all on function public.v5_set_torpor(uuid, uuid, boolean) from public, anon;
grant execute on function public.v5_set_torpor(uuid, uuid, boolean) to authenticated;

-- apply_v5_damage, now with an explicit p_halve_superficial flag: physical
-- Superficial damage to Health is halved (rounded up) after armor when the
-- sheet is a V5 vampire (ordem armadura -> metade: conferir). Mortal sheets and
-- the Willpower track ignore the flag. Body taken from
-- 20261026140000_inventory_combat_shopping.sql and otherwise unchanged.
create or replace function public.apply_v5_damage(
  p_sheet_id uuid, p_track text, p_superficial integer, p_aggravated integer,
  p_apply_armor boolean, p_operation_id uuid, p_reason text, p_halve_superficial boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  template_schema jsonb;
  sup_field text;
  agg_field text;
  first_value jsonb;
  second_value jsonb;
  maximum integer;
  sup integer;
  agg integer;
  sup_before integer;
  agg_before integer;
  incoming_sup integer;
  incoming_agg integer;
  armor_id uuid;
  armor_name text;
  armor_protection integer;
  absorbed integer := 0;
  halved integer := 0;
  vampire boolean := false;
  converted integer := 0;
  overflow integer := 0;
  prior public.character_sheet_events;
  event public.character_sheet_events;
  summary text;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_track is null or p_track not in ('health', 'willpower') then
    raise exception 'track must be health or willpower' using errcode = '22023';
  end if;
  if p_superficial is null or p_aggravated is null or p_superficial not between 0 and 30
     or p_aggravated not between 0 and 30 or p_superficial + p_aggravated = 0 then
    raise exception 'damage must be between 0 and 30 per kind and not empty' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(p_reason) > 120 then
    raise exception 'reason must have at most 120 characters' using errcode = '22023';
  end if;

  select * into sheet from public.character_sheets where id = p_sheet_id for update;
  if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;

  if p_operation_id is not null then
    select * into prior from public.character_sheet_events
     where sheet_id = p_sheet_id and campaign_id = sheet.campaign_id and actor_id = auth.uid()
       and operation_id = p_operation_id;
    if found then
      if prior.kind <> 'damage' then
        raise exception 'operation ID was already used for another adjustment' using errcode = '23505';
      end if;
      return jsonb_build_object('sheet', to_jsonb(sheet), 'event', to_jsonb(prior), 'replayed', true);
    end if;
  end if;

  sup_field := case p_track when 'health' then 'saude_superficial' else 'vontade_superficial' end;
  agg_field := case p_track when 'health' then 'saude_agravada' else 'vontade_agravada' end;
  select schema into template_schema from public.system_templates
   where id = sheet.template_id and campaign_id = sheet.campaign_id and status = 'approved';
  if (select count(*) from jsonb_array_elements(coalesce(template_schema -> 'fields', '[]'::jsonb)) as fields(field)
       where field ->> 'id' in (sup_field, agg_field) and field ->> 'kind' = 'number') <> 2 then
    raise exception 'template has no % damage track', p_track using errcode = '22023';
  end if;
  vampire := private.v5_is_vampire_schema(template_schema);

  -- Same maximum the client shows: Health = Stamina + 3, Willpower = Composure + Resolve.
  first_value := sheet.values -> case p_track when 'health' then 'vigor' else 'autocontrole' end;
  second_value := case p_track when 'health' then '3'::jsonb else sheet.values -> 'resolucao' end;
  if jsonb_typeof(first_value) is distinct from 'number' or jsonb_typeof(second_value) is distinct from 'number' then
    raise exception 'sheet has no values to size the % track', p_track using errcode = '22023';
  end if;
  maximum := least(30, greatest(0, trunc((first_value #>> '{}')::numeric)::integer + trunc((second_value #>> '{}')::numeric)::integer));
  if maximum = 0 then raise exception 'the % track is empty', p_track using errcode = '22023'; end if;

  sup := case when jsonb_typeof(sheet.values -> sup_field) = 'number' then greatest(0, trunc((sheet.values ->> sup_field)::numeric)::integer) else 0 end;
  agg := case when jsonb_typeof(sheet.values -> agg_field) = 'number' then greatest(0, trunc((sheet.values ->> agg_field)::numeric)::integer) else 0 end;
  -- A track that shrank (lower Stamina) keeps its Aggravated boxes first.
  agg := least(agg, maximum);
  sup := least(sup, maximum - agg);
  sup_before := sup;
  agg_before := agg;
  incoming_sup := p_superficial;
  incoming_agg := p_aggravated;

  if p_track = 'health' and coalesce(p_apply_armor, true) then
    select id, name, protection into armor_id, armor_name, armor_protection from public.character_inventory
     where sheet_id = sheet.id and campaign_id = sheet.campaign_id
       and category = 'armor' and equipped and acquired
     limit 1;
    if armor_id is not null then
      absorbed := least(armor_protection, incoming_sup);
      incoming_sup := incoming_sup - absorbed;
    end if;
  end if;

  if p_track = 'health' and coalesce(p_halve_superficial, false) and vampire then
    halved := incoming_sup / 2;
    incoming_sup := incoming_sup - halved;
  end if;

  for i in 1..incoming_agg loop
    if sup + agg < maximum then agg := agg + 1;
    elsif sup > 0 then sup := sup - 1; agg := agg + 1; converted := converted + 1;
    else overflow := overflow + 1;
    end if;
  end loop;
  for i in 1..incoming_sup loop
    if sup + agg < maximum then sup := sup + 1;
    elsif sup > 0 then sup := sup - 1; agg := agg + 1; converted := converted + 1;
    else overflow := overflow + 1;
    end if;
  end loop;

  if sup <> sup_before or agg <> agg_before then
    perform set_config('rpg.atomic_adjustment', 'on', true);
    update public.character_sheets
       set values = jsonb_set(jsonb_set(values, array[sup_field], to_jsonb(sup)), array[agg_field], to_jsonb(agg))
     where id = p_sheet_id
    returning * into sheet;
    perform set_config('rpg.atomic_adjustment', 'off', true);
    if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
    summary := left(concat_ws(' · ', nullif(p_reason, ''),
      format('%s superficial, %s agravado', p_superficial, p_aggravated),
      case when absorbed > 0 then format('armadura -%s', absorbed) end,
      case when halved > 0 then format('metade (vampiro) -%s', halved) end,
      case when converted > 0 then format('%s convertido', converted) end), 200);
    event := private.record_sheet_damage_event(
      p_sheet_id, p_operation_id, case when agg <> agg_before then agg_field else sup_field end,
      incoming_sup + incoming_agg,
      case when agg <> agg_before then agg_before else sup_before end,
      case when agg <> agg_before then agg else sup end, summary);
  end if;

  return jsonb_build_object(
    'sheet', to_jsonb(sheet),
    'event', case when event.id is null then null else to_jsonb(event) end,
    'replayed', false,
    'track', p_track,
    'maximum', maximum,
    'superficial', sup,
    'aggravated', agg,
    'absorbed_by_armor', absorbed,
    'halved', halved,
    'vampire', vampire,
    'armor', case when armor_id is not null then jsonb_build_object('id', armor_id, 'name', armor_name, 'protection', armor_protection) end,
    'converted', converted,
    'overflow', overflow,
    'impaired', sup + agg >= maximum,
    'incapacitated', agg >= maximum
  );
end;
$$;
revoke all on function public.apply_v5_damage(uuid, text, integer, integer, boolean, uuid, text, boolean) from public, anon;
grant execute on function public.apply_v5_damage(uuid, text, integer, integer, boolean, uuid, text, boolean) to authenticated;

-- The previous 7-argument signature stays for existing callers and never halves.
create or replace function public.apply_v5_damage(
  p_sheet_id uuid, p_track text, p_superficial integer, p_aggravated integer,
  p_apply_armor boolean default true, p_operation_id uuid default null, p_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select public.apply_v5_damage(p_sheet_id, p_track, p_superficial, p_aggravated, p_apply_armor, p_operation_id, p_reason, false);
$$;
revoke all on function public.apply_v5_damage(uuid, text, integer, integer, boolean, uuid, text) from public, anon;
grant execute on function public.apply_v5_damage(uuid, text, integer, integer, boolean, uuid, text) to authenticated;
