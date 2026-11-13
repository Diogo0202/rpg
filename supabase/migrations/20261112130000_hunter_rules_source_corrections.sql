-- Source corrections: Caçador: A Revanche, pp. 90 and 127-128.
-- v4 schemas and saved values are untouched. Failed rolls with a Desperation 1 enter Aflição at once.
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
  if coalesce((saved.outcome ->> 'desperation_ones')::integer, 0) > 0
     and not coalesce((saved.outcome ->> 'success')::boolean, false) then
    perform set_config('rpg.atomic_adjustment', 'on', true);
    update public.character_sheets set values = values || '{"em_desespero": true}'::jsonb where id = sheet.id returning * into sheet;
    perform set_config('rpg.atomic_adjustment', 'off', true);
    update public.hunter_roll_records set resolution = 'despair', resolved_by = auth.uid(), resolved_at = now(),
           outcome = outcome || '{"final_success": false}'::jsonb where id = saved.id returning * into saved;
    insert into public.hunter_events (campaign_id, cell_id, sheet_id, roll_id, actor_id, kind)
    values (sheet.campaign_id, cell.id, sheet.id, saved.id, auth.uid(), 'despair');
  end if;
  delete from public.hunter_roll_records old
   where old.sheet_id = sheet.id
     and old.id not in (select keep.id from public.hunter_roll_records keep where keep.sheet_id = sheet.id
                         order by keep.created_at desc, keep.id desc limit 50);
  return jsonb_build_object('roll', to_jsonb(saved), 'cell', private.hunter_cell_json(cell),
                            'in_despair', private.hunter_in_despair(sheet.values));
end;
$$;

-- Creation rules also apply to direct inserts, while preserving the approved v4 contract.
create or replace function private.validate_hunter_creation_edges()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  template_schema jsonb;
  current_catalog jsonb;
  edges jsonb := coalesce(new.values -> 'triunfos', '[]'::jsonb);
  perks jsonb := coalesce(new.values -> 'distincoes', '[]'::jsonb);
  edge_count integer;
  distinct_edges integer;
  perk_count integer;
  is_v5 boolean;
  edge_name text;
  perk_name text;
begin
  select schema into template_schema from public.system_templates where id = new.template_id;
  if not private.is_hunter_sheet(new.values, template_schema) then return new; end if;
  select exists(select 1 from jsonb_array_elements(coalesce(template_schema -> 'fields', '[]'::jsonb)) f where f ->> 'id' = 'pilares')
     and not exists(select 1 from jsonb_array_elements(coalesce(template_schema -> 'fields', '[]'::jsonb)) f where f ->> 'id' = 'conviccao_1')
    into is_v5;
  if not exists(select 1 from jsonb_array_elements(coalesce(template_schema -> 'fields', '[]'::jsonb)) f where f ->> 'id' = 'distincoes') then
    return new;
  end if;
  if jsonb_typeof(edges) <> 'array' or jsonb_typeof(perks) <> 'array' then
    raise exception 'Triunfos and Distinções must be collections' using errcode = '22023';
  end if;
  select count(*), count(distinct value) into edge_count, distinct_edges from jsonb_array_elements_text(edges);
  if edge_count <> distinct_edges then raise exception 'Triunfos cannot repeat' using errcode = '22023'; end if;
  select count(*) into perk_count from jsonb_array_elements_text(perks);
  if is_v5 then
    if not ((edge_count = 2 and perk_count = 0) or (edge_count = 1 and perk_count = 2)) then
      raise exception 'Hunter v5 creation requires 2 Triunfos or 1 Triunfo and 2 Distinções' using errcode = '22023';
    end if;
    current_catalog := '{"Acesso Global":["Grande Irmão Vigilante","Passe Universal","Hack Financeiro","A Letra da Lei"],"Equipamento Improvisado":["Frugal","Produção em Massa","Especialização","Criação Veloz"],"Encantador de Feras":["Incorruptível","Zoológico","Comandos Complexos","Incógnito"],"Jóquei de Drones":["Autônomo","Variantes","Habilidade Especializada","Armamentos","Carga"],"Arsenal":["Requisição Coletiva","Características Especiais","Exóticas","Irrastreável"],"Artilharia":["Cargas Múltiplas","Munição Não Letal","Exóticas","Entrega Disfarçada"],"Biblioteca":["Onde Eles Se Escondem","Quem Eles São","Como Detê-los","Como Ferí-los"],"Frota":["Armadura","Desempenho","Vigilância","Irrastreável"],"Artefato":["Fortalecer","Atração","Detecção","Escudo"],"Frustrar o Sobrenatural":["Especialização em Criatura","Guardar","Reconhecimento","Mãos Livres"],"Repelir o Sobrenatural":["Guardar","Ferir","Especialização em Criatura","Mãos Livres"],"Sentir o Sobrenatural":["Especialização em Criatura","Alcance","Precisão","Mãos Livres"]}'::jsonb;
  else
    if not ((edge_count = 2 and perk_count = 1) or (edge_count = 1 and perk_count = 2)) then
      raise exception 'Hunter v4 creation requires 2 Triunfos and 1 Distinção, or 1 Triunfo and 2 Distinções' using errcode = '22023';
    end if;
    current_catalog := '{"Arsenal":["Requisição de Equipe","Especializado","Excepcional","Irrastreável"],"Frota":["Blindagem","Desempenho","Vigilância","Irrastreável"],"Artilharia":["Cargas Múltiplas","Entrega Não Convencional","Entrega Disfarçada","Preparo de Carga"],"Biblioteca":["Onde se Escondem","Onde São Fracos","Quem São","Pesquisa Rápida"],"Equipamento Improvisado":["Frugal","Fabricação Rápida","Produção em Massa","Especializado"],"Acesso Global":["Porta dos Fundos","Lista de Vigilância","Catraca","Acesso Total"],"Piloto de Drone":["Drone Armado","Drone Autônomo","Vigilância","Carga Útil"],"Encantador de Feras":["Mensageiro","Matilha","Incorruptível","Elo Telepático"],"Vira-Casaca":["Agente Duplo","Lábia","Conhecimento Interno","Disfarce Persistente"],"Sentir o Sobrenatural":["Precisão","Alcance","Reconhecer","Sentido Ampliado"],"Repelir o Sobrenatural":["Barreira","Dano","Reação Rápida","Recuo"],"Frustrar o Sobrenatural":["Rastreio","Resistência","Proteção de Grupo","Contrafeitiço"],"Artefato":["Fortalecer","Detecção","Dano","Escudo"],"Purificar o Sobrenatural":["Purificação em Grupo","Ritual","Expulsão","Santuário"]}'::jsonb;
  end if;
  for edge_name in select value from jsonb_array_elements_text(edges) loop
    if not current_catalog ? edge_name then raise exception 'Hunter Edge % is not in this template catalog', edge_name using errcode = '22023'; end if;
  end loop;
  for perk_name in select value from jsonb_array_elements_text(perks) loop
    edge_name := btrim(split_part(perk_name, ':', 1));
    if array_length(string_to_array(perk_name, ':'), 1) <> 2
       or not edges ? edge_name
       or not coalesce(current_catalog -> edge_name, '[]'::jsonb) ? btrim(split_part(perk_name, ':', 2)) then
      raise exception 'Hunter Distinção % must belong to a selected Triunfo', perk_name using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.validate_hunter_creation_edges() from public, anon, authenticated;
drop trigger if exists hunter_creation_edges_before_insert on public.character_sheets;
create trigger hunter_creation_edges_before_insert before insert on public.character_sheets
for each row execute function private.validate_hunter_creation_edges();

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
  if roll.author_id <> auth.uid() then
    raise exception 'only the rolling player chooses this result' using errcode = '42501';
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
      update public.hunter_cells set danger = least(5, danger + coalesce((roll.outcome ->> 'desperation_ones')::integer, 0)) where id = cell.id returning * into cell;
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
