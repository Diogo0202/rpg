-- Frente F: aplicar conteúdo gerado (gerador e Segunda Inquisição) como entidade do
-- mundo e/ou participante do combate, com registro de origem (GER-06, SI-06), e
-- registrar rolagens autenticadas como atividade da crônica (DRA-05).

-- Registro de origem visível só para narradores. Escrita apenas pela função abaixo.
create table public.generated_content_applications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  idempotency_key uuid not null,
  source_kind text not null check (source_kind in ('generator', 'second_inquisition')),
  source_ref jsonb not null default '{}' check (jsonb_typeof(source_ref) = 'object' and octet_length(source_ref::text) <= 8192),
  combat_block jsonb check (combat_block is null or (jsonb_typeof(combat_block) = 'object' and octet_length(combat_block::text) <= 16384)),
  entity_id uuid references public.world_entities(id) on delete set null,
  combat_id uuid references public.combat_sessions(id) on delete set null,
  participant_id uuid,
  participant_name text check (participant_name is null or char_length(participant_name) between 1 and 120),
  applied_by uuid not null references auth.users(id) on delete restrict,
  applied_at timestamptz not null default now(),
  unique (campaign_id, idempotency_key)
);

create index generated_content_applications_campaign_idx
  on public.generated_content_applications(campaign_id, applied_at desc);

alter table public.generated_content_applications enable row level security;
revoke all on public.generated_content_applications from public, anon, authenticated;
grant select on public.generated_content_applications to authenticated;
create policy "campaign managers read generated applications" on public.generated_content_applications
  for select to authenticated using (private.can_manage_campaign(campaign_id));

create or replace function public.rpg_apply_generated_content(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_source_kind text,
  p_source_ref jsonb,
  p_name text,
  p_entity_kind text default 'npc',
  p_entity_body jsonb default '{}'::jsonb,
  p_save_entity boolean default true,
  p_combat_id uuid default null,
  p_initiative integer default null,
  p_health integer default null,
  p_combat_block jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  previous public.generated_content_applications%rowtype;
  application_id uuid := gen_random_uuid();
  clean_name text := btrim(coalesce(p_name, ''));
  new_entity_id uuid;
  scene public.combat_sessions%rowtype;
  participants jsonb;
  active_id text;
  turn_index integer;
  candidate text;
  suffix integer := 1;
  new_participant_id uuid;
  sorted jsonb;
  next_state jsonb;
  new_version integer;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_campaign_id is null or not private.can_manage_campaign(p_campaign_id) then
    raise exception using errcode = '42501', message = 'only campaign managers apply generated content';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'idempotency key required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('generated-content:' || p_campaign_id::text || ':' || p_idempotency_key::text, 0));
  select * into previous from public.generated_content_applications
   where campaign_id = p_campaign_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'application_id', previous.id, 'entity_id', previous.entity_id, 'combat_id', previous.combat_id,
      'participant_id', previous.participant_id, 'participant_name', previous.participant_name, 'replayed', true);
  end if;

  if p_source_kind is null or p_source_kind not in ('generator', 'second_inquisition') then
    raise exception using errcode = '22023', message = 'invalid source kind';
  end if;
  if p_source_ref is null or jsonb_typeof(p_source_ref) <> 'object' then
    raise exception using errcode = '22023', message = 'source reference must be an object';
  end if;
  if char_length(clean_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'name must have 1 to 120 characters';
  end if;
  if not coalesce(p_save_entity, false) and p_combat_id is null then
    raise exception using errcode = '22023', message = 'choose a world entity, a combat or both';
  end if;
  if coalesce(p_entity_kind, '') not in ('npc', 'event') then
    raise exception using errcode = '22023', message = 'invalid entity kind';
  end if;
  if p_entity_body is null or jsonb_typeof(p_entity_body) <> 'object' or octet_length(p_entity_body::text) > 32768 then
    raise exception using errcode = '22023', message = 'invalid entity body';
  end if;

  if coalesce(p_save_entity, false) then
    insert into public.world_entities (campaign_id, kind, name, body, created_by)
    values (
      p_campaign_id, p_entity_kind::public.world_entity_kind, clean_name,
      p_entity_body || jsonb_build_object('origin', jsonb_build_object(
        'application_id', application_id, 'source_kind', p_source_kind, 'applied_at', now())),
      uid)
    returning id into new_entity_id;
  end if;

  if p_combat_id is not null then
    if p_initiative is null or p_initiative not between 0 and 1000 then
      raise exception using errcode = '22023', message = 'initiative must be between 0 and 1000';
    end if;
    if p_health is null or p_health not between 1 and 1000 then
      raise exception using errcode = '22023', message = 'health must be between 1 and 1000';
    end if;
    select * into scene from public.combat_sessions
     where id = p_combat_id and campaign_id = p_campaign_id
     for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'combat not found in campaign';
    end if;
    if not scene.active then
      raise exception using errcode = '55000', message = 'combat is closed';
    end if;

    participants := case when jsonb_typeof(scene.state->'participants') = 'array'
      then scene.state->'participants' else '[]'::jsonb end;
    if jsonb_array_length(participants) >= 50 then
      raise exception using errcode = '54000', message = 'combat already has 50 participants';
    end if;
    turn_index := case when jsonb_typeof(scene.state->'turn') = 'number' then (scene.state->>'turn')::integer else 0 end;
    active_id := participants->turn_index->>'id';

    candidate := clean_name;
    while exists (select 1 from jsonb_array_elements(participants) as item(value)
                   where lower(item.value->>'name') = lower(candidate)) loop
      suffix := suffix + 1;
      candidate := left(clean_name, 114) || ' ' || suffix::text;
    end loop;

    new_participant_id := gen_random_uuid();
    select coalesce(jsonb_agg(item.value order by (item.value->>'initiative')::numeric desc, item.value->>'name'), '[]'::jsonb)
      into sorted
      from jsonb_array_elements(participants || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'id', new_participant_id::text, 'name', candidate, 'initiative', p_initiative,
        'health', p_health, 'health_max', p_health, 'entity_id', new_entity_id,
        'origin', jsonb_build_object('application_id', application_id, 'source_kind', p_source_kind))))) as item(value);

    if active_id is null then
      turn_index := 0;
    else
      select (ord - 1)::integer into turn_index
        from jsonb_array_elements(sorted) with ordinality as x(value, ord)
       where x.value->>'id' = active_id;
      turn_index := coalesce(turn_index, 0);
    end if;

    next_state := scene.state || jsonb_build_object(
      'participants', sorted,
      'turn', turn_index,
      'round', case when jsonb_typeof(scene.state->'round') = 'number' then scene.state->'round' else to_jsonb(1) end,
      'paused', case when jsonb_typeof(scene.state->'paused') = 'boolean' then scene.state->'paused' else to_jsonb(false) end);

    update public.combat_sessions set state = next_state
     where id = scene.id
     returning version into new_version;

    insert into public.combat_events (combat_id, actor_id, event_type, payload)
    values (scene.id, uid, 'generated_participant', jsonb_build_object(
      'participant_id', new_participant_id, 'name', candidate, 'source_kind', p_source_kind,
      'application_id', application_id, 'entity_id', new_entity_id));
  end if;

  insert into public.generated_content_applications (
    id, campaign_id, idempotency_key, source_kind, source_ref, combat_block,
    entity_id, combat_id, participant_id, participant_name, applied_by)
  values (
    application_id, p_campaign_id, p_idempotency_key, p_source_kind, p_source_ref, p_combat_block,
    new_entity_id, p_combat_id, new_participant_id, candidate, uid);

  return jsonb_build_object(
    'application_id', application_id, 'entity_id', new_entity_id, 'combat_id', p_combat_id,
    'participant_id', new_participant_id, 'participant_name', candidate,
    'combat_version', new_version, 'replayed', false);
end;
$$;

revoke all on function public.rpg_apply_generated_content(uuid, uuid, text, jsonb, text, text, jsonb, boolean, uuid, integer, integer, jsonb) from public, anon;
grant execute on function public.rpg_apply_generated_content(uuid, uuid, text, jsonb, text, text, jsonb, boolean, uuid, integer, integer, jsonb) to authenticated;

-- DRA-05: rolagens da sessão viram atividade da crônica sem duplicar.
alter table public.chronicle_activity
  add column source text not null default 'manual' check (source in ('manual', 'roll')),
  add column roll_key text check (roll_key is null or char_length(roll_key) between 1 and 120);
create unique index chronicle_activity_roll_key_idx
  on public.chronicle_activity(campaign_id, roll_key) where roll_key is not null;

create or replace function public.rpg_record_roll_activity(
  p_sheet_id uuid,
  p_roll_key text,
  p_trait_ids text[] default '{}',
  p_campaign_id uuid default null,
  p_occurred_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sheet_campaign uuid;
  sheet_owner uuid;
  model_schema jsonb;
  model_status text;
  valid_traits text[];
  existing_id uuid;
  activity_count integer;
  new_id uuid;
  day date := coalesce(p_occurred_on, current_date);
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_roll_key is null or char_length(p_roll_key) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'roll key must have 1 to 120 characters';
  end if;
  if cardinality(coalesce(p_trait_ids, '{}')) > 50 then
    raise exception using errcode = '22023', message = 'at most 50 traits per roll';
  end if;
  if day > current_date then
    raise exception using errcode = '22023', message = 'activity cannot be in the future';
  end if;

  select sheet.campaign_id, sheet.owner_id, template.schema, template.status::text
    into sheet_campaign, sheet_owner, model_schema, model_status
    from public.character_sheets sheet
    left join public.system_templates template on template.id = sheet.template_id
   where sheet.id = p_sheet_id;
  -- Fichas fora da campanha do usuário respondem igual a inexistentes.
  if not found or sheet_campaign is null or not private.is_campaign_member(sheet_campaign)
     or (p_campaign_id is not null and p_campaign_id <> sheet_campaign) then
    return jsonb_build_object('status', 'not_in_campaign');
  end if;
  if sheet_owner <> uid and not private.can_manage_campaign(sheet_campaign) then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  if model_status is distinct from 'approved' then
    return jsonb_build_object('status', 'unapproved_template');
  end if;

  select coalesce(array_agg(distinct used.trait_id order by used.trait_id), '{}')
    into valid_traits
    from unnest(coalesce(p_trait_ids, '{}')) as used(trait_id)
   where exists (
     select 1 from jsonb_array_elements(coalesce(model_schema->'fields', '[]'::jsonb)) as field(definition)
      where field.definition->>'id' = used.trait_id and field.definition->>'kind' = 'number');
  if cardinality(valid_traits) = 0 then
    return jsonb_build_object('status', 'no_traits');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('chronicle-activity:' || sheet_campaign::text, 0));
  select id into existing_id from public.chronicle_activity
   where campaign_id = sheet_campaign and roll_key = p_roll_key;
  if found then
    return jsonb_build_object('status', 'duplicate', 'activity_id', existing_id);
  end if;
  select count(*) into activity_count from public.chronicle_activity where campaign_id = sheet_campaign;
  if activity_count >= 500 then
    return jsonb_build_object('status', 'limit_reached');
  end if;

  insert into public.chronicle_activity (campaign_id, sheet_id, occurred_on, used_trait_ids, created_by, source, roll_key)
  values (sheet_campaign, p_sheet_id, day, valid_traits, uid, 'roll', p_roll_key)
  returning id into new_id;
  return jsonb_build_object('status', 'recorded', 'activity_id', new_id, 'campaign_id', sheet_campaign, 'used_trait_ids', to_jsonb(valid_traits));
end;
$$;

revoke all on function public.rpg_record_roll_activity(uuid, text, text[], uuid, date) from public, anon;
grant execute on function public.rpg_record_roll_activity(uuid, text, text[], uuid, date) to authenticated;
