begin;
select plan(17);

insert into auth.users (id, aud, role, email)
values
  ('1c000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fog-lia@example.test'),
  ('1c000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'fog-master@example.test'),
  ('1c000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'fog-bram@example.test');
insert into public.campaigns (id, owner_id, name)
values ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000002', 'Fog Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000001', 'player'),
       ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000003', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('3c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001',
        '1c000000-0000-0000-0000-000000000002', 'Fog Template', 'approved', '{"fields":[{"id":"name","kind":"text"}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values)
values
  ('4c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001', '3c000000-0000-0000-0000-000000000001',
   '1c000000-0000-0000-0000-000000000001', 'Lia', '{"name":"Lia"}'::jsonb),
  ('4c000000-0000-0000-0000-000000000002', '2c000000-0000-0000-0000-000000000001', '3c000000-0000-0000-0000-000000000001',
   '1c000000-0000-0000-0000-000000000003', 'Bram', '{"name":"Bram"}'::jsonb);

-- A vertical wall at x=2000 with a door in the middle (gap y 1800..2200).
create temporary table fog_base as select
  '{"version":2,"system_key":"one-ring","width":10000,"height":7500,"background":"grass","grid":{"visible":true,"size":250},
    "structures":[
      {"id":"wall","type":"wall","points":[[2000,0],[2000,4000]],"material":"stone","thickness":60},
      {"id":"door","type":"door","wall_id":"wall","at":0.5,"width":400,"style":"wooden","state":"closed"},
      {"id":"barrel","type":"prop","kind":"barrel","x":3500,"y":3500,"rotation":0,"scale":1},
      {"id":"floor","type":"area","points":[[2500,500],[4500,500],[4500,1500],[2500,1500]],"material":"wood_planks"}],
    "pins":[
      {"id":"lia","kind":"character","sheet_id":"4c000000-0000-0000-0000-000000000001","label":"Lia","x":1000,"y":2000,"gm_only":false},
      {"id":"bram","kind":"character","sheet_id":"4c000000-0000-0000-0000-000000000002","label":"Bram","x":1200,"y":3000,"gm_only":false},
      {"id":"orc","kind":"npc","label":"Orc","x":3000,"y":2000,"gm_only":false}],
    "fog":{"enabled":true,"line_of_sight":true,"regions":[
      {"id":"f-all","mode":"reveal","points":[[0,0],[3200,0],[3200,4000],[0,4000]],"players":null},
      {"id":"f-lia","mode":"reveal","points":[[3200,3000],[4000,3000],[4000,4000],[3200,4000]],"players":["1c000000-0000-0000-0000-000000000001"]}]}}'::jsonb as document;
grant select on fog_base to authenticated;

-- Validation of the fog object.
select throws_ok($$insert into public.maps (campaign_id, name, created_by, document)
  select '2c000000-0000-0000-0000-000000000001', 'Bad', '1c000000-0000-0000-0000-000000000002',
         jsonb_set(document, '{fog,regions,0,mode}', '"peek"') from fog_base$$,
  '22023', null, 'unknown fog region modes are rejected');
select throws_ok($$insert into public.maps (campaign_id, name, created_by, document)
  select '2c000000-0000-0000-0000-000000000001', 'Bad', '1c000000-0000-0000-0000-000000000002',
         jsonb_set(document, '{fog,regions,1,players}', '["not-a-uuid"]') from fog_base$$,
  '22023', null, 'fog players must be user ids');
select throws_ok($$insert into public.maps (campaign_id, name, created_by, document)
  select '2c000000-0000-0000-0000-000000000001', 'Bad', '1c000000-0000-0000-0000-000000000002',
         jsonb_set(document, '{fog,regions,0,points,0}', '[20000,0]') from fog_base$$,
  '22023', null, 'fog coordinates stay within 0..10000');
select throws_ok($$insert into public.maps (campaign_id, name, created_by, document)
  select '2c000000-0000-0000-0000-000000000001', 'Bad', '1c000000-0000-0000-0000-000000000002',
         jsonb_set(document, '{fog,regions}', (select jsonb_agg(jsonb_build_object('id', 'r' || n, 'mode', 'reveal', 'points', '[[0,0],[1,0],[1,1]]'::jsonb, 'players', null))
                                                 from generate_series(1, 501) as n)) from fog_base$$,
  '22023', null, 'fog holds at most 500 regions');
select lives_ok($$insert into public.maps (id, campaign_id, name, created_by, system_key, shared_with_players, document)
  select '7c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001', 'Cripta',
         '1c000000-0000-0000-0000-000000000002', 'one-ring', true, document from fog_base$$, 'a valid fog document is accepted');

-- Lia: closed door hides the orc; her own region reveals the barrel.
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000001', true);
create temporary table lia_view as select public.get_player_map('7c000000-0000-0000-0000-000000000001') -> 'document' as document;
select is((select jsonb_agg(value ->> 'id' order by ordinality) from lia_view, jsonb_array_elements(document -> 'pins') with ordinality),
  '["lia", "bram"]'::jsonb, 'pins behind a closed door are out of sight');
select ok((select document -> 'structures' @> '[{"id":"barrel"}]' from lia_view), 'a region aimed at the player reveals what lies under it');
select ok((select document -> 'structures' @> '[{"id":"door"}, {"id":"floor"}]' from lia_view), 'doors follow their wall and partly revealed floors stay');
select is((select jsonb_array_length(document -> 'fog' -> 'regions') from lia_view), 2, 'the player receives the regions that apply to them');
select ok(not (select jsonb_path_exists(document, '$.fog.regions[*].players ? (@ != null)') from lia_view), 'player lists never leave the database');

-- Bram: Lia's region does not apply.
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000003', true);
select ok(not (public.get_player_map('7c000000-0000-0000-0000-000000000001') -> 'document' -> 'structures' @> '[{"id":"barrel"}]'),
  'another player''s reveal does not apply');
select is(jsonb_array_length(public.get_player_map('7c000000-0000-0000-0000-000000000001') -> 'document' -> 'fog' -> 'regions'), 1,
  'regions of other players are not sent');

-- Opening the door lets Lia see through the gap, but not Bram (his line hits the wall).
reset role;
update public.maps set document = jsonb_set(document, '{structures,1,state}', '"open"') where id = '7c000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000001', true);
select ok(public.get_player_map('7c000000-0000-0000-0000-000000000001') -> 'document' -> 'pins' @> '[{"id":"orc"}]', 'an open door lets sight through');
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000003', true);
select ok(not (public.get_player_map('7c000000-0000-0000-0000-000000000001') -> 'document' -> 'pins' @> '[{"id":"orc"}]'), 'the wall beside the door still blocks');

-- Covering everything for Lia keeps only her own pin, also in move_own_pin.
reset role;
update public.maps set document = jsonb_set(document, '{fog,regions}', (document -> 'fog' -> 'regions') ||
  '[{"id":"f-hide","mode":"hide","points":[[0,0],[10000,0],[10000,7500],[0,7500]],"players":["1c000000-0000-0000-0000-000000000001"]}]'::jsonb)
 where id = '7c000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000001', true);
select is((select jsonb_agg(value ->> 'id') from jsonb_array_elements(public.get_player_map('7c000000-0000-0000-0000-000000000001') -> 'document' -> 'pins')),
  '["lia"]'::jsonb, 'own pin stays visible under fog; everything else is removed');
select is(jsonb_array_length(public.move_own_pin('7c000000-0000-0000-0000-000000000001', 'lia', 1500, 2500) -> 'document' -> 'structures'), 0,
  'move_own_pin answers with the same redaction');

reset role;
select is(jsonb_array_length(private.redact_map_document((select document from public.maps where id = '7c000000-0000-0000-0000-000000000001')) -> 'fog' -> 'regions'), 1,
  'the one-argument redaction only applies regions meant for everyone');

select * from finish();
rollback;
