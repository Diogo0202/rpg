create table public.campaign_sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  title text not null check (char_length(title) between 1 and 160),
  summary text not null default '' check (char_length(summary) <= 12000),
  status text not null default 'planned' check (status in ('planned', 'played', 'archived')),
  played_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, sequence),
  unique (id, campaign_id)
);

create table public.campaign_factions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  description text not null default '' check (char_length(description) <= 6000),
  goal text not null default '' check (char_length(goal) <= 3000),
  tension integer not null default 0 check (tension between 0 and 12),
  "limit" integer not null default 6 check ("limit" between 1 and 12),
  consequence text not null default '' check (char_length(consequence) <= 3000),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, campaign_id)
);

create table public.campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid,
  faction_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 12000),
  occurred_on date not null default current_date,
  status text not null default 'planned' check (status in ('planned', 'active', 'resolved', 'failed', 'consequence')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, campaign_id),
  constraint campaign_events_session_campaign_fk
    foreign key (session_id, campaign_id)
    references public.campaign_sessions(id, campaign_id)
    on delete set null (session_id),
  constraint campaign_events_faction_campaign_fk
    foreign key (faction_id, campaign_id)
    references public.campaign_factions(id, campaign_id)
    on delete set null (faction_id)
);

create or replace function private.touch_campaign_journal_row()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.touch_campaign_faction()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  return new;
end;
$$;

revoke all on function private.touch_campaign_journal_row() from public, anon, authenticated;
revoke all on function private.touch_campaign_faction() from public, anon, authenticated;

create trigger campaign_sessions_touch_updated_at
  before update on public.campaign_sessions
  for each row execute function private.touch_campaign_journal_row();
create trigger campaign_events_touch_updated_at
  before update on public.campaign_events
  for each row execute function private.touch_campaign_journal_row();
create trigger campaign_factions_touch_version
  before insert or update on public.campaign_factions
  for each row execute function private.touch_campaign_faction();

alter table public.campaign_sessions enable row level security;
alter table public.campaign_factions enable row level security;
alter table public.campaign_events enable row level security;

create policy "members read campaign sessions" on public.campaign_sessions
  for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "managers insert campaign sessions" on public.campaign_sessions
  for insert to authenticated with check (private.can_manage_campaign(campaign_id));
create policy "managers update campaign sessions" on public.campaign_sessions
  for update to authenticated using (private.can_manage_campaign(campaign_id))
  with check (private.can_manage_campaign(campaign_id));
create policy "managers delete campaign sessions" on public.campaign_sessions
  for delete to authenticated using (private.can_manage_campaign(campaign_id));

create policy "members read campaign factions" on public.campaign_factions
  for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "managers insert campaign factions" on public.campaign_factions
  for insert to authenticated with check (private.can_manage_campaign(campaign_id));
create policy "managers update campaign factions" on public.campaign_factions
  for update to authenticated using (private.can_manage_campaign(campaign_id))
  with check (private.can_manage_campaign(campaign_id));
create policy "managers delete campaign factions" on public.campaign_factions
  for delete to authenticated using (private.can_manage_campaign(campaign_id));

create policy "members read campaign events" on public.campaign_events
  for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "managers insert campaign events" on public.campaign_events
  for insert to authenticated with check (private.can_manage_campaign(campaign_id));
create policy "managers update campaign events" on public.campaign_events
  for update to authenticated using (private.can_manage_campaign(campaign_id))
  with check (private.can_manage_campaign(campaign_id));
create policy "managers delete campaign events" on public.campaign_events
  for delete to authenticated using (private.can_manage_campaign(campaign_id));

revoke all on public.campaign_sessions, public.campaign_factions, public.campaign_events from anon, authenticated;
grant select, insert, update, delete on public.campaign_sessions, public.campaign_factions, public.campaign_events to authenticated;
