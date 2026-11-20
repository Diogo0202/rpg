-- Sincronia de musica da mesa: o que o narrador esta tocando, visivel a todos os membros.
create table public.campaign_now_playing (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  context_uri text check (context_uri is null or context_uri ~ '^spotify:(playlist|album):[0-9A-Za-z]{22}$'),
  track_uri text check (track_uri is null or track_uri ~ '^spotify:track:[0-9A-Za-z]{22}$'),
  track_name text check (track_name is null or char_length(track_name) <= 300),
  position_ms integer not null default 0 check (position_ms between 0 and 86400000),
  is_playing boolean not null default false,
  started_at timestamptz,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create or replace function private.stamp_campaign_now_playing()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.stamp_campaign_now_playing() from public, anon, authenticated;
create trigger campaign_now_playing_stamp
  before insert or update on public.campaign_now_playing
  for each row execute function private.stamp_campaign_now_playing();

alter table public.campaign_now_playing enable row level security;
create policy "members read campaign now playing" on public.campaign_now_playing
  for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "managers insert campaign now playing" on public.campaign_now_playing
  for insert to authenticated with check (private.can_manage_campaign(campaign_id));
create policy "managers update campaign now playing" on public.campaign_now_playing
  for update to authenticated using (private.can_manage_campaign(campaign_id))
  with check (private.can_manage_campaign(campaign_id));
create policy "managers delete campaign now playing" on public.campaign_now_playing
  for delete to authenticated using (private.can_manage_campaign(campaign_id));
revoke all on public.campaign_now_playing from anon;
grant select, insert, update, delete on public.campaign_now_playing to authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_now_playing'
     ) then
    alter publication supabase_realtime add table public.campaign_now_playing;
  end if;
end;
$$;

alter table public.campaign_music_cues
  add column spotify_uri text check (spotify_uri is null or spotify_uri ~ '^spotify:(playlist|album|track):[0-9A-Za-z]{22}$');

