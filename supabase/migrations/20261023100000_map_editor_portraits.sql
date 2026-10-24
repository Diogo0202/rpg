-- Top-down map editor and character portraits.
-- Portraits live in a private bucket readable by campaign members, because
-- map pins show every character's photo to the whole table. Maps stay
-- manager-only; players get a redacted copy through get_player_map once the
-- master shares it, and may move only the pin of a sheet they own.

-- Portraits ---------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('character-portraits', 'character-portraits', false, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

-- Path: {campaign_id}/{uploader_id}/{uuid}.webp. Returns null for any other
-- shape, so policies never cast an attacker-chosen name to uuid.
create or replace function private.portrait_path_parts(p_name text, out campaign_id uuid, out uploader_id uuid)
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
begin
  if p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$' then
    return;
  end if;
  campaign_id := split_part(p_name, '/', 1)::uuid;
  uploader_id := split_part(p_name, '/', 2)::uuid;
end;
$$;
revoke all on function private.portrait_path_parts(text) from public;
grant execute on function private.portrait_path_parts(text) to authenticated;

create policy "players and managers upload own portraits" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'character-portraits'
    and (private.portrait_path_parts(name)).uploader_id = (select auth.uid())
    and (private.is_campaign_player((private.portrait_path_parts(name)).campaign_id)
         or private.can_manage_campaign((private.portrait_path_parts(name)).campaign_id))
  );
create policy "uploaders replace own portraits" on storage.objects for update to authenticated
  using (bucket_id = 'character-portraits' and (private.portrait_path_parts(name)).uploader_id = (select auth.uid()))
  with check (bucket_id = 'character-portraits' and (private.portrait_path_parts(name)).uploader_id = (select auth.uid()));
create policy "uploaders delete own portraits" on storage.objects for delete to authenticated
  using (bucket_id = 'character-portraits' and (private.portrait_path_parts(name)).uploader_id = (select auth.uid()));
create policy "campaign members view portraits" on storage.objects for select to authenticated
  using (bucket_id = 'character-portraits' and private.is_campaign_member((private.portrait_path_parts(name)).campaign_id));

alter table public.character_sheets add column portrait_path text;

-- The portrait must sit in this campaign's folder and be uploaded by the
-- sheet owner or a campaign manager (the master may create sheets for players).
create or replace function private.validate_character_portrait()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  parts record;
begin
  if new.portrait_path is null or (tg_op = 'UPDATE' and new.portrait_path is not distinct from old.portrait_path) then
    return new;
  end if;
  select * into parts from private.portrait_path_parts(new.portrait_path);
  if parts.campaign_id is distinct from new.campaign_id then
    raise exception 'portrait must belong to the sheet campaign' using errcode = '22023';
  end if;
  if parts.uploader_id <> new.owner_id
     and not exists (select 1 from public.campaigns where id = new.campaign_id and owner_id = parts.uploader_id)
     and not exists (select 1 from public.campaign_members where campaign_id = new.campaign_id
                       and user_id = parts.uploader_id and role in ('owner', 'master')) then
    raise exception 'portrait must be uploaded by the sheet owner or a campaign manager' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_character_portrait() from public;
create trigger character_sheets_validate_portrait
  before insert or update of portrait_path on public.character_sheets
  for each row execute function private.validate_character_portrait();

-- Map documents v2 --------------------------------------------------------

alter table public.maps add column shared_with_players boolean not null default false;
alter table public.maps add column system_key text check (system_key is null or system_key ~ '^[a-z0-9-]{1,80}$');

-- Version 2 documents carry vector structures and pins in 0..10000 space.
-- Older generated documents (version 1) are left untouched.
create or replace function private.validate_map_document()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  doc jsonb := new.document;
  structure jsonb;
  pin jsonb;
  point_count integer;
  min_points integer;
begin
  if doc ->> 'version' is distinct from '2' then return new; end if;
  if jsonb_typeof(doc -> 'structures') is distinct from 'array' or jsonb_array_length(doc -> 'structures') > 2000
     or jsonb_typeof(doc -> 'pins') is distinct from 'array' or jsonb_array_length(doc -> 'pins') > 300 then
    raise exception 'map documents hold at most 2000 structures and 300 pins' using errcode = '22023';
  end if;
  if jsonb_path_exists(doc, '$.structures[*].points[*][*] ? (@.type() != "number" || @ < 0 || @ > 10000)')
     or jsonb_path_exists(doc, '$.structures[*] ? (exists(@.x) && (@.x.type() != "number" || @.x < 0 || @.x > 10000 || @.y.type() != "number" || @.y < 0 || @.y > 10000))')
     or jsonb_path_exists(doc, '$.pins[*] ? (@.x.type() != "number" || @.x < 0 || @.x > 10000 || @.y.type() != "number" || @.y < 0 || @.y > 10000)') then
    raise exception 'map coordinates must be numbers between 0 and 10000' using errcode = '22023';
  end if;

  for structure in select value from jsonb_array_elements(doc -> 'structures') loop
    if jsonb_typeof(structure) is distinct from 'object'
       or jsonb_typeof(structure -> 'id') is distinct from 'string' or char_length(structure ->> 'id') not between 1 and 64
       or structure ->> 'type' is null or structure ->> 'type' not in ('wall', 'area', 'door', 'shadow', 'prop')
       or (structure ? 'material' and coalesce(structure ->> 'material', '') !~ '^[a-z_]{1,40}$')
       or (structure ? 'label' and (jsonb_typeof(structure -> 'label') <> 'string' or char_length(structure ->> 'label') > 120)) then
      raise exception 'invalid map structure' using errcode = '22023';
    end if;
    if structure ->> 'type' in ('wall', 'area', 'shadow') then
      point_count := case when jsonb_typeof(structure -> 'points') = 'array' then jsonb_array_length(structure -> 'points') else 0 end;
      min_points := case when structure ->> 'type' = 'wall' then 2 else 3 end;
      if point_count > 500 or point_count < min_points then
        raise exception 'map structure % has too few or too many points', structure ->> 'id' using errcode = '22023';
      end if;
    elsif structure ->> 'type' = 'door' then
      if jsonb_typeof(structure -> 'wall_id') is distinct from 'string'
         or jsonb_typeof(structure -> 'at') is distinct from 'number'
         or (structure ->> 'at')::numeric not between 0 and 1
         or coalesce(structure ->> 'state', '') not in ('open', 'closed', 'locked') then
        raise exception 'invalid door %', structure ->> 'id' using errcode = '22023';
      end if;
    elsif coalesce(structure ->> 'kind', '') !~ '^[a-z_]{1,40}$'
       or jsonb_typeof(structure -> 'x') is distinct from 'number' or jsonb_typeof(structure -> 'y') is distinct from 'number' then
      raise exception 'invalid prop %', structure ->> 'id' using errcode = '22023';
    end if;
  end loop;

  for pin in select value from jsonb_array_elements(doc -> 'pins') loop
    if jsonb_typeof(pin) is distinct from 'object'
       or jsonb_typeof(pin -> 'id') is distinct from 'string' or char_length(pin ->> 'id') not between 1 and 64
       or pin ->> 'kind' is null or pin ->> 'kind' not in ('character', 'npc', 'item')
       or jsonb_typeof(pin -> 'x') is distinct from 'number' or jsonb_typeof(pin -> 'y') is distinct from 'number'
       or jsonb_typeof(pin -> 'label') is distinct from 'string' or char_length(pin ->> 'label') > 120
       or jsonb_typeof(pin -> 'gm_only') is distinct from 'boolean'
       or (pin ? 'ring_color' and coalesce(pin ->> 'ring_color', '') !~ '^#[0-9a-fA-F]{6}$')
       or (pin ? 'icon' and coalesce(pin ->> 'icon', '') !~ '^[a-z_]{1,40}$')
       or (pin ? 'size' and coalesce(pin ->> 'size', '') not in ('small', 'medium', 'large')) then
      raise exception 'invalid map pin' using errcode = '22023';
    end if;
    if pin ->> 'kind' = 'character' and not exists (
      select 1 from public.character_sheets sheet
       where sheet.id::text = pin ->> 'sheet_id' and sheet.campaign_id = new.campaign_id
    ) then
      raise exception 'character pin % must reference a sheet of this campaign', pin ->> 'id' using errcode = '22023';
    end if;
    if pin ->> 'entity_id' is not null and not exists (
      select 1 from public.world_entities entity
       where entity.id::text = pin ->> 'entity_id' and entity.campaign_id = new.campaign_id
    ) then
      raise exception 'pin % must reference an entity of this campaign', pin ->> 'id' using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.validate_map_document() from public;
create trigger maps_validate_document
  before insert or update of document on public.maps
  for each row execute function private.validate_map_document();

-- Redaction: no GM-only pins or structures, no legacy marker notes, and each
-- character pin carries the portrait path players may sign through Storage.
create or replace function private.redact_map_document(p_document jsonb)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case when p_document ->> 'version' is distinct from '2' then
    jsonb_build_object('version', 1, 'width', p_document -> 'width', 'height', p_document -> 'height',
      'layers', coalesce((select jsonb_agg(layer) from jsonb_array_elements(coalesce(p_document -> 'layers', '[]'::jsonb)) as layers(layer)
                           where layer ->> 'id' = 'terrain'), '[]'::jsonb))
  else
    (p_document - 'legacy' - 'notes')
    || jsonb_build_object(
      'structures', coalesce((select jsonb_agg(structure - 'notes' order by ordinality)
                                from jsonb_array_elements(p_document -> 'structures') with ordinality as items(structure, ordinality)
                               where coalesce((structure ->> 'gm_only')::boolean, false) = false), '[]'::jsonb),
      'pins', coalesce((select jsonb_agg((pin - 'notes') || case when pin ->> 'kind' = 'character'
                                    then jsonb_build_object('portrait_path', sheet.portrait_path) else '{}'::jsonb end
                                  order by ordinality)
                          from jsonb_array_elements(p_document -> 'pins') with ordinality as items(pin, ordinality)
                          left join public.character_sheets sheet on sheet.id::text = pin ->> 'sheet_id'
                         where coalesce((pin ->> 'gm_only')::boolean, false) = false), '[]'::jsonb),
      'legacy', jsonb_build_object('terrain', p_document -> 'legacy' -> 'terrain',
                                   'width', p_document -> 'legacy' -> 'width', 'height', p_document -> 'legacy' -> 'height'))
  end;
$$;
revoke all on function private.redact_map_document(jsonb) from public;

create or replace function public.list_player_maps(p_campaign_id uuid)
returns table (id uuid, name text, version integer, system_key text, updated_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
  select map.id, map.name, map.version, map.system_key, map.updated_at
    from public.maps map
   where map.campaign_id = p_campaign_id and map.shared_with_players
     and private.is_campaign_member(p_campaign_id)
   order by map.updated_at desc;
$$;
revoke all on function public.list_player_maps(uuid) from public, anon;
grant execute on function public.list_player_maps(uuid) to authenticated;

create or replace function public.get_player_map(p_map_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  map public.maps;
begin
  select * into map from public.maps where id = p_map_id;
  if not found or not map.shared_with_players or not private.is_campaign_member(map.campaign_id) then
    raise exception 'map not found or not shared' using errcode = '42501';
  end if;
  return jsonb_build_object('id', map.id, 'campaign_id', map.campaign_id, 'name', map.name, 'version', map.version,
    'system_key', map.system_key, 'document', private.redact_map_document(map.document));
end;
$$;
revoke all on function public.get_player_map(uuid) from public, anon;
grant execute on function public.get_player_map(uuid) to authenticated;

-- Players reposition only the pin of a sheet they own; everything else in
-- the document stays as the master saved it.
create or replace function public.move_own_pin(p_map_id uuid, p_pin_id text, p_x numeric, p_y numeric)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  map public.maps;
  pin_index integer;
  pin jsonb;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_x is null or p_y is null or p_x not between 0 and 10000 or p_y not between 0 and 10000 then
    raise exception 'pin position must be between 0 and 10000' using errcode = '22023';
  end if;
  select * into map from public.maps where id = p_map_id for update;
  if not found or not map.shared_with_players or not private.is_campaign_member(map.campaign_id)
     or map.document ->> 'version' is distinct from '2' then
    raise exception 'map not found or not shared' using errcode = '42501';
  end if;
  select ordinality - 1, value into pin_index, pin
    from jsonb_array_elements(map.document -> 'pins') with ordinality
   where value ->> 'id' = p_pin_id limit 1;
  if pin is null or pin ->> 'kind' <> 'character' or coalesce((pin ->> 'gm_only')::boolean, false) or not exists (
    select 1 from public.character_sheets sheet
     where sheet.id::text = pin ->> 'sheet_id' and sheet.owner_id = auth.uid()
  ) then
    raise exception 'only your own character pin can be moved' using errcode = '42501';
  end if;
  update public.maps
     set document = jsonb_set(document, array['pins', pin_index::text],
                              pin || jsonb_build_object('x', round(p_x, 2), 'y', round(p_y, 2)))
   where id = p_map_id
  returning * into map;
  return jsonb_build_object('id', map.id, 'version', map.version, 'document', private.redact_map_document(map.document));
end;
$$;
revoke all on function public.move_own_pin(uuid, text, numeric, numeric) from public, anon;
grant execute on function public.move_own_pin(uuid, text, numeric, numeric) to authenticated;

-- Realtime invalidation (no map content in the payload) -------------------

create table public.map_notifications (
  map_id uuid primary key references public.maps(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.map_notifications enable row level security;
revoke all on public.map_notifications from public, anon, authenticated;
grant select on public.map_notifications to authenticated;
create policy "members read map notifications" on public.map_notifications for select to authenticated
  using (private.is_campaign_member(campaign_id));

create or replace function private.notify_map_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  insert into public.map_notifications (map_id, campaign_id, revision, updated_at)
  values (new.id, new.campaign_id, 1, now())
  on conflict (map_id) do update
    set revision = public.map_notifications.revision + 1, updated_at = now();
  return new;
end;
$$;
revoke all on function private.notify_map_change() from public, anon, authenticated;
create trigger maps_realtime_notification
  after insert or update on public.maps
  for each row execute function private.notify_map_change();

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and puballtables)
     and not exists (select 1 from pg_catalog.pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'map_notifications') then
    alter publication supabase_realtime add table public.map_notifications;
  end if;
end;
$$;
