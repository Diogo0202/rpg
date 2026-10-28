-- F2 (Vampiro V5): caçada e alimentação (SAN-01), Vínculo de Sangue (SAN-02) e
-- ações contra o Regente (SAN-03).
--
-- SAN-01: record_v5_hunt grava a caçada, reduz a Fome e troca o efeito de
--   Ressonância da ficha numa única escrita da linha (padrão de
--   20261022100000_sheet_atomic_adjustments.sql: trava da linha, marcador
--   rpg.atomic_adjustment, evento de auditoria e idempotência por operation_id).
-- SAN-02: ingestões por doador (ficha ou NPC da campanha) com data; o grau
--   (0 a 3) é calculado a partir das ingestões e do decaimento configurável.
--   Leem o dono da ficha vinculada e o narrador; só o narrador grava (RPC).
-- SAN-03: o teste de resistência para agir contra o Regente é registrado com
--   a rolagem guardada (v5_roll_records) e fica pendente até o narrador
--   permitir ou negar. O sistema nunca decide sozinho.
--
-- Regras a conferir no livro (SANGUINE_REVIEW_RULES em backend/app/services/v5_sanguine.py): Disciplinas de cada
-- Ressonância, bônus +1 para Intensa e Aguda, Fome mínima 1 sem matar, um nível
-- de vínculo por noite distinta e o prazo padrão de 30 dias por nível perdido.

-- ---------------------------------------------------------------------------
-- Ressonância
-- ---------------------------------------------------------------------------
create or replace function private.v5_resonance_disciplines(p_resonance text)
returns text[]
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case p_resonance
    when 'Colérica' then array['disc_potencia', 'disc_rapidez']
    when 'Melancólica' then array['disc_fortitude', 'disc_ofuscacao']
    when 'Fleumática' then array['disc_auspicios', 'disc_dominacao']
    when 'Sanguínea' then array['disc_feiticaria', 'disc_presenca']
    when 'Animal' then array['disc_animalismo', 'disc_metamorfose']
    when 'Vazia' then array['disc_oblivio']
    else array[]::text[]
  end;
$$;
revoke all on function private.v5_resonance_disciplines(text) from public;
grant execute on function private.v5_resonance_disciplines(text) to authenticated;

create table public.v5_hunts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  operation_id uuid not null,
  prey text not null check (char_length(prey) between 1 and 120),
  resonance text not null check (resonance in ('Nenhuma', 'Colérica', 'Melancólica', 'Fleumática', 'Sanguínea', 'Animal', 'Vazia')),
  intensity text not null check (intensity in ('Nenhuma', 'Fugaz', 'Intensa', 'Aguda')),
  dyscrasia text check (dyscrasia is null or char_length(dyscrasia) between 1 and 160),
  slaked integer not null check (slaked between 0 and 5),
  killed boolean not null default false,
  hunger_before integer not null check (hunger_before between 0 and 5),
  hunger_after integer not null check (hunger_after between 0 and 5),
  effect_id text check (effect_id is null or char_length(effect_id) <= 64),
  sheet_event_id bigint references public.character_sheet_events(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default clock_timestamp(),
  unique (sheet_id, author_id, operation_id),
  check ((resonance = 'Nenhuma') = (intensity = 'Nenhuma')),
  check (dyscrasia is null or intensity = 'Aguda'),
  check (hunger_after <= hunger_before)
);
create index v5_hunts_sheet_idx on public.v5_hunts (sheet_id, created_at desc, id desc);
alter table public.v5_hunts enable row level security;
revoke all on public.v5_hunts from anon, authenticated;
grant select on public.v5_hunts to authenticated;
-- A caçada é visível exatamente quando a ficha é visível.
create policy "sheet readers read v5 hunts"
  on public.v5_hunts for select to authenticated
  using (exists (select 1 from public.character_sheets sheet where sheet.id = sheet_id));

create or replace function private.template_has_field(p_schema jsonb, p_field_id text, p_kind text)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select jsonb_path_exists(coalesce(p_schema, '{}'::jsonb), '$.fields[*] ? (@.id == $id && @.kind == $kind)',
                           jsonb_build_object('id', p_field_id, 'kind', p_kind));
$$;
revoke all on function private.template_has_field(jsonb, text, text) from public;
grant execute on function private.template_has_field(jsonb, text, text) to authenticated;

create or replace function public.record_v5_hunt(
  p_sheet_id uuid,
  p_operation_id uuid,
  p_prey text,
  p_resonance text,
  p_intensity text,
  p_dyscrasia text default null,
  p_slake integer default 1,
  p_killed boolean default false,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  prior public.v5_hunts;
  saved public.v5_hunts;
  event public.character_sheet_events;
  template_schema jsonb;
  prey text := btrim(coalesce(p_prey, ''));
  dyscrasia text := nullif(btrim(coalesce(p_dyscrasia, '')), '');
  notes text := nullif(btrim(coalesce(p_notes, '')), '');
  hunger_before integer;
  hunger_after integer;
  next_values jsonb;
  next_effects jsonb;
  disciplines text[];
  effect_id text;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_operation_id is null or char_length(prey) not between 1 and 120
     or p_resonance is null or p_resonance not in ('Nenhuma', 'Colérica', 'Melancólica', 'Fleumática', 'Sanguínea', 'Animal', 'Vazia')
     or p_intensity is null or p_intensity not in ('Nenhuma', 'Fugaz', 'Intensa', 'Aguda')
     or ((p_resonance = 'Nenhuma') <> (p_intensity = 'Nenhuma'))
     or p_slake is null or p_slake not between 0 and 5 or p_killed is null
     or (dyscrasia is not null and (p_intensity <> 'Aguda' or char_length(dyscrasia) > 160))
     or (notes is not null and char_length(notes) > 500) then
    raise exception 'invalid hunt' using errcode = '22023';
  end if;

  select * into sheet from public.character_sheets where id = p_sheet_id for update;
  if not found or not private.can_write_sheet(sheet) then
    raise exception 'sheet not found or not writable' using errcode = '42501';
  end if;
  -- Idempotência: repetir a mesma operação devolve a caçada já gravada.
  select * into prior from public.v5_hunts
   where sheet_id = sheet.id and author_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if prior.prey <> prey or prior.resonance <> p_resonance or prior.intensity <> p_intensity
       or prior.slaked <> p_slake or prior.killed <> p_killed or prior.dyscrasia is distinct from dyscrasia then
      raise exception 'operation ID was already used for another hunt' using errcode = '23505';
    end if;
    return jsonb_build_object('hunt', to_jsonb(prior), 'sheet', to_jsonb(sheet), 'replayed', true);
  end if;

  select schema into template_schema from public.system_templates
   where id = sheet.template_id and campaign_id = sheet.campaign_id and status = 'approved';
  if not private.template_has_field(template_schema, 'fome', 'number') then
    raise exception 'template has no Hunger field' using errcode = '22023';
  end if;
  if sheet.values ? 'fome' and jsonb_typeof(sheet.values -> 'fome') <> 'number' then
    raise exception 'Hunger does not hold a number' using errcode = '22023';
  end if;
  hunger_before := coalesce((sheet.values ->> 'fome')::numeric, 0)::integer;
  if hunger_before not between 0 and 5 then raise exception 'Hunger out of range' using errcode = '22023'; end if;
  -- Sem matar a presa a Fome não desce abaixo de 1, nem do limite da Potência alta
  -- (kill_to_reduce_below na tabela de F1, private.v5_blood_potency); nunca sobe numa caçada.
  hunger_after := least(hunger_before, greatest(hunger_before - p_slake, case when p_killed then 0 else greatest(1, coalesce(
    (private.v5_blood_potency(case when jsonb_typeof(sheet.values -> 'potencia_sangue') = 'number'
                                   then (sheet.values ->> 'potencia_sangue')::numeric::integer end) ->> 'kill_to_reduce_below')::integer, 1)) end));

  next_values := jsonb_set(sheet.values, '{fome}', to_jsonb(hunger_after));
  if private.template_has_field(template_schema, 'ressonancia_atual', 'select') then
    next_values := jsonb_set(next_values, '{ressonancia_atual}', to_jsonb(p_resonance));
  end if;
  if private.template_has_field(template_schema, 'intensidade_ressonancia', 'select') then
    next_values := jsonb_set(next_values, '{intensidade_ressonancia}', to_jsonb(p_intensity));
  end if;
  if private.template_has_field(template_schema, 'discrasia', 'text') then
    next_values := jsonb_set(next_values, '{discrasia}', to_jsonb(coalesce(dyscrasia, '')));
  end if;

  -- A nova caçada substitui o efeito de Ressonância anterior criado aqui.
  select coalesce(jsonb_agg(item), '[]'::jsonb) into next_effects
    from jsonb_array_elements(sheet.effects) as effects(item)
   where coalesce(item ->> 'id', '') not like 'ressonancia-%';
  disciplines := private.v5_resonance_disciplines(p_resonance);
  if p_intensity in ('Intensa', 'Aguda') and cardinality(disciplines) > 0 then
    if jsonb_array_length(next_effects) >= 30 then
      raise exception 'sheet already has 30 effects' using errcode = '23514';
    end if;
    effect_id := 'ressonancia-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    next_effects := next_effects || jsonb_build_array(jsonb_build_object(
      'id', effect_id,
      'label', 'Ressonância ' || p_resonance || ' (' || p_intensity || ')',
      'delta', 1,
      'enabled', true,
      'applies_to_tags', to_jsonb(disciplines),
      'exempt_tags', '[]'::jsonb,
      'remaining_scenes', null,
      'source_note', 'Caçada V5 (' || left(prey, 80) || '); bônus de Ressonância a conferir no livro'
    ));
  end if;

  perform set_config('rpg.atomic_adjustment', 'on', true);
  update public.character_sheets set values = next_values, effects = next_effects
   where id = sheet.id returning * into sheet;
  perform set_config('rpg.atomic_adjustment', 'off', true);
  if hunger_after <> hunger_before then
    event := private.record_sheet_adjustment_event(sheet.id, p_operation_id, 'fome', hunger_after - hunger_before,
                                                   hunger_before, hunger_after, left('Caçada (V5): ' || prey, 200));
  end if;

  insert into public.v5_hunts
    (campaign_id, sheet_id, author_id, operation_id, prey, resonance, intensity, dyscrasia, slaked, killed,
     hunger_before, hunger_after, effect_id, sheet_event_id, notes)
  values
    (sheet.campaign_id, sheet.id, auth.uid(), p_operation_id, prey, p_resonance, p_intensity, dyscrasia, p_slake, p_killed,
     hunger_before, hunger_after, effect_id, event.id, notes)
  returning * into saved;
  return jsonb_build_object('hunt', to_jsonb(saved), 'sheet', to_jsonb(sheet), 'event', to_jsonb(event), 'replayed', false);
end;
$$;
revoke all on function public.record_v5_hunt(uuid, uuid, text, text, text, text, integer, boolean, text) from public, anon;
grant execute on function public.record_v5_hunt(uuid, uuid, text, text, text, text, integer, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Vínculo de Sangue
-- ---------------------------------------------------------------------------
create or replace function private.v5_is_sheet_owner(p_sheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null
     and exists (select 1 from public.character_sheets where id = p_sheet_id and owner_id = auth.uid());
$$;
revoke all on function private.v5_is_sheet_owner(uuid) from public;
grant execute on function private.v5_is_sheet_owner(uuid) to authenticated;

create table public.v5_blood_bonds (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  thrall_sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  regnant_sheet_id uuid references public.character_sheets(id) on delete cascade,
  regnant_entity_id uuid references public.world_entities(id) on delete cascade,
  regnant_label text not null check (char_length(regnant_label) between 1 and 160),
  decay_days integer not null default 30 check (decay_days between 1 and 3650),
  notes text not null default '' check (char_length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(regnant_sheet_id, regnant_entity_id) = 1),
  check (regnant_sheet_id is distinct from thrall_sheet_id)
);
create unique index v5_blood_bonds_sheet_donor_idx on public.v5_blood_bonds (thrall_sheet_id, regnant_sheet_id) where regnant_sheet_id is not null;
create unique index v5_blood_bonds_npc_donor_idx on public.v5_blood_bonds (thrall_sheet_id, regnant_entity_id) where regnant_entity_id is not null;
create index v5_blood_bonds_campaign_idx on public.v5_blood_bonds (campaign_id);
alter table public.v5_blood_bonds enable row level security;
revoke all on public.v5_blood_bonds from anon, authenticated;
grant select on public.v5_blood_bonds to authenticated;
create policy "thrall owner and narrator read blood bonds"
  on public.v5_blood_bonds for select to authenticated
  using (private.can_manage_campaign(campaign_id) or private.v5_is_sheet_owner(thrall_sheet_id));

create table public.v5_blood_bond_drinks (
  id uuid primary key default gen_random_uuid(),
  bond_id uuid not null references public.v5_blood_bonds(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  drank_at timestamptz not null,
  operation_id uuid not null,
  notes text check (notes is null or char_length(notes) <= 300),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bond_id, operation_id)
);
create index v5_blood_bond_drinks_bond_idx on public.v5_blood_bond_drinks (bond_id, drank_at);
alter table public.v5_blood_bond_drinks enable row level security;
revoke all on public.v5_blood_bond_drinks from anon, authenticated;
grant select on public.v5_blood_bond_drinks to authenticated;
create policy "blood bond readers read drinks"
  on public.v5_blood_bond_drinks for select to authenticated
  using (exists (select 1 from public.v5_blood_bonds bond where bond.id = bond_id));

-- Grau a partir das ingestões em ordem: cada noite (UTC) distinta sobe um nível
-- até 3; a cada `decay_days` dias sem beber, o grau perde um nível.
-- Mesma regra em backend/app/services/v5_sanguine.py e frontend/lib/v5-sanguine.ts.
create or replace function private.v5_bond_degree_from(p_drinks timestamptz[], p_decay_days integer, p_at timestamptz)
returns integer
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  drink timestamptz;
  level integer := 0;
  last_drink timestamptz;
  last_night date;
  night date;
begin
  if p_decay_days is null or p_decay_days < 1 then raise exception 'decay must be at least one day' using errcode = '22023'; end if;
  for drink in select value from unnest(coalesce(p_drinks, '{}'::timestamptz[])) as value where value <= p_at order by value loop
    if last_drink is not null then
      level := greatest(0, level - floor(extract(epoch from drink - last_drink) / (86400.0 * p_decay_days))::integer);
    end if;
    night := (drink at time zone 'UTC')::date;
    if last_night is null or night <> last_night then level := least(3, level + 1); end if;
    last_drink := drink;
    last_night := night;
  end loop;
  if last_drink is not null then
    level := greatest(0, level - floor(extract(epoch from p_at - last_drink) / (86400.0 * p_decay_days))::integer);
  end if;
  return level;
end;
$$;
revoke all on function private.v5_bond_degree_from(timestamptz[], integer, timestamptz) from public;
grant execute on function private.v5_bond_degree_from(timestamptz[], integer, timestamptz) to authenticated;

create or replace function public.v5_blood_bond_degree(p_bond_id uuid, p_at timestamptz default now())
returns integer
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.v5_bond_degree_from(
    array(select drink.drank_at from public.v5_blood_bond_drinks drink where drink.bond_id = bond.id order by drink.drank_at),
    bond.decay_days, coalesce(p_at, now()))
    from public.v5_blood_bonds bond where bond.id = p_bond_id;
$$;
revoke all on function public.v5_blood_bond_degree(uuid, timestamptz) from public, anon;
grant execute on function public.v5_blood_bond_degree(uuid, timestamptz) to authenticated;

create or replace function public.record_v5_bond_drink(
  p_thrall_sheet_id uuid,
  p_operation_id uuid,
  p_regnant_sheet_id uuid default null,
  p_regnant_entity_id uuid default null,
  p_drank_at timestamptz default now(),
  p_notes text default null,
  p_decay_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  thrall public.character_sheets;
  regnant_name text;
  bond public.v5_blood_bonds;
  drink public.v5_blood_bond_drinks;
  notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_operation_id is null or num_nonnulls(p_regnant_sheet_id, p_regnant_entity_id) <> 1
     or p_drank_at is null or p_drank_at > now() + interval '1 day'
     or (notes is not null and char_length(notes) > 300)
     or (p_decay_days is not null and p_decay_days not between 1 and 3650) then
    raise exception 'invalid blood bond drink' using errcode = '22023';
  end if;
  select * into thrall from public.character_sheets where id = p_thrall_sheet_id;
  if not found or not private.can_manage_campaign(thrall.campaign_id) then
    raise exception 'only the campaign narrator records blood bonds' using errcode = '42501';
  end if;
  if p_regnant_sheet_id is not null then
    if p_regnant_sheet_id = thrall.id then raise exception 'a sheet cannot bond to itself' using errcode = '22023'; end if;
    select name into regnant_name from public.character_sheets where id = p_regnant_sheet_id and campaign_id = thrall.campaign_id;
  else
    select name into regnant_name from public.world_entities
     where id = p_regnant_entity_id and campaign_id = thrall.campaign_id and kind = 'npc';
  end if;
  if regnant_name is null then raise exception 'donor must be a sheet or NPC of the same campaign' using errcode = '22023'; end if;

  select * into bond from public.v5_blood_bonds
   where thrall_sheet_id = thrall.id
     and (regnant_sheet_id = p_regnant_sheet_id or regnant_entity_id = p_regnant_entity_id)
   for update;
  if not found then
    insert into public.v5_blood_bonds (campaign_id, thrall_sheet_id, regnant_sheet_id, regnant_entity_id, regnant_label, decay_days, created_by)
    values (thrall.campaign_id, thrall.id, p_regnant_sheet_id, p_regnant_entity_id, left(regnant_name, 160), coalesce(p_decay_days, 30), auth.uid())
    returning * into bond;
  elsif p_decay_days is not null and p_decay_days <> bond.decay_days then
    update public.v5_blood_bonds set decay_days = p_decay_days, updated_at = now() where id = bond.id returning * into bond;
  end if;

  select * into drink from public.v5_blood_bond_drinks where bond_id = bond.id and operation_id = p_operation_id;
  if not found then
    insert into public.v5_blood_bond_drinks (bond_id, campaign_id, drank_at, operation_id, notes, recorded_by)
    values (bond.id, bond.campaign_id, p_drank_at, p_operation_id, notes, auth.uid())
    returning * into drink;
    update public.v5_blood_bonds set updated_at = now() where id = bond.id returning * into bond;
  elsif drink.drank_at <> p_drank_at then
    raise exception 'operation ID was already used for another drink' using errcode = '23505';
  end if;
  return jsonb_build_object('bond', to_jsonb(bond), 'drink', to_jsonb(drink),
                            'degree', public.v5_blood_bond_degree(bond.id, now()));
end;
$$;
revoke all on function public.record_v5_bond_drink(uuid, uuid, uuid, uuid, timestamptz, text, integer) from public, anon;
grant execute on function public.record_v5_bond_drink(uuid, uuid, uuid, uuid, timestamptz, text, integer) to authenticated;

create or replace function public.configure_v5_blood_bond(p_bond_id uuid, p_decay_days integer, p_notes text default null)
returns public.v5_blood_bonds
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  bond public.v5_blood_bonds;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_decay_days is null or p_decay_days not between 1 and 3650 or (p_notes is not null and char_length(p_notes) > 1000) then
    raise exception 'invalid blood bond settings' using errcode = '22023';
  end if;
  select * into bond from public.v5_blood_bonds where id = p_bond_id for update;
  if not found or not private.can_manage_campaign(bond.campaign_id) then
    raise exception 'only the campaign narrator configures blood bonds' using errcode = '42501';
  end if;
  update public.v5_blood_bonds set decay_days = p_decay_days, notes = coalesce(p_notes, notes), updated_at = now()
   where id = bond.id returning * into bond;
  return bond;
end;
$$;
revoke all on function public.configure_v5_blood_bond(uuid, integer, text) from public, anon;
grant execute on function public.configure_v5_blood_bond(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Ações contra o Regente
-- ---------------------------------------------------------------------------
create table public.v5_regnant_actions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  bond_id uuid not null references public.v5_blood_bonds(id) on delete cascade,
  thrall_sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  action text not null check (char_length(action) between 1 and 300),
  bond_degree integer not null check (bond_degree between 0 and 3),
  roll_id uuid references public.v5_roll_records(id) on delete set null,
  pool integer check (pool is null or pool between 1 and 30),
  difficulty integer check (difficulty is null or difficulty between 1 and 100),
  successes integer check (successes is null or successes between 0 and 60),
  passed boolean,
  status text not null default 'pendente' check (status in ('pendente', 'permitida', 'negada')),
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  check ((status = 'pendente') = (decided_at is null))
);
create unique index v5_regnant_actions_roll_idx on public.v5_regnant_actions (roll_id) where roll_id is not null;
create index v5_regnant_actions_sheet_idx on public.v5_regnant_actions (thrall_sheet_id, created_at desc);
alter table public.v5_regnant_actions enable row level security;
revoke all on public.v5_regnant_actions from anon, authenticated;
grant select on public.v5_regnant_actions to authenticated;
create policy "thrall owner and narrator read regnant actions"
  on public.v5_regnant_actions for select to authenticated
  using (private.can_manage_campaign(campaign_id) or private.v5_is_sheet_owner(thrall_sheet_id));

create or replace function public.request_v5_regnant_action(p_bond_id uuid, p_action text, p_roll_id uuid default null)
returns public.v5_regnant_actions
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  bond public.v5_blood_bonds;
  roll public.v5_roll_records;
  saved public.v5_regnant_actions;
  action text := btrim(coalesce(p_action, ''));
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if char_length(action) not between 1 and 300 then raise exception 'describe the action' using errcode = '22023'; end if;
  select * into bond from public.v5_blood_bonds where id = p_bond_id;
  if not found or not (private.can_manage_campaign(bond.campaign_id) or private.v5_is_sheet_owner(bond.thrall_sheet_id)) then
    raise exception 'blood bond not found' using errcode = '42501';
  end if;
  if p_roll_id is not null then
    select * into roll from public.v5_roll_records where id = p_roll_id;
    if not found or roll.sheet_id <> bond.thrall_sheet_id then
      raise exception 'the resistance roll must belong to the bonded sheet' using errcode = '22023';
    end if;
    if exists (select 1 from public.v5_regnant_actions where roll_id = p_roll_id) then
      raise exception 'this roll was already used' using errcode = '23505';
    end if;
  end if;
  insert into public.v5_regnant_actions
    (campaign_id, bond_id, thrall_sheet_id, action, bond_degree, roll_id, pool, difficulty, successes, passed, requested_by)
  values
    (bond.campaign_id, bond.id, bond.thrall_sheet_id, action, public.v5_blood_bond_degree(bond.id, now()),
     roll.id, roll.pool, roll.difficulty, (roll.outcome ->> 'successes')::integer, (roll.outcome ->> 'success')::boolean, auth.uid())
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.request_v5_regnant_action(uuid, text, uuid) from public, anon;
grant execute on function public.request_v5_regnant_action(uuid, text, uuid) to authenticated;

create or replace function public.decide_v5_regnant_action(p_action_id uuid, p_decision text, p_note text default null)
returns public.v5_regnant_actions
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  saved public.v5_regnant_actions;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('permitida', 'negada') or (note is not null and char_length(note) > 500) then
    raise exception 'decision must be permitida or negada' using errcode = '22023';
  end if;
  select * into saved from public.v5_regnant_actions where id = p_action_id for update;
  if not found or not private.can_manage_campaign(saved.campaign_id) then
    raise exception 'only the campaign narrator decides' using errcode = '42501';
  end if;
  if saved.status <> 'pendente' then raise exception 'action already decided' using errcode = '23505'; end if;
  update public.v5_regnant_actions
     set status = p_decision, decision_note = note, decided_by = auth.uid(), decided_at = now()
   where id = saved.id returning * into saved;
  return saved;
end;
$$;
revoke all on function public.decide_v5_regnant_action(uuid, text, text) from public, anon;
grant execute on function public.decide_v5_regnant_action(uuid, text, text) to authenticated;

comment on table public.v5_hunts is 'SAN-01: caçadas V5 gravadas por record_v5_hunt (Fome e efeito de Ressonância na mesma escrita).';
comment on table public.v5_blood_bonds is 'SAN-02: Vínculo de Sangue por doador; grau calculado por v5_blood_bond_degree. Leitura: dono da ficha vinculada e narrador.';
comment on table public.v5_regnant_actions is 'SAN-03: ações contra o Regente; o narrador permite ou nega (decide_v5_regnant_action).';
