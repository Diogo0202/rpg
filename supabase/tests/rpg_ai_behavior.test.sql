begin;
select no_plan();

insert into auth.users(id,aud,role,email) values
 ('a1000000-0000-4000-8000-000000000001','authenticated','authenticated','ai-master@example.test'),
 ('a1000000-0000-4000-8000-000000000002','authenticated','authenticated','ai-player@example.test'),
 ('a1000000-0000-4000-8000-000000000003','authenticated','authenticated','ai-player2@example.test'),
 ('a1000000-0000-4000-8000-000000000004','authenticated','authenticated','ai-outside@example.test');
insert into public.campaigns(id,owner_id,name) values
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','AI Campaign'),
 ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000004','Other AI Campaign'),
 ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000004','Third AI Campaign');
insert into public.campaign_members(campaign_id,user_id,role) values
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','player'),
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','player');
insert into public.system_templates(id,campaign_id,owner_id,name,status,schema) values
 ('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','AI Template','approved','{"fields":[{"id":"nome","kind":"text","required":true},{"id":"score","kind":"number","required":true}]}');
insert into public.ai_requests(id,campaign_id,author_id,kind,status,template_id,brief,idempotency_key,request_hash) values
 ('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','sheet','pending','a3000000-0000-4000-8000-000000000001','Player private concept','a9000000-0000-4000-8000-000000000001',repeat('a',64)),
 ('a4000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','sheet','pending','a3000000-0000-4000-8000-000000000001','Other private concept','a9000000-0000-4000-8000-000000000002',repeat('a',64)),
 ('a4000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','npc','pending',null,'Secret NPC','a9000000-0000-4000-8000-000000000003',repeat('a',64)),
 ('a4000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','session','pending',null,'Secret preparation','a9000000-0000-4000-8000-000000000004',repeat('a',64));
insert into public.ai_proposal_contents(request_id,campaign_id,result,context) select id,campaign_id,'{}','{"secret":"GM context"}' from public.ai_requests where campaign_id='a2000000-0000-4000-8000-000000000001';
update public.ai_proposal_contents c set template_snapshot=jsonb_build_object('id',t.id,'name',t.name,'version',t.version,'schema',t.schema)
 from public.ai_requests r join public.system_templates t on t.id=r.template_id where c.request_id=r.id;

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from public.ai_requests),1,'player sees own request only');
select is((select count(*)::int from public.ai_proposal_contents),0,'player cannot read own model output or GM context');
select is((select count(*)::int from public.ai_private_preparations),0,'player cannot read preparations');
select throws_ok($$select public.ai_approve_proposal('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',1,'{"name":"Mara","values":{"nome":"Mara","score":2}}')$$,'42501',null,'player cannot approve own request');
select throws_ok($$select public.ai_budget_reserve('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000001',10)$$,'42501',null,'player cannot reserve or change cost');

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000004',true);
select is((select count(*)::int from public.ai_requests),0,'another campaign owner sees no requests');
select throws_ok($$select public.ai_approve_proposal('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',1,'{}')$$,'42501',null,'other campaign manager cannot approve');

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from public.ai_requests),4,'campaign manager sees requests');
select is((select count(*)::int from public.ai_proposal_contents),4,'manager sees private draft context');
update public.system_templates set version=2 where id='a3000000-0000-4000-8000-000000000001';
select throws_ok($$select public.ai_approve_proposal('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',1,'{"name":"Mara","values":{"nome":"Mara","score":2}}')$$,'PT409',null,'database compares approved template snapshot inside approval transaction');
update public.system_templates set version=1 where id='a3000000-0000-4000-8000-000000000001';
select throws_ok($$select public.ai_approve_proposal('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',2,'{"name":"Mara","values":{"nome":"Mara","score":2}}')$$,'PT409',null,'stale approval conflicts');
select throws_ok($$select public.ai_approve_proposal('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',1,'{"name":"Mara","values":{"nome":"Mara"}}')$$,'P0001',null,'database rejects missing required sheet values');
select is((select count(*)::int from public.character_sheets),0,'failed approval writes no sheet');
select lives_ok($$select public.ai_approve_proposal('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',1,'{"name":"Mara","values":{"nome":"Mara","score":2}}')$$,'master applies sheet');
select lives_ok($$select public.ai_approve_proposal('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',1,'{"name":"Changed","values":{"nome":"Changed","score":4}}')$$,'approval replay returns existing destination');
select is((select count(*)::int from public.character_sheets),1,'repeated approval creates no duplicate');
select is((select name from public.character_sheets limit 1),'Mara','replay does not overwrite approved sheet');
select is((select owner_id::text from public.character_sheets limit 1),'a1000000-0000-4000-8000-000000000002','approved sheet belongs to requester');
select lives_ok($$select public.ai_approve_proposal('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003',1,'{"name":"Private NPC","description":"Public face","motivation":"Goal","voice":"Soft","secret":"Hidden betrayal","hook":"Meet me","relationships":[],"questions":[]}')$$,'NPC approval saves private content');
select lives_ok($$select public.ai_approve_proposal('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000004',1,'{"title":"Private session","summary":"Hidden reveal","scenes":[],"questions":[]}')$$,'session approval saves private preparation');
select is((select count(*)::int from public.world_entities),0,'NPC not published by approval');
select is((select count(*)::int from public.campaign_sessions),0,'session not published by approval');
select is((select count(*)::int from public.ai_private_preparations),2,'approved narrative preparations remain private');
select throws_ok(format('select public.ai_publish_preparation(%L,%L,1,%L)','a2000000-0000-4000-8000-000000000001',(select id from public.ai_private_preparations where kind='npc'),' {"name":"NPC","secret":"Hidden betrayal"}'),'22023',null,'publication rejects secrets');
select lives_ok(format('select public.ai_publish_preparation(%L,%L,1,%L)','a2000000-0000-4000-8000-000000000001',(select id from public.ai_private_preparations where kind='npc'),' {"name":"Public NPC","description":"Public face"}'),'explicit public NPC fields can be published');
select is((select body::text from public.world_entities where name='Public NPC'),'{"description": "Public face"}','publication includes selected fields only');
select throws_ok(format('select public.ai_publish_preparation(%L,%L,1,%L)','a2000000-0000-4000-8000-000000000001',(select id from public.ai_private_preparations where kind='npc'),' {"name":"Duplicate"}'),'PT409',null,'repeated publication version cannot duplicate');
select lives_ok(format('select public.ai_publish_preparation(%L,%L,1,%L)','a2000000-0000-4000-8000-000000000001',(select id from public.ai_private_preparations where kind='session'),' {"title":"Public session"}'),'only selected session title published');
select is((select summary from public.campaign_sessions limit 1),'','private summary remains unpublished');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from public.ai_private_preparations),0,'private preparations remain hidden after publication');
select is((select count(*)::int from public.character_sheets),1,'player can read approved own sheet');
select is((select count(*)::int from public.world_entities),1,'players can read published NPC');

reset role;
set local role service_role;
select is(public.ai_budget_reserve('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010',318432)->>'reason','ok','first budget reservation admitted');
select is(public.ai_budget_reserve('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','a9000000-0000-4000-8000-000000000011',318432)->>'reason','busy','same campaign cannot run two calls');
select is(public.ai_budget_reserve('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000004','a9000000-0000-4000-8000-000000000012',318432)->>'reason','ok','second campaign may generate concurrently');
select is(public.ai_budget_reserve('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000013',318432)->>'reason','busy','third simultaneous global call denied');
select ok(public.ai_budget_dispatch('a9000000-0000-4000-8000-000000000010'),'dispatch marks possible bill');
select ok(not public.ai_budget_cancel('a9000000-0000-4000-8000-000000000010'),'dispatched request cannot refund as unused');
select ok(public.ai_budget_uncertain('a9000000-0000-4000-8000-000000000010'),'timeout marks uncertain cost');
select is((select reserved_micro from public.ai_budget_state),636864::bigint,'uncertain reserve remains counted');
select ok(public.ai_budget_settle('a9000000-0000-4000-8000-000000000010',150,100,20),'known usage settles reservation');
select is((select spent_micro from public.ai_budget_state),150::bigint,'actual usage counted');
select is((select reserved_micro from public.ai_budget_state),318432::bigint,'only unused reservation released');
select ok(not public.ai_budget_settle('a9000000-0000-4000-8000-000000000010',150,100,20),'settlement idempotent without double spending');
select ok(public.ai_budget_cancel('a9000000-0000-4000-8000-000000000012'),'non-dispatched reservation can cancel');
select is(public.ai_budget_reserve('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000014',318432)->>'reason','ok','second generation for user admitted');
select ok(public.ai_budget_cancel('a9000000-0000-4000-8000-000000000014'),'second unsubmitted reservation cancelled');
select is(public.ai_budget_reserve('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000015',318432)->>'reason','rate','third user operation inside minute denied');
update public.ai_budget_state set spent_micro=29900000;
select is(public.ai_budget_reserve('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000004','a9000000-0000-4000-8000-000000000016',318432)->>'reason','budget','shared monthly budget fails closed');
reset role;
select * from finish();
rollback;
