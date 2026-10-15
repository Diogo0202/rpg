-- Inclui apenas character_sheets na publication quando ela estiver disponivel.
do $$
begin
  if exists (
    select 1
      from pg_catalog.pg_publication
     where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
      from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'character_sheets'
  ) then
    alter publication supabase_realtime add table public.character_sheets;
  end if;
end;
$$;
