begin;
select plan(11);

select ok(has_table_privilege('authenticated', 'public.campaigns', 'select,insert,update,delete'), 'authenticated has explicit campaign grants');
select ok(not has_table_privilege('anon', 'public.campaigns', 'select,insert,update,delete'), 'anon has no campaign grants');
select ok((select relrowsecurity from pg_class where oid='public.campaigns'::regclass), 'campaigns has RLS');
select ok((select relrowsecurity from pg_class where oid='public.library_sources'::regclass), 'library sources has RLS');
select ok((select relrowsecurity from pg_class where oid='public.character_sheets'::regclass), 'character sheets has RLS');
select ok((select relrowsecurity from pg_class where oid='public.world_entities'::regclass), 'world entities has RLS');
select ok((select relrowsecurity from pg_class where oid='public.maps'::regclass), 'maps has RLS');
select ok(not has_table_privilege('authenticated', 'public.document_chunks', 'select'), 'raw extracted chunks are not browser-readable');
select has_trigger('public', 'character_sheets', 'character_sheets_validate_and_version', 'sheet writes validate modular fields and advance version');
select has_index('public', 'character_sheets', 'character_sheets_owner_campaign_updated_idx', 'sheets can be listed by owner and campaign');
select has_trigger('public', 'system_templates', 'system_templates_protect_referenced_approved', 'referenced approved templates are immutable');

select * from finish();
rollback;
