-- Mobile sync v1. The sync version is independent from domain/model versions.
alter table public.campaigns add column sync_version bigint not null default 1 check (sync_version > 0);
alter table public.system_templates add column sync_version bigint not null default 1 check (sync_version > 0);
alter table public.character_sheets add column sync_version bigint not null default 1 check (sync_version > 0);
alter table public.character_inventory add column sync_version bigint not null default 1 check (sync_version > 0);
alter table public.world_entities add column sync_version bigint not null default 1 check (sync_version > 0);
alter table public.world_relations add column sync_version bigint not null default 1 check (sync_version > 0);
alter table public.maps add column sync_version bigint not null default 1 check (sync_version > 0);
alter table public.map_pins add column sync_version bigint not null default 1 check (sync_version > 0);
alter table public.map_pins add column campaign_id uuid;
update public.map_pins p set campaign_id=m.campaign_id from public.maps m where m.id=p.map_id;
alter table public.map_pins alter column campaign_id set not null;
alter table public.map_pins add constraint map_pins_campaign_id_fk foreign key (campaign_id) references public.campaigns(id) on delete cascade;
alter table public.campaign_sessions add column sync_version bigint not null default 1 check (sync_version > 0);
alter table public.campaign_factions add column sync_version bigint not null default 1 check (sync_version > 0);
alter table public.campaign_events add column sync_version bigint not null default 1 check (sync_version > 0);
alter table public.combat_sessions add column sync_version bigint not null default 1 check (sync_version > 0);

create table private.sync_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create table private.campaign_sync_state (
  campaign_id uuid primary key,
  revision bigint not null default 0 check (revision >= 0),
  changed_at timestamptz not null default now()
);

create table private.sync_changes (
  campaign_id uuid not null,
  revision bigint not null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in ('create','update','delete')),
  record jsonb,
  entity_version bigint not null check (entity_version > 0),
  owner_id uuid,
  visibility_only boolean not null default false,
  changed_at timestamptz not null default now(),
  primary key (campaign_id, revision)
);
create index sync_changes_entity_idx on private.sync_changes(campaign_id, entity_type, entity_id, revision desc);

create table private.mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null,
  device_id uuid not null,
  operation_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, campaign_id, device_id, operation_id)
);

alter table private.sync_devices enable row level security;
alter table private.campaign_sync_state enable row level security;
alter table private.sync_changes enable row level security;
alter table private.mutation_receipts enable row level security;
revoke all on private.sync_devices, private.campaign_sync_state, private.sync_changes, private.mutation_receipts from public, anon, authenticated, service_role;

create or replace function private.mobile_sync_version()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then raise exception 'sync entity identity cannot change'; end if;
    if (to_jsonb(new)->>'campaign_id') is distinct from (to_jsonb(old)->>'campaign_id') then
      raise exception 'sync entity campaign cannot change';
    end if;
    new.sync_version := old.sync_version + 1;
  else
    new.sync_version := 1;
  end if;
  return new;
end;
$$;
revoke all on function private.mobile_sync_version() from public, anon, authenticated;

create trigger campaigns_mobile_sync_version before insert or update on public.campaigns for each row execute function private.mobile_sync_version();
create trigger system_templates_mobile_sync_version before insert or update on public.system_templates for each row execute function private.mobile_sync_version();
create trigger character_sheets_mobile_sync_version before insert or update on public.character_sheets for each row execute function private.mobile_sync_version();
create trigger character_inventory_mobile_sync_version before insert or update on public.character_inventory for each row execute function private.mobile_sync_version();
create trigger world_entities_mobile_sync_version before insert or update on public.world_entities for each row execute function private.mobile_sync_version();
create trigger world_relations_mobile_sync_version before insert or update on public.world_relations for each row execute function private.mobile_sync_version();
create trigger maps_mobile_sync_version before insert or update on public.maps for each row execute function private.mobile_sync_version();
create trigger map_pins_mobile_sync_version before insert or update on public.map_pins for each row execute function private.mobile_sync_version();
create trigger campaign_sessions_mobile_sync_version before insert or update on public.campaign_sessions for each row execute function private.mobile_sync_version();
create trigger campaign_factions_mobile_sync_version before insert or update on public.campaign_factions for each row execute function private.mobile_sync_version();
create trigger campaign_events_mobile_sync_version before insert or update on public.campaign_events for each row execute function private.mobile_sync_version();
create trigger combat_sessions_mobile_sync_version before insert or update on public.combat_sessions for each row execute function private.mobile_sync_version();

create or replace function private.mobile_sync_pin_scope()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare map_campaign uuid;
begin
  select campaign_id into map_campaign from public.maps where id=new.map_id;
  if map_campaign is null then raise exception 'map access denied' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.map_id is distinct from old.map_id or new.campaign_id is distinct from old.campaign_id) then
    raise exception 'map pin identity cannot change';
  end if;
  new.campaign_id:=map_campaign;
  return new;
end;
$$;
revoke all on function private.mobile_sync_pin_scope() from public, anon, authenticated;
create trigger map_pins_mobile_sync_scope before insert or update on public.map_pins for each row execute function private.mobile_sync_pin_scope();

create or replace function private.mobile_sync_log_visibility_tombstone(p_campaign uuid,p_entity text,p_entity_id uuid,p_version bigint,p_owner uuid)
returns void language plpgsql security definer set search_path = pg_catalog, private as $$
declare next_revision bigint;
begin
  if p_entity not in ('character_sheets','character_inventory') or p_owner is null or p_version<1 then
    raise exception 'invalid visibility tombstone';
  end if;
  insert into private.campaign_sync_state(campaign_id,revision) values(p_campaign,0)
    on conflict(campaign_id) do nothing;
  update private.campaign_sync_state set revision=revision+1,changed_at=clock_timestamp()
   where campaign_id=p_campaign returning revision into next_revision;
  insert into private.sync_changes(campaign_id,revision,entity_type,entity_id,action,record,entity_version,owner_id,visibility_only)
  values(p_campaign,next_revision,p_entity,p_entity_id,'delete',null,p_version,p_owner,true);
end;
$$;
revoke all on function private.mobile_sync_log_visibility_tombstone(uuid,text,uuid,bigint,uuid) from public, anon, authenticated, service_role;

create or replace function private.mobile_sync_log_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  row_json jsonb;
  campaign_key uuid;
  entity_key uuid;
  row_owner uuid;
  rev bigint;
  changed_inventory record;
begin
  row_json := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity_key := (row_json->>'id')::uuid;
  if tg_table_name = 'campaigns' then campaign_key := (row_json->>'id')::uuid;
  else campaign_key := nullif(row_json->>'campaign_id','')::uuid; end if;
  if campaign_key is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name = 'character_sheets' then row_owner := (row_json->>'owner_id')::uuid;
  elsif tg_table_name = 'character_inventory' then
    select s.owner_id into row_owner from public.character_sheets s where s.id = (row_json->>'sheet_id')::uuid;
  end if;

  insert into private.campaign_sync_state(campaign_id, revision) values (campaign_key, 0)
    on conflict (campaign_id) do nothing;
  update private.campaign_sync_state set revision = revision + 1, changed_at = clock_timestamp()
   where campaign_id = campaign_key returning revision into rev;
  insert into private.sync_changes(campaign_id, revision, entity_type, entity_id, action, record, entity_version, owner_id)
  values (campaign_key, rev, tg_table_name, entity_key,
          case lower(tg_op) when 'insert' then 'create' when 'update' then 'update' else 'delete' end,
          case when tg_op = 'DELETE' then null else row_json end,
          case when tg_op='DELETE' then coalesce((row_json->>'sync_version')::bigint,1)+1 else coalesce((row_json->>'sync_version')::bigint,1) end,
          row_owner);
  if tg_table_name='character_sheets' and tg_op='UPDATE' and (to_jsonb(old)->>'owner_id') is distinct from (to_jsonb(new)->>'owner_id') then
    perform private.mobile_sync_log_visibility_tombstone(campaign_key,'character_sheets',entity_key,new.sync_version,(to_jsonb(old)->>'owner_id')::uuid);
    for changed_inventory in
      update public.character_inventory set version=version where sheet_id=entity_key returning id,sync_version
    loop
      perform private.mobile_sync_log_visibility_tombstone(campaign_key,'character_inventory',changed_inventory.id,changed_inventory.sync_version,(to_jsonb(old)->>'owner_id')::uuid);
    end loop;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.mobile_sync_log_change() from public, anon, authenticated;

create trigger campaigns_mobile_sync_log after insert or update or delete on public.campaigns for each row execute function private.mobile_sync_log_change();
create trigger system_templates_mobile_sync_log after insert or update or delete on public.system_templates for each row execute function private.mobile_sync_log_change();
create trigger character_sheets_mobile_sync_log after insert or update or delete on public.character_sheets for each row execute function private.mobile_sync_log_change();
create trigger character_inventory_mobile_sync_log after insert or update or delete on public.character_inventory for each row execute function private.mobile_sync_log_change();
create trigger world_entities_mobile_sync_log after insert or update or delete on public.world_entities for each row execute function private.mobile_sync_log_change();
create trigger world_relations_mobile_sync_log after insert or update or delete on public.world_relations for each row execute function private.mobile_sync_log_change();
create trigger maps_mobile_sync_log after insert or update or delete on public.maps for each row execute function private.mobile_sync_log_change();
create trigger map_pins_mobile_sync_log after insert or update or delete on public.map_pins for each row execute function private.mobile_sync_log_change();
create trigger campaign_sessions_mobile_sync_log after insert or update or delete on public.campaign_sessions for each row execute function private.mobile_sync_log_change();
create trigger campaign_factions_mobile_sync_log after insert or update or delete on public.campaign_factions for each row execute function private.mobile_sync_log_change();
create trigger campaign_events_mobile_sync_log after insert or update or delete on public.campaign_events for each row execute function private.mobile_sync_log_change();
create trigger combat_sessions_mobile_sync_log after insert or update or delete on public.combat_sessions for each row execute function private.mobile_sync_log_change();

create or replace function private.mobile_sync_patch(p_doc jsonb, p_path text[], p_exists boolean, p_value jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
declare
  parent_doc jsonb;
begin
  if cardinality(p_path) = 1 then
    if p_exists then return jsonb_set(coalesce(p_doc,'{}'::jsonb), p_path, coalesce(p_value,'null'::jsonb), true); end if;
    return coalesce(p_doc,'{}'::jsonb) #- p_path;
  end if;
  parent_doc := p_doc #> p_path[1:cardinality(p_path)-1];
  if parent_doc is null then parent_doc := '{}'::jsonb;
  elsif jsonb_typeof(parent_doc) <> 'object' then raise exception 'paths cannot traverse arrays or scalars' using errcode='22023'; end if;
  parent_doc := private.mobile_sync_patch(parent_doc, p_path[2:cardinality(p_path)], p_exists, p_value);
  return jsonb_set(coalesce(p_doc,'{}'::jsonb), p_path[1:cardinality(p_path)-1], parent_doc, true);
end;
$$;
revoke all on function private.mobile_sync_patch(jsonb,text[],boolean,jsonb) from public, anon, authenticated;

create or replace function private.mobile_sync_field_allowlist(p_entity text)
returns text[] language sql immutable set search_path = pg_catalog as $$
  select case p_entity
    when 'campaigns' then array['name','description']::text[]
    when 'system_templates' then array['name','schema','page_references']::text[]
    when 'character_sheets' then array['template_id','name','values']::text[]
    when 'character_inventory' then array['sheet_id','name','category','quantity','resource_cost','damage_bonus','protection','notes','acquired','equipped','sort_order']::text[]
    when 'world_entities' then array['kind','name','body']::text[]
    when 'world_relations' then array['from_entity_id','to_entity_id','relation_type','notes']::text[]
    when 'maps' then array['name','document','grid_kind','isometric']::text[]
    when 'map_pins' then array['map_id','entity_id','x','y','label']::text[]
    when 'campaign_sessions' then array['sequence','title','summary','status','played_on']::text[]
    when 'campaign_factions' then array['name','description','goal','tension','limit','consequence']::text[]
    when 'campaign_events' then array['session_id','faction_id','title','description','occurred_on','status']::text[]
    when 'combat_sessions' then array['map_id','title','state','active']::text[]
    else null::text[] end;
$$;
revoke all on function private.mobile_sync_field_allowlist(text) from public, anon, authenticated;
grant execute on function private.mobile_sync_field_allowlist(text) to authenticated;
grant execute on function private.mobile_sync_patch(jsonb,text[],boolean,jsonb) to authenticated;

create or replace function private.mobile_sync_validate_template_schema(p_schema jsonb)
returns void language plpgsql immutable set search_path = pg_catalog, public, private as $$
declare
  field_definition jsonb;
  field_count integer;
  name_markers integer;
  field_kind text;
begin
  if jsonb_typeof(p_schema) is distinct from 'object' or jsonb_typeof(p_schema->'fields') is distinct from 'array' then
    raise exception 'template schema must be an object with a fields array';
  end if;
  select count(*) into field_count from jsonb_array_elements(p_schema->'fields');
  if field_count<1 or field_count>200 then raise exception 'template must have between 1 and 200 fields'; end if;
  if p_schema ? 'name' and (jsonb_typeof(p_schema->'name') is distinct from 'string' or char_length(p_schema->>'name') not between 3 and 120) then
    raise exception 'template schema name is invalid';
  end if;
  if p_schema ? 'version' and ((p_schema->>'version') !~ '^[1-9][0-9]*$' or (p_schema->>'version')::numeric>2147483647) then
    raise exception 'template schema version is invalid';
  end if;
  if p_schema ? 'system_key' and jsonb_typeof(p_schema->'system_key') not in ('string','null') then raise exception 'template system key is invalid'; end if;
  if p_schema ? 'system_key' and jsonb_typeof(p_schema->'system_key')='string' and char_length(p_schema->>'system_key')>80 then raise exception 'template system key is too long'; end if;
  if p_schema ? 'rules_profile_version' and jsonb_typeof(p_schema->'rules_profile_version') not in ('number','null') then raise exception 'template rules profile version is invalid'; end if;
  if p_schema ? 'rules_profile_version' and jsonb_typeof(p_schema->'rules_profile_version')='number'
     and ((p_schema->>'rules_profile_version') !~ '^[1-9][0-9]*$' or (p_schema->>'rules_profile_version')::numeric>2147483647) then raise exception 'template rules profile version is invalid'; end if;
  select count(*) into name_markers from jsonb_array_elements(p_schema->'fields') f(value) where f.value->'character_name'='true'::jsonb;
  if name_markers>1 then raise exception 'only one character name field is allowed'; end if;
  for field_definition in select value from jsonb_array_elements(p_schema->'fields') loop
    field_kind:=field_definition->>'kind';
    if jsonb_typeof(field_definition) is distinct from 'object'
       or exists(select 1 from jsonb_object_keys(field_definition) k where k not in ('id','label','kind','required','options','expression','creation_step','identity_kind','character_name','depends_on'))
       or jsonb_typeof(field_definition->'id') is distinct from 'string'
       or (field_definition->>'id') !~ '^[a-z][a-z0-9_]{1,63}$'
       or jsonb_typeof(field_definition->'label') is distinct from 'string'
       or char_length(field_definition->>'label') not between 1 and 120
       or field_kind not in ('text','number','select','checkbox','collection','formula','roll')
       or (field_definition ? 'required' and jsonb_typeof(field_definition->'required') is distinct from 'boolean')
       or (field_definition ? 'options' and jsonb_typeof(field_definition->'options') is distinct from 'array')
       or (field_definition ? 'options' and jsonb_array_length(field_definition->'options')>100)
       or (field_definition ? 'options' and exists(select 1 from jsonb_array_elements(field_definition->'options') o(value) where jsonb_typeof(o.value) is distinct from 'string'))
       or (field_definition ? 'expression' and jsonb_typeof(field_definition->'expression') not in ('string','null'))
       or (jsonb_typeof(field_definition->'expression')='string' and char_length(field_definition->>'expression')>120)
       or (field_definition ? 'creation_step' and jsonb_typeof(field_definition->'creation_step') not in ('string','null'))
       or (jsonb_typeof(field_definition->'creation_step')='string' and field_definition->>'creation_step' not in ('identity','attributes','skills','traits','resources','story','other'))
       or (field_definition ? 'identity_kind' and jsonb_typeof(field_definition->'identity_kind') not in ('string','null'))
       or (jsonb_typeof(field_definition->'identity_kind')='string' and field_definition->>'identity_kind' not in ('race','subrace','clan','predator','creed','lineage','origin','archetype'))
       or (field_definition ? 'character_name' and jsonb_typeof(field_definition->'character_name') is distinct from 'boolean') then
      raise exception 'invalid template field';
    end if;
    if (field_definition->>'character_name')::boolean is true and field_kind<>'text' then raise exception 'character name field must be text'; end if;
    if field_kind='select' and (field_definition->'depends_on' is null or jsonb_typeof(field_definition->'depends_on')='null')
       and coalesce(jsonb_array_length(field_definition->'options'),0)=0 then raise exception 'select field needs options'; end if;
    if field_definition->'depends_on' is not null and jsonb_typeof(field_definition->'depends_on')<>'null' and field_kind<>'select' then
      raise exception 'only select fields may declare dependencies';
    end if;
    if field_definition->'depends_on' is not null and jsonb_typeof(field_definition->'depends_on')<>'null'
       and coalesce(field_definition->'options','[]'::jsonb)<>'[]'::jsonb then raise exception 'dependent selects cannot have static options'; end if;
    if field_kind in ('formula','roll') and (jsonb_typeof(field_definition->'expression') is distinct from 'string' or btrim(field_definition->>'expression')='') then
      raise exception 'formula and roll fields need expressions';
    end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_schema->'fields') f(value))<>field_count then raise exception 'template field IDs must be unique'; end if;
  perform private.validate_sheet_template_dependencies(p_schema);
end;
$$;
revoke all on function private.mobile_sync_validate_template_schema(jsonb) from public, anon, authenticated;
grant execute on function private.mobile_sync_validate_template_schema(jsonb) to authenticated;

create or replace function private.mobile_sync_device_touch(p_device uuid)
returns void language plpgsql security definer set search_path = pg_catalog, private, auth as $$
begin
  if auth.uid() is null or p_device is null then raise exception 'authenticated user and device required' using errcode='42501'; end if;
  insert into private.sync_devices(user_id,device_id) values(auth.uid(),p_device)
  on conflict(user_id,device_id) do update set last_seen_at=now();
end;
$$;
revoke all on function private.mobile_sync_device_touch(uuid) from public, anon, authenticated;
grant execute on function private.mobile_sync_device_touch(uuid) to authenticated;

create or replace function private.mobile_sync_receipt_get(p_campaign uuid,p_device uuid,p_operation uuid)
returns jsonb language sql security definer set search_path = pg_catalog, private, auth as $$
  select jsonb_build_object('payload_hash',payload_hash,'result',result)
    from private.mutation_receipts
   where user_id=auth.uid() and campaign_id=p_campaign and device_id=p_device and operation_id=p_operation
     and private.is_campaign_member(p_campaign)
$$;
revoke all on function private.mobile_sync_receipt_get(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function private.mobile_sync_receipt_get(uuid,uuid,uuid) to authenticated;

create or replace function private.mobile_sync_receipt_claim(p_campaign uuid,p_device uuid,p_operation uuid,p_hash text)
returns boolean language plpgsql security definer set search_path = pg_catalog, private, auth as $$
declare inserted_count integer;
begin
  if auth.uid() is null or p_device is null or p_operation is null then raise exception 'authenticated user, device and operation required' using errcode='42501'; end if;
  if p_campaign is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'valid campaign and payload hash required' using errcode='22023'; end if;
  if not private.is_campaign_member(p_campaign) and exists(select 1 from public.campaigns where id=p_campaign) then
    raise exception 'campaign access denied' using errcode='42501';
  end if;
  insert into private.mutation_receipts(user_id,campaign_id,device_id,operation_id,payload_hash,result)
  values(auth.uid(),p_campaign,p_device,p_operation,p_hash,null)
  on conflict(user_id,campaign_id,device_id,operation_id) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count=1;
end;
$$;
revoke all on function private.mobile_sync_receipt_claim(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function private.mobile_sync_receipt_claim(uuid,uuid,uuid,text) to authenticated;

create or replace function private.mobile_sync_receipt_finish(p_campaign uuid,p_device uuid,p_operation uuid,p_result jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, private, auth as $$
begin
  if auth.uid() is null or p_campaign is null or p_device is null or p_operation is null then raise exception 'authenticated user, campaign, device and operation required' using errcode='42501'; end if;
  if jsonb_typeof(p_result)<>'object' or coalesce(octet_length(p_result::text),0)>65536
     or p_result->>'operation_id' is distinct from p_operation::text
     or coalesce(p_result->>'status','') not in ('applied','conflict','invalid','denied','dependency_failed') then
    raise exception 'invalid receipt result' using errcode='22023';
  end if;
  if not private.is_campaign_member(p_campaign) then raise exception 'campaign access denied' using errcode='42501'; end if;
  update private.mutation_receipts set result=p_result
   where user_id=auth.uid() and campaign_id=p_campaign and device_id=p_device and operation_id=p_operation and result is null;
  if not found then raise exception 'receipt claim missing' using errcode='40001'; end if;
end;
$$;
revoke all on function private.mobile_sync_receipt_finish(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function private.mobile_sync_receipt_finish(uuid,uuid,uuid,jsonb) to authenticated;

create or replace function private.mobile_sync_head(p_campaign uuid)
returns bigint language sql stable security definer set search_path = pg_catalog, private, auth as $$
  select case when private.is_campaign_member(p_campaign) then coalesce((select revision from private.campaign_sync_state where campaign_id=p_campaign),0) else null end
$$;
revoke all on function private.mobile_sync_head(uuid) from public, anon, authenticated;
grant execute on function private.mobile_sync_head(uuid) to authenticated;

create or replace function private.mobile_sync_record_dto(p_entity text,p_record jsonb)
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select case when p_record is null then null else jsonb_build_object(
    'entity_type',p_entity,'entity_id',p_record->'id',
    'version',coalesce(p_record->'sync_version','1'::jsonb),
    'data',p_record-'sync_version') end
$$;
revoke all on function private.mobile_sync_record_dto(text,jsonb) from public, anon, authenticated;
grant execute on function private.mobile_sync_record_dto(text,jsonb) to authenticated;

create or replace function private.mobile_sync_entity_was_deleted(p_campaign uuid,p_entity text,p_entity_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, private, auth as $$
begin
  if auth.uid() is null then raise exception 'authenticated user required' using errcode='42501'; end if;
  if p_entity<>'campaigns' and not private.is_campaign_member(p_campaign) then raise exception 'campaign access denied' using errcode='42501'; end if;
  return exists(select 1 from private.sync_changes where campaign_id=p_campaign and entity_type=p_entity and entity_id=p_entity_id and action='delete');
end;
$$;
revoke all on function private.mobile_sync_entity_was_deleted(uuid,text,uuid) from public, anon, authenticated;
grant execute on function private.mobile_sync_entity_was_deleted(uuid,text,uuid) to authenticated;

create or replace function private.mobile_sync_create_campaign(p_campaign uuid,p_name text,p_description text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, auth as $$
declare saved public.campaigns;
begin
  if auth.uid() is null or p_campaign is null then raise exception 'authenticated campaign owner required' using errcode='42501'; end if;
  insert into public.campaigns(id,owner_id,name,description)
  values(p_campaign,auth.uid(),btrim(p_name),coalesce(p_description,'')) returning * into saved;
  return to_jsonb(saved);
end;
$$;
revoke all on function private.mobile_sync_create_campaign(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function private.mobile_sync_create_campaign(uuid,text,text) to authenticated;

create or replace function private.mobile_sync_apply_one(p_campaign uuid, p_user uuid, p_operation jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public, private, auth as $$
declare
  entity text := p_operation->>'entity_type';
  action_name text := p_operation->>'action';
  entity_id uuid := (p_operation->>'entity_id')::uuid;
  base_version bigint := (p_operation->>'base_version')::bigint;
  allowed text[] := private.mobile_sync_field_allowlist(entity);
  changes jsonb := coalesce(p_operation->'changes','[]'::jsonb);
  current_row jsonb;
  candidate jsonb := '{}'::jsonb;
  change jsonb;
  path_parts text[];
  path_text text;
  root_field text;
  before_exists boolean;
  after_exists boolean;
  current_value jsonb;
  seen_paths text[] := '{}';
  fields text[];
  columns_sql text;
  values_sql text;
  field_name text;
  campaign_field text;
  version_value bigint;
  new_row jsonb;
  affected integer;
  record_owner uuid;
  model_schema jsonb;
  name_field_id text;
  canonical_name text;
  name_changed boolean := false;
begin
  if auth.uid() is null or auth.uid() is distinct from p_user then raise exception 'authenticated actor mismatch' using errcode='42501'; end if;
  if allowed is null or cardinality(allowed)=0 or action_name not in ('create','update','delete') or jsonb_typeof(changes) <> 'array'
     or jsonb_array_length(changes) > 200 then
    return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','error','unsupported operation');
  end if;
  if entity='campaigns' then campaign_field := 'id';
  elsif entity='map_pins' then campaign_field := 'map_id';
  else campaign_field := 'campaign_id'; end if;
  if entity='campaigns' and entity_id<>p_campaign then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id'); end if;

  if action_name='create' then
    if base_version <> 0 then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id'); end if;
    for change in select value from jsonb_array_elements(changes) loop
      path_parts := array(select jsonb_array_elements_text(change->'path'));
      path_text := array_to_string(path_parts,E'\x1f');
      if jsonb_typeof(change->'path')<>'array' or jsonb_typeof(change->'before')<>'object' or jsonb_typeof(change->'after')<>'object'
         or jsonb_typeof(change->'before'->'exists')<>'boolean' or jsonb_typeof(change->'after'->'exists')<>'boolean'
         or cardinality(path_parts)<1 or cardinality(path_parts)>12 or not (path_parts[1] = any(allowed))
         or exists(select 1 from unnest(path_parts) p where p='' or p ~ '^[0-9]+$' or p in ('__proto__','prototype','constructor'))
         or exists(select 1 from unnest(seen_paths) prior where prior=path_text or prior like path_text||E'\x1f%' or path_text like prior||E'\x1f%')
         or (change->'before'->>'exists')::boolean
         or not (change->'after'->>'exists')::boolean or not (change->'after' ? 'value') then
        return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','error','invalid create fields');
      end if;
      seen_paths:=array_append(seen_paths,path_text);
      candidate := private.mobile_sync_patch(candidate,path_parts,true,change->'after'->'value');
    end loop;
    candidate := candidate || jsonb_build_object('id',entity_id,'sync_version',1);
    if entity='campaigns' then
      candidate := candidate || jsonb_build_object('owner_id',p_user);
    elsif entity='character_sheets' then
      candidate := candidate || jsonb_build_object('campaign_id',p_campaign,'owner_id',p_user);
    elsif entity='system_templates' then
      candidate := candidate || jsonb_build_object('campaign_id',p_campaign,'owner_id',p_user,'status','needs_review','version',1);
      canonical_name:=nullif(btrim(candidate->>'name'),'');
      if canonical_name is null then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','message','template name is required'); end if;
      candidate:=jsonb_set(candidate,'{name}',to_jsonb(canonical_name),true);
      perform private.mobile_sync_validate_template_schema(candidate->'schema');
    elsif entity in ('world_entities','world_relations') then
      candidate := candidate || jsonb_build_object('campaign_id',p_campaign,'created_by',p_user);
    elsif entity='character_inventory' or entity='maps' or entity='campaign_sessions' or entity='campaign_factions' or entity='campaign_events' or entity='combat_sessions' then
      candidate := candidate || jsonb_build_object('campaign_id',p_campaign);
    end if;
    if entity='character_inventory' then
      candidate := candidate || jsonb_build_object('campaign_id',p_campaign);
    elsif entity='map_pins' then
      candidate := candidate || jsonb_build_object('campaign_id',p_campaign);
    end if;
    if entity='campaigns' and entity_id <> p_campaign then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id'); end if;

    if private.mobile_sync_entity_was_deleted(p_campaign,entity,entity_id) then
      return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','error','deleted entity ids cannot be reused');
    end if;
    if entity='campaigns' then
      new_row:=private.mobile_sync_create_campaign(entity_id,candidate->>'name',candidate->>'description');
      return jsonb_build_object('status','applied','operation_id',p_operation->>'operation_id','record',new_row);
    end if;
    if entity='character_sheets' then
      select schema into model_schema from public.system_templates where id=(candidate->>'template_id')::uuid and campaign_id=p_campaign and status='approved';
      if model_schema is null then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','message','an approved campaign template is required'); end if;
      perform private.mobile_sync_validate_template_schema(model_schema);
      if coalesce(model_schema->'rules_profile_version','null'::jsonb)<>'null'::jsonb then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','message','template rules profile is unsupported for mobile sheets'); end if;
      select field->>'id' into name_field_id from jsonb_array_elements(coalesce(model_schema->'fields','[]'::jsonb)) f(field)
       where field->>'character_name'='true' and field->>'kind'='text' limit 1;
      if name_field_id is null then
        select field->>'id' into name_field_id from jsonb_array_elements(coalesce(model_schema->'fields','[]'::jsonb)) f(field)
         where field->>'id'='nome' and field->>'kind'='text' limit 1;
      end if;
      canonical_name:=nullif(btrim(candidate->>'name'),'');
      if canonical_name is null then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','message','sheet name is required'); end if;
      candidate:=jsonb_set(candidate,'{values}',coalesce(candidate->'values','{}'::jsonb)-array(select field->>'id' from jsonb_array_elements(coalesce(model_schema->'fields','[]'::jsonb)) f(field) where field->>'kind' in ('formula','roll')),true);
      if name_field_id is not null then candidate:=jsonb_set(candidate,array['values',name_field_id],to_jsonb(canonical_name),true); end if;
      candidate:=jsonb_set(candidate,'{name}',to_jsonb(canonical_name),true);
    end if;

    fields := array['id'];
    foreach field_name in array allowed loop
      if candidate ? field_name then fields := array_append(fields,field_name); end if;
    end loop;
    if entity not in ('campaigns','map_pins') then fields := array_append(fields,'campaign_id'); end if;
    if entity='campaigns' then fields := array_append(fields,'owner_id'); end if;
    if entity in ('character_sheets','system_templates') then fields := array_append(fields,'owner_id'); end if;
    if entity in ('world_entities','world_relations') then fields := array_append(fields,'created_by'); end if;
    select string_agg(format('%I',f),',') into columns_sql from unnest(fields) f;
    select string_agg(format('r.%I',f),',') into values_sql from unnest(fields) f;
    execute format('insert into public.%I as t (%s) select %s from jsonb_populate_record(null::public.%I,$1) r returning to_jsonb(t)',entity,columns_sql,values_sql,entity)
       into new_row using candidate;
    return jsonb_build_object('status','applied','operation_id',p_operation->>'operation_id','record',new_row);
  end if;

  if entity='campaigns' then
    execute 'select to_jsonb(t) from public.campaigns t where t.id=$1' into current_row using entity_id;
  else
    execute format('select to_jsonb(t) from public.%I t where t.id=$1 and t.campaign_id=$2',entity) into current_row using entity_id,p_campaign;
  end if;
  if current_row is null then
    return jsonb_build_object('status','denied','operation_id',p_operation->>'operation_id');
  end if;
  if entity='system_templates' and current_row->>'status'<>'needs_review' then
    return jsonb_build_object('status','denied','operation_id',p_operation->>'operation_id','message','only draft templates can sync');
  end if;
  version_value := coalesce((current_row->>'sync_version')::bigint,1);
  if action_name='delete' then
    if jsonb_array_length(changes) <> 0 or version_value <> base_version then
      return jsonb_build_object('status','conflict','operation_id',p_operation->>'operation_id','record',current_row,'conflicting_paths',jsonb_build_array(jsonb_build_array('sync_version')));
    end if;
    if entity='campaigns' then execute 'delete from public.campaigns where id=$1' using entity_id;
    else execute format('delete from public.%I where id=$1 and campaign_id=$2',entity) using entity_id,p_campaign; end if;
    get diagnostics affected = row_count;
    if affected=0 then return jsonb_build_object('status','denied','operation_id',p_operation->>'operation_id'); end if;
    return jsonb_build_object('status','applied','operation_id',p_operation->>'operation_id');
  end if;
  if action_name<>'update' or base_version<1 then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id'); end if;
  candidate := current_row;
  for change in select value from jsonb_array_elements(changes) loop
    path_parts := array(select jsonb_array_elements_text(change->'path'));
    if jsonb_typeof(change->'path')<>'array' or jsonb_typeof(change->'before')<>'object' or jsonb_typeof(change->'after')<>'object'
       or jsonb_typeof(change->'before'->'exists')<>'boolean' or jsonb_typeof(change->'after'->'exists')<>'boolean'
       or cardinality(path_parts)<1 or cardinality(path_parts)>12 then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id'); end if;
    root_field := path_parts[1];
    if not (root_field = any(allowed)) or root_field in ('id','campaign_id','owner_id','created_by','sync_version','version')
       or exists(select 1 from unnest(path_parts) p where p='' or p ~ '^[0-9]+$' or p in ('__proto__','prototype','constructor')) then
      return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','error','field is immutable or unsupported');
    end if;
    path_text := array_to_string(path_parts,E'\x1f');
    if exists(select 1 from unnest(seen_paths) prior where prior=path_text or prior like path_text||E'\x1f%' or path_text like prior||E'\x1f%') then
      return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','error','overlapping paths');
    end if;
    seen_paths := array_append(seen_paths,path_text);
    before_exists := (change->'before'->>'exists')::boolean;
    after_exists := (change->'after'->>'exists')::boolean;
    if (before_exists and not (change->'before' ? 'value')) or (after_exists and not (change->'after' ? 'value')) then
      return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id');
    end if;
    current_value := candidate #> path_parts;
    if (current_value is not null) is distinct from before_exists or (before_exists and current_value is distinct from change->'before'->'value') then
      if version_value<>base_version then seen_paths:=array_append(seen_paths,path_text||E'\x1e');
      else return jsonb_build_object('status','conflict','operation_id',p_operation->>'operation_id','record',current_row,'conflicting_paths',jsonb_build_array(to_jsonb(path_parts))); end if;
    end if;
    candidate := private.mobile_sync_patch(candidate,path_parts,after_exists,change->'after'->'value');
    if entity='character_sheets' and root_field='name' then name_changed:=true; end if;
  end loop;
  if version_value<>base_version then
    -- Fields whose before-image still matched are mergeable. Conflicting fields were marked above.
    if exists(select 1 from unnest(seen_paths) s where s like '%'||E'\x1e') then
      return jsonb_build_object('status','conflict','operation_id',p_operation->>'operation_id','record',current_row,'conflicting_paths',coalesce((select jsonb_agg(to_jsonb(string_to_array(replace(s,E'\x1e',''),E'\x1f'))) from unnest(seen_paths) s where s like '%'||E'\x1e'),'[]'::jsonb));
    end if;
  end if;
  if entity='character_sheets' then
    select schema into model_schema from public.system_templates where id=(candidate->>'template_id')::uuid and campaign_id=p_campaign and status='approved';
    if model_schema is null then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','message','an approved campaign template is required'); end if;
    perform private.mobile_sync_validate_template_schema(model_schema);
    if coalesce(model_schema->'rules_profile_version','null'::jsonb)<>'null'::jsonb then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','message','template rules profile is unsupported for mobile sheets'); end if;
    select field->>'id' into name_field_id from jsonb_array_elements(coalesce(model_schema->'fields','[]'::jsonb)) f(field)
     where field->>'character_name'='true' and field->>'kind'='text' limit 1;
    if name_field_id is null then
      select field->>'id' into name_field_id from jsonb_array_elements(coalesce(model_schema->'fields','[]'::jsonb)) f(field)
       where field->>'id'='nome' and field->>'kind'='text' limit 1;
    end if;
    if name_changed then canonical_name:=nullif(btrim(candidate->>'name'),'');
    elsif name_field_id is not null and candidate->'values' ? name_field_id then canonical_name:=nullif(btrim(candidate->'values'->>name_field_id),'');
    else canonical_name:=nullif(btrim(candidate->>'name'),''); end if;
    if canonical_name is null then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','message','sheet name is required'); end if;
    candidate:=jsonb_set(candidate,'{values}',coalesce(candidate->'values','{}'::jsonb)-array(select field->>'id' from jsonb_array_elements(coalesce(model_schema->'fields','[]'::jsonb)) f(field) where field->>'kind' in ('formula','roll')),true);
    if name_field_id is not null then candidate:=jsonb_set(candidate,array['values',name_field_id],to_jsonb(canonical_name),true); end if;
    candidate:=jsonb_set(candidate,'{name}',to_jsonb(canonical_name),true);
  end if;
  if entity='system_templates' then
    canonical_name:=nullif(btrim(candidate->>'name'),'');
    if canonical_name is null then return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','message','template name is required'); end if;
    candidate:=jsonb_set(candidate,'{name}',to_jsonb(canonical_name),true);
    perform private.mobile_sync_validate_template_schema(candidate->'schema');
  end if;
  fields := allowed;
  select string_agg(format('%I',f),',') into columns_sql from unnest(fields) f;
  select string_agg(format('r.%I',f),',') into values_sql from unnest(fields) f;
  if entity='campaigns' then
    execute format('update public.%I as t set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1) r) where t.id=$2 returning to_jsonb(t)',entity,columns_sql,values_sql,entity) into new_row using candidate,entity_id;
  else
    execute format('update public.%I as t set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1) r) where t.id=$2 and t.campaign_id=$3 returning to_jsonb(t)',entity,columns_sql,values_sql,entity) into new_row using candidate,entity_id,p_campaign;
  end if;
  if new_row is null then return jsonb_build_object('status','denied','operation_id',p_operation->>'operation_id'); end if;
  return jsonb_build_object('status','applied','operation_id',p_operation->>'operation_id','record',new_row);
exception when insufficient_privilege then
  return jsonb_build_object('status','denied','operation_id',p_operation->>'operation_id','error',sqlerrm);
when others then
  return jsonb_build_object('status','invalid','operation_id',p_operation->>'operation_id','error','domain validation failed');
end;
$$;
revoke all on function private.mobile_sync_apply_one(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function private.mobile_sync_apply_one(uuid,uuid,jsonb) to authenticated;

create or replace function public.mobile_sync_push(p_campaign_id uuid, p_device_id uuid, p_mutations jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public, private, auth as $$
declare
  actor uuid := auth.uid();
  mutation jsonb;
  operation_id uuid;
  receipt jsonb;
  hash_value text;
  result jsonb;
  results jsonb := '[]'::jsonb;
  deps jsonb;
  dependency_id uuid;
  dependency_result jsonb;
  claimed boolean;
  current_record jsonb;
begin
  if actor is null then raise exception 'authenticated user required' using errcode='42501'; end if;
  if jsonb_typeof(p_mutations)<>'array' or jsonb_array_length(p_mutations)>50 then raise exception 'mutations must be an array of at most 50 items'; end if;
  if p_device_id is null then raise exception 'device required' using errcode='22023'; end if;
  if not private.is_campaign_member(p_campaign_id) and not (
      jsonb_array_length(p_mutations)=1
      and p_mutations->0->>'entity_type'='campaigns'
      and p_mutations->0->>'entity_id'=p_campaign_id::text
      and p_mutations->0->>'action'='create') then
    raise exception 'campaign access denied' using errcode='42501';
  end if;
  perform private.mobile_sync_device_touch(p_device_id);
  for mutation in select value from jsonb_array_elements(p_mutations) loop
    if coalesce(mutation->>'operation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      results:=results||jsonb_build_array(jsonb_build_object('status','invalid','operation_id',mutation->>'operation_id','message','operation_id must be a UUID'));
      continue;
    end if;
    operation_id := (mutation->>'operation_id')::uuid;
    if coalesce(octet_length(mutation::text),0)>32768 then
      results:=results||jsonb_build_array(jsonb_build_object('status','invalid','operation_id',operation_id,'message','operation too large'));
      continue;
    end if;
    hash_value := encode(sha256(convert_to(mutation::text,'UTF8')),'hex');
    receipt:=private.mobile_sync_receipt_get(p_campaign_id,p_device_id,operation_id);
    if receipt is not null then
      if receipt->>'payload_hash'<>hash_value then
        result:=jsonb_build_object('status','invalid','operation_id',operation_id,'message','operation id reused with different content');
      elsif receipt->'result' is not null and receipt->'result'<>'null'::jsonb then
        result:=receipt->'result';
        if result->>'status'='applied' then result:=result||jsonb_build_object('status','duplicate'); end if;
        if result ? 'record' then
          if mutation->>'entity_type'='campaigns' then
            execute 'select to_jsonb(t) from public.campaigns t where t.id=$1' into current_record using (result->'record'->>'id')::uuid;
          else
            execute format('select to_jsonb(t) from public.%I t where t.id=$1 and t.campaign_id=$2',mutation->>'entity_type') into current_record using (result->'record'->>'id')::uuid,p_campaign_id;
          end if;
          if current_record is null then result:=jsonb_build_object('status','denied','operation_id',operation_id,'message','record is no longer available');
          else result:=result||jsonb_build_object('record',current_record); end if;
        end if;
      else
        result:=jsonb_build_object('status','invalid','operation_id',operation_id,'message','operation is already being processed');
      end if;
    else
      claimed:=private.mobile_sync_receipt_claim(p_campaign_id,p_device_id,operation_id,hash_value);
      if not claimed then
        receipt:=private.mobile_sync_receipt_get(p_campaign_id,p_device_id,operation_id);
        if receipt->>'payload_hash'<>hash_value then
          result:=jsonb_build_object('status','invalid','operation_id',operation_id,'message','operation id reused with different content');
        elsif receipt->'result' is not null and receipt->'result'<>'null'::jsonb then
          result:=receipt->'result';
          if result->>'status'='applied' then result:=result||jsonb_build_object('status','duplicate'); end if;
          if result ? 'record' then
            if mutation->>'entity_type'='campaigns' then
              execute 'select to_jsonb(t) from public.campaigns t where t.id=$1' into current_record using (result->'record'->>'id')::uuid;
            else
              execute format('select to_jsonb(t) from public.%I t where t.id=$1 and t.campaign_id=$2',mutation->>'entity_type') into current_record using (result->'record'->>'id')::uuid,p_campaign_id;
            end if;
            if current_record is null then result:=jsonb_build_object('status','denied','operation_id',operation_id,'message','record is no longer available');
            else result:=result||jsonb_build_object('record',current_record); end if;
          end if;
        else
          result:=jsonb_build_object('status','invalid','operation_id',operation_id,'message','operation is already being processed');
        end if;
      else
        deps:=coalesce(mutation->'depends_on','[]'::jsonb);
        if jsonb_typeof(deps)<>'array' then result:=jsonb_build_object('status','invalid','operation_id',operation_id,'message','depends_on must be an array');
        else
          dependency_result:=null;
          for dependency_id in select (value#>>'{}')::uuid from jsonb_array_elements(deps) loop
            receipt:=private.mobile_sync_receipt_get(p_campaign_id,p_device_id,dependency_id);
            dependency_result:=receipt->'result';
            if dependency_result is null or dependency_result->>'status' not in ('applied','duplicate') then exit; end if;
          end loop;
          if jsonb_array_length(deps)>0 and (dependency_result is null or dependency_result->>'status' not in ('applied','duplicate')) then
            result:=jsonb_build_object('status','dependency_failed','operation_id',operation_id);
          else
            result:=private.mobile_sync_apply_one(p_campaign_id,actor,mutation);
          end if;
        end if;
        if result ? 'error' then result:=jsonb_build_object('status',result->'status','operation_id',operation_id,'message','domain validation failed'); end if;
        perform private.mobile_sync_receipt_finish(p_campaign_id,p_device_id,operation_id,result);
      end if;
    end if;
    if result ? 'conflicting_paths' then
      result:=jsonb_build_object('operation_id',operation_id,'status','conflict','record',private.mobile_sync_record_dto(mutation->>'entity_type',result->'record'),'conflict_paths',result->'conflicting_paths');
    elsif result ? 'record' then
      result:=result||jsonb_build_object('record',private.mobile_sync_record_dto(mutation->>'entity_type',result->'record'));
    end if;
    results:=results||jsonb_build_array(result);
  end loop;
  return jsonb_build_object('protocol_version',1,'campaign_id',p_campaign_id,'cursor',private.mobile_sync_head(p_campaign_id),'results',results);
end;
$$;
revoke all on function public.mobile_sync_push(uuid,uuid,jsonb) from public, anon, service_role;
grant execute on function public.mobile_sync_push(uuid,uuid,jsonb) to authenticated;

create or replace function public.mobile_sync_snapshot(p_campaign_id uuid, p_entity_type text, p_after_id uuid default null, p_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public, private, auth as $$
declare
  result_rows jsonb;
  next_id uuid;
  current_revision bigint;
  count_rows integer;
begin
  if auth.uid() is null or not private.is_campaign_member(p_campaign_id) then raise exception 'campaign access denied' using errcode='42501'; end if;
  if private.mobile_sync_field_allowlist(p_entity_type) is null then raise exception 'unsupported entity type'; end if;
  if p_limit<1 or p_limit>500 then raise exception 'limit must be between 1 and 500'; end if;
  current_revision:=private.mobile_sync_head(p_campaign_id);
  if p_entity_type='map_pins' then
    select coalesce(jsonb_agg(x.row_data order by x.entity_id),'[]'::jsonb), (array_agg(x.entity_id order by x.entity_id desc))[1], count(*)
      into result_rows,next_id,count_rows from (
        select p.id entity_id,to_jsonb(p) row_data from public.map_pins p join public.maps m on m.id=p.map_id
         where m.campaign_id=p_campaign_id and (p_after_id is null or p.id>p_after_id) order by p.id limit p_limit+1
      ) x;
  elsif p_entity_type='campaigns' then
    select coalesce(jsonb_agg(x.row_data order by x.entity_id),'[]'::jsonb),(array_agg(x.entity_id order by x.entity_id desc))[1],count(*) into result_rows,next_id,count_rows from (
      select t.id entity_id,to_jsonb(t) row_data from public.campaigns t where t.id=p_campaign_id and (p_after_id is null or t.id>p_after_id) order by t.id limit p_limit+1) x;
  else
    execute format('select coalesce(jsonb_agg(x.row_data order by x.entity_id),''[]''::jsonb),(array_agg(x.entity_id order by x.entity_id desc))[1],count(*) from (select t.id entity_id,to_jsonb(t) row_data from public.%I t where t.campaign_id=$1 and ($2 is null or t.id>$2) order by t.id limit $3) x',p_entity_type)
      into result_rows,next_id,count_rows using p_campaign_id,p_after_id,p_limit+1;
  end if;
  if count_rows>p_limit then
    select coalesce(jsonb_agg(v.value order by v.ordinality),'[]'::jsonb) into result_rows
      from jsonb_array_elements(result_rows) with ordinality v(value,ordinality) where v.ordinality<=p_limit;
    next_id:=(result_rows->(jsonb_array_length(result_rows)-1)->>'id')::uuid;
  end if;
  select coalesce(jsonb_agg(private.mobile_sync_record_dto(p_entity_type,v.value) order by v.ordinality),'[]'::jsonb) into result_rows from jsonb_array_elements(coalesce(result_rows,'[]'::jsonb)) with ordinality v(value,ordinality);
  return jsonb_build_object('protocol_version',1,'campaign_id',p_campaign_id,'cursor',coalesce(current_revision,0),'records',coalesce(result_rows,'[]'::jsonb),'next_after_id',next_id,'has_more',coalesce(count_rows>p_limit,false));
end;
$$;
revoke all on function public.mobile_sync_snapshot(uuid,text,uuid,integer) from public, anon, service_role;
grant execute on function public.mobile_sync_snapshot(uuid,text,uuid,integer) to authenticated;

create or replace function public.mobile_sync_changes(p_campaign_id uuid, p_cursor bigint, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, auth as $$
declare
  output jsonb := '[]'::jsonb;
  item record;
  next_cursor bigint := greatest(coalesce(p_cursor,0),0);
  revision_head bigint;
  delivered integer := 0;
  row_data jsonb;
  can_read boolean;
begin
  if auth.uid() is null or not private.is_campaign_member(p_campaign_id) then raise exception 'campaign access denied' using errcode='42501'; end if;
  if p_limit<1 or p_limit>500 then raise exception 'limit must be between 1 and 500'; end if;
  select coalesce(max(revision),0) into revision_head from private.sync_changes where campaign_id=p_campaign_id;
  for item in select * from private.sync_changes where campaign_id=p_campaign_id and revision>next_cursor order by revision limit p_limit+1 loop
    next_cursor:=item.revision;
    if item.visibility_only then
      can_read:=item.owner_id=auth.uid() and not private.can_manage_campaign(p_campaign_id);
    elsif item.entity_type='character_sheets' then
      can_read:=item.owner_id=auth.uid() or private.can_manage_campaign(p_campaign_id);
    elsif item.entity_type='character_inventory' then
      can_read:=item.owner_id=auth.uid() or private.can_manage_campaign(p_campaign_id);
    elsif item.entity_type in ('maps','map_pins') then
      can_read:=private.can_manage_campaign(p_campaign_id);
    else can_read:=private.is_campaign_member(p_campaign_id); end if;
    if can_read then
    if item.action='delete' then row_data:=null;
      elsif item.entity_type='campaigns' then
        select to_jsonb(t) into row_data from public.campaigns t where t.id=item.entity_id;
      else
        execute format('select to_jsonb(t) from public.%I t where t.id=$1 and t.campaign_id=$2',item.entity_type) into row_data using item.entity_id,p_campaign_id;
      end if;
      if item.action<>'delete' and item.entity_type='character_sheets' and row_data is not null then
        can_read:=(row_data->>'owner_id')::uuid=auth.uid() or private.can_manage_campaign(p_campaign_id);
      elsif item.action<>'delete' and item.entity_type='character_inventory' and row_data is not null then
        select s.owner_id=auth.uid() or private.can_manage_campaign(p_campaign_id)
          into can_read from public.character_sheets s where s.id=(row_data->>'sheet_id')::uuid and s.campaign_id=p_campaign_id;
      end if;
      if item.action='delete' or row_data is not null then
        if not can_read then row_data:=null; end if;
      end if;
      if item.action='delete' and can_read or item.action<>'delete' and can_read and row_data is not null then
        output:=output||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('revision',item.revision,'entity_type',item.entity_type,'entity_id',item.entity_id,'version',item.entity_version,'action',item.action,'record',case when item.action='delete' then null else private.mobile_sync_record_dto(item.entity_type,row_data) end,'tombstone',case when item.action='delete' then true else null end)));
        delivered:=delivered+1;
      end if;
    end if;
    exit when delivered>=p_limit;
  end loop;
  return jsonb_build_object('protocol_version',1,'campaign_id',p_campaign_id,'cursor',next_cursor,'has_more',next_cursor<revision_head,'changes',output);
end;
$$;
revoke all on function public.mobile_sync_changes(uuid,bigint,integer) from public, anon, service_role;
grant execute on function public.mobile_sync_changes(uuid,bigint,integer) to authenticated;

comment on table private.sync_changes is 'Private ordered change log. Read only through campaign-authorized mobile_sync_changes.';
comment on table private.mutation_receipts is 'Permanent per-user/device operation hash and result for idempotent mobile sync.';
comment on column public.map_pins.campaign_id is 'Denormalized campaign scope derived from map_id for ordered mobile synchronization.';
