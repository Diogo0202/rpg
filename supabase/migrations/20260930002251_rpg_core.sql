-- Núcleo privado do RPG Nexus. Todo conteúdo pertence a uma conta ou campanha.
create extension if not exists vector;

create type public.campaign_role as enum ('owner', 'master', 'player', 'guest');
create type public.source_kind as enum ('upload', 'google_drive');
create type public.extraction_status as enum ('queued', 'processing', 'needs_review', 'approved', 'failed');
create type public.world_entity_kind as enum ('character', 'npc', 'item', 'rule', 'location', 'quest', 'event', 'scene');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  created_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 3 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_members (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.campaign_role not null default 'player',
  created_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

-- Esta função evita recursão nas políticas de membros. Ela só responde sobre o usuário autenticado.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_campaign_member(target_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = target_campaign and c.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.campaign_members cm
    where cm.campaign_id = target_campaign and cm.user_id = (select auth.uid())
  );
$$;

create or replace function private.can_manage_campaign(target_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = target_campaign and c.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.campaign_members cm
    where cm.campaign_id = target_campaign
      and cm.user_id = (select auth.uid())
      and cm.role in ('owner', 'master')
  );
$$;

revoke all on function private.is_campaign_member(uuid) from public;
revoke all on function private.can_manage_campaign(uuid) from public;
grant execute on function private.is_campaign_member(uuid) to authenticated;
grant execute on function private.can_manage_campaign(uuid) to authenticated;

create table public.library_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  kind public.source_kind not null,
  title text not null check (char_length(title) between 1 and 240),
  mime_type text not null,
  storage_path text unique,
  drive_file_id text,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  rights_confirmed boolean not null default false,
  rights_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'upload' and storage_path is not null and drive_file_id is null) or
         (kind = 'google_drive' and drive_file_id is not null))
);

create table public.library_grants (
  source_id uuid not null references public.library_sources(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  granted_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (source_id, campaign_id)
);

create table public.extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.library_sources(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status public.extraction_status not null default 'queued',
  page_references integer[] not null check (cardinality(page_references) > 0),
  draft jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.system_templates (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  source_id uuid references public.library_sources(id) on delete set null,
  name text not null check (char_length(name) between 3 and 120),
  version integer not null default 1 check (version > 0),
  status public.extraction_status not null default 'needs_review',
  schema jsonb not null check (jsonb_typeof(schema) = 'object'),
  page_references integer[] not null default '{}',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (campaign_id, name, version)
);

create table public.character_sheets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  template_id uuid not null references public.system_templates(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  values jsonb not null default '{}' check (jsonb_typeof(values) = 'object'),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table public.world_entities (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  kind public.world_entity_kind not null,
  name text not null check (char_length(name) between 1 and 160),
  body jsonb not null default '{}' check (jsonb_typeof(body) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.world_relations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  from_entity_id uuid not null references public.world_entities(id) on delete cascade,
  to_entity_id uuid not null references public.world_entities(id) on delete cascade,
  relation_type text not null check (char_length(relation_type) between 1 and 80),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  check (from_entity_id <> to_entity_id),
  unique (from_entity_id, to_entity_id, relation_type)
);

create table public.maps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  document jsonb not null default '{"version":1,"layers":[]}' check (jsonb_typeof(document) = 'object'),
  grid_kind text not null default 'square' check (grid_kind in ('square', 'hex')),
  isometric boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.map_pins (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps(id) on delete cascade,
  entity_id uuid not null references public.world_entities(id) on delete cascade,
  x numeric(10,2) not null,
  y numeric(10,2) not null,
  label text not null default '' check (char_length(label) <= 120),
  unique (map_id, entity_id)
);

create table public.combat_sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  map_id uuid references public.maps(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  state jsonb not null default '{"initiative":[],"round":1}' check (jsonb_typeof(state) = 'object'),
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.combat_events (
  id uuid primary key default gen_random_uuid(),
  combat_id uuid not null references public.combat_sessions(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (char_length(event_type) between 1 and 80),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null,
  subject_type text not null,
  subject_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Embeddings ficam sem acesso direto do navegador; a busca passa pelo backend autenticado.
create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.library_sources(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index campaigns_owner_idx on public.campaigns(owner_id);
create index campaign_members_user_idx on public.campaign_members(user_id);
create index library_sources_owner_idx on public.library_sources(owner_id);
create index library_grants_campaign_idx on public.library_grants(campaign_id);
create index character_sheets_campaign_idx on public.character_sheets(campaign_id);
create index world_entities_campaign_idx on public.world_entities(campaign_id);
create index maps_campaign_idx on public.maps(campaign_id);
create index combat_sessions_campaign_idx on public.combat_sessions(campaign_id);
create index combat_events_combat_idx on public.combat_events(combat_id, created_at);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.library_sources enable row level security;
alter table public.library_grants enable row level security;
alter table public.extraction_jobs enable row level security;
alter table public.system_templates enable row level security;
alter table public.character_sheets enable row level security;
alter table public.world_entities enable row level security;
alter table public.world_relations enable row level security;
alter table public.maps enable row level security;
alter table public.map_pins enable row level security;
alter table public.combat_sessions enable row level security;
alter table public.combat_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.document_chunks enable row level security;

create policy "profile owner reads" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profile owner inserts" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profile owner updates" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "campaign members read" on public.campaigns for select to authenticated using (private.is_campaign_member(id));
create policy "users create campaigns" on public.campaigns for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "owners update campaigns" on public.campaigns for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "owners delete campaigns" on public.campaigns for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "campaign members list members" on public.campaign_members for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "masters invite members" on public.campaign_members for insert to authenticated with check (private.can_manage_campaign(campaign_id));
create policy "masters update members" on public.campaign_members for update to authenticated using (private.can_manage_campaign(campaign_id)) with check (private.can_manage_campaign(campaign_id));
create policy "masters remove members" on public.campaign_members for delete to authenticated using (private.can_manage_campaign(campaign_id));

create policy "owners manage sources" on public.library_sources for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "source owner grants access" on public.library_grants for all to authenticated using (exists (select 1 from public.library_sources s where s.id = source_id and s.owner_id = (select auth.uid()))) with check (exists (select 1 from public.library_sources s where s.id = source_id and s.owner_id = (select auth.uid())));
create policy "campaign members see grants" on public.library_grants for select to authenticated using (private.is_campaign_member(campaign_id));

create policy "owners manage extraction jobs" on public.extraction_jobs for all to authenticated using ((select auth.uid()) = requested_by) with check ((select auth.uid()) = requested_by);
create policy "campaign members read templates" on public.system_templates for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "masters manage templates" on public.system_templates for insert to authenticated with check (private.can_manage_campaign(campaign_id) and (select auth.uid()) = owner_id);
create policy "masters update templates" on public.system_templates for update to authenticated using (private.can_manage_campaign(campaign_id)) with check (private.can_manage_campaign(campaign_id));
create policy "masters delete templates" on public.system_templates for delete to authenticated using (private.can_manage_campaign(campaign_id));

create policy "sheet owners or masters read" on public.character_sheets for select to authenticated using ((select auth.uid()) = owner_id or private.can_manage_campaign(campaign_id));
create policy "sheet owners or masters create" on public.character_sheets for insert to authenticated with check ((select auth.uid()) = owner_id or private.can_manage_campaign(campaign_id));
create policy "sheet owners or masters update" on public.character_sheets for update to authenticated using ((select auth.uid()) = owner_id or private.can_manage_campaign(campaign_id)) with check ((select auth.uid()) = owner_id or private.can_manage_campaign(campaign_id));
create policy "masters delete sheets" on public.character_sheets for delete to authenticated using (private.can_manage_campaign(campaign_id));

create policy "members read world entities" on public.world_entities for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "masters manage world entities" on public.world_entities for insert to authenticated with check (private.can_manage_campaign(campaign_id) and (select auth.uid()) = created_by);
create policy "masters update world entities" on public.world_entities for update to authenticated using (private.can_manage_campaign(campaign_id)) with check (private.can_manage_campaign(campaign_id));
create policy "masters delete world entities" on public.world_entities for delete to authenticated using (private.can_manage_campaign(campaign_id));
create policy "members read relations" on public.world_relations for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "masters manage relations" on public.world_relations for all to authenticated using (private.can_manage_campaign(campaign_id)) with check (private.can_manage_campaign(campaign_id));

create policy "members read maps" on public.maps for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "masters manage maps" on public.maps for all to authenticated using (private.can_manage_campaign(campaign_id)) with check (private.can_manage_campaign(campaign_id));
create policy "members read map pins" on public.map_pins for select to authenticated using (exists (select 1 from public.maps m where m.id = map_id and private.is_campaign_member(m.campaign_id)));
create policy "masters manage map pins" on public.map_pins for all to authenticated using (exists (select 1 from public.maps m where m.id = map_id and private.can_manage_campaign(m.campaign_id))) with check (exists (select 1 from public.maps m where m.id = map_id and private.can_manage_campaign(m.campaign_id)));

create policy "members read combat sessions" on public.combat_sessions for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "masters manage combat sessions" on public.combat_sessions for all to authenticated using (private.can_manage_campaign(campaign_id)) with check (private.can_manage_campaign(campaign_id));
create policy "members read combat events" on public.combat_events for select to authenticated using (exists (select 1 from public.combat_sessions c where c.id = combat_id and private.is_campaign_member(c.campaign_id)));
create policy "members add own combat events" on public.combat_events for insert to authenticated with check ((select auth.uid()) = actor_id and exists (select 1 from public.combat_sessions c where c.id = combat_id and private.is_campaign_member(c.campaign_id)));
create policy "masters remove combat events" on public.combat_events for delete to authenticated using (exists (select 1 from public.combat_sessions c where c.id = combat_id and private.can_manage_campaign(c.campaign_id)));

create policy "members read audit trail" on public.audit_events for select to authenticated using (campaign_id is not null and private.is_campaign_member(campaign_id));
create policy "members add own audit events" on public.audit_events for insert to authenticated with check ((select auth.uid()) = actor_id and campaign_id is not null and private.is_campaign_member(campaign_id));

-- O servidor usa service_role para indexar; o navegador nunca lê chunks crus.
revoke all on public.document_chunks from authenticated;

insert into storage.buckets (id, name, public) values ('library', 'library', false)
on conflict (id) do update set public = false;
create policy "owners upload library files" on storage.objects for insert to authenticated with check (bucket_id = 'library' and owner_id = (select auth.uid()));
create policy "owners view library files" on storage.objects for select to authenticated using (bucket_id = 'library' and owner_id = (select auth.uid()));
create policy "owners update library files" on storage.objects for update to authenticated using (bucket_id = 'library' and owner_id = (select auth.uid())) with check (bucket_id = 'library' and owner_id = (select auth.uid()));
create policy "owners delete library files" on storage.objects for delete to authenticated using (bucket_id = 'library' and owner_id = (select auth.uid()));
