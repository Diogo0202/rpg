begin;
select plan(16);

insert into auth.users (id, aud, role, email) values
  ('c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'grant-source-owner@example.test'),
  ('c1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'grant-other-manager@example.test'),
  ('c1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'grant-player@example.test');

insert into public.campaigns (id, owner_id, name) values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Source owner campaign'),
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Other campaign');

insert into public.campaign_members (campaign_id, user_id, role) values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'master'),
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003', 'player');

insert into public.library_sources (id, owner_id, kind, title, mime_type, drive_file_id, sha256)
values ('c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
        'google_drive', 'Test reference', 'application/pdf', 'fixture-drive-id', repeat('a', 64));

select ok(not has_table_privilege('authenticated', 'public.library_grants', 'update'), 'browser cannot edit existing grants');
select ok(not has_table_privilege('authenticated', 'public.audit_events', 'insert'), 'browser cannot forge audit events');
select ok(not has_table_privilege('authenticated', 'public.audit_events', 'update'), 'browser cannot edit audit events');
select ok(not has_table_privilege('authenticated', 'public.audit_events', 'delete'), 'browser cannot erase audit events');
select ok(has_table_privilege('service_role', 'public.audit_events', 'insert'), 'trusted server can append audit events');
select ok(not has_table_privilege('service_role', 'public.audit_events', 'update'), 'trusted server cannot edit the audit trail');
select is((select file_size_limit::bigint from storage.buckets where id = 'library'), 20971520::bigint, 'library upload limit is 20 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'library'), array['application/pdf']::text[], 'library accepts declared PDF MIME only');
select ok(not (select public from storage.buckets where id = 'library'), 'library bucket remains private');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$insert into public.library_grants (source_id, campaign_id, granted_by) values
    ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'source owner cannot grant to a campaign they do not manage'
);
select throws_ok(
  $$insert into public.library_grants (source_id, campaign_id, granted_by) values
    ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'source owner cannot forge the grantor'
);
select lives_ok(
  $$insert into public.library_grants (source_id, campaign_id, granted_by) values
    ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001')$$,
  'source owner may grant to their own campaign'
);

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.library_grants (source_id, campaign_id, granted_by) values
    ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'campaign manager cannot grant a foreign source'
);
select lives_ok(
  $$delete from public.library_grants where source_id = 'c3000000-0000-4000-8000-000000000001'
    and campaign_id = 'c2000000-0000-4000-8000-000000000001'$$,
  'campaign manager can revoke a source grant'
);
select is((select count(*)::integer from public.library_grants), 0, 'revoked grant is removed');

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$insert into public.audit_events (campaign_id, actor_id, event_type, subject_type) values
    ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003', 'admin_action', 'campaign')$$,
  '42501', null, 'campaign member cannot forge an audit event'
);

reset role;
select * from finish();
rollback;
