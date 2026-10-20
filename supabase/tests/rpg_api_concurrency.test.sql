begin;
select plan(19);

select ok(has_function_privilege('service_role', 'public.api_concurrency_acquire(uuid)', 'execute'), 'service_role can acquire a shared API lease');
select ok(not has_function_privilege('anon', 'public.api_concurrency_acquire(uuid)', 'execute'), 'anon cannot acquire a shared API lease');
select ok(not has_function_privilege('authenticated', 'public.api_concurrency_acquire(uuid)', 'execute'), 'authenticated cannot acquire a shared API lease');
select ok(has_function_privilege('service_role', 'public.api_concurrency_release(uuid)', 'execute'), 'service_role can release a shared API lease');
select ok(not has_function_privilege('anon', 'public.api_concurrency_release(uuid)', 'execute'), 'anon cannot release a shared API lease');
select ok(not has_function_privilege('authenticated', 'public.api_concurrency_release(uuid)', 'execute'), 'authenticated cannot release a shared API lease');

select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'private' and c.relname = 'api_concurrency_leases'), 'lease table has row level security enabled');
select ok(not has_table_privilege('anon', 'private.api_concurrency_leases', 'select,insert,update,delete'), 'anon has no direct lease table access');
select ok(not has_table_privilege('authenticated', 'private.api_concurrency_leases', 'select,insert,update,delete'), 'authenticated has no direct lease table access');
select ok(not has_table_privilege('service_role', 'private.api_concurrency_leases', 'select,insert,update,delete'), 'service role uses RPCs instead of direct lease table access');
select is((select count(*)::integer from pg_policies
            where schemaname = 'private' and tablename = 'api_concurrency_leases'), 0,
          'no client row policies expose lease records');
select is((select count(*)::integer from private.api_concurrency_leases), 10, 'migration seeds ten fixed lease slots');

-- Keep the test deterministic while its outer transaction guarantees rollback.
update private.api_concurrency_leases set lease_token = null, expires_at = null;
create temporary table api_concurrency_test_results (
  slot_number integer primary key,
  lease_token uuid not null,
  admitted boolean
) on commit drop;

insert into api_concurrency_test_results (slot_number, lease_token, admitted)
select slot_number,
       ('80000000-0000-0000-0000-' || lpad(slot_number::text, 12, '0'))::uuid,
       public.api_concurrency_acquire(
         ('80000000-0000-0000-0000-' || lpad(slot_number::text, 12, '0'))::uuid
       )
  from generate_series(1, 11) as slots(slot_number);

select is((select count(*)::integer from api_concurrency_test_results where admitted), 10, 'exactly ten simultaneous leases are admitted');
select is((select count(*)::integer from api_concurrency_test_results where admitted is false), 1, 'the eleventh lease is rejected');
select is(public.api_concurrency_release('80000000-0000-0000-0000-999999999999'::uuid), false, 'unknown lease release returns false');
select is(public.api_concurrency_release('80000000-0000-0000-0000-000000000001'::uuid), true, 'owned lease release returns true');
select is(public.api_concurrency_acquire('80000000-0000-0000-0000-000000000011'::uuid), true, 'released slot admits one replacement lease');

update private.api_concurrency_leases
   set expires_at = clock_timestamp() - interval '1 second'
 where lease_token = '80000000-0000-0000-0000-000000000002'::uuid;
select is(public.api_concurrency_acquire('80000000-0000-0000-0000-000000000012'::uuid), true, 'expired lease is replaced by a new admission');
select is((select count(*)::integer from private.api_concurrency_leases
            where lease_token = '80000000-0000-0000-0000-000000000002'::uuid), 0,
          'acquisition replaces the expired lease token');

select * from finish();
rollback;
