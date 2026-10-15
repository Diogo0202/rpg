create table public.campaign_music_cues (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid,
  title text not null check (char_length(title) between 3 and 160),
  scene_type text not null check (scene_type in ('arrival', 'exploration', 'intrigue', 'tension', 'combat', 'aftermath', 'rest')),
  duration_seconds integer not null check (duration_seconds between 30 and 3600),
  brief text not null default '' check (char_length(brief) <= 8000),
  notes text not null default '' check (char_length(notes) <= 2000),
  audio_url text check (
    audio_url is null or (
      char_length(audio_url) between 9 and 2048
      and audio_url ~ '^https://[^/@?#[:space:]]+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
    )
  ),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, campaign_id),
  constraint campaign_music_cues_session_campaign_fk
    foreign key (session_id, campaign_id)
    references public.campaign_sessions(id, campaign_id)
    on delete set null (session_id)
);

create index campaign_music_cues_campaign_idx on public.campaign_music_cues(campaign_id, updated_at desc);
create index campaign_music_cues_session_idx on public.campaign_music_cues(session_id);

create or replace function private.touch_campaign_music_cue()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.campaign_id is distinct from old.campaign_id then
      raise exception 'campaign music cue identity cannot change';
    end if;
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_campaign_music_cue() from public, anon, authenticated;
create trigger campaign_music_cues_touch_version
  before insert or update on public.campaign_music_cues
  for each row execute function private.touch_campaign_music_cue();

alter table public.campaign_music_cues enable row level security;
create policy "members read campaign music cues" on public.campaign_music_cues
  for select to authenticated using (private.is_campaign_member(campaign_id));
create policy "managers manage campaign music cues" on public.campaign_music_cues
  for all to authenticated using (private.can_manage_campaign(campaign_id))
  with check (private.can_manage_campaign(campaign_id));
grant select, insert, update, delete on public.campaign_music_cues to authenticated;
revoke all on public.campaign_music_cues from anon;
