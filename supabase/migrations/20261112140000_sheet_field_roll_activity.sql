-- Log approved roll-field execution without claiming unrelated numeric trait use.
create function public.rpg_record_sheet_field_roll(
  p_sheet_id uuid, p_field_id text, p_roll_key text, p_expression text, p_campaign_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  sheet public.character_sheets;
  template public.system_templates;
  field jsonb;
  previous public.chronicle_activity;
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'session required' using errcode='42501'; end if;
  if p_roll_key is null or char_length(p_roll_key) not between 1 and 120
    or p_field_id is null or p_field_id !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'invalid roll context' using errcode='22023';
  end if;
  select * into sheet from public.character_sheets where id=p_sheet_id;
  if not found or not private.is_campaign_member(sheet.campaign_id)
    or (p_campaign_id is not null and p_campaign_id<>sheet.campaign_id) then
    return jsonb_build_object('status','not_in_campaign');
  end if;
  if not private.can_write_sheet(sheet) then return jsonb_build_object('status','not_allowed'); end if;
  select * into template from public.system_templates where id=sheet.template_id and campaign_id=sheet.campaign_id;
  if not found or template.status::text<>'approved' then return jsonb_build_object('status','unapproved_template'); end if;
  select value into field from jsonb_array_elements(coalesce(template.schema->'fields','[]'::jsonb))
    where value->>'id'=p_field_id and value->>'kind'='roll';
  if not found then return jsonb_build_object('status','no_traits'); end if;
  if field->>'expression' is distinct from p_expression then return jsonb_build_object('status','unapproved_template'); end if;
  perform pg_advisory_xact_lock(hashtextextended('chronicle-activity:'||sheet.campaign_id::text,0));
  select * into previous from public.chronicle_activity where campaign_id=sheet.campaign_id and roll_key=p_roll_key;
  if found then
    if previous.sheet_id<>sheet.id then return jsonb_build_object('status','not_allowed'); end if;
    return jsonb_build_object('status','duplicate','activity_id',previous.id);
  end if;
  if (select count(*) from public.chronicle_activity where campaign_id=sheet.campaign_id)>=500 then
    return jsonb_build_object('status','limit_reached');
  end if;
  insert into public.chronicle_activity(campaign_id,sheet_id,occurred_on,used_trait_ids,created_by,source,roll_key)
    values(sheet.campaign_id,sheet.id,current_date,'{}'::text[],auth.uid(),'roll',p_roll_key) returning id into new_id;
  return jsonb_build_object('status','recorded','activity_id',new_id);
end;
$$;
revoke all on function public.rpg_record_sheet_field_roll(uuid,text,text,text,uuid) from public,anon;
grant execute on function public.rpg_record_sheet_field_roll(uuid,text,text,text,uuid) to authenticated;
