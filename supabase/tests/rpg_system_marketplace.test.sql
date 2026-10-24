begin;
select plan(18);

insert into auth.users(id, aud, role, email) values
  ('71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'publisher@example.test'),
  ('71000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@example.test'),
  ('71000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'master@example.test');
insert into public.campaigns(id, owner_id, name) values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000003', 'Marketplace campaign');
insert into public.campaign_members(campaign_id, user_id, role) values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'master');
insert into public.marketplace_systems(id, owner_id, name, description, tags, author_name, automation_level, dependencies, template)
values ('73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Star Frontier', 'A compact space game', array['Sci-Fi','D20'], 'Publisher', 'formulas', array['Dice'],
  '{"name":"Star Frontier","fields":[{"id":"health","label":"Health","kind":"number"}]}'::jsonb);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select is((select count(*) from public.marketplace_search('star', array['Sci-Fi'], 1, 50)), 1::bigint, 'full text name and tag search returns the public system');
select public.marketplace_vote('73000000-0000-4000-8000-000000000001', 1);
select public.marketplace_vote('73000000-0000-4000-8000-000000000001', 1);
select is((select likes from public.marketplace_systems where id = '73000000-0000-4000-8000-000000000001'), 1::bigint, 'repeated vote does not increase like counter');
select public.marketplace_vote('73000000-0000-4000-8000-000000000001', -1);
select is((select likes from public.marketplace_systems where id = '73000000-0000-4000-8000-000000000001'), 0::bigint, 'vote change removes previous like');
select is((select dislikes from public.marketplace_systems where id = '73000000-0000-4000-8000-000000000001'), 1::bigint, 'vote change adds dislike');
select throws_ok($$insert into public.marketplace_votes(system_id,user_id,value) values ('73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',1)$$, '42501', null, 'clients cannot write vote rows directly');
select public.marketplace_report('73000000-0000-4000-8000-000000000001', 'This copies protected game text');
reset role;
select is((select status from public.marketplace_systems where id = '73000000-0000-4000-8000-000000000001'), 'hidden', 'report hides the system in the same transaction');
set local role anon;
select is((select count(*) from public.marketplace_systems where id = '73000000-0000-4000-8000-000000000001'), 0::bigint, 'anonymous list cannot see reported system');
reset role;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select throws_ok($$select public.marketplace_report('73000000-0000-4000-8000-000000000001','Another report after hiding')$$, 'P0001', null, 'hidden systems cannot receive a public report');
select throws_ok($$select count(*) from public.marketplace_reports$$, '42501', null, 'report text is private to service role and moderation RPC');
reset role;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', false);
set local role authenticated;
select throws_ok($$select public.marketplace_clone('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','clone-key-0001')$$, 'P0001', null, 'hidden system cannot be cloned');

reset role;
insert into public.marketplace_admins(user_id) values ('71000000-0000-4000-8000-000000000003');
select set_config('test.report_id', (select id::text from public.marketplace_reports limit 1), false);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select throws_ok($$select * from public.marketplace_list_reports(1,20)$$, '42501', null, 'non-admin cannot read the moderation queue');
reset role;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select is((select count(*) from public.marketplace_list_reports(1,20)), 1::bigint, 'admin queue returns private report details');
select public.marketplace_resolve_report(current_setting('test.report_id')::uuid, 'restore', 'Reviewed by moderator');
select is((select status from public.marketplace_systems where id = '73000000-0000-4000-8000-000000000001'), 'published', 'admin resolution restores a report-approved system');
reset role;
-- The campaign master clones; retries return the same draft and count once.
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', false);
set local role authenticated;
select public.marketplace_clone('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','clone-key-0001');
select public.marketplace_clone('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','clone-key-0001');
select is((select usage_count from public.marketplace_systems where id = '73000000-0000-4000-8000-000000000001'), 1::bigint, 'idempotent clone increments usage once');
select is((select count(*) from public.system_templates where campaign_id = '72000000-0000-4000-8000-000000000001' and status = 'needs_review'), 1::bigint, 'clone creates a campaign draft for GM review');
reset role;
select is((select count(*) from public.marketplace_clone_operations where campaign_id = '72000000-0000-4000-8000-000000000001' and idempotency_key = 'clone-key-0001'), 1::bigint, 'retry reuses the saved clone operation');
set local role authenticated;
select throws_ok($$insert into public.marketplace_systems(owner_id,name,description,tags,author_name,automation_level,template) values ('71000000-0000-4000-8000-000000000001','Direct publish','Bad',array['D20'],'Publisher','static','{"name":"Direct publish"}')$$, '42501', null, 'authenticated users cannot bypass validated publication');

reset role;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select throws_ok($$select public.marketplace_resolve_report(current_setting('test.report_id')::uuid, 'restore', 'reviewed')$$, '42501', null, 'non-admin cannot resolve a report');
select * from finish();
rollback;
