create table public.campaign_playlist_links (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  playlist_id text not null check (playlist_id ~ '^[A-Za-z0-9]{22}$'),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (campaign_id, playlist_id)
);

alter table public.campaign_playlist_links enable row level security;

revoke all on table public.campaign_playlist_links from public, anon, authenticated;
grant select, insert, delete on table public.campaign_playlist_links to authenticated;

create policy "campaign members read playlist links"
  on public.campaign_playlist_links
  for select
  to authenticated
  using (private.is_campaign_member(campaign_id));

create policy "campaign managers add playlist links"
  on public.campaign_playlist_links
  for insert
  to authenticated
  with check (
    private.can_manage_campaign(campaign_id)
    and created_by = (select auth.uid())
  );

create policy "campaign managers remove playlist links"
  on public.campaign_playlist_links
  for delete
  to authenticated
  using (private.can_manage_campaign(campaign_id));
