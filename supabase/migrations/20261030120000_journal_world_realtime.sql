-- Publish only campaign data whose row policies already restrict reads to members.
do $$
declare
  target_table text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach target_table in array array[
    'campaign_sessions', 'campaign_factions', 'campaign_events',
    'campaign_event_entity_links', 'world_entities'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end;
$$;
