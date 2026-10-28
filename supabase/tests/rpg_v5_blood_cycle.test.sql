begin;
select plan(40);

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
   '91000000-0000-4000-8000-000000000002','Mortal','{"vigor":2,"saude_superficial":0,"saude_agravada":0}');

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

select * from finish();
rollback;
