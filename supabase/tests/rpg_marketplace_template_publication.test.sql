begin;
select plan(21);

insert into auth.users(id, aud, role, email) values
  ('a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'manager@market.test'),
  ('a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@market.test'),
  ('a1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other@market.test');
insert into public.campaigns(id, owner_id, name) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Mesa de teste'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'Outra mesa');
insert into public.campaign_members(campaign_id, user_id, role) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'player');
insert into public.system_templates(id, campaign_id, owner_id, name, version, status, schema) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'Modelo aprovado', 1, 'approved',
   '{"name":"Modelo aprovado","version":1,"fields":[{"id":"nome","label":"Nome","kind":"text","required":true,"options":[],"expression":null}]}'::jsonb),
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'Rascunho', 1, 'needs_review',
   '{"name":"Rascunho","version":1,"fields":[{"id":"nome","label":"Nome","kind":"text","required":true,"options":[],"expression":null}]}'::jsonb),
  ('a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'Outro rascunho', 1, 'needs_review',
   '{"name":"Rascunho","version":1,"fields":[{"id":"nome","label":"Nome","kind":"text","required":true,"options":[],"expression":null}]}'::jsonb);
insert into public.marketplace_systems(id, owner_id, name, description, tags, author_name, automation_level, template) values
  ('a4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   'Modelo da comunidade', 'Ficha para campanha', array['fantasia'], 'Autor', 'static',
   '{"name":"Rascunho","version":1,"fields":[{"id":"nome","label":"Nome","kind":"text","required":true,"options":[],"expression":null}]}'::jsonb);
insert into public.marketplace_clone_operations(system_id, campaign_id, user_id, idempotency_key, template_id) values
  ('a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'import-key-0001', 'a3000000-0000-4000-8000-000000000002'),
  ('a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'import-key-0002', 'a3000000-0000-4000-8000-000000000003');

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', false);
set local role authenticated;
select is((select count(*) from public.marketplace_managed_campaigns()), 1::bigint,
  'manager sees their campaign as a copy destination');
select is((select count(*) from public.marketplace_publishable_templates()), 1::bigint,
  'manager sees only approved templates');
select is(public.marketplace_export_template('a3000000-0000-4000-8000-000000000001') ->> 'name',
  'Modelo aprovado', 'manager exports an approved template');
select throws_ok($$select public.marketplace_export_template('a3000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'pending template cannot be published');
select is((select count(*) from public.marketplace_pending_imports('a2000000-0000-4000-8000-000000000001')),
  2::bigint, 'manager sees pending imports');
select throws_ok($$select public.marketplace_approve_import('a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000002', '{}'::jsonb)$$,
  '22023', 'template changed during review', 'different reviewed snapshot cannot be approved');
select is((select status::text from public.system_templates where id = 'a3000000-0000-4000-8000-000000000002'),
  'needs_review', 'snapshot mismatch leaves the import pending');
select is(public.marketplace_approve_import('a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000002',
  (select schema from public.system_templates where id = 'a3000000-0000-4000-8000-000000000002')),
  'a3000000-0000-4000-8000-000000000002'::uuid, 'manager approves the reviewed snapshot');
select is((select status::text from public.system_templates where id = 'a3000000-0000-4000-8000-000000000002'),
  'approved', 'approved import becomes available to sheets');
select is(public.marketplace_approve_import('a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000002',
  (select schema from public.system_templates where id = 'a3000000-0000-4000-8000-000000000002')),
  'a3000000-0000-4000-8000-000000000002'::uuid, 'repeated approval is idempotent');
reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select is((select count(*) from public.marketplace_managed_campaigns()), 0::bigint,
  'player cannot list campaign copy destinations');
select is((select count(*) from public.marketplace_publishable_templates()), 0::bigint,
  'player cannot list publishable templates');
select throws_ok($$select * from public.marketplace_pending_imports('a2000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'player cannot list pending imports');
select throws_ok($$select public.marketplace_export_template('a3000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'player cannot export the approved template');
select throws_ok($$select public.marketplace_approve_import('a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000003', '{}'::jsonb)$$,
  '42501', null, 'player cannot approve an import');
reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select throws_ok($$select public.marketplace_export_template('a3000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'another campaign manager cannot export the template');
select throws_ok($$select * from public.marketplace_pending_imports('a2000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'another campaign manager cannot list pending imports');
select throws_ok($$select public.marketplace_approve_import('a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000003', '{}'::jsonb)$$,
  '42501', null, 'another campaign manager cannot approve the import');
reset role;

update public.marketplace_systems set status = 'hidden' where id = 'a4000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', false);
set local role authenticated;
select is((select source_status from public.marketplace_pending_imports('a2000000-0000-4000-8000-000000000001') limit 1),
  'hidden', 'review shows source moderation status');
select throws_ok($$select public.marketplace_approve_import('a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000003',
  (select schema from public.system_templates where id = 'a3000000-0000-4000-8000-000000000003'))$$,
  '42501', null, 'hidden source cannot be approved');
reset role;

set local role anon;
select throws_ok($$select public.marketplace_publishable_templates()$$,
  '42501', null, 'anonymous sessions cannot list templates');
select * from finish();
rollback;
