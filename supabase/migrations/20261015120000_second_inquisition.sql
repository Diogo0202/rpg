create table public.second_inquisition_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  event_kind text not null check (event_kind in ('public_discipline', 'masquerade_breach', 'digital_trace')),
  area_id text not null check (char_length(btrim(area_id)) between 1 and 100),
  occurred_at timestamptz not null,
  verified_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);

create index second_inquisition_events_campaign_order_idx
  on public.second_inquisition_events(campaign_id, verified_at, id);

create or replace function private.stamp_second_inquisition_event()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'authenticated narrator required' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'confirmed events are immutable' using errcode = '42501';
  end if;
  new.created_by := auth.uid();
  new.verified_at := clock_timestamp();
  new.version := 1;
  return new;
end;
$$;
revoke all on function private.stamp_second_inquisition_event() from public, anon, authenticated;

create trigger second_inquisition_events_stamp
  before insert or update on public.second_inquisition_events
  for each row execute function private.stamp_second_inquisition_event();

alter table public.second_inquisition_events enable row level security;
create policy "managers read second inquisition events" on public.second_inquisition_events
  for select to authenticated using (private.can_manage_campaign(campaign_id));
create policy "managers confirm second inquisition events" on public.second_inquisition_events
  for insert to authenticated with check (private.can_manage_campaign(campaign_id) and created_by = (select auth.uid()));
create policy "managers revoke second inquisition events" on public.second_inquisition_events
  for delete to authenticated using (private.can_manage_campaign(campaign_id));

grant select, insert, delete on public.second_inquisition_events to authenticated;
revoke all on public.second_inquisition_events from anon;
comment on table public.second_inquisition_events is
  'Eventos confirmados pelo mestre, reconstruídos integralmente para cada avaliação determinística da Segunda Inquisição.';
