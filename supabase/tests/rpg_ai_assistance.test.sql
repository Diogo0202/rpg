begin;
select plan(19);

select ok((select relrowsecurity from pg_class where oid='public.ai_requests'::regclass),'request metadata has RLS');
select ok((select relrowsecurity from pg_class where oid='public.ai_proposal_contents'::regclass),'proposal contents have RLS');
select ok((select relrowsecurity from pg_class where oid='public.ai_private_preparations'::regclass),'private preparations have RLS');
select ok(not has_table_privilege('anon','public.ai_requests','select,insert,update,delete'),'anon has no request table access');
select ok(not has_table_privilege('authenticated','public.ai_requests','insert,update,delete'),'authenticated cannot write request metadata directly');
select ok(not has_table_privilege('authenticated','public.ai_proposal_contents','insert,update,delete'),'authenticated cannot write private proposal data directly');
select ok(not has_table_privilege('authenticated','public.ai_private_preparations','insert,update,delete'),'authenticated cannot write private preparations directly');
select ok(has_table_privilege('service_role','public.ai_proposal_contents','select,insert,update,delete'),'backend can persist private proposal data');
select ok(has_function_privilege('authenticated','public.ai_approve_proposal(uuid,uuid,integer,jsonb)','execute'),'authenticated manager approval RPC is callable');
select ok(not has_function_privilege('anon','public.ai_approve_proposal(uuid,uuid,integer,jsonb)','execute'),'anon cannot approve proposals');
select ok(has_function_privilege('authenticated','public.ai_reject_proposal(uuid,uuid,integer)','execute'),'authenticated manager rejection RPC is callable');
select ok(has_function_privilege('authenticated','public.ai_publish_preparation(uuid,uuid,integer,jsonb)','execute'),'authenticated preparation publication RPC is callable');
select ok(not has_function_privilege('authenticated','public.ai_budget_reserve(uuid,uuid,uuid,bigint)','execute'),'browser cannot reserve provider budget');
select ok(has_function_privilege('service_role','public.ai_budget_reserve(uuid,uuid,uuid,bigint)','execute'),'backend can reserve provider budget');
select ok(not has_table_privilege('authenticated','public.ai_budget_operations','select,insert,update,delete'),'clients cannot inspect or change spend ledger');
select ok(has_table_privilege('service_role','public.ai_budget_operations','select,insert,update,delete'),'backend owns spend ledger writes');
select ok((select pg_get_constraintdef(oid) like '%30000000%' from pg_constraint where conrelid='public.ai_budget_operations'::regclass limit 1) is not null,'budget ledger has constraints');
select ok((select count(*)=1 from public.ai_budget_state where singleton),'one shared account budget state serializes reservations');
select ok(exists(select 1 from pg_proc where oid='public.ai_budget_uncertain(uuid)'::regprocedure),'uncertain provider outcomes retain an explicit ledger state');

select * from finish();
rollback;

