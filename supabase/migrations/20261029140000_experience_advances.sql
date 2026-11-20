-- EXP-02: compra de avanço com XP, atômica e com histórico remoto.
--
-- O custo nunca vem do cliente. purchase_advance identifica o sistema pelo
-- system_key do modelo aprovado da ficha, classifica o traço pela tabela
-- experience_trait_categories, resolve Disciplina de clã / externa / Caitiff
-- pelas regras de criação do próprio modelo (clã da ficha), recalcula o custo
-- pela tabela experience_cost_rules, confere o XP disponível no campo
-- experience_field, sobe o traço e desconta o XP numa única gravação, com
-- versão otimista e repetição idempotente por operation_id.
--
-- As tabelas abaixo espelham frontend/lib/experience-math.ts (um teste de
-- domínio compara as duas). TODOS os números estão marcados para conferência
-- no livro antes de considerar o EXP-02 concluído.
--
-- Bases de custo:
--   new      soma de (novo nível × multiplicador) a cada ponto comprado (V5, Caçador)
--   current  soma de (nível atual × multiplicador) a cada ponto; do 0 para o 1
--            vale new_cost (V3: habilidade nova 3, Disciplina nova 10) ou o
--            multiplicador quando new_cost é nulo
--   flat     valor fixo = multiplicador (especialização, Edge, Perk)
--   level    nível do item × multiplicador (ritual, fórmula)
--   per_dot  pontos comprados × multiplicador (Vantagem)
--
-- Códigos de erro: 42501 sem acesso · 40001 versão desatualizada / a ficha
-- mudou · 23505 operation_id reutilizado com outro pedido · 22023 pedido
-- inválido · 23514 fora do limite do campo · XP001 XP insuficiente ·
-- P0002 avanço não encontrado.

create table public.experience_cost_rules (
  system_key text not null check (system_key ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  category text not null check (category ~ '^[a-z][a-z_]{1,40}$'),
  basis text not null check (basis in ('new', 'current', 'flat', 'level', 'per_dot')),
  multiplier integer not null check (multiplier between 1 and 100),
  new_cost integer check (new_cost is null or new_cost between 1 and 100),
  label text not null check (char_length(label) between 1 and 80),
  needs_book_check boolean not null default true,
  primary key (system_key, category)
);
comment on table public.experience_cost_rules is
  'Custos de XP por sistema e categoria (EXP-02). Espelho de frontend/lib/experience-math.ts; conferir no livro.';

create table public.experience_trait_categories (
  system_key text not null,
  field_id text not null check (field_id ~ '^[a-z][a-z0-9_]{1,63}$'),
  -- 'discipline' é resolvida em clan_discipline, out_of_clan_discipline ou caitiff_discipline.
  category text not null check (category ~ '^[a-z][a-z_]{1,40}$'),
  primary key (system_key, field_id)
);
comment on table public.experience_trait_categories is
  'Campo da ficha → categoria de custo de XP. Campos ausentes no modelo são ignorados.';

alter table public.experience_cost_rules enable row level security;
alter table public.experience_trait_categories enable row level security;
revoke all on public.experience_cost_rules, public.experience_trait_categories from public, anon, authenticated;
grant select on public.experience_cost_rules, public.experience_trait_categories to authenticated;
create policy "authenticated read experience costs" on public.experience_cost_rules for select to authenticated using (true);
create policy "authenticated read experience categories" on public.experience_trait_categories for select to authenticated using (true);

insert into public.experience_cost_rules (system_key, category, basis, multiplier, new_cost, label) values
  -- Vampiro: A Máscara 5ª edição (conferir no livro básico, tabela de experiência).
  ('vampire-v5', 'attribute', 'new', 5, null, 'Atributo'),
  ('vampire-v5', 'skill', 'new', 3, null, 'Habilidade'),
  ('vampire-v5', 'specialty', 'flat', 3, null, 'Especialização'),
  ('vampire-v5', 'clan_discipline', 'new', 5, null, 'Disciplina de clã'),
  ('vampire-v5', 'out_of_clan_discipline', 'new', 7, null, 'Disciplina externa'),
  ('vampire-v5', 'caitiff_discipline', 'new', 6, null, 'Disciplina de Caitiff'),
  ('vampire-v5', 'ritual', 'level', 3, null, 'Ritual de Feitiçaria do Sangue'),
  ('vampire-v5', 'formula', 'level', 3, null, 'Fórmula de Alquimia do Sangue-Ralo'),
  ('vampire-v5', 'advantage', 'per_dot', 3, null, 'Vantagem'),
  ('vampire-v5', 'blood_potency', 'new', 10, null, 'Potência de Sangue'),
  -- Vampiro: A Máscara 3ª edição revisada (conferir; Caitiff ×6 vem do V20).
  ('vampire-v3', 'attribute', 'current', 4, null, 'Atributo'),
  ('vampire-v3', 'skill', 'current', 2, 3, 'Habilidade'),
  ('vampire-v3', 'clan_discipline', 'current', 5, 10, 'Disciplina de clã'),
  ('vampire-v3', 'out_of_clan_discipline', 'current', 7, 10, 'Disciplina externa'),
  ('vampire-v3', 'caitiff_discipline', 'current', 6, 10, 'Disciplina de Caitiff'),
  ('vampire-v3', 'virtue', 'current', 2, null, 'Virtude'),
  ('vampire-v3', 'humanity', 'current', 2, null, 'Humanidade / Trilha'),
  ('vampire-v3', 'willpower', 'current', 1, null, 'Força de Vontade'),
  -- Caçador: A Revanche 5ª edição (conferir).
  ('hunter', 'attribute', 'new', 5, null, 'Atributo'),
  ('hunter', 'skill', 'new', 3, null, 'Habilidade'),
  ('hunter', 'specialty', 'flat', 3, null, 'Especialização'),
  ('hunter', 'edge', 'flat', 7, null, 'Edge'),
  ('hunter', 'perk', 'flat', 3, null, 'Perk'),
  ('hunter', 'advantage', 'per_dot', 3, null, 'Vantagem');

insert into public.experience_trait_categories (system_key, field_id, category)
select 'vampire-v5', field_id, 'attribute' from unnest(array[
  'forca', 'destreza', 'vigor', 'carisma', 'manipulacao', 'autocontrole', 'inteligencia', 'raciocinio', 'resolucao']) as f(field_id)
union all
select 'vampire-v5', field_id, 'skill' from unnest(array[
  'atletismo', 'briga', 'conducao', 'furtividade', 'ladroagem', 'oficios', 'sobrevivencia', 'armas_brancas', 'armas_de_fogo',
  'etiqueta', 'empatia', 'intimidacao', 'lideranca', 'manha', 'performance', 'persuasao', 'subterfugio', 'trato_com_animais',
  'academicos', 'ciencia', 'consciencia', 'financas', 'investigacao', 'medicina', 'ocultismo', 'percepcao', 'tecnologia']) as f(field_id)
union all
select 'vampire-v5', field_id, 'discipline' from unnest(array[
  'disc_animalismo', 'disc_auspicios', 'disc_dominacao', 'disc_fortitude', 'disc_ofuscacao', 'disc_potencia', 'disc_presenca',
  'disc_metamorfose', 'disc_rapidez', 'disc_feiticaria', 'disc_oblivio', 'disc_alquimia']) as f(field_id)
union all
select 'vampire-v5', field_id, category from (values
  ('potencia_sangue', 'blood_potency'), ('especialidades', 'specialty'), ('rituais', 'ritual'),
  ('formulas', 'formula'), ('vantagens', 'advantage')) as f(field_id, category)
union all
select 'vampire-v3', field_id, 'attribute' from unnest(array[
  'forca', 'destreza', 'vigor', 'carisma', 'manipulacao', 'aparencia', 'percepcao', 'inteligencia', 'raciocinio']) as f(field_id)
union all
select 'vampire-v3', field_id, 'skill' from unnest(array[
  'prontidao', 'esportes', 'briga', 'esquiva', 'empatia', 'expressao', 'intimidacao', 'lideranca', 'manha', 'labia',
  'empatia_animais', 'oficios', 'conducao', 'etiqueta', 'armas_de_fogo', 'armas_brancas', 'performance', 'seguranca', 'furtividade', 'sobrevivencia',
  'academicos', 'computador', 'financas', 'investigacao', 'direito', 'linguistica', 'medicina', 'ocultismo', 'politica', 'ciencia']) as f(field_id)
union all
select 'vampire-v3', field_id, 'discipline' from unnest(array[
  'disc_animalismo', 'disc_auspicios', 'disc_rapidez', 'disc_quimerismo', 'disc_dementacao', 'disc_dominacao', 'disc_fortitude',
  'disc_necromancia', 'disc_ofuscacao', 'disc_obtenebracao', 'disc_potencia', 'disc_presenca', 'disc_metamorfose', 'disc_quietus',
  'disc_serpentis', 'disc_taumaturgia', 'disc_vicissitude']) as f(field_id)
union all
-- conviccao e instintos são as virtudes alternativas das Trilhas (frente F3).
select 'vampire-v3', field_id, category from (values
  ('consciencia', 'virtue'), ('autocontrole', 'virtue'), ('coragem', 'virtue'), ('conviccao', 'virtue'), ('instintos', 'virtue'),
  ('humanidade', 'humanity'), ('trilha_nivel', 'humanity'), ('forca_vontade', 'willpower')) as f(field_id, category)
union all
select 'hunter', field_id, 'attribute' from unnest(array[
  'forca', 'destreza', 'vigor', 'carisma', 'manipulacao', 'autocontrole', 'inteligencia', 'raciocinio', 'resolucao']) as f(field_id)
union all
select 'hunter', field_id, 'skill' from unnest(array[
  'armas_brancas', 'armas_de_fogo', 'atletismo', 'briga', 'ciencia', 'conducao', 'trato_com_animais', 'academicos', 'etiqueta',
  'financas', 'furtividade', 'intimidacao', 'investigacao', 'ladroagem', 'lideranca', 'manha', 'medicina', 'ocultismo', 'oficios',
  'percepcao', 'performance', 'persuasao', 'politica', 'empatia', 'sobrevivencia', 'subterfugio', 'tecnologia']) as f(field_id)
union all
-- edges e perks são as coleções que a frente F4 cria.
select 'hunter', field_id, category from (values
  ('especialidades', 'specialty'), ('vantagens', 'advantage'), ('edges', 'edge'), ('perks', 'perk')) as f(field_id, category);

-- Política da campanha: com requires_approval, a compra do jogador fica
-- pendente até o narrador aprovar; o narrador compra direto.
create table public.campaign_experience_settings (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  requires_approval boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.campaign_experience_settings enable row level security;
revoke all on public.campaign_experience_settings from public, anon, authenticated;
grant select, insert, update on public.campaign_experience_settings to authenticated;
create policy "members read experience settings" on public.campaign_experience_settings
  for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "managers create experience settings" on public.campaign_experience_settings
  for insert to authenticated with check (private.can_manage_campaign(campaign_id) and updated_by = (select auth.uid()));
create policy "managers update experience settings" on public.campaign_experience_settings
  for update to authenticated using (private.can_manage_campaign(campaign_id))
  with check (private.can_manage_campaign(campaign_id) and updated_by = (select auth.uid()));

create table public.character_advances (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  operation_id uuid not null,
  system_key text not null,
  trait text not null check (trait ~ '^[a-z][a-z0-9_]{1,63}$'),
  category text not null,
  item_name text check (item_name is null or char_length(item_name) between 1 and 120),
  item_value text check (item_value is null or char_length(item_value) between 1 and 160),
  item_before text check (item_before is null or char_length(item_before) <= 160),
  from_level integer not null check (from_level between 0 and 20),
  to_level integer not null check (to_level between 1 and 20),
  cost integer not null check (cost between 1 and 1000),
  status text not null check (status in ('pending', 'applied', 'rejected', 'refunded')),
  xp_before integer,
  xp_after integer,
  sheet_version integer check (sheet_version is null or sheet_version > 0),
  reason text check (reason is null or char_length(reason) <= 200),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 200),
  created_at timestamptz not null default now()
);
create unique index character_advances_operation_idx on public.character_advances (actor_id, sheet_id, operation_id);
create index character_advances_sheet_idx on public.character_advances (sheet_id, created_at desc);
create index character_advances_pending_idx on public.character_advances (campaign_id) where status = 'pending';
comment on table public.character_advances is
  'Histórico remoto de compras de avanço com XP (EXP-02). Escrito só pelas RPCs; dono e narrador leem.';
alter table public.character_advances enable row level security;
revoke all on public.character_advances from public, anon, authenticated;
grant select on public.character_advances to authenticated;
-- Visível exatamente quando a ficha é visível pela RLS dela (dono e narrador).
create policy "sheet readers read advances" on public.character_advances
  for select to authenticated using (exists (select 1 from public.character_sheets sheet where sheet.id = sheet_id));

create or replace function private.advance_cost(
  p_basis text, p_multiplier integer, p_new_cost integer, p_from integer, p_to integer
)
returns integer
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_total integer := 0;
  v_rank integer;
begin
  if p_basis = 'flat' then return p_multiplier; end if;
  if p_basis = 'level' then return p_to * p_multiplier; end if;
  if p_basis = 'per_dot' then return (p_to - p_from) * p_multiplier; end if;
  for v_rank in (p_from + 1)..p_to loop
    if p_basis = 'new' then
      v_total := v_total + v_rank * p_multiplier;
    elsif v_rank = 1 then
      v_total := v_total + coalesce(p_new_cost, p_multiplier);
    else
      v_total := v_total + (v_rank - 1) * p_multiplier;
    end if;
  end loop;
  return v_total;
end;
$$;
revoke all on function private.advance_cost(text, integer, integer, integer, integer) from public;
grant execute on function private.advance_cost(text, integer, integer, integer, integer) to authenticated;

-- Nome do item sem o sufixo de pontos ("Recursos ••" ou "Recursos 2" → "Recursos").
create or replace function private.advance_item_base(p_item text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$ select nullif(btrim(regexp_replace(coalesce(p_item, ''), '\s*(•+|\d+)$', '')), '') $$;
revoke all on function private.advance_item_base(text) from public;
grant execute on function private.advance_item_base(text) to authenticated;

-- Resolve categoria, níveis, custo e o novo item de coleção para um pedido.
-- Usa só dados do servidor: modelo aprovado e valores atuais da ficha.
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
      exists (  -- V5: o select_grants do clã soma 1 ponto em cada Disciplina de clã
        select 1 from jsonb_array_elements(coalesce(p_schema -> 'creation_rules', '[]'::jsonb)) as rules(item),
                      jsonb_array_elements(coalesce(rules.item -> 'cases', '[]'::jsonb)) as cases(item)
         where rules.item ->> 'type' = 'select_grants' and rules.item ->> 'field' = 'cla'
           and cases.item ->> 'equals' = v_clan and jsonb_typeof(cases.item -> 'add') = 'object'
           and (cases.item -> 'add') ? p_trait)
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

create or replace function private.advance_sheet_schema(p_template_id uuid, p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select template.schema from public.system_templates template
   where template.id = p_template_id and template.campaign_id = p_campaign_id and template.status = 'approved';
$$;
revoke all on function private.advance_sheet_schema(uuid, uuid) from public;
grant execute on function private.advance_sheet_schema(uuid, uuid) to authenticated;

-- Jogador compra na própria ficha; narrador (dono ou mestre) em qualquer ficha da campanha.
create or replace function private.can_buy_advance(p_owner_id uuid, p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
  select private.can_manage_campaign(p_campaign_id)
      or (p_owner_id = (select auth.uid()) and private.is_campaign_player(p_campaign_id));
$$;
revoke all on function private.can_buy_advance(uuid, uuid) from public;
grant execute on function private.can_buy_advance(uuid, uuid) to authenticated;

create or replace function private.advance_requires_approval(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select not private.can_manage_campaign(p_campaign_id) and coalesce(
    (select setting.requires_approval from public.campaign_experience_settings setting where setting.campaign_id = p_campaign_id), false);
$$;
revoke all on function private.advance_requires_approval(uuid) from public;
grant execute on function private.advance_requires_approval(uuid) to authenticated;

-- Grava traço e XP juntos. Chamado com a ficha já bloqueada (for update).
create or replace function private.apply_advance_quote(p_sheet_id uuid, p_schema jsonb, p_quote jsonb)
returns public.character_sheets
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_xp_field text := p_schema ->> 'experience_field';
  v_trait text := p_quote ->> 'trait';
  v_sheet public.character_sheets;
  v_values jsonb;
  v_items jsonb;
  v_xp integer;
begin
  select * into v_sheet from public.character_sheets where id = p_sheet_id;
  if v_xp_field is null then raise exception 'template has no experience field' using errcode = '22023'; end if;
  if v_sheet.values ? v_xp_field and jsonb_typeof(v_sheet.values -> v_xp_field) not in ('number', 'null') then
    raise exception 'experience field does not hold a number' using errcode = '22023';
  end if;
  v_xp := coalesce((v_sheet.values ->> v_xp_field)::numeric, 0)::integer - (p_quote ->> 'cost')::integer;
  if v_xp < 0 then raise exception 'not enough experience' using errcode = 'XP001'; end if;

  v_values := v_sheet.values;
  if p_quote ->> 'item_value' is null then
    v_values := jsonb_set(v_values, array[v_trait], to_jsonb((p_quote ->> 'to_level')::integer));
  else
    v_items := case when jsonb_typeof(v_values -> v_trait) = 'array' then v_values -> v_trait else '[]'::jsonb end;
    if p_quote ->> 'item_index' is not null then
      v_items := jsonb_set(v_items, array[p_quote ->> 'item_index'], to_jsonb(p_quote ->> 'item_value'));
    else
      v_items := v_items || jsonb_build_array(p_quote ->> 'item_value');
    end if;
    v_values := jsonb_set(v_values, array[v_trait], v_items);
  end if;
  v_values := jsonb_set(v_values, array[v_xp_field], to_jsonb(v_xp));

  update public.character_sheets set values = v_values where id = p_sheet_id returning * into v_sheet;
  if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  return v_sheet;
end;
$$;
revoke all on function private.apply_advance_quote(uuid, jsonb, jsonb) from public;
grant execute on function private.apply_advance_quote(uuid, jsonb, jsonb) to authenticated;

-- Prévia do custo calculada pelo servidor, para mostrar antes de confirmar.
create or replace function public.quote_advance(
  p_sheet_id uuid, p_trait text, p_target_level integer, p_item_name text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_sheet public.character_sheets;
  v_schema jsonb;
  v_xp_field text;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  select * into v_sheet from public.character_sheets where id = p_sheet_id;
  if not found or not private.can_buy_advance(v_sheet.owner_id, v_sheet.campaign_id) then
    raise exception 'sheet not found or not writable' using errcode = '42501';
  end if;
  v_schema := private.advance_sheet_schema(v_sheet.template_id, v_sheet.campaign_id);
  if v_schema is null then raise exception 'sheet template is not approved' using errcode = '22023'; end if;
  v_xp_field := v_schema ->> 'experience_field';
  return private.quote_advance_for(v_schema, v_sheet.values, p_trait, p_target_level, p_item_name) || jsonb_build_object(
    'xp_available', case when v_xp_field is null then null else coalesce((v_sheet.values ->> v_xp_field)::numeric, 0)::integer end,
    'sheet_version', v_sheet.version,
    'requires_approval', private.advance_requires_approval(v_sheet.campaign_id)
  );
end;
$$;
revoke all on function public.quote_advance(uuid, text, integer, text) from public, anon;
grant execute on function public.quote_advance(uuid, text, integer, text) to authenticated;

create or replace function public.purchase_advance(
  p_sheet_id uuid, p_trait text, p_target_level integer, p_expected_version integer,
  p_operation_id uuid, p_item_name text default null, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_sheet public.character_sheets;
  v_schema jsonb;
  v_quote jsonb;
  v_prior public.character_advances;
  v_advance public.character_advances;
  v_xp_field text;
  v_xp integer;
  v_pending boolean;
begin
  if v_actor is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_operation_id is null then raise exception 'operation ID required' using errcode = '22023'; end if;
  if p_reason is not null and char_length(p_reason) > 200 then
    raise exception 'reason must have at most 200 characters' using errcode = '22023';
  end if;
  -- The row lock serializes concurrent purchases and replays of the same operation.
  select * into v_sheet from public.character_sheets where id = p_sheet_id for update;
  if not found or not private.can_buy_advance(v_sheet.owner_id, v_sheet.campaign_id) then
    raise exception 'sheet not found or not writable' using errcode = '42501';
  end if;

  select * into v_prior from public.character_advances advance
   where advance.actor_id = v_actor and advance.sheet_id = p_sheet_id and advance.operation_id = p_operation_id;
  if found then
    if v_prior.trait <> p_trait or v_prior.to_level <> p_target_level
       or (v_prior.item_name is distinct from nullif(btrim(coalesce(p_item_name, '')), '')
           and v_prior.item_name is distinct from private.advance_item_base(p_item_name)) then
      raise exception 'operation ID was already used for another purchase' using errcode = '23505';
    end if;
    return jsonb_build_object('advance', to_jsonb(v_prior), 'sheet', to_jsonb(v_sheet), 'replayed', true);
  end if;

  if p_expected_version is null or v_sheet.version <> p_expected_version then
    raise exception 'sheet changed since version %', p_expected_version using errcode = '40001';
  end if;
  v_schema := private.advance_sheet_schema(v_sheet.template_id, v_sheet.campaign_id);
  if v_schema is null then raise exception 'sheet template is not approved' using errcode = '22023'; end if;
  v_xp_field := v_schema ->> 'experience_field';
  if v_xp_field is null then raise exception 'template has no experience field' using errcode = '22023'; end if;
  v_quote := private.quote_advance_for(v_schema, v_sheet.values, p_trait, p_target_level, p_item_name);
  v_xp := coalesce((v_sheet.values ->> v_xp_field)::numeric, 0)::integer;
  if v_xp < (v_quote ->> 'cost')::integer then raise exception 'not enough experience' using errcode = 'XP001'; end if;

  v_pending := private.advance_requires_approval(v_sheet.campaign_id);
  if v_pending then
    if (select count(*) from public.character_advances advance
         where advance.sheet_id = p_sheet_id and advance.status = 'pending') >= 20 then
      raise exception 'too many pending advances' using errcode = '23514';
    end if;
  else
    v_sheet := private.apply_advance_quote(p_sheet_id, v_schema, v_quote);
  end if;

  insert into public.character_advances
    (sheet_id, campaign_id, actor_id, operation_id, system_key, trait, category, item_name, item_value, item_before,
     from_level, to_level, cost, status, xp_before, xp_after, sheet_version, reason)
  values
    (v_sheet.id, v_sheet.campaign_id, v_actor, p_operation_id, v_quote ->> 'system_key', p_trait, v_quote ->> 'category',
     v_quote ->> 'item_name', v_quote ->> 'item_value', v_quote ->> 'item_before',
     (v_quote ->> 'from_level')::integer, (v_quote ->> 'to_level')::integer, (v_quote ->> 'cost')::integer,
     case when v_pending then 'pending' else 'applied' end,
     case when v_pending then null else v_xp end,
     case when v_pending then null else v_xp - (v_quote ->> 'cost')::integer end,
     case when v_pending then null else v_sheet.version end, p_reason)
  returning * into v_advance;
  return jsonb_build_object('advance', to_jsonb(v_advance), 'sheet', to_jsonb(v_sheet), 'replayed', false);
end;
$$;
revoke all on function public.purchase_advance(uuid, text, integer, integer, uuid, text, text) from public, anon;
grant execute on function public.purchase_advance(uuid, text, integer, integer, uuid, text, text) to authenticated;

-- Narrador aprova ou recusa uma compra pendente; o jogador pode recusar
-- (cancelar) a própria. A aprovação recalcula o custo com a ficha atual e
-- falha com 40001 se o traço mudou desde o pedido.
create or replace function public.review_advance(p_advance_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_advance public.character_advances;
  v_sheet public.character_sheets;
  v_schema jsonb;
  v_quote jsonb;
  v_xp integer;
begin
  if v_actor is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'decision required' using errcode = '22023'; end if;
  if p_note is not null and char_length(p_note) > 200 then raise exception 'note too long' using errcode = '22023'; end if;
  select * into v_advance from public.character_advances advance where advance.id = p_advance_id;
  if not found or not exists (select 1 from public.character_sheets sheet where sheet.id = v_advance.sheet_id
                               and private.can_buy_advance(sheet.owner_id, sheet.campaign_id)) then
    raise exception 'advance not found' using errcode = 'P0002';
  end if;
  if not private.can_manage_campaign(v_advance.campaign_id) and not (v_advance.actor_id = v_actor and not p_approve) then
    raise exception 'only the campaign master can review advances' using errcode = '42501';
  end if;
  select * into v_sheet from public.character_sheets where id = v_advance.sheet_id for update;
  select * into v_advance from public.character_advances advance where advance.id = p_advance_id for update;
  if v_advance.status <> 'pending' then raise exception 'advance is not pending' using errcode = '22023'; end if;

  if not p_approve then
    update public.character_advances advance
       set status = 'rejected', reviewed_by = v_actor, reviewed_at = now(), review_note = p_note
     where advance.id = p_advance_id returning * into v_advance;
    return jsonb_build_object('advance', to_jsonb(v_advance), 'sheet', to_jsonb(v_sheet));
  end if;

  v_schema := private.advance_sheet_schema(v_sheet.template_id, v_sheet.campaign_id);
  if v_schema is null then raise exception 'sheet template is not approved' using errcode = '22023'; end if;
  v_quote := private.quote_advance_for(v_schema, v_sheet.values, v_advance.trait, v_advance.to_level, v_advance.item_name);
  if (v_quote ->> 'from_level')::integer <> v_advance.from_level then
    raise exception 'trait changed since the request' using errcode = '40001';
  end if;
  v_xp := coalesce((v_sheet.values ->> (v_schema ->> 'experience_field'))::numeric, 0)::integer;
  v_sheet := private.apply_advance_quote(v_sheet.id, v_schema, v_quote);
  update public.character_advances advance
     set status = 'applied', category = v_quote ->> 'category', cost = (v_quote ->> 'cost')::integer,
         item_value = v_quote ->> 'item_value', item_before = v_quote ->> 'item_before',
         xp_before = v_xp, xp_after = v_xp - (v_quote ->> 'cost')::integer,
         sheet_version = v_sheet.version, reviewed_by = v_actor, reviewed_at = now(), review_note = p_note
   where advance.id = p_advance_id returning * into v_advance;
  return jsonb_build_object('advance', to_jsonb(v_advance), 'sheet', to_jsonb(v_sheet));
end;
$$;
revoke all on function public.review_advance(uuid, boolean, text) from public, anon;
grant execute on function public.review_advance(uuid, boolean, text) to authenticated;

-- Estorno pelo narrador: só o último avanço aplicado daquele traço e só se o
-- traço ainda estiver no nível comprado. Devolve o XP.
create or replace function public.refund_advance(p_advance_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_advance public.character_advances;
  v_sheet public.character_sheets;
  v_xp_field text;
  v_items jsonb;
  v_values jsonb;
  v_index integer;
begin
  if v_actor is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_note is not null and char_length(p_note) > 200 then raise exception 'note too long' using errcode = '22023'; end if;
  select * into v_advance from public.character_advances advance where advance.id = p_advance_id;
  if not found then raise exception 'advance not found' using errcode = 'P0002'; end if;
  if not private.can_manage_campaign(v_advance.campaign_id) then
    raise exception 'only the campaign master can refund advances' using errcode = '42501';
  end if;
  select * into v_sheet from public.character_sheets where id = v_advance.sheet_id for update;
  select * into v_advance from public.character_advances advance where advance.id = p_advance_id for update;
  if v_advance.status <> 'applied' then raise exception 'advance is not applied' using errcode = '22023'; end if;
  if exists (select 1 from public.character_advances later
              where later.sheet_id = v_advance.sheet_id and later.trait = v_advance.trait and later.status = 'applied'
                and later.sheet_version > v_advance.sheet_version
                and later.item_name is not distinct from v_advance.item_name) then
    raise exception 'refund the later advance of this trait first' using errcode = '40001';
  end if;
  v_xp_field := private.advance_sheet_schema(v_sheet.template_id, v_sheet.campaign_id) ->> 'experience_field';
  if v_xp_field is null then raise exception 'template has no experience field' using errcode = '22023'; end if;
  v_values := v_sheet.values;
  if v_advance.item_value is null then
    if jsonb_typeof(v_values -> v_advance.trait) is distinct from 'number'
       or (v_values ->> v_advance.trait)::numeric <> v_advance.to_level then
      raise exception 'trait changed since the purchase' using errcode = '40001';
    end if;
    v_values := jsonb_set(v_values, array[v_advance.trait], to_jsonb(v_advance.from_level));
  else
    v_items := case when jsonb_typeof(v_values -> v_advance.trait) = 'array' then v_values -> v_advance.trait else '[]'::jsonb end;
    select (entry.ordinality - 1)::integer into v_index
      from jsonb_array_elements(v_items) with ordinality as entry(value, ordinality)
     where entry.value #>> '{}' = v_advance.item_value limit 1;
    if v_index is null then raise exception 'item changed since the purchase' using errcode = '40001'; end if;
    if v_advance.item_before is null then
      v_items := v_items - v_index;
    else
      v_items := jsonb_set(v_items, array[v_index::text], to_jsonb(v_advance.item_before));
    end if;
    v_values := jsonb_set(v_values, array[v_advance.trait], v_items);
  end if;
  v_values := jsonb_set(v_values, array[v_xp_field],
    to_jsonb(coalesce((v_sheet.values ->> v_xp_field)::numeric, 0)::integer + v_advance.cost));
  update public.character_sheets set values = v_values where id = v_sheet.id returning * into v_sheet;
  update public.character_advances advance
     set status = 'refunded', reviewed_by = v_actor, reviewed_at = now(), review_note = p_note
   where advance.id = p_advance_id returning * into v_advance;
  return jsonb_build_object('advance', to_jsonb(v_advance), 'sheet', to_jsonb(v_sheet));
end;
$$;
revoke all on function public.refund_advance(uuid, text) from public, anon;
grant execute on function public.refund_advance(uuid, text) to authenticated;
