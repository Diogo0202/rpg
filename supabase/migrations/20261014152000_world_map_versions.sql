alter table public.maps add column version integer not null default 1 check(version>0);
alter table public.world_entities add column version integer not null default 1 check(version>0);
alter table public.combat_sessions add column version integer not null default 1 check(version>0);

create or replace function private.version_campaign_document()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if new.id is distinct from old.id or new.campaign_id is distinct from old.campaign_id or new.created_by is distinct from old.created_by then
    raise exception 'campaign document identity cannot change';
  end if;
  new.version:=old.version+1;
  if tg_table_name<>'combat_sessions' then new.updated_at:=now(); end if;
  return new;
end;
$$;
revoke all on function private.version_campaign_document() from public;
create trigger maps_version before update on public.maps for each row execute function private.version_campaign_document();
create trigger world_entities_version before update on public.world_entities for each row execute function private.version_campaign_document();
create trigger combat_sessions_version before update on public.combat_sessions for each row execute function private.version_campaign_document();

alter table public.maps add constraint maps_document_size check(octet_length(document::text)<=1048576);
alter table public.world_entities add constraint world_entities_body_size check(octet_length(body::text)<=65536);
alter table public.combat_sessions add constraint combat_sessions_state_size check(octet_length(state::text)<=262144);
