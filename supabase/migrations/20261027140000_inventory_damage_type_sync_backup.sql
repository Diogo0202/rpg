-- INV-06 follow-up: the weapon damage kind (character_inventory.damage_type,
-- added in 20261026140000) travels through mobile sync and portable backups.
-- Backups written before this column existed omit the key and restore as
-- 'superficial', the column default.

create or replace function private.mobile_sync_field_allowlist(p_entity text)
returns text[] language sql immutable set search_path=pg_catalog as $$
select case p_entity
  when 'campaigns' then array['name','description']::text[]
  when 'system_templates' then array['name','schema','page_references']::text[]
  when 'character_sheets' then array['template_id','name','values']::text[]
  when 'character_inventory' then array['sheet_id','name','category','quantity','resource_cost','damage_bonus','damage_type','protection','notes','acquired','equipped','sort_order','custom_values']::text[]
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

create or replace function private.mobile_sync_record_dto(p_entity text,p_record jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select case when p_record is null then null else jsonb_build_object(
    'entity_type',p_entity,'entity_id',p_record->'id',
    'version',coalesce(p_record->'sync_version','1'::jsonb),
    'data',coalesce((select jsonb_object_agg(key,value) from jsonb_each(p_record)
      where key=any(case p_entity
      when 'campaigns' then array['created_at','description','id','name','owner_id','updated_at']::text[]
      when 'character_inventory' then array['acquired','campaign_id','category','custom_values','damage_bonus','damage_type','equipped','id','name','notes','protection','quantity','resource_cost','sheet_id','sort_order','updated_at','version']::text[]
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

-- Same contract as 20261025120000, plus the optional damage_type per item.
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
      or jsonb_typeof(item->'equipped') is distinct from 'boolean'
      or (item ? 'damage_type' and coalesce(item->>'damage_type','') not in ('superficial','aggravated')) then
      raise exception 'invalid inventory item';
    end if;
    insert into public.character_inventory(sheet_id,campaign_id,name,category,quantity,resource_cost,damage_bonus,damage_type,protection,notes,acquired,equipped,sort_order,custom_values)
      values(result.id,p_campaign_id,item->>'name',item->>'category',(item->>'quantity')::integer,(item->>'resource_cost')::integer,
        (item->>'damage_bonus')::integer,coalesce(item->>'damage_type','superficial'),(item->>'protection')::integer,item->>'notes',
        (item->>'acquired')::boolean,(item->>'equipped')::boolean,(item->>'sort_order')::integer,coalesce(item->'custom_values','{}'::jsonb));
  end loop;
  return result;
end;
$$;
revoke all on function public.restore_character_backup(uuid,uuid,jsonb) from public,anon;
grant execute on function public.restore_character_backup(uuid,uuid,jsonb) to authenticated;
