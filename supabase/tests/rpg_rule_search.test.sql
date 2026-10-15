begin;
select plan(5);

select ok(not has_table_privilege('authenticated', 'public.document_chunks', 'select'), 'authenticated clients cannot select source chunks directly');
select ok(has_function_privilege('authenticated', 'public.search_campaign_rules(uuid,text,integer)', 'execute'), 'authenticated users can invoke scoped rule search');
select ok(not has_function_privilege('anon', 'public.search_campaign_rules(uuid,text,integer)', 'execute'), 'anonymous users cannot invoke rule search');
select ok(has_function_privilege('authenticated', 'public.get_campaign_rule_page(uuid,uuid,integer)', 'execute'), 'authenticated users can request a scoped source page');
select ok(not has_function_privilege('anon', 'public.get_campaign_rule_page(uuid,uuid,integer)', 'execute'), 'anonymous users cannot request source pages');

select * from finish();
rollback;
