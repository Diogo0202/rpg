-- Persistência de fichas modulares por campanha.
-- A definição dos campos vive em system_templates.schema.fields e os valores
-- permanecem indexados pelo id do campo em character_sheets.values.

create or replace function private.is_campaign_player(target_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1 from public.campaign_members member
     where member.campaign_id = target_campaign
       and member.user_id = (select auth.uid())
       and member.role = 'player'
  );
$$;

revoke all on function private.is_campaign_player(uuid) from public;
grant execute on function private.is_campaign_player(uuid) to authenticated;

-- Players edit their own sheets, guests may read their own, and campaign
-- owners/masters can administer sheets for campaign members.
drop policy "sheet owner or master reads active campaign sheet" on public.character_sheets;
drop policy "sheet owner or master creates active campaign sheet" on public.character_sheets;
drop policy "sheet owner or master updates active campaign sheet" on public.character_sheets;
create policy "members and managers read campaign sheets"
  on public.character_sheets for select to authenticated
  using (
    (owner_id = (select auth.uid()) and private.is_campaign_member(campaign_id))
    or private.can_manage_campaign(campaign_id)
  );
create policy "players and managers create campaign sheets"
  on public.character_sheets for insert to authenticated
  with check (
    (owner_id = (select auth.uid()) and private.is_campaign_player(campaign_id))
    or private.can_manage_campaign(campaign_id)
  );
create policy "players and managers update campaign sheets"
  on public.character_sheets for update to authenticated
  using (
    (owner_id = (select auth.uid()) and private.is_campaign_player(campaign_id))
    or private.can_manage_campaign(campaign_id)
  )
  with check (
    (owner_id = (select auth.uid()) and private.is_campaign_player(campaign_id))
    or private.can_manage_campaign(campaign_id)
  );

create or replace function private.prevent_used_approved_template_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if old.status = 'approved'
     and exists (
       select 1 from public.character_sheets sheet
        where sheet.template_id = old.id
     )
     and (
       new.id is distinct from old.id
       or new.campaign_id is distinct from old.campaign_id
       or new.owner_id is distinct from old.owner_id
       or new.source_id is distinct from old.source_id
       or new.name is distinct from old.name
       or new.version is distinct from old.version
       or new.status is distinct from old.status
       or new.schema is distinct from old.schema
       or new.page_references is distinct from old.page_references
       or new.created_at is distinct from old.created_at
       or new.approved_at is distinct from old.approved_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'referenced approved templates are immutable; create a new template version';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_used_approved_template_mutation() from public;

create trigger system_templates_protect_referenced_approved
  before update on public.system_templates
  for each row execute function private.prevent_used_approved_template_mutation();

create or replace function private.validate_character_sheet_values()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  template_schema jsonb;
  template_status public.extraction_status;
  campaign_owner_id uuid;
  field_definition jsonb;
  field_id text;
  field_kind text;
  field_value jsonb;
begin
  select schema, status
    into template_schema, template_status
    from public.system_templates
   where id = new.template_id
     and campaign_id = new.campaign_id;

  if not found then
    raise exception 'template must belong to the character sheet campaign';
  end if;
  select owner_id into campaign_owner_id
    from public.campaigns
   where id = new.campaign_id;
  if campaign_owner_id is null or (
    new.owner_id <> campaign_owner_id
    and not exists (
      select 1 from public.campaign_members member
       where member.campaign_id = new.campaign_id
         and member.user_id = new.owner_id
    )
  ) then
    raise exception 'sheet owner must be a member of its campaign';
  end if;
  if template_status <> 'approved' then
    raise exception 'character sheets require an approved template';
  end if;
  if jsonb_typeof(template_schema -> 'fields') is distinct from 'array' then
    raise exception 'template schema must contain a fields array';
  end if;

  for field_definition in select field from jsonb_array_elements(template_schema -> 'fields') as fields(field)
  loop
    if field_definition ->> 'required' = 'true'
      and field_definition ->> 'kind' not in ('formula', 'roll')
      and not (new.values ? (field_definition ->> 'id')) then
      raise exception 'required field missing: %', field_definition ->> 'id';
    end if;
  end loop;

  for field_id, field_value in
    select key, value from jsonb_each(new.values)
  loop
    select field into field_definition
      from jsonb_array_elements(template_schema -> 'fields') as fields(field)
     where field ->> 'id' = field_id
     limit 1;
    if field_definition is null then
      raise exception 'unknown field id: %', field_id;
    end if;

    field_kind := field_definition ->> 'kind';
    if field_kind = 'text' and jsonb_typeof(field_value) <> 'string' then
      raise exception 'field % must be text', field_id;
    elsif field_kind = 'number' and jsonb_typeof(field_value) <> 'number' then
      raise exception 'field % must be numeric', field_id;
    elsif field_kind = 'select' and (
      jsonb_typeof(field_value) <> 'string'
      or not ((field_definition -> 'options') @> jsonb_build_array(field_value))
    ) then
      raise exception 'field % must match a template option', field_id;
    elsif field_kind = 'checkbox' and jsonb_typeof(field_value) <> 'boolean' then
      raise exception 'field % must be boolean', field_id;
    elsif field_kind = 'collection' and jsonb_typeof(field_value) <> 'array' then
      raise exception 'field % must be an array', field_id;
    elsif field_kind in ('formula', 'roll') and field_value <> 'null'::jsonb then
      raise exception 'calculated field % cannot be persisted as an input', field_id;
    elsif field_kind not in ('text', 'number', 'select', 'checkbox', 'collection', 'formula', 'roll') then
      raise exception 'unsupported field kind for %', field_id;
    end if;
  end loop;

  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.validate_character_sheet_values() from public;

drop trigger if exists character_sheets_campaign_scope on public.character_sheets;
create trigger character_sheets_validate_and_version
  before insert or update on public.character_sheets
  for each row execute function private.validate_character_sheet_values();

create index if not exists character_sheets_owner_campaign_updated_idx
  on public.character_sheets(owner_id, campaign_id, updated_at desc);

comment on column public.system_templates.schema is
  'Template modular versionado. Campos em schema.fields usam id estável para endereçar character_sheets.values.';
comment on column public.character_sheets.values is
  'Objeto JSON com valores indexados pelos ids definidos no schema.fields do template aprovado.';
