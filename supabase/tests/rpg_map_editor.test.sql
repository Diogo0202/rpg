begin;
select plan(26);

insert into auth.users (id, aud, role, email)
values
  ('13000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'map-player@example.test'),
  ('13000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'map-master@example.test'),
  ('13000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'map-other-player@example.test'),
  ('13000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'map-outsider@example.test');
insert into public.campaigns (id, owner_id, name)
values ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000002', 'Map Campaign'),
       ('23000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000004', 'Other Map Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'player'),
       ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000003', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('33000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001',
        '13000000-0000-0000-0000-000000000002', 'Map Template', 'approved', '{"fields":[{"id":"name","kind":"text"}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values, portrait_path)
values
  ('43000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001',
   '13000000-0000-0000-0000-000000000001', 'Player Sheet', '{"name":"A"}'::jsonb,
   '23000000-0000-0000-0000-000000000001/13000000-0000-0000-0000-000000000001/53000000-0000-0000-0000-000000000001.webp'),
  ('43000000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001',
   '13000000-0000-0000-0000-000000000003', 'Other Sheet', '{"name":"B"}'::jsonb, null);
insert into storage.objects (bucket_id, name, owner_id)
values ('character-portraits', '23000000-0000-0000-0000-000000000001/13000000-0000-0000-0000-000000000001/53000000-0000-0000-0000-000000000001.webp',
        '13000000-0000-0000-0000-000000000001');
insert into public.world_entities (id, campaign_id, kind, name, created_by)
values ('63000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 'npc', 'Taverneiro', '13000000-0000-0000-0000-000000000002');

select is((select public from storage.buckets where id = 'character-portraits'), false, 'portrait bucket is private');
select is((select file_size_limit from storage.buckets where id = 'character-portraits'), 2097152::bigint, 'portrait bucket is limited to 2 MB');
select throws_ok($$update public.character_sheets set portrait_path =
  '23000000-0000-0000-0000-000000000002/13000000-0000-0000-0000-000000000003/53000000-0000-0000-0000-000000000009.webp'
  where id = '43000000-0000-0000-0000-000000000002'$$, '22023', null, 'portrait from another campaign folder is rejected');
select throws_ok($$update public.character_sheets set portrait_path =
  '23000000-0000-0000-0000-000000000001/13000000-0000-0000-0000-000000000001/53000000-0000-0000-0000-000000000009.webp'
  where id = '43000000-0000-0000-0000-000000000002'$$, '22023', null, 'portrait uploaded by another player is rejected');
select lives_ok($$update public.character_sheets set portrait_path =
  '23000000-0000-0000-0000-000000000001/13000000-0000-0000-0000-000000000002/53000000-0000-0000-0000-000000000008.webp'
  where id = '43000000-0000-0000-0000-000000000002'$$, 'portrait uploaded by the master is accepted');

-- Document validation.
select throws_ok($$insert into public.maps (campaign_id, name, created_by, document) values
  ('23000000-0000-0000-0000-000000000001', 'Bad', '13000000-0000-0000-0000-000000000002',
   '{"version":2,"structures":[{"id":"w","type":"wall","points":[[0,0],[20000,0]]}],"pins":[]}'::jsonb)$$,
  '22023', null, 'coordinates outside 0..10000 are rejected');
select throws_ok($$insert into public.maps (campaign_id, name, created_by, document) values
  ('23000000-0000-0000-0000-000000000001', 'Bad', '13000000-0000-0000-0000-000000000002',
   '{"version":2,"structures":[{"id":"w","type":"wall","points":[[0,0]]}],"pins":[]}'::jsonb)$$,
  '22023', null, 'a wall needs at least two points');
select throws_ok($$insert into public.maps (campaign_id, name, created_by, document) values
  ('23000000-0000-0000-0000-000000000001', 'Bad', '13000000-0000-0000-0000-000000000002',
   '{"version":2,"structures":[],"pins":[{"id":"p","kind":"character","sheet_id":"43000000-0000-0000-0000-000000000009","label":"X","x":1,"y":1,"gm_only":false}]}'::jsonb)$$,
  '22023', null, 'character pin must reference a sheet of the campaign');
select throws_ok($$insert into public.maps (campaign_id, name, created_by, document) values
  ('23000000-0000-0000-0000-000000000001', 'Bad', '13000000-0000-0000-0000-000000000002',
   '{"version":2,"structures":[{"id":"s","type":"script","points":[[0,0],[1,1]]}],"pins":[]}'::jsonb)$$,
  '22023', null, 'unknown structure types are rejected');

insert into public.maps (id, campaign_id, name, created_by, system_key, document)
values ('73000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 'Taverna',
        '13000000-0000-0000-0000-000000000002', 'one-ring',
        '{"version":2,"system_key":"one-ring","width":10000,"height":7500,"background":"grass","grid":{"visible":true,"size":250},
          "structures":[
            {"id":"w1","type":"wall","points":[[1000,1000],[4000,1000],[4000,3000]],"material":"stone","thickness":60},
            {"id":"a1","type":"area","points":[[1000,1000],[4000,1000],[4000,3000],[1000,3000]],"material":"wood_planks","label":"Salão"},
            {"id":"d1","type":"door","wall_id":"w1","at":0.25,"width":300,"style":"wooden","state":"closed"},
            {"id":"s1","type":"shadow","points":[[1000,1000],[2000,1000],[2000,2000]],"opacity":0.6,"gm_only":true},
            {"id":"o1","type":"prop","kind":"barrel","x":1500,"y":1500,"rotation":0,"scale":1}],
          "pins":[
            {"id":"pc","kind":"character","sheet_id":"43000000-0000-0000-0000-000000000001","label":"A","x":2000,"y":2000,"gm_only":false,"ring_color":"#b55b32","size":"medium"},
            {"id":"pc2","kind":"character","sheet_id":"43000000-0000-0000-0000-000000000002","label":"B","x":2500,"y":2000,"gm_only":false},
            {"id":"npc","kind":"npc","entity_id":"63000000-0000-0000-0000-000000000001","label":"Taverneiro","x":3000,"y":2000,"gm_only":false,"icon":"innkeeper"},
            {"id":"trap","kind":"item","label":"Armadilha","x":3500,"y":2500,"gm_only":true,"icon":"trap","notes":"segredo"}]}'::jsonb);
select ok(exists (select 1 from public.map_notifications where map_id = '73000000-0000-0000-0000-000000000001'), 'map writes create a realtime notification');

-- Player before sharing.
set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);
select is((select count(*)::integer from public.maps), 0, 'players still cannot select raw maps');
select throws_ok($$select public.get_player_map('73000000-0000-0000-0000-000000000001')$$, '42501', null, 'unshared map is hidden from players');
select is((select count(*)::integer from public.list_player_maps('23000000-0000-0000-0000-000000000001')), 0, 'unshared map is not listed');
select is((select count(*)::integer from storage.objects where bucket_id = 'character-portraits'), 1, 'member reads campaign portraits');
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('character-portraits',
  '23000000-0000-0000-0000-000000000001/13000000-0000-0000-0000-000000000001/53000000-0000-0000-0000-000000000002.webp',
  '13000000-0000-0000-0000-000000000001')$$, 'player uploads into own folder');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('character-portraits',
  '23000000-0000-0000-0000-000000000001/13000000-0000-0000-0000-000000000003/53000000-0000-0000-0000-000000000003.webp',
  '13000000-0000-0000-0000-000000000001')$$, '42501', null, 'player cannot upload into another player folder');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('character-portraits',
  '../../etc/passwd', '13000000-0000-0000-0000-000000000001')$$, '42501', null, 'malformed portrait paths are denied');

reset role;
update public.maps set shared_with_players = true where id = '73000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);
select is((select count(*)::integer from public.list_player_maps('23000000-0000-0000-0000-000000000001')), 1, 'shared map is listed for players');
select is((select jsonb_array_length(public.get_player_map('73000000-0000-0000-0000-000000000001') -> 'document' -> 'pins')), 3, 'GM-only pins are redacted');
select is((select jsonb_array_length(public.get_player_map('73000000-0000-0000-0000-000000000001') -> 'document' -> 'structures')), 4, 'GM-only shadows are redacted');
select is((select public.get_player_map('73000000-0000-0000-0000-000000000001') -> 'document' -> 'pins' -> 0 ->> 'portrait_path'),
  '23000000-0000-0000-0000-000000000001/13000000-0000-0000-0000-000000000001/53000000-0000-0000-0000-000000000001.webp',
  'character pins carry the portrait path');
select is(((public.move_own_pin('73000000-0000-0000-0000-000000000001', 'pc', 4321, 1234) -> 'document' -> 'pins' -> 0 ->> 'x'))::numeric,
  4321::numeric, 'player moves own character pin');
select throws_ok($$select public.move_own_pin('73000000-0000-0000-0000-000000000001', 'pc2', 1, 1)$$, '42501', null, 'player cannot move another player pin');
select throws_ok($$select public.move_own_pin('73000000-0000-0000-0000-000000000001', 'npc', 1, 1)$$, '42501', null, 'player cannot move NPC pins');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000004', true);
select throws_ok($$select public.get_player_map('73000000-0000-0000-0000-000000000001')$$, '42501', null, 'outsider cannot read a shared map');
select is((select count(*)::integer from storage.objects where bucket_id = 'character-portraits'), 0, 'outsider cannot read portraits');

select * from finish();
rollback;
