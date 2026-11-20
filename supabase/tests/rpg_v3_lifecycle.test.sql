begin;
select plan(22);
insert into auth.users(id,email) values
('13000000-0000-0000-0000-000000000081','life-owner@example.test'),
('13000000-0000-0000-0000-000000000082','life-player@example.test'),
('13000000-0000-0000-0000-000000000083','life-other@example.test');
insert into public.campaigns(id,owner_id,name) values
('23000000-0000-0000-0000-000000000081','13000000-0000-0000-0000-000000000081','V3 life');
insert into public.campaign_members(campaign_id,user_id,role) values
('23000000-0000-0000-0000-000000000081','13000000-0000-0000-0000-000000000082','player');
insert into public.system_templates(id,campaign_id,owner_id,name,status,schema) values
('33000000-0000-0000-0000-000000000081','23000000-0000-0000-0000-000000000081','13000000-0000-0000-0000-000000000081','V3 life','approved',
'{"system_key":"vampire-v3","fields":[{"id":"pontos_sangue","kind":"number"},{"id":"ant_geracao","kind":"number"},{"id":"dano_letal","kind":"number"},{"id":"dano_contundente","kind":"number"},{"id":"dano_agravado","kind":"number"}]}'::jsonb);
insert into public.character_sheets(id,campaign_id,template_id,owner_id,name,values) values
('43000000-0000-0000-0000-000000000081','23000000-0000-0000-0000-000000000081','33000000-0000-0000-0000-000000000081','13000000-0000-0000-0000-000000000082','Lia','{"pontos_sangue":5,"ant_geracao":0,"dano_letal":0,"dano_contundente":0,"dano_agravado":0}');
set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-0000-0000-000000000082',true);
select is(public.v3_life_state('43000000-0000-0000-0000-000000000081')->>'state','active','legacy sheet starts active without changing its template');
select is(public.v3_apply_damage('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000081','letal',9)->>'state','torpor','lethal overflow enters torpor');
select is(public.v3_life_state('43000000-0000-0000-0000-000000000081')->>'state','torpor','torpor persists across calls');
select is((public.v3_apply_damage('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000081','letal',9)->>'replayed')::boolean,true,'lost acknowledgement replays the same receipt');
select is((select count(*)::integer from public.v3_life_operations),1,'replay adds no second operation');
select throws_ok($$select public.v3_apply_damage('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000081','letal',8)$$,'23505',null,'changed payload cannot reuse a receipt');
select throws_ok($$select public.v3_heal('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000082',1)$$,'23514',null,'torpor blocks blood expenditure before awakening');
select throws_ok($$select public.v3_life_action('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000083','alimentar',3,null,'Presa aprovada pela mesa')$$,'42501',null,'player cannot self-award feeding');
select throws_ok($$update public.v3_life_states set state='active'$$,'42501',null,'state cannot bypass RPC through direct update');
select set_config('request.jwt.claim.sub','13000000-0000-0000-0000-000000000081',true);
select is((public.v3_life_action('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000084','alimentar',3,null,'Presa aprovada pela mesa')->'sheet'->'values'->>'pontos_sangue')::integer,8,'narrator records feeding');
select is(public.v3_life_action('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000085','despertar',null,null,'Repouso cumprido e teste de Despertar aprovado')->>'state','active','narrator confirms rest and awakening');
select is((select (values->>'pontos_sangue')::integer from public.character_sheets where id='43000000-0000-0000-0000-000000000081'),7,'awakening spends one blood point');
select is((select (values->>'dano_letal')::integer from public.character_sheets where id='43000000-0000-0000-0000-000000000081'),6,'awakening returns injured vampire to Aleijado');
select is(public.v3_apply_damage('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000086','agravado',1)->>'state','final_death','aggravated damage takes final health level');
select throws_ok($$select public.v3_life_action('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000087','despertar',null,null,'Tentativa de desfazer Morte Final')$$,'23514',null,'Final Death cannot be undone by awakening');
select throws_ok($$select public.v3_spend_blood('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000088',1)$$,'23514',null,'Final Death blocks ordinary blood actions');
select set_config('request.jwt.claim.sub','13000000-0000-0000-0000-000000000083',true);
select throws_ok($$select public.v3_life_state('43000000-0000-0000-0000-000000000081')$$,'42501',null,'outsider cannot read state');
select ok(not has_function_privilege('anon','public.v3_life_action(uuid,uuid,text,integer,text,text)','execute'), 'anonymous cannot execute life actions');
select throws_ok($$select public.v3_life_action('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000091','torpor',null,null,'Outsider attempts a state change')$$,'42501',null,'security definer refuses outsider mutation');
reset role;
delete from public.campaign_members where campaign_id='23000000-0000-0000-0000-000000000081' and user_id='13000000-0000-0000-0000-000000000082';
set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-0000-0000-000000000082',true);
select throws_ok($$select public.v3_life_action('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000081','dano',9,'letal',null)$$,'42501',null,'revoked owner cannot replay an earlier receipt');
select is((select count(*)::integer from public.v3_life_operations),0,'revoked owner cannot read receipts');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.v3_life_action('43000000-0000-0000-0000-000000000081','53000000-0000-0000-0000-000000000092','dano',1,'letal',null)$$,'42501',null,'security definer requires an authenticated identity');
select * from finish();
rollback;
