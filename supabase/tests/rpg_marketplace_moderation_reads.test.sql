begin;
select plan(20);

insert into auth.users(id, aud, role, email) values
  ('d1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'author@reads.test'),
  ('d1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'reporter@reads.test'),
  ('d1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'moderator@reads.test');
insert into public.marketplace_admins(user_id) values ('d1000000-0000-4000-8000-000000000003');
insert into public.marketplace_systems(id, owner_id, name, description, tags, author_name, automation_level, template) values
  ('d1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Moonlit Harbor', 'Original harbor game', array['Mar'], 'Author', 'static', '{"name":"Moonlit Harbor"}'::jsonb),
  ('d1200000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'Ash Garden', 'Original garden game', array['Jardim'], 'Author', 'static', '{"name":"Ash Garden"}'::jsonb);

-- A reporter flags one system.
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select public.marketplace_report('d1200000-0000-4000-8000-000000000001', 'Copied third-party rules text');
select is(public.marketplace_is_moderator(), false, 'regular user is not a moderator');
select throws_ok($$select * from public.marketplace_moderation_queue(1, 20)$$, '42501', null, 'non-moderator cannot read the queue');
select throws_ok($$select * from public.marketplace_moderation_history(1, 20)$$, '42501', null, 'non-moderator cannot read the history');
select throws_ok($$select * from public.marketplace_moderation_systems(null, null, 1, 20)$$, '42501', null, 'non-moderator cannot list systems in every state');
select throws_ok($$select count(*) from public.marketplace_moderation_log$$, '42501', null, 'log table stays private');
reset role;

set local role anon;
select is(public.marketplace_is_moderator(), false, 'anonymous session is not a moderator');
select throws_ok($$select * from public.marketplace_moderation_queue(1, 20)$$, '42501', null, 'anonymous cannot read the queue');
reset role;

-- Moderator reads.
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select is(public.marketplace_is_moderator(), true, 'admin is recognized from marketplace_admins');
select is((select count(*) from public.marketplace_moderation_queue(1, 50) where system_id = 'd1200000-0000-4000-8000-000000000001'), 1::bigint, 'queue shows the open report');
select is((select system_status from public.marketplace_moderation_queue(1, 50) where system_id = 'd1200000-0000-4000-8000-000000000001'), 'hidden', 'queue shows the reported system status');
select is((select open_reports from public.marketplace_moderation_queue(1, 50) where system_id = 'd1200000-0000-4000-8000-000000000001'), 1::bigint, 'queue counts open reports per system');
select is((select bool_or(arg in ('reporter_id', 'owner_id', 'moderator_id')) from pg_proc, unnest(proargnames) arg
            where proname in ('marketplace_moderation_queue', 'marketplace_moderation_history', 'marketplace_moderation_systems')),
          false, 'moderation reads expose no user ids');
select is((select count(*) from public.marketplace_moderation_systems('hidden', null, 1, 50) where id = 'd1200000-0000-4000-8000-000000000001'), 1::bigint, 'moderator finds hidden systems');
select is((select count(*) from public.marketplace_moderation_systems(null, 'ash', 1, 50)), 1::bigint, 'moderator searches systems by name');
select throws_ok($$select * from public.marketplace_moderation_systems('deleted', null, 1, 20)$$, '22023', null, 'invalid status filter is rejected');

-- Actions feed the history, including report resolutions.
select public.marketplace_moderate_system('d1200000-0000-4000-8000-000000000002', 'hide', 'Manual review');
select public.marketplace_resolve_report((select id from public.marketplace_moderation_queue(1, 50) where system_id = 'd1200000-0000-4000-8000-000000000001'), 'restore', 'Not a copy');
select is((select count(*) from public.marketplace_moderation_history(1, 50) where system_id::text like 'd12%'), 2::bigint, 'history lists direct and report actions');
select is((select from_report from public.marketplace_moderation_history(1, 50) where system_id = 'd1200000-0000-4000-8000-000000000001'), true, 'report resolution is marked in history');
select is((select current_status from public.marketplace_moderation_history(1, 50) where system_id = 'd1200000-0000-4000-8000-000000000001'), 'published', 'restore through report republishes the system');
select is((select bool_and(by_me) from public.marketplace_moderation_history(1, 50) where system_id::text like 'd12%'), true, 'history marks own actions without exposing ids');
select is((select count(*) from public.marketplace_moderation_queue(1, 50) where system_id::text like 'd12%'), 0::bigint, 'resolved report leaves the queue');
reset role;

select * from finish();
rollback;
