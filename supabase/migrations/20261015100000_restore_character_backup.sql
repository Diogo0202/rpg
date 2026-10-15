-- Restores create a new sheet owned by the caller. They cannot grant access or
-- publish a template; an identical approved template must already be visible.
create or replace function public.restore_character_backup(p_campaign_id uuid,p_template_id uuid,p_backup jsonb)
returns public.character_sheets
language plpgsql security invoker set search_path=pg_catalog,public,auth as $$
declare template_schema jsonb; result public.character_sheets; inventory jsonb; item jsonb; definition jsonb; input_value jsonb;
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
  if not found or template_schema->'fields' is distinct from p_backup->'template'->'fields' then
    raise exception 'an identical approved campaign template is required';
  end if;
  for definition in select value from jsonb_array_elements(template_schema->'fields') loop
    if definition->>'required'='true' and definition->>'kind' not in ('formula','roll') then
      input_value:=p_backup->'values'->(definition->>'id');
      if input_value is null or jsonb_typeof(input_value)='null'
        or (jsonb_typeof(input_value)='string' and btrim(input_value #>> '{}')='')
        or (jsonb_typeof(input_value)='array' and input_value='[]'::jsonb)
        or (definition->>'kind'='checkbox' and input_value<>'true'::jsonb) then
        raise exception 'required backup value missing';
      end if;
    end if;
  end loop;
  inventory:=coalesce(p_backup->'inventory','[]'::jsonb);
  if jsonb_typeof(inventory)<>'array' or jsonb_array_length(inventory)>500 then raise exception 'invalid inventory'; end if;
  insert into public.character_sheets(campaign_id,template_id,owner_id,name,values,effects)
    values(p_campaign_id,p_template_id,auth.uid(),p_backup->>'name',p_backup->'values',p_backup->'effects') returning * into result;
  for item in select value from jsonb_array_elements(inventory) loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'name') is distinct from 'string'
      or jsonb_typeof(item->'notes') is distinct from 'string'
      or jsonb_typeof(item->'acquired') is distinct from 'boolean'
      or jsonb_typeof(item->'equipped') is distinct from 'boolean' then raise exception 'invalid inventory item'; end if;
    insert into public.character_inventory(sheet_id,campaign_id,name,category,quantity,resource_cost,damage_bonus,protection,notes,acquired,equipped,sort_order)
      values(result.id,p_campaign_id,item->>'name',item->>'category',(item->>'quantity')::integer,(item->>'resource_cost')::integer,
        (item->>'damage_bonus')::integer,(item->>'protection')::integer,item->>'notes',(item->>'acquired')::boolean,(item->>'equipped')::boolean,(item->>'sort_order')::integer);
  end loop;
  return result;
end;
$$;
revoke all on function public.restore_character_backup(uuid,uuid,jsonb) from public,anon;
grant execute on function public.restore_character_backup(uuid,uuid,jsonb) to authenticated;
