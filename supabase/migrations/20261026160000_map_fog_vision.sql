-- Frente G: fog of war per player (MAP-05) and line of sight (MAP-08).
--
-- Map documents v2 gain an optional "fog" object:
--   { "enabled": bool, "line_of_sight": bool,
--     "regions": [{ "id", "mode": "reveal"|"hide", "points": [[x,y],...], "players": null | [uuid,...] }] }
-- Regions apply in order; the last one containing a point decides. With fog
-- enabled, get_player_map removes every structure, pin and legacy cell that
-- the caller cannot see, and returns only the caller's regions without the
-- player lists. With line_of_sight, pins of others are removed when walls or
-- closed doors stand between them and every character pin the caller owns.
-- The rules mirror frontend/lib/map-visibility.ts.

-- Validation ------------------------------------------------------------------

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
  region jsonb;
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
         or coalesce(structure ->> 'state', '') not in ('open', 'closed', 'locked')
         or (structure ? 'width' and (jsonb_typeof(structure -> 'width') is distinct from 'number'
                                      or (structure ->> 'width')::numeric not between 50 and 1500)) then
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

  if doc ? 'fog' and jsonb_typeof(doc -> 'fog') is distinct from 'null' then
    if jsonb_typeof(doc -> 'fog') is distinct from 'object'
       or (doc -> 'fog' ? 'enabled' and jsonb_typeof(doc -> 'fog' -> 'enabled') is distinct from 'boolean')
       or (doc -> 'fog' ? 'line_of_sight' and jsonb_typeof(doc -> 'fog' -> 'line_of_sight') is distinct from 'boolean')
       or (doc -> 'fog' ? 'regions' and jsonb_typeof(doc -> 'fog' -> 'regions') is distinct from 'array')
       or coalesce(jsonb_array_length(case when jsonb_typeof(doc -> 'fog' -> 'regions') = 'array' then doc -> 'fog' -> 'regions' end), 0) > 500 then
      raise exception 'map fog holds at most 500 regions' using errcode = '22023';
    end if;
    if jsonb_path_exists(doc, '$.fog.regions[*].points[*][*] ? (@.type() != "number" || @ < 0 || @ > 10000)') then
      raise exception 'fog coordinates must be numbers between 0 and 10000' using errcode = '22023';
    end if;
    for region in select value from jsonb_array_elements(coalesce(doc -> 'fog' -> 'regions', '[]'::jsonb)) loop
      if jsonb_typeof(region) is distinct from 'object'
         or jsonb_typeof(region -> 'id') is distinct from 'string' or char_length(region ->> 'id') not between 1 and 64
         or coalesce(region ->> 'mode', '') not in ('reveal', 'hide')
         or jsonb_typeof(region -> 'points') is distinct from 'array'
         or jsonb_array_length(region -> 'points') not between 3 and 500
         or jsonb_path_exists(region, 'strict $.points[*] ? (@.type() != "array" || @.size() != 2)')
         or (jsonb_typeof(region -> 'players') is distinct from 'null' and region ? 'players' and (
              jsonb_typeof(region -> 'players') is distinct from 'array'
              or jsonb_array_length(region -> 'players') not between 1 and 100
              or jsonb_path_exists(region, '$.players[*] ? (@.type() != "string" || !(@ like_regex "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"))'))) then
        raise exception 'invalid fog region' using errcode = '22023';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_map_document() from public;

-- Geometry helpers (pure) ------------------------------------------------------

create or replace function private.map_jsonb_polygon(p_points jsonb)
returns polygon
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select ('(' || string_agg('(' || (item ->> 0)::float8 || ',' || (item ->> 1)::float8 || ')', ',' order by ordinality) || ')')::polygon
    from jsonb_array_elements(p_points) with ordinality as points(item, ordinality);
$$;
revoke all on function private.map_jsonb_polygon(jsonb) from public, anon, authenticated;

-- Last region containing the point decides; uncovered points stay hidden.
create or replace function private.map_fog_visible(p_polygons polygon[], p_reveal boolean[], p_point point)
returns boolean
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
begin
  for i in reverse coalesce(array_length(p_polygons, 1), 0)..1 loop
    if p_polygons[i] @> p_point then return p_reveal[i]; end if;
  end loop;
  return false;
end;
$$;
revoke all on function private.map_fog_visible(polygon[], boolean[], point) from public, anon, authenticated;

-- Vertices plus points every 250 units (at most 16 per segment), like samplePolyline.
create or replace function private.map_structure_visible(p_item jsonb, p_polygons polygon[], p_reveal boolean[])
returns boolean
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  pts jsonb := p_item -> 'points';
  closed boolean := p_item ->> 'type' in ('area', 'shadow');
  n integer;
  segments integer;
  a point;
  b point;
  steps integer;
  shape polygon;
begin
  if p_item ->> 'type' = 'prop' then
    return private.map_fog_visible(p_polygons, p_reveal, point((p_item ->> 'x')::float8, (p_item ->> 'y')::float8));
  end if;
  if jsonb_typeof(pts) is distinct from 'array' or jsonb_array_length(pts) = 0 then return false; end if;
  n := jsonb_array_length(pts);
  segments := case when closed then n else n - 1 end;
  for k in 0..segments - 1 loop
    a := point((pts -> k ->> 0)::float8, (pts -> k ->> 1)::float8);
    b := point((pts -> ((k + 1) % n) ->> 0)::float8, (pts -> ((k + 1) % n) ->> 1)::float8);
    steps := least(16, greatest(1, ceil((a <-> b) / 250)::integer));
    for s in 0..steps loop
      if private.map_fog_visible(p_polygons, p_reveal, point(a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps)) then
        return true;
      end if;
    end loop;
  end loop;
  if closed and n >= 3 then
    shape := private.map_jsonb_polygon(pts);
    for i in 1..coalesce(array_length(p_polygons, 1), 0) loop
      -- A reveal overlapping the shape counts unless a later hide covers the whole shape.
      if p_reveal[i] and p_polygons[i] && shape and not exists (
        select 1 from generate_series(i + 1, array_length(p_polygons, 1)) as later(j)
         where not p_reveal[later.j] and p_polygons[later.j] @> shape
      ) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;
revoke all on function private.map_structure_visible(jsonb, polygon[], boolean[]) from public, anon, authenticated;

-- True when no wall of p_doc crosses the segment a-b, except inside the gap
-- of an open door on that wall (the gap is at*length +- width/2).
create or replace function private.map_sight_clear(p_doc jsonb, p_from point, p_to point)
returns boolean
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  ray lseg := lseg(p_from, p_to);
  wall jsonb;
  pts jsonb;
  n integer;
  total float8;
  walked float8;
  p0 point;
  p1 point;
  edge lseg;
  hit point;
  along float8;
begin
  for wall in select value from jsonb_array_elements(coalesce(p_doc -> 'structures', '[]'::jsonb)) where value ->> 'type' = 'wall' loop
    pts := wall -> 'points';
    n := jsonb_array_length(pts);
    total := 0;
    for k in 0..n - 2 loop
      total := total + (point((pts -> k ->> 0)::float8, (pts -> k ->> 1)::float8) <-> point((pts -> (k + 1) ->> 0)::float8, (pts -> (k + 1) ->> 1)::float8));
    end loop;
    walked := 0;
    for k in 0..n - 2 loop
      p0 := point((pts -> k ->> 0)::float8, (pts -> k ->> 1)::float8);
      p1 := point((pts -> (k + 1) ->> 0)::float8, (pts -> (k + 1) ->> 1)::float8);
      edge := lseg(p0, p1);
      if edge ?# ray then
        hit := edge # ray;
        if hit is null then return false; end if; -- collinear overlap
        along := walked + (p0 <-> hit);
        if not exists (
          select 1 from jsonb_array_elements(p_doc -> 'structures') door
           where door ->> 'type' = 'door' and door ->> 'wall_id' = wall ->> 'id' and door ->> 'state' = 'open'
             and abs(along - (door ->> 'at')::float8 * total) <= coalesce((door ->> 'width')::float8, 300) / 2
        ) then
          return false;
        end if;
      end if;
      walked := walked + (p0 <-> p1);
    end loop;
  end loop;
  return true;
end;
$$;
revoke all on function private.map_sight_clear(jsonb, point, point) from public, anon, authenticated;

-- Redaction for one viewer --------------------------------------------------------

create or replace function private.redact_map_document(p_document jsonb, p_viewer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  doc jsonb;
  fog jsonb := p_document -> 'fog';
  fog_on boolean;
  los_on boolean;
  polygons polygon[] := '{}';
  reveal boolean[] := '{}';
  own_regions jsonb := '[]'::jsonb;
  own_sheets text[];
  eyes point[] := '{}';
  region jsonb;
  item jsonb;
  kept_structures jsonb := '[]'::jsonb;
  kept_walls text[] := '{}';
  kept_ids text[] := '{}';
  kept_pins jsonb := '[]'::jsonb;
  terrain jsonb := '[]'::jsonb;
  target point;
  seen boolean;
  doc_width float8;
  doc_height float8;
  legacy_width float8;
  legacy_height float8;
begin
  if p_document ->> 'version' is distinct from '2' then
    return jsonb_build_object('version', 1, 'width', p_document -> 'width', 'height', p_document -> 'height',
      'layers', coalesce((select jsonb_agg(layer) from jsonb_array_elements(coalesce(p_document -> 'layers', '[]'::jsonb)) as layers(layer)
                           where layer ->> 'id' = 'terrain'), '[]'::jsonb));
  end if;

  -- GM-only redaction (unchanged from 20261023100000), without the fog object.
  doc := (p_document - 'legacy' - 'notes' - 'fog')
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
                                   'width', p_document -> 'legacy' -> 'width', 'height', p_document -> 'legacy' -> 'height'));

  fog_on := jsonb_typeof(fog) = 'object' and coalesce((fog ->> 'enabled')::boolean, false);
  los_on := jsonb_typeof(fog) = 'object' and coalesce((fog ->> 'line_of_sight')::boolean, false);

  -- Doors only travel with a wall that travels too.
  select coalesce(array_agg(value ->> 'id'), '{}') into kept_walls
    from jsonb_array_elements(doc -> 'structures') where value ->> 'type' = 'wall';
  if not fog_on and not los_on then
    return doc || jsonb_build_object('structures', coalesce((select jsonb_agg(value order by ordinality)
      from jsonb_array_elements(doc -> 'structures') with ordinality
     where value ->> 'type' <> 'door' or value ->> 'wall_id' = any (kept_walls)), '[]'::jsonb));
  end if;

  if fog_on then
    for region in select value from jsonb_array_elements(coalesce(fog -> 'regions', '[]'::jsonb)) with ordinality order by ordinality loop
      if jsonb_typeof(region -> 'players') is distinct from 'array'
         or (p_viewer is not null and region -> 'players' ? p_viewer::text) then
        polygons := polygons || private.map_jsonb_polygon(region -> 'points');
        reveal := reveal || (region ->> 'mode' = 'reveal');
        own_regions := own_regions || jsonb_build_array(jsonb_build_object('id', region -> 'id', 'mode', region -> 'mode',
                                                                          'points', region -> 'points', 'players', null));
      end if;
    end loop;
  end if;

  select coalesce(array_agg(sheet.id::text), '{}') into own_sheets
    from public.character_sheets sheet where p_viewer is not null and sheet.owner_id = p_viewer;
  select coalesce(array_agg(point((value ->> 'x')::float8, (value ->> 'y')::float8)), '{}') into eyes
    from jsonb_array_elements(doc -> 'pins') where value ->> 'kind' = 'character' and value ->> 'sheet_id' = any (own_sheets);

  -- Structures: a wall under fog still blocks sight, so LOS uses doc as is.
  if fog_on then
    kept_walls := '{}';
    kept_ids := '{}';
    for item in select value from jsonb_array_elements(doc -> 'structures') with ordinality order by ordinality loop
      if item ->> 'type' <> 'door' and private.map_structure_visible(item, polygons, reveal) then
        kept_ids := kept_ids || (item ->> 'id');
        if item ->> 'type' = 'wall' then kept_walls := kept_walls || (item ->> 'id'); end if;
      end if;
    end loop;
    kept_structures := coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements(doc -> 'structures') with ordinality
                                  where (value ->> 'type' = 'door' and value ->> 'wall_id' = any (kept_walls))
                                     or (value ->> 'type' <> 'door' and value ->> 'id' = any (kept_ids))), '[]'::jsonb);
  else
    kept_structures := coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements(doc -> 'structures') with ordinality
                                  where value ->> 'type' <> 'door' or value ->> 'wall_id' = any (kept_walls)), '[]'::jsonb);
  end if;

  for item in select value from jsonb_array_elements(doc -> 'pins') with ordinality order by ordinality loop
    if item ->> 'kind' = 'character' and item ->> 'sheet_id' = any (own_sheets) then
      kept_pins := kept_pins || jsonb_build_array(item);
      continue;
    end if;
    target := point((item ->> 'x')::float8, (item ->> 'y')::float8);
    if fog_on and not private.map_fog_visible(polygons, reveal, target) then continue; end if;
    if los_on and coalesce(array_length(eyes, 1), 0) > 0 then
      seen := false;
      for i in 1..array_length(eyes, 1) loop
        if private.map_sight_clear(doc, eyes[i], target) then seen := true; exit; end if;
      end loop;
      if not seen then continue; end if;
    end if;
    kept_pins := kept_pins || jsonb_build_array(item);
  end loop;

  if fog_on and jsonb_typeof(doc -> 'legacy' -> 'terrain') = 'array' then
    doc_width := coalesce((doc ->> 'width')::float8, 10000);
    doc_height := coalesce((doc ->> 'height')::float8, 7500);
    legacy_width := greatest(1, coalesce((doc -> 'legacy' ->> 'width')::float8, 1));
    legacy_height := greatest(1, coalesce((doc -> 'legacy' ->> 'height')::float8, 1));
    terrain := coalesce((select jsonb_agg(cell order by ordinality) from jsonb_array_elements(doc -> 'legacy' -> 'terrain') with ordinality as cells(cell, ordinality)
                          where private.map_fog_visible(polygons, reveal, point(((cell ->> 'x')::float8 + 0.5) * doc_width / legacy_width,
                                                                                ((cell ->> 'y')::float8 + 0.5) * doc_height / legacy_height))), '[]'::jsonb);
    doc := jsonb_set(doc, '{legacy,terrain}', terrain);
  end if;

  return doc || jsonb_build_object(
    'structures', kept_structures,
    'pins', kept_pins,
    'fog', jsonb_build_object('enabled', fog_on, 'line_of_sight', los_on, 'regions', own_regions));
end;
$$;
revoke all on function private.redact_map_document(jsonb, uuid) from public, anon, authenticated;

-- The one-argument form keeps working (regions for everyone only, no own pins).
create or replace function private.redact_map_document(p_document jsonb)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select private.redact_map_document(p_document, null::uuid);
$$;
revoke all on function private.redact_map_document(jsonb) from public;

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
    'system_key', map.system_key, 'document', private.redact_map_document(map.document, auth.uid()));
end;
$$;
revoke all on function public.get_player_map(uuid) from public, anon;
grant execute on function public.get_player_map(uuid) to authenticated;

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
  return jsonb_build_object('id', map.id, 'version', map.version, 'document', private.redact_map_document(map.document, auth.uid()));
end;
$$;
revoke all on function public.move_own_pin(uuid, text, numeric, numeric) from public, anon;
grant execute on function public.move_own_pin(uuid, text, numeric, numeric) to authenticated;
