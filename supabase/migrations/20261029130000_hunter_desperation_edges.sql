-- Frente F4: Caçador: A Revanche (5ª ed.) completo.
--
-- 1. Desesperação (Desperation) e Perigo (Danger) vivem só na célula (hunter_cells); a ficha guarda
--    só o estado Despair (`em_desespero`). O campo antigo `desespero` da ficha migra para a célula
--    vinculada, quando houver, ou é descartado com registro em hunter_desperation_migration_reports.
-- 2. A ficha se vincula à célula por id (hunter_cell_members): uma célula por ficha daqui em diante.
--    Fichas cujo texto `celula` bate com o nome de uma célula da campanha são vinculadas na migração.
-- 3. Rolador com dados gerados no banco (como v5_roll_records): lê a Desesperação da célula, guarda os
--    dados, aceita uma rerrolagem de Vontade (até 3 dados comuns, gasto atômico) e a escolha da mesa
--    entre Overreach (Perigo +1) e Despair (marca a ficha), aplicada de forma atômica e idempotente.
-- 4. Redenção: o jogador registra o pedido ligado ao Ímpeto e o narrador decide; aprovar encerra o Despair.
-- 5. Ajuste de Perigo/Desesperação da célula por RPC idempotente, com evento de auditoria.
-- Regras marcadas para conferência no livro: docs/CACADOR_CRIACAO_GUIADA.md (seção F4).

-- ---------------------------------------------------------------------------------------------
-- Vínculo ficha -> célula
-- ---------------------------------------------------------------------------------------------

-- The cell of a sheet: its oldest membership (older data may list a sheet in two cells).
create or replace function private.hunter_sheet_cell(p_sheet_id uuid)
returns public.hunter_cells
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select cell.*
    from public.hunter_cell_members member
    join public.hunter_cells cell on cell.id = member.cell_id and cell.campaign_id = member.campaign_id
   where member.sheet_id = p_sheet_id
   order by member.created_at, member.cell_id
   limit 1;
$$;
revoke all on function private.hunter_sheet_cell(uuid) from public, anon, authenticated;

-- New memberships keep one cell per sheet; rows that predate this migration are left as they are.
create or replace function private.guard_hunter_single_cell()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if exists (select 1 from public.hunter_cell_members other
              where other.sheet_id = new.sheet_id and other.cell_id <> new.cell_id) then
    raise exception 'a sheet belongs to one hunter cell' using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_hunter_single_cell() from public, anon, authenticated;
create trigger hunter_cell_members_single_cell
  before insert on public.hunter_cell_members
  for each row execute function private.guard_hunter_single_cell();

create or replace function private.is_hunter_sheet(p_values jsonb, p_schema jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(p_schema ->> 'system_key', '') = 'hunter'
      or coalesce(p_values ->> 'sistema', '') = 'Caçador: A Revanche';
$$;
revoke all on function private.is_hunter_sheet(jsonb, jsonb) from public;
grant execute on function private.is_hunter_sheet(jsonb, jsonb) to authenticated;

create or replace function private.hunter_in_despair(p_values jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(p_values -> 'em_desespero' = 'true'::jsonb, false);
$$;
revoke all on function private.hunter_in_despair(jsonb) from public;
grant execute on function private.hunter_in_despair(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Eventos de célula e ficha (append-only)
-- ---------------------------------------------------------------------------------------------
create table public.hunter_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  cell_id uuid references public.hunter_cells(id) on delete set null,
  sheet_id uuid references public.character_sheets(id) on delete cascade,
  roll_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('cell_adjust', 'overreach', 'despair', 'redemption_requested',
                                     'redemption_approved', 'redemption_rejected', 'migration')),
  operation_id uuid,
  danger_before smallint, danger_after smallint,
  desperation_before smallint, desperation_after smallint,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create unique index hunter_events_operation_idx on public.hunter_events (actor_id, cell_id, operation_id)
  where operation_id is not null;
create index hunter_events_cell_idx on public.hunter_events (cell_id, id desc);
create index hunter_events_sheet_idx on public.hunter_events (sheet_id, id desc);
alter table public.hunter_events enable row level security;
revoke all on public.hunter_events from anon, authenticated;
grant select on public.hunter_events to authenticated;
create policy "members read hunter events" on public.hunter_events for select to authenticated
  using (private.is_campaign_member(campaign_id));
comment on table public.hunter_events is
  'Hunter cell and Despair log: cell adjustments, Overreach, Despair and Redemption. Written only by the F4 RPCs.';

-- ---------------------------------------------------------------------------------------------
-- Migração: `desespero` da ficha -> célula
-- ---------------------------------------------------------------------------------------------
create table public.hunter_desperation_migration_reports (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sheet_id uuid references public.character_sheets(id) on delete set null,
  sheet_name text,
  cell_id uuid references public.hunter_cells(id) on delete set null,
  sheet_value jsonb,
  cell_before smallint,
  cell_after smallint,
  outcome text not null check (outcome in ('linked_by_name', 'moved_to_cell', 'discarded_no_cell', 'discarded_invalid', 'kept_update_failed')),
  detail text
);
alter table public.hunter_desperation_migration_reports enable row level security;
revoke all on public.hunter_desperation_migration_reports from anon, authenticated;
grant select on public.hunter_desperation_migration_reports to authenticated;
create policy "managers read hunter migration reports" on public.hunter_desperation_migration_reports
  for select to authenticated using (private.can_manage_campaign(campaign_id));
comment on table public.hunter_desperation_migration_reports is
  'F4 migration report: Desperation moved from Hunter sheets to their cell, or discarded when the sheet had no cell.';

-- Idempotent: a second run finds no `desespero` keys left. Returns how many sheets it touched.
create or replace function private.migrate_hunter_sheet_desperation()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  sheet record;
  cell public.hunter_cells;
  matched public.hunter_cells;
  raw jsonb;
  amount integer;
  before_value smallint;
  touched integer := 0;
  moved integer := 0;
  discarded integer := 0;
begin
  -- Link by name: the text `celula` of a sheet without a cell names a cell of its campaign.
  for sheet in
    select s.id, s.campaign_id, s.name, s.values from public.character_sheets s
      join public.system_templates t on t.id = s.template_id
     where private.is_hunter_sheet(s.values, t.schema)
       and jsonb_typeof(s.values -> 'celula') = 'string' and btrim(s.values ->> 'celula') <> ''
       and not exists (select 1 from public.hunter_cell_members m where m.sheet_id = s.id)
  loop
    select * into matched from public.hunter_cells c
     where c.campaign_id = sheet.campaign_id and lower(btrim(c.name)) = lower(btrim(sheet.values ->> 'celula'))
     limit 1;
    if matched.id is not null then
      insert into public.hunter_cell_members (cell_id, campaign_id, sheet_id) values (matched.id, sheet.campaign_id, sheet.id);
      insert into public.hunter_desperation_migration_reports (campaign_id, sheet_id, sheet_name, cell_id, outcome, detail)
      values (sheet.campaign_id, sheet.id, sheet.name, matched.id, 'linked_by_name', 'célula vinculada pelo nome do campo Célula');
    end if;
    matched := null;
  end loop;

  for sheet in
    select s.id, s.campaign_id, s.name, s.values from public.character_sheets s
      join public.system_templates t on t.id = s.template_id
     where private.is_hunter_sheet(s.values, t.schema) and s.values ? 'desespero'
     order by s.campaign_id, s.id
  loop
    touched := touched + 1;
    raw := sheet.values -> 'desespero';
    cell := private.hunter_sheet_cell(sheet.id);
    amount := case when jsonb_typeof(raw) = 'number' and (raw #>> '{}')::numeric = trunc((raw #>> '{}')::numeric)
                        and (raw #>> '{}')::numeric between 0 and 5 then (raw #>> '{}')::integer end;
    begin
      update public.character_sheets set values = values - 'desespero' where id = sheet.id;
    exception when others then
      insert into public.hunter_desperation_migration_reports (campaign_id, sheet_id, sheet_name, cell_id, sheet_value, outcome, detail)
      values (sheet.campaign_id, sheet.id, sheet.name, cell.id, raw, 'kept_update_failed', left(sqlerrm, 300));
      continue;
    end;
    if amount is null then
      discarded := discarded + 1;
      insert into public.hunter_desperation_migration_reports (campaign_id, sheet_id, sheet_name, cell_id, sheet_value, outcome, detail)
      values (sheet.campaign_id, sheet.id, sheet.name, cell.id, raw, 'discarded_invalid', 'valor fora de 0 a 5; a célula não mudou');
    elsif cell.id is null then
      discarded := discarded + 1;
      insert into public.hunter_desperation_migration_reports (campaign_id, sheet_id, sheet_name, sheet_value, outcome, detail)
      values (sheet.campaign_id, sheet.id, sheet.name, raw, 'discarded_no_cell',
              'ficha sem célula vinculada; ajuste a Desesperação na célula quando ela existir');
    else
      before_value := cell.desperation;
      -- Members of one cell may disagree; the cell keeps the highest value seen.
      if amount > cell.desperation then
        update public.hunter_cells set desperation = amount where id = cell.id;
      end if;
      moved := moved + 1;
      insert into public.hunter_desperation_migration_reports
        (campaign_id, sheet_id, sheet_name, cell_id, sheet_value, cell_before, cell_after, outcome, detail)
      values (sheet.campaign_id, sheet.id, sheet.name, cell.id, raw, before_value, greatest(before_value, amount), 'moved_to_cell',
              'a célula fica com o maior valor entre ela e as fichas');
      insert into public.hunter_events (campaign_id, cell_id, sheet_id, kind, desperation_before, desperation_after, note)
      values (sheet.campaign_id, cell.id, sheet.id, 'migration', before_value, greatest(before_value, amount),
              'Desesperação migrada da ficha');
    end if;
  end loop;
  raise notice 'Hunter desperation migration: % sheet(s), % moved to a cell, % discarded (see hunter_desperation_migration_reports)',
    touched, moved, discarded;
  return touched;
end;
$$;
revoke all on function private.migrate_hunter_sheet_desperation() from public, anon, authenticated;

select private.migrate_hunter_sheet_desperation();

-- ---------------------------------------------------------------------------------------------
-- Rolagens de Caçador
-- ---------------------------------------------------------------------------------------------
create table public.hunter_roll_records (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  cell_id uuid references public.hunter_cells(id) on delete set null,
  author_id uuid references auth.users(id) on delete set null,
  base_pool integer not null check (base_pool between 1 and 30),
  desperation integer not null check (desperation between 0 and 5),
  difficulty integer not null check (difficulty between 1 and 69),
  normal_dice integer[] not null,
  desperation_dice integer[] not null,
  outcome jsonb not null check (jsonb_typeof(outcome) = 'object'),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 8192),
  original_normal_dice integer[],
  rerolled_indices integer[],
  willpower_event_id bigint references public.character_sheet_events(id) on delete set null,
  rerolled_at timestamptz,
  resolution text check (resolution in ('overreach', 'despair')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (cardinality(normal_dice) = base_pool),
  check (cardinality(desperation_dice) = desperation),
  check ((rerolled_at is null) = (original_normal_dice is null) and (rerolled_at is null) = (rerolled_indices is null)),
  check (rerolled_indices is null or cardinality(rerolled_indices) between 1 and 3),
  check ((resolution is null) = (resolved_at is null))
);
create index hunter_roll_records_sheet_idx on public.hunter_roll_records (sheet_id, created_at desc, id desc);
alter table public.hunter_roll_records enable row level security;
revoke all on public.hunter_roll_records from anon, authenticated;
grant select on public.hunter_roll_records to authenticated;
create policy "campaign members read hunter rolls" on public.hunter_roll_records for select to authenticated
  using (private.is_campaign_member(campaign_id));
comment on table public.hunter_roll_records is
  'Hunter rolls generated by record_hunter_roll; one Willpower reroll and one Desperation resolution each. Newest 50 per sheet.';

-- Successes are 6+; each pair of 10s (normal and Desperation dice together) adds 2 more.
-- A 1 on a Desperation die: success lets the table choose Overreach or Despair; failure is Despair.
create or replace function private.hunter_roll_outcome(p_normal integer[], p_desperation integer[], p_difficulty integer)
returns jsonb
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  with faces as (
    select face, false as desperate from unnest(coalesce(p_normal, '{}'::integer[])) as face
    union all
    select face, true from unnest(coalesce(p_desperation, '{}'::integer[])) as face
  ), counts as (
    select count(*) filter (where face >= 6) as successes,
           count(*) filter (where face = 10) as tens,
           count(*) filter (where face = 1 and desperate) as ones
      from faces
  ), totals as (
    select successes + 2 * (tens / 2) as total, tens / 2 as pairs, ones from counts
  )
  select jsonb_build_object(
    'successes', total,
    'success', total >= p_difficulty,
    'critical_pairs', pairs,
    'critical', total >= p_difficulty and pairs > 0,
    'desperation_ones', ones,
    'desperation_consequence', case when ones = 0 then null when total >= p_difficulty then 'table_choice' else 'despair' end
  ) from totals;
$$;
revoke all on function private.hunter_roll_outcome(integer[], integer[], integer) from public;
grant execute on function private.hunter_roll_outcome(integer[], integer[], integer) to authenticated;

create or replace function private.hunter_cell_json(p_cell public.hunter_cells)
returns jsonb
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case when p_cell.id is null then null else jsonb_build_object(
    'id', p_cell.id, 'name', p_cell.name, 'danger', p_cell.danger, 'desperation', p_cell.desperation, 'version', p_cell.version) end;
$$;
revoke all on function private.hunter_cell_json(public.hunter_cells) from public;
grant execute on function private.hunter_cell_json(public.hunter_cells) to authenticated;

-- p_details may carry {"edge": "<Triunfo>"}: an Edge must be on the sheet and is blocked in Despair.
create or replace function public.record_hunter_roll(
  p_sheet_id uuid, p_base_pool integer, p_difficulty integer, p_use_desperation boolean default false, p_details jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  template_schema jsonb;
  cell public.hunter_cells;
  desperation integer := 0;
  normal_dice integer[] := '{}';
  desperation_dice integer[] := '{}';
  saved public.hunter_roll_records;
  edge text;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_base_pool is null or p_base_pool not between 1 and 30 or p_difficulty is null or p_difficulty not between 1 and 69 then
    raise exception 'invalid pool or difficulty' using errcode = '22023';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' or pg_column_size(p_details) > 8192 then
    raise exception 'details must be a small object' using errcode = '22023';
  end if;
  select * into sheet from public.character_sheets where id = p_sheet_id;
  if not found or not private.can_write_sheet(sheet) then
    raise exception 'sheet not found or not writable' using errcode = '42501';
  end if;
  select schema into template_schema from public.system_templates where id = sheet.template_id and campaign_id = sheet.campaign_id;
  if not private.is_hunter_sheet(sheet.values, template_schema) then
    raise exception 'not a Hunter sheet' using errcode = '22023';
  end if;
  edge := nullif(btrim(coalesce(p_details ->> 'edge', '')), '');
  if edge is not null then
    if private.hunter_in_despair(sheet.values) then
      raise exception 'Edges are blocked while the hunter is in Despair' using errcode = '55000';
    end if;
    if jsonb_typeof(sheet.values -> 'triunfos') is distinct from 'array' or not (sheet.values -> 'triunfos') ? edge then
      raise exception 'the sheet does not have this Edge' using errcode = '22023';
    end if;
  end if;
  cell := private.hunter_sheet_cell(sheet.id);
  if coalesce(p_use_desperation, false) then
    if private.hunter_in_despair(sheet.values) then
      raise exception 'a hunter in Despair cannot add Desperation dice' using errcode = '55000';
    end if;
    desperation := coalesce(cell.desperation, 0);
  end if;
  for i in 1 .. p_base_pool loop normal_dice := normal_dice || private.v5_random_die(); end loop;
  for i in 1 .. desperation loop desperation_dice := desperation_dice || private.v5_random_die(); end loop;
  insert into public.hunter_roll_records
    (campaign_id, sheet_id, cell_id, author_id, base_pool, desperation, difficulty, normal_dice, desperation_dice, outcome, details)
  values
    (sheet.campaign_id, sheet.id, cell.id, auth.uid(), p_base_pool, desperation, p_difficulty, normal_dice, desperation_dice,
     private.hunter_roll_outcome(normal_dice, desperation_dice, p_difficulty), p_details)
  returning * into saved;
  delete from public.hunter_roll_records old
   where old.sheet_id = sheet.id
     and old.id not in (select keep.id from public.hunter_roll_records keep where keep.sheet_id = sheet.id
                         order by keep.created_at desc, keep.id desc limit 50);
  return jsonb_build_object('roll', to_jsonb(saved), 'cell', private.hunter_cell_json(cell),
                            'in_despair', private.hunter_in_despair(sheet.values));
end;
$$;
revoke all on function public.record_hunter_roll(uuid, integer, integer, boolean, jsonb) from public, anon;
grant execute on function public.record_hunter_roll(uuid, integer, integer, boolean, jsonb) to authenticated;

-- Up to three ordinary dice (never Desperation dice), once per roll and before the table resolves
-- a Desperation 1. One Willpower is spent in the same transaction (same path as reroll_v5_roll).
create or replace function public.reroll_hunter_roll(p_roll_id uuid, p_indices integer[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  roll public.hunter_roll_records;
  sheet public.character_sheets;
  template_schema jsonb;
  currency jsonb;
  new_dice integer[];
  idx integer;
  spend jsonb;
  willpower_max numeric;
  damage numeric;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  select * into roll from public.hunter_roll_records where id = p_roll_id for update;
  if not found or roll.author_id is distinct from auth.uid() then
    raise exception 'roll not found or not yours' using errcode = '42501';
  end if;
  if roll.rerolled_at is not null then
    raise exception 'this roll was already rerolled with Willpower' using errcode = '23505';
  end if;
  if roll.resolution is not null then
    raise exception 'the Desperation result was already resolved' using errcode = '55000';
  end if;
  if p_indices is null or cardinality(p_indices) not between 1 and 3
     or (select count(distinct value) from unnest(p_indices) as value) <> cardinality(p_indices)
     or exists (select 1 from unnest(p_indices) as value where value is null or value < 0 or value >= cardinality(roll.normal_dice)) then
    raise exception 'choose from one to three distinct ordinary dice' using errcode = '22023';
  end if;
  select * into sheet from public.character_sheets where id = roll.sheet_id for update;
  if not found or not private.can_write_sheet(sheet) then
    raise exception 'sheet not found or not writable' using errcode = '42501';
  end if;
  select schema into template_schema from public.system_templates where id = sheet.template_id and campaign_id = sheet.campaign_id;
  select value into currency from jsonb_array_elements(coalesce(template_schema -> 'meta_currencies', '[]'::jsonb))
   where value ->> 'id' = 'vontade' limit 1;
  if currency is not null and currency ->> 'mode' = 'track' then
    willpower_max := case
      when jsonb_typeof(currency -> 'max') = 'number' then (currency ->> 'max')::numeric
      when jsonb_typeof(sheet.values -> coalesce(currency ->> 'max_field', 'vontade_max')) = 'number'
        then (sheet.values ->> coalesce(currency ->> 'max_field', 'vontade_max'))::numeric
      when jsonb_typeof(sheet.values -> 'autocontrole') = 'number' and jsonb_typeof(sheet.values -> 'resolucao') = 'number'
        then (sheet.values ->> 'autocontrole')::numeric + (sheet.values ->> 'resolucao')::numeric
    end;
    damage := coalesce(case when jsonb_typeof(sheet.values -> (currency ->> 'field')) = 'number'
                            then (sheet.values ->> (currency ->> 'field'))::numeric end, 0)
            + coalesce(case when jsonb_typeof(sheet.values -> 'vontade_agravada') = 'number'
                            then (sheet.values ->> 'vontade_agravada')::numeric end, 0);
    if willpower_max is not null and damage + 1 > willpower_max then
      raise exception 'Willpower track is full' using errcode = '23514';
    end if;
  end if;
  new_dice := roll.normal_dice;
  foreach idx in array p_indices loop
    new_dice[idx + 1] := private.v5_random_die();
  end loop;
  update public.hunter_roll_records
     set original_normal_dice = roll.normal_dice, normal_dice = new_dice,
         rerolled_indices = (select array_agg(value order by value) from unnest(p_indices) as value),
         outcome = private.hunter_roll_outcome(new_dice, roll.desperation_dice, roll.difficulty),
         rerolled_at = now()
   where id = roll.id returning * into roll;
  if currency is not null then
    spend := public.spend_meta_currency(sheet.id, 'vontade', 1, 'Rerrolagem de Vontade (Caçador)');
  elsif exists (select 1 from jsonb_array_elements(coalesce(template_schema -> 'fields', '[]'::jsonb)) as fields(field)
                 where field ->> 'id' = 'vontade_superficial' and field ->> 'kind' = 'number') then
    spend := public.adjust_sheet_number(sheet.id, 'vontade_superficial', 1, 'Rerrolagem de Vontade (Caçador)');
  else
    raise exception 'the sheet has no Willpower to spend' using errcode = '22023';
  end if;
  update public.hunter_roll_records set willpower_event_id = (spend -> 'event' ->> 'id')::bigint
   where id = roll.id returning * into roll;
  return jsonb_build_object('roll', to_jsonb(roll), 'willpower_spent', true, 'sheet_values', spend -> 'sheet' -> 'values');
end;
$$;
revoke all on function public.reroll_hunter_roll(uuid, integer[]) from public, anon;
grant execute on function public.reroll_hunter_roll(uuid, integer[]) to authenticated;

-- The table's choice on a Desperation 1. Overreach keeps the success and raises the cell's Danger by 1
-- (up to 5); Despair turns the roll into a failure and marks the sheet. Repeating the same choice
-- returns the stored result; a different choice after resolution is refused.
create or replace function public.resolve_hunter_desperation(p_roll_id uuid, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  roll public.hunter_roll_records;
  sheet public.character_sheets;
  cell public.hunter_cells;
  before_danger smallint;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_choice is null or p_choice not in ('overreach', 'despair') then
    raise exception 'choose overreach or despair' using errcode = '22023';
  end if;
  select * into roll from public.hunter_roll_records where id = p_roll_id for update;
  if not found then raise exception 'roll not found' using errcode = '42501'; end if;
  select * into sheet from public.character_sheets where id = roll.sheet_id for update;
  if not found or not private.can_write_sheet(sheet) then
    raise exception 'sheet not found or not writable' using errcode = '42501';
  end if;
  if roll.cell_id is not null then
    select * into cell from public.hunter_cells where id = roll.cell_id for update;
  end if;
  if roll.resolution is not null then
    if roll.resolution <> p_choice then
      raise exception 'the Desperation result was already resolved as %', roll.resolution using errcode = '23505';
    end if;
    return jsonb_build_object('roll', to_jsonb(roll), 'cell', private.hunter_cell_json(cell),
                              'in_despair', private.hunter_in_despair(sheet.values), 'replayed', true);
  end if;
  if coalesce((roll.outcome ->> 'desperation_ones')::integer, 0) = 0 then
    raise exception 'no Desperation 1 to resolve' using errcode = '22023';
  end if;
  if p_choice = 'overreach' and not coalesce((roll.outcome ->> 'success')::boolean, false) then
    raise exception 'a failed roll cannot Overreach' using errcode = '22023';
  end if;
  if p_choice = 'overreach' then
    if cell.id is not null then
      before_danger := cell.danger;
      update public.hunter_cells set danger = least(5, danger + 1) where id = cell.id returning * into cell;
    end if;
    insert into public.hunter_events (campaign_id, cell_id, sheet_id, roll_id, actor_id, kind, danger_before, danger_after, note)
    values (roll.campaign_id, cell.id, sheet.id, roll.id, auth.uid(), 'overreach', before_danger, cell.danger,
            case when cell.id is null then 'ficha sem célula: Perigo não mudou' end);
  else
    perform set_config('rpg.atomic_adjustment', 'on', true);
    update public.character_sheets set values = values || '{"em_desespero": true}'::jsonb where id = sheet.id returning * into sheet;
    perform set_config('rpg.atomic_adjustment', 'off', true);
    insert into public.hunter_events (campaign_id, cell_id, sheet_id, roll_id, actor_id, kind)
    values (roll.campaign_id, cell.id, sheet.id, roll.id, auth.uid(), 'despair');
  end if;
  update public.hunter_roll_records
     set resolution = p_choice, resolved_by = auth.uid(), resolved_at = now(),
         outcome = outcome || jsonb_build_object('final_success', p_choice = 'overreach')
   where id = roll.id returning * into roll;
  return jsonb_build_object('roll', to_jsonb(roll), 'cell', private.hunter_cell_json(cell),
                            'in_despair', private.hunter_in_despair(sheet.values), 'replayed', false);
end;
$$;
revoke all on function public.resolve_hunter_desperation(uuid, text) from public, anon;
grant execute on function public.resolve_hunter_desperation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Ajuste de Perigo e Desesperação da célula (narrador)
-- ---------------------------------------------------------------------------------------------
create or replace function public.adjust_hunter_cell(
  p_cell_id uuid, p_operation_id uuid, p_danger_delta integer default 0, p_desperation_delta integer default 0, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  cell public.hunter_cells;
  prior public.hunter_events;
  saved public.hunter_events;
  before_danger smallint;
  before_desperation smallint;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_operation_id is null or p_danger_delta is null or p_desperation_delta is null
     or (p_danger_delta = 0 and p_desperation_delta = 0) or abs(p_danger_delta) > 5 or abs(p_desperation_delta) > 5 then
    raise exception 'invalid operation or deltas' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'reason must have at most 500 characters' using errcode = '22023';
  end if;
  select * into cell from public.hunter_cells where id = p_cell_id for update;
  if not found or not private.can_manage_campaign(cell.campaign_id) then
    raise exception 'cell not found or not managed by you' using errcode = '42501';
  end if;
  select * into prior from public.hunter_events
   where actor_id = auth.uid() and cell_id = cell.id and operation_id = p_operation_id;
  if found then
    if prior.kind <> 'cell_adjust' or coalesce(prior.danger_after - prior.danger_before, 0) <> p_danger_delta
       or coalesce(prior.desperation_after - prior.desperation_before, 0) <> p_desperation_delta then
      raise exception 'operation ID was already used for another adjustment' using errcode = '23505';
    end if;
    return jsonb_build_object('cell', private.hunter_cell_json(cell), 'event', to_jsonb(prior), 'replayed', true);
  end if;
  before_danger := cell.danger;
  before_desperation := cell.desperation;
  if before_danger + p_danger_delta not between 0 and 5 or before_desperation + p_desperation_delta not between 0 and 5 then
    raise exception 'Danger and Desperation stay between 0 and 5' using errcode = '23514';
  end if;
  update public.hunter_cells set danger = danger + p_danger_delta, desperation = desperation + p_desperation_delta
   where id = cell.id returning * into cell;
  insert into public.hunter_events (campaign_id, cell_id, actor_id, kind, operation_id, danger_before, danger_after,
                                    desperation_before, desperation_after, note)
  values (cell.campaign_id, cell.id, auth.uid(), 'cell_adjust', p_operation_id, before_danger, cell.danger,
          before_desperation, cell.desperation, p_reason)
  returning * into saved;
  return jsonb_build_object('cell', private.hunter_cell_json(cell), 'event', to_jsonb(saved), 'replayed', false);
end;
$$;
revoke all on function public.adjust_hunter_cell(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.adjust_hunter_cell(uuid, uuid, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Redenção: pedido ligado ao Ímpeto e decisão do narrador
-- ---------------------------------------------------------------------------------------------
create table public.hunter_redemptions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  drive text not null check (char_length(drive) between 1 and 80),
  redemption text not null default '' check (char_length(redemption) <= 240),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null))
);
create unique index hunter_redemptions_pending_idx on public.hunter_redemptions (sheet_id) where status = 'pending';
alter table public.hunter_redemptions enable row level security;
revoke all on public.hunter_redemptions from anon, authenticated;
grant select on public.hunter_redemptions to authenticated;
create policy "members read hunter redemptions" on public.hunter_redemptions for select to authenticated
  using (private.is_campaign_member(campaign_id));

-- The sheet's writer asks; the Ímpeto (`impulso`) and the Redenção text are snapshotted. One pending per sheet.
create or replace function public.request_hunter_redemption(p_sheet_id uuid, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  saved public.hunter_redemptions;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'note too long' using errcode = '22023'; end if;
  select * into sheet from public.character_sheets where id = p_sheet_id for update;
  if not found or not private.can_write_sheet(sheet) then
    raise exception 'sheet not found or not writable' using errcode = '42501';
  end if;
  if not private.hunter_in_despair(sheet.values) then
    raise exception 'the hunter is not in Despair' using errcode = '55000';
  end if;
  if jsonb_typeof(sheet.values -> 'impulso') is distinct from 'string' or btrim(sheet.values ->> 'impulso') = '' then
    raise exception 'Redemption follows the Drive; choose the Ímpeto first' using errcode = '22023';
  end if;
  select * into saved from public.hunter_redemptions where sheet_id = sheet.id and status = 'pending';
  if found then return jsonb_build_object('redemption', to_jsonb(saved), 'replayed', true); end if;
  insert into public.hunter_redemptions (campaign_id, sheet_id, requested_by, drive, redemption, note)
  values (sheet.campaign_id, sheet.id, auth.uid(), left(sheet.values ->> 'impulso', 80),
          left(coalesce(case when jsonb_typeof(sheet.values -> 'redencao') = 'string' then sheet.values ->> 'redencao' end, ''), 240),
          coalesce(p_note, ''))
  returning * into saved;
  insert into public.hunter_events (campaign_id, cell_id, sheet_id, actor_id, kind, note)
  values (sheet.campaign_id, (private.hunter_sheet_cell(sheet.id)).id, sheet.id, auth.uid(), 'redemption_requested', nullif(p_note, ''));
  return jsonb_build_object('redemption', to_jsonb(saved), 'replayed', false);
end;
$$;
revoke all on function public.request_hunter_redemption(uuid, text) from public, anon;
grant execute on function public.request_hunter_redemption(uuid, text) to authenticated;

-- Only a campaign manager decides. Approval ends the Despair state in the same transaction.
create or replace function public.decide_hunter_redemption(p_redemption_id uuid, p_approve boolean, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  request public.hunter_redemptions;
  sheet public.character_sheets;
  wanted text;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_approve is null or (p_note is not null and char_length(p_note) > 500) then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  wanted := case when p_approve then 'approved' else 'rejected' end;
  select * into request from public.hunter_redemptions where id = p_redemption_id for update;
  if not found or not private.can_manage_campaign(request.campaign_id) then
    raise exception 'only the narrator decides a Redemption' using errcode = '42501';
  end if;
  select * into sheet from public.character_sheets where id = request.sheet_id for update;
  if request.status <> 'pending' then
    if request.status <> wanted then
      raise exception 'Redemption already decided as %', request.status using errcode = '23505';
    end if;
    return jsonb_build_object('redemption', to_jsonb(request), 'in_despair', private.hunter_in_despair(sheet.values), 'replayed', true);
  end if;
  update public.hunter_redemptions
     set status = wanted, decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(p_note, '')
   where id = request.id returning * into request;
  if p_approve then
    perform set_config('rpg.atomic_adjustment', 'on', true);
    update public.character_sheets set values = values || '{"em_desespero": false}'::jsonb where id = sheet.id returning * into sheet;
    perform set_config('rpg.atomic_adjustment', 'off', true);
  end if;
  insert into public.hunter_events (campaign_id, cell_id, sheet_id, actor_id, kind, note)
  values (request.campaign_id, (private.hunter_sheet_cell(sheet.id)).id, sheet.id, auth.uid(),
          case when p_approve then 'redemption_approved' else 'redemption_rejected' end, nullif(p_note, ''));
  return jsonb_build_object('redemption', to_jsonb(request), 'in_despair', private.hunter_in_despair(sheet.values), 'replayed', false);
end;
$$;
revoke all on function public.decide_hunter_redemption(uuid, boolean, text) from public, anon;
grant execute on function public.decide_hunter_redemption(uuid, boolean, text) to authenticated;

-- What the roller shows: the cell values, the Despair state, blocked Edges and a pending Redemption.
create or replace function public.hunter_sheet_state(p_sheet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  pending public.hunter_redemptions;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  select * into sheet from public.character_sheets where id = p_sheet_id;
  if not found or not private.is_campaign_member(sheet.campaign_id) then
    raise exception 'sheet not found' using errcode = '42501';
  end if;
  select * into pending from public.hunter_redemptions where sheet_id = sheet.id and status = 'pending';
  return jsonb_build_object(
    'cell', private.hunter_cell_json(private.hunter_sheet_cell(sheet.id)),
    'in_despair', private.hunter_in_despair(sheet.values),
    'edges_blocked', private.hunter_in_despair(sheet.values),
    'pending_redemption', case when pending.id is null then null else to_jsonb(pending) end);
end;
$$;
revoke all on function public.hunter_sheet_state(uuid) from public, anon;
grant execute on function public.hunter_sheet_state(uuid) to authenticated;
