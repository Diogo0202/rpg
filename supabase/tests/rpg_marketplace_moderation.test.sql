begin;
select plan(30);

insert into auth.users(id, aud, role, email) values
  ('cf000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'author@market.test'),
  ('cf000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'other@market.test'),
  ('cf000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'moderator@market.test'),
  ('cf000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'player@market.test');
insert into public.campaigns(id, owner_id, name) values
  ('cf100000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000002', 'Clone target');
insert into public.campaign_members(campaign_id, user_id, role) values
  ('cf100000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000004', 'player');
insert into public.marketplace_admins(user_id) values ('cf000000-0000-4000-8000-000000000003');

-- Publication goes through the service role (the API derives owner_id from the verified session).
set local role service_role;
insert into public.marketplace_systems(id, owner_id, name, description, tags, author_name, automation_level, template, updated_at) values
  ('cf200000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'Lantern Roads', 'Original travel game', array['Viagem'], 'Author', 'static',
   '{"name":"Lantern Roads","fields":[{"id":"luz","label":"Luz","kind":"number"}]}'::jsonb, '2026-10-01T00:00:00Z'),
  ('cf200000-0000-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000001', 'Ember Court', 'Original court intrigue', array['Viagem'], 'Author', 'static',
   '{"name":"Ember Court","fields":[{"id":"favor","label":"Favor","kind":"number"}]}'::jsonb, '2026-10-02T00:00:00Z');
reset role;
select is((select status from public.marketplace_systems where id = 'cf200000-0000-4000-8000-000000000001'), 'published', 'service role publishes a system');
select is((select search_document <> ''::tsvector from public.marketplace_systems where id = 'cf200000-0000-4000-8000-000000000001'), true, 'publication builds the search document');

-- Nobody can publish (or rewrite authorship) as another user from a client session.
select set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select throws_ok($$insert into public.marketplace_systems(owner_id,name,description,tags,author_name,automation_level,template) values ('cf000000-0000-4000-8000-000000000001','Forged','Forged',array['X'],'Author','static','{"name":"Forged"}')$$,
  '42501', null, 'authenticated user cannot insert a system owned by someone else');
select throws_ok($$insert into public.marketplace_systems(owner_id,name,description,tags,author_name,automation_level,template) values ('cf000000-0000-4000-8000-000000000002','Own direct','Bad',array['X'],'Me','static','{"name":"Own direct"}')$$,
  '42501', null, 'authenticated user cannot bypass validated publication even as self');
select throws_ok($$update public.marketplace_systems set author_name = 'Hijacked' where id = 'cf200000-0000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated user cannot rewrite a published system');
select throws_ok($$select owner_id from public.marketplace_systems$$, '42501', null, 'owner ids are not exposed to clients');
reset role;
set local role anon;
select throws_ok($$insert into public.marketplace_systems(owner_id,name,description,tags,author_name,automation_level,template) values ('cf000000-0000-4000-8000-000000000001','Anon','Anon',array['X'],'Author','static','{"name":"Anon"}')$$,
  '42501', null, 'anonymous user cannot publish');
select throws_ok($$select public.marketplace_vote('cf200000-0000-4000-8000-000000000001', 1)$$, '42501', null, 'anonymous user cannot vote');
select is((select count(*) from public.marketplace_search(null, '{}', 1, 50) where id::text like 'cf2%'), 2::bigint, 'anonymous search lists published systems');
reset role;

-- Votes keep the content ordering stable.
select set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select public.marketplace_vote('cf200000-0000-4000-8000-000000000001', 1);
select is((select updated_at from public.marketplace_systems where id = 'cf200000-0000-4000-8000-000000000001'), '2026-10-01T00:00:00Z'::timestamptz, 'votes do not bump updated_at');
reset role;
select set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000001', false);
set local role authenticated;
select throws_ok($$select public.marketplace_vote('cf200000-0000-4000-8000-000000000001', 1)$$, '42501', null, 'authors cannot vote for their own system');
reset role;

-- Copy to campaign: only the campaign manager can clone.
select set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000004', false);
set local role authenticated;
select throws_ok($$select public.marketplace_clone('cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','player-key-01')$$, '42501', null, 'players cannot copy systems into the campaign');
reset role;
select set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select is((select public.marketplace_clone('cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','gm-clone-key-01')->>'status'), 'needs_review', 'campaign manager copies the system as a draft for review');
select is((select (public.marketplace_clone('cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','gm-clone-key-01')->>'owner_id')::uuid), 'cf000000-0000-4000-8000-000000000002'::uuid, 'copy belongs to the cloning manager, not the author');
select throws_ok($$select public.marketplace_clone('cf200000-0000-4000-8000-000000000002','cf100000-0000-4000-8000-000000000001','gm-clone-key-01')$$, '22023', null, 'idempotency key cannot be reused for another system');

-- Report hides the system immediately.
select public.marketplace_report('cf200000-0000-4000-8000-000000000001', 'Contains copied third-party text');
reset role;
select is((select status from public.marketplace_systems where id = 'cf200000-0000-4000-8000-000000000001'), 'hidden', 'report hides the system');

-- Hidden systems are invisible, including to their author.
select set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000001', false);
set local role authenticated;
select is((select count(*) from public.marketplace_systems where id = 'cf200000-0000-4000-8000-000000000001'), 0::bigint, 'author cannot see own hidden system through the table');
select is((select count(*) from public.marketplace_search('lantern', '{}', 1, 50)), 0::bigint, 'hidden system is absent from search');
reset role;
select set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select is((select public.marketplace_clone('cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','gm-clone-key-01')->>'status'), 'needs_review', 'idempotent retry still returns the copy made before hiding');
select throws_ok($$select public.marketplace_clone('cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','gm-clone-key-02')$$, 'P0001', null, 'new copies of a hidden system are refused');
select throws_ok($$select public.marketplace_moderate_system('cf200000-0000-4000-8000-000000000002', 'hide', null)$$, '42501', null, 'non-moderator cannot hide a system');
reset role;
select public.marketplace_apply_usage_events(1000);
select is((select usage_count from public.marketplace_systems where id = 'cf200000-0000-4000-8000-000000000001'), 1::bigint, 'usage counted once across retries');

-- Moderator actions.
select set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select throws_ok($$select public.marketplace_moderate_system('cf200000-0000-4000-8000-000000000001', 'restore', null)$$, 'P0001', null, 'restore is blocked while a report is open');
select public.marketplace_resolve_report((select id from public.marketplace_list_reports(1, 50) where system_id = 'cf200000-0000-4000-8000-000000000001'), 'remove', 'Confirmed by rights holder');
reset role;
select is((select status from public.marketplace_systems where id = 'cf200000-0000-4000-8000-000000000001'), 'removed', 'moderator removes a reported system');
select set_config('test.cf_report', (select id::text from public.marketplace_reports where system_id = 'cf200000-0000-4000-8000-000000000001' limit 1), false);
set local role authenticated;
select throws_ok($$select public.marketplace_resolve_report(current_setting('test.cf_report')::uuid, 'restore', 'second opinion')$$, 'P0001', null, 'resolved report cannot be resolved again');
select is((select public.marketplace_moderate_system('cf200000-0000-4000-8000-000000000002', 'hide', 'Manual review')), 'hidden', 'moderator hides a system without a report');
reset role;
set local role anon;
select is((select count(*) from public.marketplace_systems where id = 'cf200000-0000-4000-8000-000000000002'), 0::bigint, 'anonymous cannot see a moderator-hidden system');
reset role;
select set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select is((select public.marketplace_moderate_system('cf200000-0000-4000-8000-000000000002', 'restore', null)), 'published', 'moderator restores a hidden system');
reset role;
select is((select count(*) from public.marketplace_moderation_log where system_id = 'cf200000-0000-4000-8000-000000000002'), 2::bigint, 'moderation actions are logged');
set local role authenticated;
select throws_ok($$select count(*) from public.marketplace_moderation_log$$, '42501', null, 'moderation log is private to service role');
reset role;

select * from finish();
rollback;
