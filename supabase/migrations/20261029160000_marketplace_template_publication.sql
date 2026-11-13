-- A creator may publish only a model approved in a campaign they manage.
create or replace function public.marketplace_managed_campaigns()
returns table (id uuid, name text)
language plpgsql stable security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  return query
    select campaign.id, campaign.name from public.campaigns campaign
     where private.can_manage_campaign(campaign.id)
     order by campaign.name, campaign.id
     limit 200;
end;
$$;
revoke all on function public.marketplace_managed_campaigns() from public, anon;
grant execute on function public.marketplace_managed_campaigns() to authenticated;

create or replace function public.marketplace_publishable_templates()
returns table (id uuid, campaign_id uuid, campaign_name text, name text, version integer)
language plpgsql stable security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  return query
    select template.id, template.campaign_id, campaign.name, template.name, template.version
      from public.system_templates template
      join public.campaigns campaign on campaign.id = template.campaign_id
     where template.status = 'approved'
       and private.can_manage_campaign(template.campaign_id)
     order by template.created_at desc, template.id
     limit 200;
end;
$$;
revoke all on function public.marketplace_publishable_templates() from public, anon;
grant execute on function public.marketplace_publishable_templates() to authenticated;

create or replace function public.marketplace_export_template(p_template_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  source public.system_templates%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into source from public.system_templates
   where id = p_template_id and status = 'approved';
  if not found then
    raise exception 'template unavailable' using errcode = '42501';
  end if;
  if not private.can_manage_campaign(source.campaign_id) then
    raise exception 'template unavailable' using errcode = '42501';
  end if;
  return source.schema;
end;
$$;
revoke all on function public.marketplace_export_template(uuid) from public, anon;
grant execute on function public.marketplace_export_template(uuid) to authenticated;

create or replace function public.marketplace_pending_imports(p_campaign_id uuid)
returns table (id uuid, name text, version integer, schema jsonb, source_name text, source_status text)
language plpgsql stable security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
  if auth.uid() is null or not private.can_manage_campaign(p_campaign_id) then
    raise exception 'campaign manager required' using errcode = '42501';
  end if;
  return query
    select template.id, template.name, template.version, template.schema,
           source.name, source.status
      from public.marketplace_clone_operations operation
      join public.system_templates template on template.id = operation.template_id
      join public.marketplace_systems source on source.id = operation.system_id
     where operation.campaign_id = p_campaign_id
       and template.campaign_id = p_campaign_id
       and template.status = 'needs_review'
     order by operation.created_at desc, operation.id desc
     limit 100;
end;
$$;
revoke all on function public.marketplace_pending_imports(uuid) from public, anon;
grant execute on function public.marketplace_pending_imports(uuid) to authenticated;

create or replace function public.marketplace_import_review(p_campaign_id uuid, p_template_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not private.can_manage_campaign(p_campaign_id) then
    raise exception 'campaign manager required' using errcode = '42501';
  end if;
  select jsonb_build_object('id', template.id, 'name', template.name, 'version', template.version,
                            'schema', template.schema, 'status', template.status,
                            'source_name', source.name, 'source_status', source.status)
    into result
    from public.marketplace_clone_operations operation
    join public.system_templates template on template.id = operation.template_id
    join public.marketplace_systems source on source.id = operation.system_id
   where operation.campaign_id = p_campaign_id
     and template.campaign_id = p_campaign_id
     and operation.template_id = p_template_id;
  if result is null then raise exception 'import unavailable' using errcode = '42501'; end if;
  return result;
end;
$$;
revoke all on function public.marketplace_import_review(uuid, uuid) from public, anon;
grant execute on function public.marketplace_import_review(uuid, uuid) to authenticated;

create or replace function public.marketplace_approve_import(
  p_campaign_id uuid, p_template_id uuid, p_expected_schema jsonb
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  imported public.system_templates%rowtype;
  source_status text;
begin
  if auth.uid() is null or not private.can_manage_campaign(p_campaign_id) then
    raise exception 'campaign manager required' using errcode = '42501';
  end if;
  select * into imported from public.system_templates
   where id = p_template_id and campaign_id = p_campaign_id for update;
  if not found then raise exception 'import unavailable' using errcode = '42501'; end if;
  select source.status into source_status
    from public.marketplace_clone_operations operation
    join public.marketplace_systems source on source.id = operation.system_id
   where operation.template_id = p_template_id and operation.campaign_id = p_campaign_id
   for share of source;
  if not found or source_status <> 'published' then
    raise exception 'source unavailable' using errcode = '42501';
  end if;
  if imported.schema is distinct from p_expected_schema then
    raise exception 'template changed during review' using errcode = '22023';
  end if;
  if imported.status = 'approved' then return imported.id; end if;
  if imported.status <> 'needs_review' then
    raise exception 'import unavailable' using errcode = '42501';
  end if;
  update public.system_templates set status = 'approved', approved_at = now()
   where id = imported.id;
  return imported.id;
end;
$$;
revoke all on function public.marketplace_approve_import(uuid, uuid, jsonb) from public, anon;
grant execute on function public.marketplace_approve_import(uuid, uuid, jsonb) to authenticated;

-- Keep the approved source version when copying it into a campaign.
create or replace function public.marketplace_clone(p_system_id uuid, p_campaign_id uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  actor uuid := auth.uid();
  source public.marketplace_systems%rowtype;
  prior public.marketplace_clone_operations%rowtype;
  new_id uuid := gen_random_uuid();
  new_name text;
  new_version integer;
  inserted public.system_templates%rowtype;
  operation_id bigint;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if not private.can_manage_campaign(p_campaign_id) then
    raise exception 'campaign manager required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(actor::text), hashtext(p_campaign_id::text || ':' || p_idempotency_key));
  select * into prior from public.marketplace_clone_operations
   where campaign_id = p_campaign_id and user_id = actor and idempotency_key = p_idempotency_key;
  if found then
    if prior.system_id <> p_system_id then raise exception 'idempotency key already used' using errcode = '22023'; end if;
    select * into inserted from public.system_templates where id = prior.template_id;
    return to_jsonb(inserted);
  end if;
  select * into source from public.marketplace_systems where id = p_system_id and status = 'published' for share;
  if not found then raise exception 'system unavailable' using errcode = 'P0001'; end if;
  new_name := left(source.name, 96) || ' [community-' || left(new_id::text, 8) || ']';
  new_version := coalesce((source.template ->> 'version')::integer, 1);
  insert into public.system_templates(id, campaign_id, owner_id, name, version, status, schema)
    values (new_id, p_campaign_id, actor, new_name, new_version, 'needs_review',
            jsonb_set(source.template, '{name}', to_jsonb(new_name), true))
    returning * into inserted;
  insert into public.marketplace_clone_operations(system_id, campaign_id, user_id, idempotency_key, template_id)
    values (p_system_id, p_campaign_id, actor, p_idempotency_key, new_id)
    returning id into operation_id;
  insert into public.marketplace_usage_events(system_id, clone_operation_id) values (p_system_id, operation_id);
  return to_jsonb(inserted);
end;
$$;
revoke all on function public.marketplace_clone(uuid, uuid, text) from public;
grant execute on function public.marketplace_clone(uuid, uuid, text) to authenticated;
