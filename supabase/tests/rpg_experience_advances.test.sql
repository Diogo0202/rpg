begin;
select plan(54);

insert into auth.users (id, aud, role, email)
values
  ('13500000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'xp-player@example.test'),
  ('13500000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'xp-master@example.test'),
  ('13500000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'xp-other@example.test'),
  ('13500000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'xp-outsider@example.test');
insert into public.campaigns (id, owner_id, name)
values ('23500000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000002', 'XP Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values
  ('23500000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000001', 'player'),
  ('23500000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000003', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values
  ('33500000-0000-0000-0000-000000000001', '23500000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000002',
   'V5 XP', 'approved',
   '{"system_key":"vampire-v5","experience_field":"experiencia","fields":[
      {"id":"cla","kind":"select","options":["Brujah","Caitiff","Toreador"]},
      {"id":"forca","kind":"number","min":1,"max":5},
      {"id":"briga","kind":"number","min":0,"max":5},
      {"id":"disc_potencia","kind":"number","min":0,"max":5},
      {"id":"disc_auspicios","kind":"number","min":0,"max":5},
      {"id":"potencia_sangue","kind":"number","min":0,"max":10},
      {"id":"especialidades","kind":"collection"},
      {"id":"vantagens","kind":"collection"},
      {"id":"notas","kind":"text"},
      {"id":"experiencia","kind":"number","min":0,"max":9999}],
     "creation_rules":[]}'::jsonb),
  ('33500000-0000-0000-0000-000000000002', '23500000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000002',
   'V3 XP', 'approved',
   '{"system_key":"vampire-v3","experience_field":"experiencia","fields":[
      {"id":"cla","kind":"select","options":["Brujah","Ventrue"]},
      {"id":"forca","kind":"number","min":1,"max":5},
      {"id":"briga","kind":"number","min":0,"max":5},
      {"id":"disc_potencia","kind":"number","min":0,"max":5},
      {"id":"forca_vontade","kind":"number","min":0,"max":10},
      {"id":"experiencia","kind":"number","min":0,"max":9999}],
     "creation_rules":[]}'::jsonb);
-- V3 clan disciplines come from the priority pool; the rule is added after the
-- fixture sheets so the creation check does not apply to them.
update public.system_templates set schema = jsonb_set(schema, '{creation_rules}',
  '[{"type":"priority_points","id":"criacao_v3","label":"Criação","freebies":15,"fields":["disc_potencia"],
     "pools":[{"id":"disciplinas","label":"Disciplinas","base":0,"cost":7,"budgets":[3],
       "groups":[{"label":"Disciplinas","fields":["disc_potencia"]}],
       "allowed":{"field":"cla","cases":{"Brujah":["disc_potencia"],"Ventrue":[]}}}]}]'::jsonb)
 where id = '33500000-0000-0000-0000-000000000002';
update public.system_templates set schema = jsonb_set(schema, '{creation_rules}',
  '[{"type":"select_grants","id":"cla_disciplinas","label":"Disciplinas do clã","field":"cla",
     "fields":["disc_potencia","disc_auspicios"],
     "cases":[{"equals":"Brujah","add":{"disc_potencia":1}},{"equals":"Toreador","add":{"disc_auspicios":1}}]}]'::jsonb)
 where id = '33500000-0000-0000-0000-000000000001';

-- Fixture sheets skip the creation distribution, which this test does not exercise.
alter table public.character_sheets disable trigger character_sheets_validate_rules;
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values)
values
  ('43500000-0000-0000-0000-000000000001', '23500000-0000-0000-0000-000000000001', '33500000-0000-0000-0000-000000000001',
   '13500000-0000-0000-0000-000000000001', 'Brujah', '{"cla":"Brujah","forca":2,"briga":0,"disc_potencia":1,"disc_auspicios":0,"experiencia":0}'::jsonb),
  ('43500000-0000-0000-0000-000000000002', '23500000-0000-0000-0000-000000000001', '33500000-0000-0000-0000-000000000002',
   '13500000-0000-0000-0000-000000000001', 'Antigo', '{"cla":"Ventrue","forca":3,"briga":0,"disc_potencia":0,"forca_vontade":4,"experiencia":0}'::jsonb),
  ('43500000-0000-0000-0000-000000000003', '23500000-0000-0000-0000-000000000001', '33500000-0000-0000-0000-000000000001',
   '13500000-0000-0000-0000-000000000003', 'Outro', '{"cla":"Toreador","forca":1,"experiencia":0}'::jsonb);
alter table public.character_sheets enable trigger character_sheets_validate_rules;

-- Cost function (domain): V5 is new level × multiplier; V3 is current level × multiplier.
select is(private.advance_cost('new', 5, null, 2, 4), 35, 'V5 attribute 2→4 costs 3×5 + 4×5');
select is(private.advance_cost('current', 4, null, 3, 4), 12, 'V3 attribute 3→4 costs 3×4');
select is(private.advance_cost('current', 2, 3, 0, 2), 5, 'V3 new ability costs 3, then 1×2');
select is(private.advance_cost('current', 7, 10, 0, 1), 10, 'V3 new discipline costs 10');
select is(private.advance_cost('level', 3, null, 0, 2), 6, 'ritual level 2 costs 6');
select is(private.advance_cost('per_dot', 3, null, 1, 3), 6, 'two advantage dots cost 6');

-- The master grants XP.
set local role authenticated;
select set_config('request.jwt.claim.sub', '13500000-0000-0000-0000-000000000002', true);
select lives_ok($$select public.increment_xp('43500000-0000-0000-0000-000000000001', 40, 'sessões')$$, 'master grants V5 XP');
select lives_ok($$select public.increment_xp('43500000-0000-0000-0000-000000000002', 30, 'sessões')$$, 'master grants V3 XP');
select lives_ok($$select public.increment_xp('43500000-0000-0000-0000-000000000003', 30, 'sessões')$$, 'master grants XP to the other player');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '13500000-0000-0000-0000-000000000001', true);

select is((public.quote_advance('43500000-0000-0000-0000-000000000001', 'disc_potencia', 2) ->> 'cost')::integer, 10,
  'quote: Brujah buys clan Potence 2 for 2×5');
select is(public.quote_advance('43500000-0000-0000-0000-000000000001', 'disc_auspicios', 1) ->> 'category', 'out_of_clan_discipline',
  'quote: Auspex is out of clan for a Brujah');
select is((public.quote_advance('43500000-0000-0000-0000-000000000001', 'disc_auspicios', 1) ->> 'cost')::integer, 7,
  'quote: out-of-clan level 1 costs 7');
select is((public.quote_advance('43500000-0000-0000-0000-000000000002', 'disc_potencia', 1) ->> 'cost')::integer, 10,
  'quote: V3 new discipline costs 10');
select is((public.quote_advance('43500000-0000-0000-0000-000000000002', 'forca_vontade', 5) ->> 'cost')::integer, 4,
  'quote: V3 Willpower 4→5 costs 4');
select throws_ok($$select public.quote_advance('43500000-0000-0000-0000-000000000001', 'notas', 1)$$,
  '22023', null, 'text fields cannot be bought');

-- Purchase: the database recalculates, debits and raises in one write.
select is((public.purchase_advance('43500000-0000-0000-0000-000000000001', 'forca', 3,
  (select version from public.character_sheets where id = '43500000-0000-0000-0000-000000000001'),
  '53500000-0000-0000-0000-000000000001') -> 'advance' ->> 'cost')::integer, 15, 'V5 Strength 2→3 is charged 15');
select is((select values ->> 'forca' || '/' || (values ->> 'experiencia') from public.character_sheets where id = '43500000-0000-0000-0000-000000000001'),
  '3/25', 'trait raised and XP debited together');
select is((public.purchase_advance('43500000-0000-0000-0000-000000000001', 'forca', 3, 1,
  '53500000-0000-0000-0000-000000000001') ->> 'replayed')::boolean, true, 'repeating the operation replays it');
select is((select values ->> 'experiencia' from public.character_sheets where id = '43500000-0000-0000-0000-000000000001'),
  '25', 'the replay did not charge again');
select throws_ok($$select public.purchase_advance('43500000-0000-0000-0000-000000000001', 'briga', 1, 1,
  '53500000-0000-0000-0000-000000000001')$$, '23505', null, 'operation ID cannot be reused for another trait');
select throws_ok($$select public.purchase_advance('43500000-0000-0000-0000-000000000001', 'briga', 1, 1,
  '53500000-0000-0000-0000-000000000002')$$, '40001', null, 'stale expected version is rejected');
select throws_ok(format($$select public.purchase_advance('43500000-0000-0000-0000-000000000001', 'potencia_sangue', 3, %s,
  '53500000-0000-0000-0000-000000000003')$$, (select version from public.character_sheets where id = '43500000-0000-0000-0000-000000000001')),
  'XP001', null, 'not enough XP for Blood Potency 0→3 (60)');
select is((public.purchase_advance('43500000-0000-0000-0000-000000000001', 'vantagens', 2,
  (select version from public.character_sheets where id = '43500000-0000-0000-0000-000000000001'),
  '53500000-0000-0000-0000-000000000004', 'Recursos') -> 'sheet' -> 'values' -> 'vantagens'), '["Recursos ••"]'::jsonb,
  'advantage dots go into the collection');
select throws_ok(format($$select public.purchase_advance('43500000-0000-0000-0000-000000000003', 'forca', 2, %s,
  '53500000-0000-0000-0000-000000000005')$$, (select 1)), '42501', null, 'player cannot buy on another player sheet');
select throws_ok($$update public.character_sheets set values = values || '{"experiencia":99}'::jsonb
  where id = '43500000-0000-0000-0000-000000000001'$$, '42501', null, 'player still cannot raise XP directly');
select ok(not has_table_privilege('authenticated', 'public.character_advances', 'insert,update,delete'), 'clients cannot write advances directly');

-- Approval mode: the player request stays pending until the master decides.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '13500000-0000-0000-0000-000000000002', true);
insert into public.campaign_experience_settings (campaign_id, requires_approval, updated_by)
values ('23500000-0000-0000-0000-000000000001', true, '13500000-0000-0000-0000-000000000002');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '13500000-0000-0000-0000-000000000001', true);
select is(public.purchase_advance('43500000-0000-0000-0000-000000000002', 'forca', 4,
  (select version from public.character_sheets where id = '43500000-0000-0000-0000-000000000002'),
  '53500000-0000-0000-0000-000000000006') -> 'advance' ->> 'status', 'pending', 'player purchase waits for approval');
select is((select values ->> 'forca' from public.character_sheets where id = '43500000-0000-0000-0000-000000000002'),
  '3', 'pending purchase does not change the sheet');
select is((public.quote_advance('43500000-0000-0000-0000-000000000002', 'forca_vontade', 5) ->> 'xp_available')::integer,
  18, 'pending purchase reserves its XP in the quote');
select is(public.purchase_advance('43500000-0000-0000-0000-000000000002', 'forca_vontade', 5,
  (select version from public.character_sheets where id = '43500000-0000-0000-0000-000000000002'),
  '53500000-0000-0000-0000-000000000007') -> 'advance' ->> 'status', 'pending', 'another purchase can reserve only remaining XP');
select is((public.quote_advance('43500000-0000-0000-0000-000000000002', 'briga', 1) ->> 'xp_available')::integer,
  14, 'all pending costs count against available XP');
select is(public.review_advance((select id from public.character_advances where operation_id = '53500000-0000-0000-0000-000000000007'), false)
  -> 'advance' ->> 'status', 'rejected', 'player cancellation releases the reservation');
select is((public.quote_advance('43500000-0000-0000-0000-000000000002', 'briga', 1) ->> 'xp_available')::integer,
  18, 'rejected purchase no longer reserves XP');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '13500000-0000-0000-0000-000000000002', true);
select throws_ok($$select public.increment_xp('43500000-0000-0000-0000-000000000002', -20, 'adjustment cannot spend reserved XP')$$,
  'XP001', null, 'generic XP adjustment cannot consume a pending reservation');
select throws_ok($$update public.character_sheets set values = values || '{"experiencia":0}'::jsonb
  where id = '43500000-0000-0000-0000-000000000002'$$,
  'XP001', null, 'direct master write cannot consume a pending reservation');
select is(public.review_advance((select id from public.character_advances where operation_id = '53500000-0000-0000-0000-000000000006'), true)
  -> 'advance' ->> 'status', 'applied', 'master approves the pending purchase');
select is((select values ->> 'forca' || '/' || (values ->> 'experiencia') from public.character_sheets where id = '43500000-0000-0000-0000-000000000002'),
  '4/18', 'approval applies V3 Strength 3→4 for 12 XP');
select is(public.refund_advance((select id from public.character_advances where operation_id = '53500000-0000-0000-0000-000000000006'))
  -> 'advance' ->> 'status', 'refunded', 'master refunds the advance');
select is((select values ->> 'forca' || '/' || (values ->> 'experiencia') from public.character_sheets where id = '43500000-0000-0000-0000-000000000002'),
  '3/30', 'refund restores the trait and the XP');

-- Outsider sees no advance history; the owner sees their own.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '13500000-0000-0000-0000-000000000004', true);
select is((select count(*)::integer from public.character_advances), 0, 'outsider cannot read advances');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '13500000-0000-0000-0000-000000000001', true);
select is((select count(*)::integer from public.character_advances), 4, 'owner reads the history of own sheets');

-- V2 pair grants: XP considers all clan options, not just the selected pair.
reset role;
select set_config('request.jwt.claim.sub', '13500000-0000-0000-0000-000000000002', true);
insert into public.system_templates(id,campaign_id,owner_id,name,status,schema)
select '33500000-0000-0000-0000-000000000004',campaign_id,owner_id,'V5 XP pair version','approved',jsonb_set(
  jsonb_set(schema, '{fields}', (schema->'fields') || '[{"id":"disciplina_inicial","kind":"select","options":["Potence 2 Presence 1","Celerity 2 Potence 1","Auspex 2 Presence 1"]},{"id":"disc_presenca","kind":"number","min":0,"max":5},{"id":"disc_rapidez","kind":"number","min":0,"max":5}]'::jsonb),
  '{creation_rules}', '[{"type":"select_grants","id":"cla_disciplinas","label":"Initial pair","field":"cla",
    "fields":["disc_potencia","disc_presenca","disc_rapidez","disc_auspicios"],
    "cases":[{"equals":"Brujah","choices":[{"field":"disciplina_inicial","label":"Pair","options":[
      {"label":"Potence 2 Presence 1","add":{"disc_potencia":2,"disc_presenca":1}},
      {"label":"Celerity 2 Potence 1","add":{"disc_rapidez":2,"disc_potencia":1}}
    ]}]},{"equals":"Toreador","choices":[{"field":"disciplina_inicial","label":"Pair","options":[
      {"label":"Auspex 2 Presence 1","add":{"disc_auspicios":2,"disc_presenca":1}}
    ]}]}]}]'::jsonb)
from public.system_templates where id = '33500000-0000-0000-0000-000000000001';
-- Saved initial choice is deliberately the pair without Celerity.
alter table public.character_sheets disable trigger character_sheets_validate_rules;
insert into public.character_sheets(id,campaign_id,template_id,owner_id,name,values)
select '43500000-0000-0000-0000-000000000004',campaign_id,'33500000-0000-0000-0000-000000000004',owner_id,'Brujah V2',values || '{"disciplina_inicial":"Potence 2 Presence 1","disc_potencia":2,"disc_presenca":1,"disc_rapidez":0}'::jsonb
from public.character_sheets where id = '43500000-0000-0000-0000-000000000001';
alter table public.character_sheets enable trigger character_sheets_validate_rules;
set local role authenticated;
select set_config('request.jwt.claim.sub', '13500000-0000-0000-0000-000000000001', true);
select is(public.quote_advance('43500000-0000-0000-0000-000000000004','disc_rapidez',1)->>'category',
  'clan_discipline','unselected third clan Discipline retains clan category');
select is((public.quote_advance('43500000-0000-0000-0000-000000000004','disc_rapidez',1)->>'cost')::integer,
  5,'unselected third clan Discipline costs new level times five');
select is((public.quote_advance('43500000-0000-0000-0000-000000000004','disc_potencia',3)->>'cost')::integer,
  15,'selected starting Discipline still uses clan cost');
select is(public.quote_advance('43500000-0000-0000-0000-000000000004','disc_auspicios',1)->>'category',
  'out_of_clan_discipline','another clan option does not grant Brujah clan pricing');
select is((public.quote_advance('43500000-0000-0000-0000-000000000004','disc_auspicios',1)->>'cost')::integer,
  7,'external Discipline retains seven XP cost');
select is((private.quote_advance_for(
  (select schema from public.system_templates where id='33500000-0000-0000-0000-000000000004'),
  '{"cla":"Caitiff","disc_rapidez":0}'::jsonb,'disc_rapidez',1,null)->>'cost')::integer,
  6,'Caitiff retain six XP cost despite pair options');
select is((public.purchase_advance('43500000-0000-0000-0000-000000000004','disc_rapidez',1,
  (select version from public.character_sheets where id='43500000-0000-0000-0000-000000000004'),
  '53500000-0000-0000-0000-000000000010')->'advance'->>'cost')::integer,
  5,'pending request reserves the recalculated clan price');
select is((select status::text from public.character_advances where operation_id='53500000-0000-0000-0000-000000000010'),
  'pending','pair-based advance still requires narrator approval');
select is((select values->>'disc_rapidez' from public.character_sheets where id='43500000-0000-0000-0000-000000000004'),
  '0','pending pair-based request leaves trait unchanged');
select is((public.quote_advance('43500000-0000-0000-0000-000000000004','disc_auspicios',1)->>'xp_available')::integer,
  14,'pending request reserves five of nineteen available XP');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '13500000-0000-0000-0000-000000000002', true);
select is((public.review_advance((select id from public.character_advances where operation_id='53500000-0000-0000-0000-000000000010'),true)->'advance'->>'cost')::integer,
  5,'approval recalculates the same clan price');
select is((select values->>'disc_rapidez' from public.character_sheets where id='43500000-0000-0000-0000-000000000004'),
  '1','approved request applies the third clan Discipline');
select is((select values->>'experiencia' from public.character_sheets where id='43500000-0000-0000-0000-000000000004'),
  '14','approval debits five XP once');

select * from finish();
rollback;
