begin;
select plan(25);

select ok(to_regclass('public.access_audit_logs') is not null, 'access audit table exists');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.access_audit_logs'::regclass), 'access audit table has RLS enabled');

select ok(not has_table_privilege('anon', 'public.access_audit_logs', 'select'), 'anon cannot select access logs');
select ok(not has_table_privilege('anon', 'public.access_audit_logs', 'insert'), 'anon cannot insert access logs');
select ok(not has_table_privilege('anon', 'public.access_audit_logs', 'update'), 'anon cannot update access logs');
select ok(not has_table_privilege('anon', 'public.access_audit_logs', 'delete'), 'anon cannot delete access logs');
select ok(not has_table_privilege('authenticated', 'public.access_audit_logs', 'select'), 'authenticated cannot select access logs');
select ok(not has_table_privilege('authenticated', 'public.access_audit_logs', 'insert'), 'authenticated cannot insert access logs');
select ok(not has_table_privilege('authenticated', 'public.access_audit_logs', 'update'), 'authenticated cannot update access logs');
select ok(not has_table_privilege('authenticated', 'public.access_audit_logs', 'delete'), 'authenticated cannot delete access logs');

select ok(has_table_privilege('service_role', 'public.access_audit_logs', 'select'), 'service role can select access logs');
select ok(has_table_privilege('service_role', 'public.access_audit_logs', 'insert'), 'service role can insert access logs');
select ok(not has_table_privilege('service_role', 'public.access_audit_logs', 'update'), 'service role cannot update access logs');
select ok(not has_table_privilege('service_role', 'public.access_audit_logs', 'delete'), 'service role cannot delete access logs');
select ok(not has_table_privilege('service_role', 'public.access_audit_logs', 'truncate'), 'service role cannot truncate access logs');

select ok(to_regprocedure('private.audit_campaign_table_write()') is not null, 'database audit trigger function exists');
select ok(not has_function_privilege('anon', 'private.audit_campaign_table_write()', 'execute'), 'anon cannot call the database audit trigger function');
select ok(not has_function_privilege('authenticated', 'private.audit_campaign_table_write()', 'execute'), 'authenticated cannot call the database audit trigger function');

select ok(
  to_regclass('public.campaigns') is null or exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = to_regclass('public.campaigns') and tgname = 'access_audit_write' and not tgisinternal
  ), 'campaign writes are audited when the table exists'
);
select ok(
  to_regclass('public.campaign_members') is null or exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = to_regclass('public.campaign_members') and tgname = 'access_audit_write' and not tgisinternal
  ), 'campaign membership writes are audited when the table exists'
);
select ok(
  to_regclass('public.character_sheets') is null or exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = to_regclass('public.character_sheets') and tgname = 'access_audit_write' and not tgisinternal
  ), 'character sheet writes are audited when the table exists'
);
select ok(
  to_regclass('public.maps') is null or exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = to_regclass('public.maps') and tgname = 'access_audit_write' and not tgisinternal
  ), 'map writes are audited when the table exists'
);
select ok(
  to_regclass('public.campaign_sessions') is null or exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = to_regclass('public.campaign_sessions') and tgname = 'access_audit_write' and not tgisinternal
  ), 'journal session writes are audited when the table exists'
);
select ok(
  to_regclass('public.campaign_events') is null or exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = to_regclass('public.campaign_events') and tgname = 'access_audit_write' and not tgisinternal
  ), 'journal event writes are audited when the table exists'
);
select ok(
  to_regclass('public.chronicle_activity') is null or exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = to_regclass('public.chronicle_activity') and tgname = 'access_audit_write' and not tgisinternal
  ), 'chronicle activity writes are audited when the table exists'
);

select * from finish();
rollback;
