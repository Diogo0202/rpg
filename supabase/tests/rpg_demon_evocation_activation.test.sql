begin;
select plan(9);

insert into auth.users(id, aud, role, email) values
  ('de000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'narrator@demon.test'),
  ('de000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@demon.test'),
  ('de000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other@demon.test');
insert into public.campaigns(id, owner_id, name) values
  ('de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', 'Demon campaign');
insert into public.campaign_members(campaign_id, user_id, role) values
  ('de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000002', 'player'),
  ('de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000003', 'player');
insert into public.system_templates(id,campaign_id,owner_id,name,status,schema) values
  ('de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001',
   'de000000-0000-4000-8000-000000000001', 'Demônio conferido', 'approved',
   '{"system_key":"demon-the-fallen","fields":[
      {"id":"nome","kind":"text"},{"id":"dou_chama","kind":"number","min":0,"max":5},
      {"id":"fe_permanente","kind":"number","min":0,"max":10},
      {"id":"fe_atual","kind":"number","min":0,"max":10}],
     "meta_currencies":[{"id":"fe","label":"Fé","field":"fe_atual","mode":"pool","max_field":"fe_permanente"}]}'::jsonb);
select set_config('request.jwt.claim.sub', 'de000000-0000-4000-8000-000000000001', false);
insert into public.character_sheets(id,campaign_id,template_id,owner_id,name,values) values
  ('de300000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000002',
   'Mara', '{"nome":"Mara","dou_chama":2,"fe_permanente":3,"fe_atual":3}'::jsonb);

select set_config('request.jwt.claim.sub', 'de000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select throws_ok($$select public.register_demon_evocation(
  'de100000-0000-4000-8000-000000000001','Chama testada','dou_chama',2,2,'Livro conferido',170,
  'Custo e nível conferidos pelo narrador')$$, '42501', null, 'jogador não cadastra evocação');
reset role;

select set_config('request.jwt.claim.sub', 'de000000-0000-4000-8000-000000000001', false);
set local role authenticated;
select throws_ok($$select public.register_demon_evocation(
  'de100000-0000-4000-8000-000000000001','Sem página','dou_chama',2,2,'Livro conferido',null,
  'Custo e nível conferidos pelo narrador')$$, '22023', null, 'cadastro exige página');
select set_config('test.power_a', (select id::text from public.register_demon_evocation(
  'de100000-0000-4000-8000-000000000001','Chama testada','dou_chama',2,2,'Livro conferido',170,
  'Custo e nível conferidos pelo narrador')), false);
select set_config('test.power_b', (select id::text from public.register_demon_evocation(
  'de100000-0000-4000-8000-000000000001','Outra chama','dou_chama',3,1,'Livro conferido',171,
  'Custo e nível conferidos pelo narrador')), false);
select is((select count(*) from public.demon_evocation_catalog), 2::bigint, 'narrador cadastrou dois metadados de evocação');
reset role;

select set_config('request.jwt.claim.sub', 'de000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select throws_ok($$select public.activate_demon_evocation(
  'de300000-0000-4000-8000-000000000001',current_setting('test.power_a')::uuid,
  'de400000-0000-4000-8000-000000000001',1)$$, '42501', null, 'outro jogador não gasta Fé da ficha');
reset role;

select set_config('request.jwt.claim.sub', 'de000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select throws_ok($$select public.activate_demon_evocation(
  'de300000-0000-4000-8000-000000000001',current_setting('test.power_b')::uuid,
  'de400000-0000-4000-8000-000000000002',1)$$, '22023', null, 'doutrina abaixo do nível exigido não ativa');
select is((public.activate_demon_evocation(
  'de300000-0000-4000-8000-000000000001',current_setting('test.power_a')::uuid,
  'de400000-0000-4000-8000-000000000001',1) -> 'activation' ->> 'faith_after')::integer,
  1, 'ativação reduz Fé de 3 para 1');
select is((public.activate_demon_evocation(
  'de300000-0000-4000-8000-000000000001',current_setting('test.power_a')::uuid,
  'de400000-0000-4000-8000-000000000001',1) -> 'activation' ->> 'faith_after')::integer,
  1, 'mesma operação devolve o resultado sem segundo gasto');
select throws_ok($$select public.activate_demon_evocation(
  'de300000-0000-4000-8000-000000000001',current_setting('test.power_a')::uuid,
  'de400000-0000-4000-8000-000000000003',1)$$, '40001', null, 'versão antiga não cria nova ativação');
select throws_ok($$select public.activate_demon_evocation(
  'de300000-0000-4000-8000-000000000001',current_setting('test.power_b')::uuid,
  'de400000-0000-4000-8000-000000000001',1)$$, '23505', null, 'ID usado com outro poder é rejeitado');
reset role;

select * from finish();
rollback;
