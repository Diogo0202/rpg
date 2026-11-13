begin;
select plan(6);

select ok(exists(select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'),
  'Supabase Realtime publication exists');
select ok(not exists(select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and puballtables),
  'Realtime does not publish every table');
select is((select count(*)::integer from pg_catalog.pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public'
    and tablename = any(array['campaign_sessions','campaign_factions','campaign_events','campaign_event_entity_links','world_entities'])),
  5, 'journal and world changes are published');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.campaign_sessions'::regclass),
  'campaign sessions keep row security');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.campaign_factions'::regclass),
  'campaign factions keep row security');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.campaign_events'::regclass),
  'campaign events keep row security');

select * from finish();
rollback;
