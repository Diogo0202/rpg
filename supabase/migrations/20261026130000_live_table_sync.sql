-- Frente D: combate sincronizado, presença da campanha e consequências ligadas ao mundo.
--
-- 1. combat_sessions/combat_events entram na publication Realtime. O Realtime aplica a RLS
--    de SELECT de cada assinante, então só membros da campanha recebem as mudanças.
--    Os participantes do combate vivem em combat_sessions.state (jsonb) e viajam junto.
-- 2. Canais privados de presença/ping: políticas em realtime.messages (quando o schema existe)
--    delegam a private.can_use_campaign_realtime, testável em pgTAP.
-- 3. public.campaign_event_entity_links liga eventos/consequências do diário a NPCs, itens,
--    missões e locais do mundo, sempre dentro da mesma campanha.

-- 1. Publication ----------------------------------------------------------------------------
do $$
declare
  target_table text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach target_table in array array['combat_sessions', 'combat_events'] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end;
$$;

-- 2. Autorização dos canais privados --------------------------------------------------------
-- Tópico aceito: campaign:<uuid>:live. Membros recebem e publicam presença; somente dono ou
-- mestre publica broadcast (o "ping" de atenção do narrador).
create or replace function private.can_use_campaign_realtime(p_topic text, p_extension text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  parts text[];
  target uuid;
begin
  if p_topic is null or p_topic !~ '^campaign:[0-9a-fA-F-]{36}:live$' then
    return false;
  end if;
  parts := string_to_array(p_topic, ':');
  begin
    target := parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if not private.is_campaign_member(target) then
    return false;
  end if;
  if coalesce(p_write, false) then
    if p_extension = 'presence' then
      return true;
    elsif p_extension = 'broadcast' then
      return private.can_manage_campaign(target);
    end if;
    return false;
  end if;
  return p_extension in ('presence', 'broadcast');
end;
$$;
revoke all on function private.can_use_campaign_realtime(text, text, boolean) from public, anon;
grant execute on function private.can_use_campaign_realtime(text, text, boolean) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is null then
    return;
  end if;
  execute 'alter table realtime.messages enable row level security';
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'campaign members receive live channel') then
    execute $policy$create policy "campaign members receive live channel" on realtime.messages
      for select to authenticated
      using (private.can_use_campaign_realtime(realtime.topic(), extension, false))$policy$;
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'campaign members publish live channel') then
    execute $policy$create policy "campaign members publish live channel" on realtime.messages
      for insert to authenticated
      with check (private.can_use_campaign_realtime(realtime.topic(), extension, true))$policy$;
  end if;
end;
$$;

-- 3. Consequências ligadas a entidades -----------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.world_entities'::regclass and contype = 'u'
       and conkey = array[
         (select attnum from pg_catalog.pg_attribute where attrelid = 'public.world_entities'::regclass and attname = 'id'),
         (select attnum from pg_catalog.pg_attribute where attrelid = 'public.world_entities'::regclass and attname = 'campaign_id')
       ]::int2[]
  ) then
    alter table public.world_entities add constraint world_entities_id_campaign_unique unique (id, campaign_id);
  end if;
end;
$$;

create table public.campaign_event_entity_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  event_id uuid not null,
  entity_id uuid not null,
  link_kind text not null default 'consequence' check (link_kind in ('consequence', 'involves', 'reward', 'setting')),
  notes text not null default '' check (char_length(notes) <= 1000),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (event_id, entity_id, link_kind),
  constraint campaign_event_entity_links_event_fk
    foreign key (event_id, campaign_id) references public.campaign_events(id, campaign_id) on delete cascade,
  constraint campaign_event_entity_links_entity_fk
    foreign key (entity_id, campaign_id) references public.world_entities(id, campaign_id) on delete cascade
);
create index campaign_event_entity_links_campaign_idx on public.campaign_event_entity_links(campaign_id);
create index campaign_event_entity_links_entity_idx on public.campaign_event_entity_links(entity_id);

-- Só NPCs, itens, missões e locais recebem consequências do diário.
create or replace function private.enforce_event_entity_link_kind()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_kind public.world_entity_kind;
begin
  select kind into target_kind from public.world_entities
   where id = new.entity_id and campaign_id = new.campaign_id;
  if target_kind is null or target_kind not in ('npc', 'item', 'quest', 'location') then
    raise exception 'journal links only accept npc, item, quest or location entities'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_event_entity_link_kind() from public, anon, authenticated;
create trigger campaign_event_entity_links_kind
  before insert or update on public.campaign_event_entity_links
  for each row execute function private.enforce_event_entity_link_kind();

alter table public.campaign_event_entity_links enable row level security;
create policy "members read event entity links" on public.campaign_event_entity_links
  for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "managers create event entity links" on public.campaign_event_entity_links
  for insert to authenticated
  with check (private.can_manage_campaign(campaign_id) and created_by = (select auth.uid()));
create policy "managers update event entity links" on public.campaign_event_entity_links
  for update to authenticated
  using (private.can_manage_campaign(campaign_id))
  with check (private.can_manage_campaign(campaign_id));
create policy "managers delete event entity links" on public.campaign_event_entity_links
  for delete to authenticated using (private.can_manage_campaign(campaign_id));

revoke all on public.campaign_event_entity_links from anon, authenticated;
grant select, insert, delete on public.campaign_event_entity_links to authenticated;
grant update (link_kind, notes) on public.campaign_event_entity_links to authenticated;

do $$
begin
  if to_regprocedure('private.audit_campaign_table_write()') is not null then
    execute 'create trigger access_audit_write after insert or update or delete on public.campaign_event_entity_links for each row execute function private.audit_campaign_table_write()';
  end if;
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_catalog.pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_event_entity_links') then
    alter publication supabase_realtime add table public.campaign_event_entity_links;
  end if;
end;
$$;
