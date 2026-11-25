-- Keep portrait paths in the campaign sync DTO and apply them through existing sheet policies.
create or replace function private.mobile_sync_field_allowlist(p_entity text)
returns text[] language sql immutable set search_path=pg_catalog as $$
select case p_entity
  when 'campaigns' then array['name','description']::text[]
  when 'system_templates' then array['name','schema','page_references']::text[]
  when 'character_sheets' then array['template_id','name','values','portrait_path']::text[]
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
      when 'character_sheets' then array['campaign_id','effects','id','name','owner_id','portrait_path','template_id','updated_at','values','version']::text[]
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


-- Portrait-only updates leave the sheet values and template unchanged, including
-- for sheets whose rules profile does not take part in mobile character creation.
do $migration$
declare
  definition text := replace(pg_get_functiondef('private.mobile_sync_apply_one(uuid,uuid,jsonb)'::regprocedure), E'\r\n', E'\n');
  sheet_update text := '  if entity=''character_sheets'' then' || E'\n' || '    select schema into model_schema';
  guarded_update text := $replace$  if entity='character_sheets' and not portrait_only then
    select schema into model_schema$replace$;
begin
  if position(sheet_update in definition)=0
     or position('  fields := allowed;' in definition)=0
     or position('  candidate := current_row;' in definition)=0 then
    raise exception 'mobile sync update statements changed';
  end if;
  definition := replace(definition, '  name_changed boolean := false;',
    '  name_changed boolean := false; portrait_only boolean := false;');
  definition := replace(definition, '  candidate := current_row;', $replace$  candidate := current_row;
  portrait_only := entity='character_sheets' and jsonb_array_length(changes)=1
    and changes->0->'path'='["portrait_path"]'::jsonb;$replace$);
  definition := replace(definition, sheet_update, guarded_update);
  definition := replace(definition, '  fields := allowed;', $replace$  fields := case
    when portrait_only then array['portrait_path']::text[]
    when entity='character_sheets' and not exists (
      select 1 from jsonb_array_elements(changes) item where item->'path'->>0='portrait_path'
    ) then array_remove(allowed,'portrait_path')
    else allowed end;$replace$);
  execute definition;
end;
$migration$;

-- Keep nullable DTO fields on live records, including a cleared portrait.
do $migration$
declare
  definition text := pg_get_functiondef('public.mobile_sync_changes(uuid,bigint,integer)'::regprocedure);
  old_event text := $old$jsonb_strip_nulls(jsonb_build_object('revision',item.revision,'entity_type',item.entity_type,'entity_id',item.entity_id,'version',item.entity_version,'action',item.action,'record',case when item.action='delete' then null else private.mobile_sync_record_dto(item.entity_type,row_data) end,'tombstone',case when item.action='delete' then true else null end))$old$;
  new_event text := $new$jsonb_build_object('revision',item.revision,'entity_type',item.entity_type,'entity_id',item.entity_id,'version',item.entity_version,'action',item.action)
          || case when item.action='delete' then jsonb_build_object('tombstone',true)
                  else jsonb_build_object('record',private.mobile_sync_record_dto(item.entity_type,row_data)) end$new$;
begin
  if position(old_event in definition)=0 then
    raise exception 'mobile sync change event changed';
  end if;
  execute replace(definition, old_event, new_event);
end;
$migration$;
