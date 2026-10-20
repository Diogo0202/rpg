begin;
select no_plan();
insert into auth.users(id,aud,role,email) values
 ('b1000000-0000-4000-8000-000000000001','authenticated','authenticated','versions-master@example.test'),
 ('b1000000-0000-4000-8000-000000000002','authenticated','authenticated','versions-other@example.test');
insert into public.campaigns(id,owner_id,name) values
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Version Campaign'),
 ('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','Version Other');
insert into public.world_entities(id,campaign_id,kind,name,body,created_by) values
 ('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','npc','NPC','{"stats":{"health":5},"description":"Old"}','b1000000-0000-4000-8000-000000000001'),
 ('b3000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','npc','Ally','{}','b1000000-0000-4000-8000-000000000001'),
 ('b3000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000002','npc','Foreign','{}','b1000000-0000-4000-8000-000000000002');
insert into public.campaign_sessions(id,campaign_id,sequence,title,summary) values
 ('b4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',1,'Session','Original');
insert into public.ai_requests(id,campaign_id,author_id,kind,status,target_id,target_version,brief,idempotency_key,request_hash) values
 ('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','npc','pending','b3000000-0000-4000-8000-000000000001',1,'Expand NPC','b6000000-0000-4000-8000-000000000001',repeat('a',64)),
 ('b5000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','session','pending','b4000000-0000-4000-8000-000000000001',1,'Expand Session','b6000000-0000-4000-8000-000000000002',repeat('a',64));
insert into public.ai_proposal_contents(request_id,campaign_id,result) select id,campaign_id,'{}' from public.ai_requests where campaign_id='b2000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.ai_approve_proposal('b2000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001',1,'{"name":"NPC","description":"Draft","secret":"Private","relationships":[],"questions":[]}')$$,'existing NPC approved privately');
select lives_ok(format('select public.ai_publish_preparation(%L,%L,1,%L)','b2000000-0000-4000-8000-000000000001',(select id from public.ai_private_preparations where kind='npc'),'{"description":"New face"}'),'partial NPC publication does not require renaming');
select is((select body->'stats'->>'health' from public.world_entities where id='b3000000-0000-4000-8000-000000000001'),'5','publishing narrative preserves combat statistics');
select is((select body->>'description' from public.world_entities where id='b3000000-0000-4000-8000-000000000001'),'New face','selected narrative field changed');
select lives_ok(format('select public.ai_publish_preparation(%L,%L,2,%L)','b2000000-0000-4000-8000-000000000001',(select id from public.ai_private_preparations where kind='npc'),'{"relationships":[{"target_id":"b3000000-0000-4000-8000-000000000002","relation_type":"ally","notes":"Reviewed"}]}'),'reviewed relationship can be published');
select is((select count(*)::int from public.world_relations),1,'relationship created after explicit publication');
select throws_ok(format('select public.ai_publish_preparation(%L,%L,3,%L)','b2000000-0000-4000-8000-000000000001',(select id from public.ai_private_preparations where kind='npc'),'{"description":"Must rollback","relationships":[{"target_id":"b3000000-0000-4000-8000-000000000003","relation_type":"enemy","notes":"Foreign"}]}'),'22023',null,'cross-campaign relationship rejected');
select is((select body->>'description' from public.world_entities where id='b3000000-0000-4000-8000-000000000001'),'New face','invalid relationship rolls back NPC changes atomically');
update public.world_entities set body=body||'{"updated_elsewhere":true}' where id='b3000000-0000-4000-8000-000000000001';
select throws_ok(format('select public.ai_publish_preparation(%L,%L,3,%L)','b2000000-0000-4000-8000-000000000001',(select id from public.ai_private_preparations where kind='npc'),'{"description":"Overwrite"}'),'PT409',null,'concurrent NPC edit cannot be overwritten');
select lives_ok($$select public.ai_approve_proposal('b2000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002',1,'{"title":"Session prep","summary":"Private draft","scenes":[],"questions":[]}')$$,'session approval remains private');
update public.campaign_sessions set summary='Edited elsewhere' where id='b4000000-0000-4000-8000-000000000001';
select throws_ok(format('select public.ai_publish_preparation(%L,%L,1,%L)','b2000000-0000-4000-8000-000000000001',(select id from public.ai_private_preparations where kind='session'),'{"summary":"Overwrite"}'),'PT409',null,'session conflict preserves newer notes');
select is((select summary from public.campaign_sessions where id='b4000000-0000-4000-8000-000000000001'),'Edited elsewhere','concurrent session edit preserved');
reset role;
insert into public.ai_requests(id,campaign_id,author_id,kind,status,brief,idempotency_key,request_hash,updated_at) values
 ('b5000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','npc','generating','Interrupted request','b6000000-0000-4000-8000-000000000003',repeat('a',64),now()-interval '3 minutes');
set local role service_role;
select is(public.ai_budget_reserve('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000003',318432)->>'reason','ok','reserve before interrupted provider call');
select ok(public.ai_budget_dispatch('b6000000-0000-4000-8000-000000000003'),'interrupted call was dispatched');
update public.ai_budget_operations set lease_until=now()-interval '1 second' where operation_id='b6000000-0000-4000-8000-000000000003';
select is(public.ai_recover_stale('b2000000-0000-4000-8000-000000000001'),1,'stale generating request recovered for review');
select is((select status from public.ai_requests where id='b5000000-0000-4000-8000-000000000003'),'failed','interrupted request no longer stuck generating');
select is((select reserved_micro from public.ai_budget_state),318432::bigint,'recovering stale call does not refund uncertain cost');
select is((select status from public.ai_budget_operations where operation_id='b6000000-0000-4000-8000-000000000003'),'uncertain','expired dispatched operation keeps uncertain financial state');
select is(public.ai_budget_reserve('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000004',318432)->>'reason','ok','recovery releases concurrency for intentional new generation');
update public.ai_budget_operations set lease_until=now()-interval '1 second' where operation_id='b6000000-0000-4000-8000-000000000004';
select ok(not public.ai_budget_dispatch('b6000000-0000-4000-8000-000000000004'),'expired unused lease cannot start a paid call');
select is(public.ai_recover_stale('b2000000-0000-4000-8000-000000000001'),0,'recovery without stale requests is idempotent');
select is((select reserved_micro from public.ai_budget_state),318432::bigint,'only reservation known never dispatched can be returned');
reset role;
select * from finish();
rollback;
