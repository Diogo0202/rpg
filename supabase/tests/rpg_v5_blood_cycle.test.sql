begin;
select plan(56);

insert into auth.users(id) values
  ('91000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000002'),
  ('91000000-0000-4000-8000-000000000003'),
  ('91000000-0000-4000-8000-000000000004');
insert into public.campaigns(id,owner_id,name) values
  ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Frente F1');
insert into public.campaign_members(campaign_id,user_id,role) values
  ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','player'),
  ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003','player');
insert into public.system_templates(id,campaign_id,owner_id,name,status,schema) values (
  '93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','V5 sangue','approved',
  '{"fields":[{"id":"cla","label":"Clã","kind":"select","options":["Brujah","Caitiff"]},
    {"id":"vigor","label":"Vigor","kind":"number"},{"id":"autocontrole","label":"Autocontrole","kind":"number"},{"id":"resolucao","label":"Resolução","kind":"number"},
    {"id":"saude_superficial","label":"S","kind":"number"},{"id":"saude_agravada","label":"A","kind":"number"},
    {"id":"vontade_superficial","label":"VS","kind":"number"},{"id":"vontade_agravada","label":"VA","kind":"number"},
    {"id":"fome","label":"Fome","kind":"number"},{"id":"humanidade","label":"Humanidade","kind":"number"},
    {"id":"manchas","label":"Manchas","kind":"number"},{"id":"potencia_sangue","label":"Potência","kind":"number"},
    {"id":"compulsao_atual","label":"Compulsão","kind":"select","options":["Nenhuma","Fome","Dominação","Destruição","Paranoia","Compulsão do clã"]},
    {"id":"torpor","label":"Torpor","kind":"checkbox"}]}'),
  ('93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Mortal','approved',
  '{"fields":[{"id":"vigor","label":"Vigor","kind":"number"},{"id":"saude_superficial","label":"S","kind":"number"},{"id":"saude_agravada","label":"A","kind":"number"}]}');
insert into public.character_sheets(id,campaign_id,template_id,owner_id,name,values) values
  ('94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
   '91000000-0000-4000-8000-000000000002','Lia',
   '{"cla":"Brujah","vigor":2,"autocontrole":2,"resolucao":2,"saude_superficial":0,"saude_agravada":0,"vontade_superficial":0,"vontade_agravada":0,
     "fome":5,"humanidade":7,"manchas":2,"potencia_sangue":1,"compulsao_atual":"Nenhuma","torpor":false}'),
  ('94000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002',
   '91000000-0000-4000-8000-000000000002','Mortal','{"vigor":2,"saude_superficial":0,"saude_agravada":0}'),
  ('94000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
   '91000000-0000-4000-8000-000000000002','Lia ferida',
   '{"cla":"Brujah","vigor":2,"autocontrole":2,"resolucao":2,"saude_superficial":3,"saude_agravada":0,"vontade_superficial":0,"vontade_agravada":0,
     "fome":2,"humanidade":7,"manchas":2,"potencia_sangue":1,"compulsao_atual":"Nenhuma","torpor":false}');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);

-- Blood Potency table (mirror of v5_blood.py).
select is(private.v5_blood_potency(1) ->> 'rouse_reroll_level','1','BP 1 rerolls Rouse for level 1 powers');
select is(private.v5_blood_potency(5) ->> 'kill_to_reduce_below','2','BP 5 must kill to go below Hunger 2');
select is(private.v5_blood_potency(99) ->> 'potency','10','potency is clamped to 10');

-- Rouse at Hunger 5: Hunger never exceeds 5; a failure flags the hunger frenzy test.
create temp table rouse_a as select public.v5_rouse_check('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001',1,'Rapidez') as r;
select is((select r -> 'outcome' ->> 'hunger_after' from rouse_a),'5','Hunger stays at 5');
select is((select (r -> 'outcome' ->> 'hunger_frenzy_test')::boolean = not (r -> 'outcome' ->> 'success')::boolean from rouse_a),true,
  'a failed Rouse at Hunger 5 flags a hunger frenzy test');
select is((select (r -> 'outcome' ->> 'reroll_allowed')::boolean from rouse_a),true,'BP 1 allows the reroll for a level 1 power');
select is((select cardinality(array(select jsonb_array_elements(r -> 'dice'))) = case when (r -> 'dice' ->> 0)::integer < 6 then 2 else 1 end from rouse_a),true,
  'a failed first die is rerolled once, a success is not');
select is((select (r -> 'outcome' ->> 'success')::boolean = exists (select 1 from jsonb_array_elements_text(r -> 'dice') d where d::integer >= 6) from rouse_a),true,
  'success means any die at 6 or more');
select is((public.v5_rouse_check('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001',1,'Rapidez') ->> 'replayed'),'true',
  'retrying the same operation replays');
select is((select count(*)::integer from public.v5_blood_events where sheet_id='94000000-0000-4000-8000-000000000001'),1,'the replay adds no event');

-- Force the failed-Rouse branch: mending still works, and Hunger rises.
reset role;
create or replace function private.v5_random_die() returns integer language sql volatile as $$ select 1 $$;
set local role authenticated;
create temp table mend_a as select public.v5_mend('94000000-0000-4000-8000-000000000003','95000000-0000-4000-8000-000000000020') as r;
select is((select (r -> 'outcome' ->> 'healed')::integer = 1 from mend_a), true,
  'mend heals one superficial at Blood Potency 1 even when the Rouse fails');
select is((select (r -> 'outcome' ->> 'hunger_after')::integer = case when (r -> 'outcome' ->> 'success')::boolean then (r -> 'outcome' ->> 'hunger_before')::integer else least(5, (r -> 'outcome' ->> 'hunger_before')::integer + 1) end from mend_a), true,
  'a failed mend Rouse raises Hunger, capped at five');
select is((select (r -> 'sheet' -> 'values' ->> 'saude_superficial')::integer = 3 - (r -> 'outcome' ->> 'healed')::integer from mend_a), true,
  'mend and Hunger update commit in the same result');
select is((public.v5_mend('94000000-0000-4000-8000-000000000003','95000000-0000-4000-8000-000000000020') ->> 'replayed'),'true',
  'repeating mend does not roll or heal twice');

select throws_ok($$select public.v5_mend('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000024')$$,
  '23514', null, 'Hunger 5 prevents voluntary mending');
select throws_ok($$select public.v5_blood_surge('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000025','hungry:turn',5)$$,
  '23514', null, 'Hunger 5 prevents voluntary Blood Surge');
reset role;
update public.character_sheets set values = values || '{"fome":3}' where id='94000000-0000-4000-8000-000000000001';
set local role authenticated;
-- Blood Surge is limited to one action for a stable sheet/turn key.
create temp table surge_a as select public.v5_blood_surge('94000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000021','c1:r1',5) as r;
select is((select (r -> 'outcome' ->> 'bonus_dice')::integer = 2 and (r -> 'outcome' ->> 'base_pool')::integer = 5 from surge_a), true,
  'Blood Surge returns BP 1 bonus and records the base pool');
select is((public.v5_blood_surge('94000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000021','c1:r1',5) ->> 'replayed'),'true', 'retrying a Surge replays its same Rouse');
select is(public.v5_blood_surge('94000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000022','c1:r1',5)->>'replayed','true','same turn after browser restart replays existing Surge');
select throws_ok($$select public.v5_blood_surge('94000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000023','c1:r2',29)$$, '22023', null, 'Surge cannot push a pool above 30');
create temp table surged_roll as select public.record_v5_roll('94000000-0000-4000-8000-000000000001',7,3,3,
  '{"base_pool":5,"context_tags":[],"blood_surge":{"operation_id":"95000000-0000-4000-8000-000000000021","turn_key":"c1:r1"}}') as r;
select is((select count(*)::integer from public.v5_roll_records),1,'a Surge creates exactly one stored roll');
select is(public.record_v5_roll('94000000-0000-4000-8000-000000000001',8,0,3,
  '{"base_pool":5,"context_tags":[],"blood_surge":{"operation_id":"95000000-0000-4000-8000-000000000021","turn_key":"c1:r1"}}'),
  (select r from surged_roll),'Surge retry preserves original roll despite changed current modifiers');
select throws_ok($$select public.record_v5_roll('94000000-0000-4000-8000-000000000001',7,3,4,
  '{"base_pool":5,"context_tags":[],"blood_surge":{"operation_id":"95000000-0000-4000-8000-000000000021","turn_key":"c1:r1"}}')$$,
  '23505',null,'Surge receipt rejects a different action difficulty');
select is((public.v5_rouse_check('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002',2) -> 'outcome' ->> 'reroll_allowed'),'false',
  'BP 1 does not reroll a level 2 power');
select throws_ok($$select public.v5_remorse_check('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001')$$,'23505',null,
  'an operation ID cannot be reused for another kind');
select throws_ok($$select public.v5_rouse_check('94000000-0000-4000-8000-000000000001',null)$$,'22023',null,'operation ID is required');

-- Rouse below Hunger 5 moves Hunger by the result.
reset role;
update public.character_sheets set values = values || '{"fome":1}' where id='94000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
create temp table rouse_b as select public.v5_awaken('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000003') as r;
select is((select (r -> 'outcome' ->> 'hunger_after')::integer = case when (r -> 'outcome' ->> 'success')::boolean then 1 else 2 end from rouse_b),true,
  'waking keeps Hunger on a success and raises it on a failure');
select is((select (r -> 'sheet' -> 'values' ->> 'fome') = (r -> 'outcome' ->> 'hunger_after') from rouse_b),true,'the stored Hunger matches the outcome');
select is((select (r -> 'outcome' ->> 'reroll_allowed') from rouse_b),'false','waking has no Discipline reroll');
select is((select r -> 'event' ->> 'kind' from rouse_b),'awaken','waking is audited');

-- Remorse: 10 - 7 - 2 = 1 die; Stains cleared, Humanity -1 only on a failure.
create temp table remorse as select public.v5_remorse_check('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000004') as r;
select is((select r -> 'outcome' ->> 'pool' from remorse),'1','remorse pool is 10 - Humanity - Stains');
select is((select r -> 'sheet' -> 'values' ->> 'manchas' from remorse),'0','stains are cleared');
select is((select (r -> 'sheet' -> 'values' ->> 'humanidade')::integer = case when (r -> 'outcome' ->> 'success')::boolean then 7 else 6 end from remorse),true,
  'Humanity drops only on a failed remorse');
select throws_ok($$select public.v5_remorse_check('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000005')$$,'22023',null,
  'remorse needs stains');

-- Frenzy: Willpower 4 + Humanity / 3; Brujah lose Bane Severity (2) against fury.
create temp table frenzy as select
  public.v5_frenzy_check('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000006',3,'fury') as fury,
  public.v5_frenzy_check('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000007',3,'terror') as terror;
select is((select (fury -> 'outcome' ->> 'pool')::integer from frenzy),(select 4 + (r -> 'sheet' -> 'values' ->> 'humanidade')::integer / 3 - 2 from remorse),
  'Brujah fury frenzy pool subtracts the bane severity');
select is((select (terror -> 'outcome' ->> 'pool')::integer - (fury -> 'outcome' ->> 'pool')::integer from frenzy),2,'terror frenzy has no Brujah penalty');
select is((select jsonb_array_length(terror -> 'dice') = (terror -> 'outcome' ->> 'pool')::integer from frenzy),true,'one die per pool point, rolled in the database');
select throws_ok($$select public.v5_frenzy_check('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000008',0,'fury')$$,'22023',null,
  'frenzy difficulty is validated');

-- Compulsions.
select is(public.v5_set_compulsion('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000009','Paranoia') -> 'sheet' -> 'values' ->> 'compulsao_atual','Paranoia',
  'a named compulsion is stored');
select is(public.v5_set_compulsion('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000010','Compulsão do clã') -> 'outcome' ->> 'clan_compulsion','Rebeldia',
  'the clan compulsion is named for Brujah');
create temp table rolled as select public.v5_set_compulsion('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000011') as r;
select is((select (r -> 'outcome' ->> 'rolled')::boolean and jsonb_array_length(r -> 'dice') >= 1 from rolled),true,'without a name the table is rolled');
select ok((select r -> 'outcome' ->> 'compulsion' in ('Fome','Dominação','Destruição','Paranoia','Compulsão do clã') from rolled),'rolled compulsion comes from the table');
select throws_ok($$select public.v5_set_compulsion('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000012','Xyz')$$,'22023',null,
  'unknown compulsion rejected');

-- Torpor.
select is(public.v5_set_torpor('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000013',true) -> 'sheet' -> 'values' ->> 'torpor','true','enters torpor');
select throws_ok($$select public.v5_awaken('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000014')$$,'22023',null,
  'a vampire in torpor does not wake normally');
select throws_ok($$select public.v5_set_torpor('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000015',true)$$,'22023',null,
  'entering torpor twice is rejected');
select is(public.v5_set_torpor('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000016',false) -> 'sheet' -> 'values' ->> 'torpor','false','leaves torpor');

-- Non-vampire sheets are refused; damage halving only for vampires.
select throws_ok($$select public.v5_rouse_check('94000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000017')$$,'22023',null,
  'mortal sheet has no blood cycle');
select is((select (r ->> 'halved') || '/' || (r ->> 'superficial') from (select public.apply_v5_damage('94000000-0000-4000-8000-000000000001','health',5,0,false,null,null,true) r) x),
  '2/3','vampire halves physical superficial damage rounding up');
select is((select (r ->> 'halved') || '/' || (r ->> 'superficial') from (select public.apply_v5_damage('94000000-0000-4000-8000-000000000002','health',3,0,false,null,null,true) r) x),
  '0/3','mortal sheet ignores the halving flag');
select ok(not has_function_privilege('anon','public.apply_v5_damage(uuid,text,integer,integer,boolean,uuid,text,boolean)','execute'),
  'anonymous callers cannot apply damage');

-- Other members can neither act on the sheet nor read its blood events.
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.v5_rouse_check('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000018')$$,'42501',null,
  'another player cannot rouse this sheet');
select is((select count(*)::integer from public.v5_blood_events),0,'another player cannot read the blood events');

reset role;
delete from public.campaign_members where campaign_id='92000000-0000-4000-8000-000000000001' and user_id='91000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.v5_mend('94000000-0000-4000-8000-000000000003','95000000-0000-4000-8000-000000000020')$$,
  '42501', null, 'revoked sheet owner cannot replay a mend receipt');
select throws_ok($$select public.v5_blood_surge('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000030','revoked:turn',5)$$,
  '42501', null, 'revoked sheet owner cannot invoke a security definer Surge');
select throws_ok($$select public.v5_surge_roll_receipt('94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000021',5,3,'c1:r1','[]')$$,
  '42501',null,'revoked owner cannot fetch a saved surged roll receipt');
select * from finish();
rollback;
