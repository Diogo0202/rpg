alter table public.character_inventory add column custom_values jsonb not null default '{}'::jsonb
  check(jsonb_typeof(custom_values)='object' and octet_length(custom_values::text)<=32768);

create function private.validate_inventory_custom_values() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare definitions jsonb; definition jsonb; field_id text; field_value jsonb; kind text;
begin
  select coalesce(t.schema->'inventory_schema','[]'::jsonb) into definitions
    from public.character_sheets s join public.system_templates t on t.id=s.template_id and t.campaign_id=s.campaign_id
    where s.id=new.sheet_id and s.campaign_id=new.campaign_id and t.status='approved';
  if definitions is null then raise exception 'approved inventory schema required' using errcode='23514'; end if;
  if jsonb_typeof(definitions)<>'array' then raise exception 'invalid inventory schema' using errcode='23514'; end if;
  if jsonb_array_length(definitions)>200 or exists(select 1 from jsonb_array_elements(definitions) item
    where item->>'kind' not in ('number','text','select','checkbox','collection') or item->>'private'='true'
      or (item ? 'depends_on' and item->'depends_on'<>'null'::jsonb))
  then raise exception 'unsupported inventory schema' using errcode='23514'; end if;
  if (select count(*) from jsonb_object_keys(new.custom_values))>200 then raise exception 'too many custom fields' using errcode='23514'; end if;
  for field_id,field_value in select key,value from jsonb_each(new.custom_values) loop
    select item into definition from jsonb_array_elements(definitions) item where item->>'id'=field_id;
    if definition is null then raise exception 'unknown inventory field' using errcode='23514'; end if;
    kind:=definition->>'kind';
    if kind in ('text','select') then
      if jsonb_typeof(field_value)<>'string' or char_length(field_value#>>'{}')>10000 then raise exception 'invalid inventory text' using errcode='23514'; end if;
      if kind='select' and not ((definition->'options') @> jsonb_build_array(field_value)) then raise exception 'invalid inventory option' using errcode='23514'; end if;
    elsif kind='number' then
      if jsonb_typeof(field_value)<>'number' then raise exception 'invalid inventory number' using errcode='23514'; end if;
      if abs((field_value#>>'{}')::numeric)>1000000
         or (definition->>'min' is not null and (field_value#>>'{}')::numeric<(definition->>'min')::numeric)
         or (definition->>'max' is not null and (field_value#>>'{}')::numeric>(definition->>'max')::numeric)
      then raise exception 'inventory number outside allowed range' using errcode='23514'; end if;
    elsif kind='checkbox' then
      if jsonb_typeof(field_value)<>'boolean' then raise exception 'invalid inventory checkbox' using errcode='23514'; end if;
    elsif kind='collection' then
      if jsonb_typeof(field_value)<>'array' then raise exception 'invalid inventory list' using errcode='23514'; end if;
      if jsonb_array_length(field_value)>200 or exists(select 1 from jsonb_array_elements(field_value) part where jsonb_typeof(part)<>'string' or char_length(part#>>'{}')>500)
      then raise exception 'invalid inventory list' using errcode='23514'; end if;
    else raise exception 'unsupported inventory field' using errcode='23514';
    end if;
  end loop;
  for definition in select value from jsonb_array_elements(definitions) loop
    if definition->>'required'='true' then
      field_value:=new.custom_values->(definition->>'id');
      if field_value is null or field_value='null'::jsonb
         or (jsonb_typeof(field_value)='string' and btrim(field_value#>>'{}')='')
         or field_value='[]'::jsonb
         or (definition->>'kind'='checkbox' and field_value<>'true'::jsonb)
      then raise exception 'required inventory field missing' using errcode='23514'; end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.validate_inventory_custom_values() from public;
create trigger character_inventory_custom_validation before insert or update on public.character_inventory
  for each row execute function private.validate_inventory_custom_values();

create or replace function private.mobile_sync_field_allowlist(p_entity text)
returns text[] language sql immutable set search_path=pg_catalog as $$
select case p_entity
  when 'campaigns' then array['name','description']::text[]
  when 'system_templates' then array['name','schema','page_references']::text[]
  when 'character_sheets' then array['template_id','name','values']::text[]
  when 'character_inventory' then array['sheet_id','name','category','quantity','resource_cost','damage_bonus','protection','notes','acquired','equipped','sort_order','custom_values']::text[]
  when 'world_entities' then array['kind','name','body']::text[]
  when 'world_relations' then array['from_entity_id','to_entity_id','relation_type','notes']::text[]
  when 'maps' then array['name','document','grid_kind','isometric']::text[]
  when 'map_pins' then array['map_id','entity_id','label','x','y']::text[]
  when 'campaign_sessions' then array['sequence','title','summary','status','played_on']::text[]
  when 'campaign_factions' then array['name','description','goal','tension','limit','consequence']::text[]
  when 'campaign_events' then array['session_id','faction_id','title','description','occurred_on','status']::text[]
  when 'combat_sessions' then array['map_id','title','state','active']::text[]
  else null::text[] end;
$$;

-- Preserve custom item values when restoring a portable sheet backup.
create or replace function public.restore_character_backup(p_campaign_id uuid,p_template_id uuid,p_backup jsonb)
returns public.character_sheets
language plpgsql security invoker set search_path=pg_catalog,public,auth as $$
declare template_schema jsonb; result public.character_sheets; inventory jsonb; item jsonb;
begin
  if auth.uid() is null then raise exception 'session required' using errcode='42501'; end if;
  if p_backup is null or jsonb_typeof(p_backup)<>'object' or octet_length(p_backup::text)>1048576
    or p_backup->>'format' is distinct from 'rpg-nexus-sheet'
    or p_backup->>'format_version' is distinct from '1'
    or jsonb_typeof(p_backup->'name') is distinct from 'string'
    or jsonb_typeof(p_backup->'values') is distinct from 'object'
    or jsonb_typeof(p_backup->'effects') is distinct from 'array' then
    raise exception 'invalid backup format';
  end if;
  select schema into template_schema from public.system_templates
    where id=p_template_id and campaign_id=p_campaign_id and status='approved';
  if not found or jsonb_typeof(template_schema->'fields') is distinct from 'array'
    or jsonb_typeof(p_backup->'template'->'fields') is distinct from 'array'
    or public.normalize_sheet_backup_fields(template_schema->'fields')
      is distinct from public.normalize_sheet_backup_fields(p_backup->'template'->'fields') then
    raise exception 'an identical approved campaign template is required';
  end if;
  inventory:=coalesce(p_backup->'inventory','[]'::jsonb);
  if jsonb_typeof(inventory)<>'array' or jsonb_array_length(inventory)>500 then raise exception 'invalid inventory'; end if;
  perform set_config('rpg.restoring_backup','on',true);
  insert into public.character_sheets(campaign_id,template_id,owner_id,name,values,effects)
    values(p_campaign_id,p_template_id,auth.uid(),p_backup->>'name',p_backup->'values',p_backup->'effects') returning * into result;
  perform set_config('rpg.restoring_backup','off',true);
  for item in select value from jsonb_array_elements(inventory) loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'name') is distinct from 'string'
      or jsonb_typeof(item->'notes') is distinct from 'string'
      or jsonb_typeof(item->'acquired') is distinct from 'boolean'
      or jsonb_typeof(item->'equipped') is distinct from 'boolean' then raise exception 'invalid inventory item'; end if;
    insert into public.character_inventory(sheet_id,campaign_id,name,category,quantity,resource_cost,damage_bonus,protection,notes,acquired,equipped,sort_order,custom_values)
      values(result.id,p_campaign_id,item->>'name',item->>'category',(item->>'quantity')::integer,(item->>'resource_cost')::integer,
        (item->>'damage_bonus')::integer,(item->>'protection')::integer,item->>'notes',(item->>'acquired')::boolean,(item->>'equipped')::boolean,(item->>'sort_order')::integer,coalesce(item->'custom_values','{}'::jsonb));
  end loop;
  return result;
end;
$$;
revoke all on function public.restore_character_backup(uuid,uuid,jsonb) from public,anon;
grant execute on function public.restore_character_backup(uuid,uuid,jsonb) to authenticated;

-- Keep DTOs explicit when new columns are added to shared tables.
create or replace function private.mobile_sync_record_dto(p_entity text,p_record jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select case when p_record is null then null else jsonb_build_object(
    'entity_type',p_entity,'entity_id',p_record->'id',
    'version',coalesce(p_record->'sync_version','1'::jsonb),
    'data',coalesce((select jsonb_object_agg(key,value) from jsonb_each(p_record)
      where key=any(case p_entity
      when 'campaigns' then array['created_at','description','id','name','owner_id','updated_at']::text[]
      when 'character_inventory' then array['acquired','campaign_id','category','custom_values','damage_bonus','equipped','id','name','notes','protection','quantity','resource_cost','sheet_id','sort_order','updated_at','version']::text[]
      when 'system_templates' then array['approved_at','campaign_id','created_at','id','name','owner_id','page_references','schema','source_id','status','version']::text[]
      when 'character_sheets' then array['campaign_id','effects','id','name','owner_id','template_id','updated_at','values','version']::text[]
      when 'world_entities' then array['body','campaign_id','created_at','created_by','id','kind','name','updated_at','version']::text[]
      when 'world_relations' then array['campaign_id','created_by','from_entity_id','id','notes','relation_type','to_entity_id']::text[]
      when 'maps' then array['campaign_id','created_by','document','grid_kind','id','isometric','name','updated_at','version']::text[]
      when 'map_pins' then array['campaign_id','entity_id','id','label','map_id','x','y']::text[]
      when 'combat_sessions' then array['active','campaign_id','created_at','created_by','id','map_id','state','title','version']::text[]
      when 'campaign_sessions' then array['campaign_id','created_at','id','played_on','sequence','status','summary','title','updated_at']::text[]
      when 'campaign_factions' then array['campaign_id','consequence','created_at','description','goal','id','limit','name','tension','updated_at','version']::text[]
      when 'campaign_events' then array['campaign_id','created_at','description','faction_id','id','occurred_on','session_id','status','title','updated_at']::text[]
      else array[]::text[] end)), '{}'::jsonb)) end;
$$;
