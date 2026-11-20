begin;
select plan(34);

insert into auth.users(id,aud,role,email) values
 ('71000000-0000-4000-8000-000000000001','authenticated','authenticated','ring-master@example.test'),
 ('71000000-0000-4000-8000-000000000002','authenticated','authenticated','ring-player@example.test'),
 ('71000000-0000-4000-8000-000000000003','authenticated','authenticated','ring-outsider@example.test');
insert into public.campaigns(id,owner_id,name) values
 ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Companhia teste'),
 ('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','Outra campanha');
insert into public.campaign_members(campaign_id,user_id,role) values
 ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','player');
insert into public.system_templates(id,campaign_id,owner_id,name,status,schema) values
 ('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','One Ring aprovado','approved','{"system_key":"one-ring","fields":[{"id":"linhagem","kind":"text"},{"id":"segredo","kind":"text"}]}'::jsonb);
alter table public.character_sheets disable trigger character_sheets_validate_rules;
insert into public.character_sheets(id,campaign_id,template_id,owner_id,name,values) values
 ('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','Bard','{"linhagem":"Homens de Bri","segredo":"privado"}'),
 ('74000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Dori','{"linhagem":"Anões do Povo de Durin"}');
alter table public.character_sheets enable trigger character_sheets_validate_rules;
insert into public.campaign_sessions(id,campaign_id,sequence,title,status) values
 ('75000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',1,'Sessão concluída','played');

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select is((public.one_ring_company_snapshot('72000000-0000-4000-8000-000000000001')->>'company'),null,'manager gets a null company before setup');
select is((public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001',0,'create',
 '{"name":"Companhia","patron_id":"bilbo","safe_havens":["Valfenda"]}'::jsonb)->'company'->>'version'),'1','create starts at version one');
select is((public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000002',1,'add_member',
 '{"sheet_id":"74000000-0000-4000-8000-000000000001"}'::jsonb)->'company'->>'society_max'),'4','Bri and Bilbo bonuses count in Society maximum');
select is((public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000003',2,'add_member',
 '{"sheet_id":"74000000-0000-4000-8000-000000000002"}'::jsonb)->'company'->>'society_max'),'5','each member adds one to maximum');
select ok((public.one_ring_company_snapshot('72000000-0000-4000-8000-000000000001')::text not like '%segredo%'),'snapshot does not contain private sheet values');
select is((public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000004',3,'spend',
 '{"amount":3,"reason":"Viagem"}'::jsonb)->'company'->>'society_current'),'2','spending reduces available Society');
select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000005',4,'spend','{"amount":3,"reason":"too much"}'::jsonb)$$,
 '23514',null,'spending cannot go over current maximum');
select is((public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000006',4,'restore',
 '{"amount":1,"reason":"Restauro"}'::jsonb)->'company'->>'society_current'),'3','restore returns spent Society');
select is((public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000007',5,'set_focus',
 '{"source_sheet_id":"74000000-0000-4000-8000-000000000001","target_sheet_id":"74000000-0000-4000-8000-000000000002"}'::jsonb)->'focuses'->0->>'target_sheet_id'),'74000000-0000-4000-8000-000000000002','narrator can set directed focus between company members');
select is((public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000008',6,'reset_session',
 '{"session_id":"75000000-0000-4000-8000-000000000001"}'::jsonb)->'company'->>'society_current'),'5','played session reset restores all available Society');
select is((public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000009',7,'reset_session',
 '{"session_id":"75000000-0000-4000-8000-000000000001"}'::jsonb)->'company'->>'version'),'8','second reset command is accepted as a versioned no-op');
select is(jsonb_array_length(public.one_ring_company_snapshot('72000000-0000-4000-8000-000000000001')->'reset_sessions'),1,'session reset changes balances once');
select is((public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000010',8,'spend',
 '{"amount":4,"reason":"Depois"}'::jsonb)->'company'->>'society_current'),'1','spent amount remains bounded after subsequent commands');
select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000011',9,'set_focus','{"source_sheet_id":"74000000-0000-4000-8000-000000000001","target_sheet_id":"74000000-0000-4000-8000-000000000001"}'::jsonb)$$,
 '23514',null,'self focus is rejected');
select is((public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000004',3,'spend',
 '{"amount":3,"reason":"Viagem"}'::jsonb)->'company'->>'version'),'4','same operation and request returns its saved result');

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000012',10,'configure','{"name":"No","patron_id":null,"safe_havens":[]}'::jsonb)$$,
 '42501',null,'players cannot configure company');
select lives_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000013',9,'set_focus','{"source_sheet_id":"74000000-0000-4000-8000-000000000001","target_sheet_id":null}'::jsonb)$$,
 'player may clear own sheet focus');

select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000014',10,'set_focus','{"source_sheet_id":"74000000-0000-4000-8000-000000000002","target_sheet_id":null}'::jsonb)$$,
 '42501',null,'player cannot change another owner focus');
select throws_ok($$update public.one_ring_companies set spent_this_session=0$$,'42501',null,'raw balance writes are denied');
select throws_ok($$insert into public.one_ring_company_focuses(company_id,campaign_id,source_sheet_id,target_sheet_id) values(gen_random_uuid(),'72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002')$$,'42501',null,'raw focus writes are denied');
select is((select count(*) from public.one_ring_company_notifications),1::bigint,'member sees minimal company notification');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.one_ring_company_snapshot('72000000-0000-4000-8000-000000000001')$$,'42501',null,'outsider cannot read snapshot');
select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000015',10,'spend','{"amount":1,"reason":"No"}'::jsonb)$$,'42501',null,'outsider cannot mutate company');
select is((select count(*) from public.one_ring_company_notifications),0::bigint,'outsider cannot see company notification');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000016',9,'spend','{"amount":1,"reason":"stale"}'::jsonb)$$,'40001',null,'a stale version cannot spend');
select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000004',3,'spend','{"amount":2,"reason":"Viagem"}'::jsonb)$$,'23505',null,'operation id cannot be reused with another payload');
select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000017',0,'create','{"name":"Second","patron_id":null,"safe_havens":[]}'::jsonb)$$,'40001',null,'one company per campaign');
select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000018',10,'restore','{"amount":9,"reason":"over"}'::jsonb)$$,'23514',null,'restore cannot exceed previously spent Society');
select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000019',10,'reset_session','{"session_id":"75000000-0000-4000-8000-000000000099"}'::jsonb)$$,'22023',null,'unknown session cannot refill');
select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000020',10,'spend','{"amount":"1","reason":"string"}'::jsonb)$$,'22023',null,'raw RPC rejects string amounts');
select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000021',10,'configure','{"name":"No","patron_id":null,"safe_havens":[123]}'::jsonb)$$,'22023',null,'raw RPC rejects nontext safe havens');
select throws_ok($$select public.one_ring_company_command('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000022',10,'spend','{"amount":1,"reason":null}'::jsonb)$$,'22023',null,'raw RPC requires a textual reason');
select is((public.one_ring_company_snapshot('72000000-0000-4000-8000-000000000001')->'company'->>'society_current'),'1','retries and invalid commands preserve current balance');
select is((public.one_ring_company_snapshot('72000000-0000-4000-8000-000000000001')->'company'->>'version'),'10','rejected commands leave version unchanged');

select * from finish();
rollback;
