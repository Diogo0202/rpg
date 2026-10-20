-- Append-only security audit for API access and direct campaign-table writes.
create table public.access_audit_logs (
  id bigint generated always as identity primary key,
  timestamp timestamptz not null default now(),
  request_id uuid,
  actor_id uuid,
  worker boolean not null default false,
  method text not null check (char_length(method) between 1 and 8),
  route text not null check (char_length(route) between 1 and 256),
  status integer not null check (status between 100 and 599),
  duration_ms integer not null check (duration_ms between 0 and 86400000),
  source text not null default 'api' check (source in ('api', 'database')),
  table_name text check (table_name is null or char_length(table_name) between 1 and 63),
  operation text check (operation is null or operation in ('INSERT', 'UPDATE', 'DELETE')),
  resource_id uuid
);

create index access_audit_logs_timestamp_idx on public.access_audit_logs (timestamp desc);
create index access_audit_logs_actor_timestamp_idx on public.access_audit_logs (actor_id, timestamp desc);
alter table public.access_audit_logs enable row level security;
revoke all on public.access_audit_logs from public, anon, authenticated;
revoke update, delete, truncate on public.access_audit_logs from service_role;
grant select, insert on public.access_audit_logs to service_role;
grant usage, select on sequence public.access_audit_logs_id_seq to service_role;
create policy "service role reads access audit logs"
  on public.access_audit_logs for select to service_role using (true);
create policy "service role inserts access audit logs"
  on public.access_audit_logs for insert to service_role with check (true);

create or replace function private.audit_campaign_table_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  row_data jsonb;
  target_resource uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  begin
    target_resource := coalesce(
      row_data ->> 'id',
      row_data ->> 'campaign_id',
      row_data ->> 'sheet_id',
      row_data ->> 'map_id',
      row_data ->> 'combat_id'
    )::uuid;
  exception when invalid_text_representation then
    target_resource := null;
  end;

  insert into public.access_audit_logs (
    timestamp, actor_id, worker, method, route, status, duration_ms,
    source, table_name, operation, resource_id
  ) values (
    now(), auth.uid(), coalesce(auth.role() = 'service_role', false),
    tg_op, 'database_write', 200, 0,
    'database', tg_table_name, tg_op, target_resource
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.audit_campaign_table_write() from public, anon, authenticated;

-- Only tables in the current campaign, sheet, journal, and chronicle schema.
do $$
declare
  target_table text;
  audited_tables constant text[] := array[
    'profiles', 'campaigns', 'campaign_members', 'library_sources', 'library_grants',
    'extraction_jobs', 'system_templates', 'character_sheets', 'world_entities',
    'world_relations', 'maps', 'map_pins', 'combat_sessions', 'combat_events',
    'audit_events', 'document_chunks', 'campaign_playlist_links', 'campaign_sessions', 'campaign_factions',
    'campaign_events', 'character_inventory', 'campaign_music_cues',
    'second_inquisition_events', 'chronicle_goals', 'chronicle_supporters',
    'chronicle_defects', 'chronicle_activity', 'character_sheet_notifications'
  ];
begin
  foreach target_table in array audited_tables loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format(
        'create trigger access_audit_write after insert or update or delete on public.%I for each row execute function private.audit_campaign_table_write()',
        target_table
      );
    end if;
  end loop;
end;
$$;
