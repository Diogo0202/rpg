-- Frente J: structured text limits on template fields and persisted Hunter cells (ATL-04).
--
-- 1. Template fields may declare max_length (text, or each collection item), min_items,
--    max_items and item_options (collections) and paired_with (two text fields filled
--    together). Mirrors backend/app/models.py TemplateField and app/services/sheet_values.py.
--    They are separate triggers so the creation-rule functions other migrations redefine stay
--    untouched. Approved templates without these keys are unaffected: old sheets keep working.
-- 2. Hunter cells: a campaign cell with name, Danger/Desperation, notes, member sheets,
--    antagonists/targets and bonds. Campaign members read; the owner and masters edit.

create or replace function private.validate_template_text_constraints(p_schema jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  field_definition jsonb;
  kind text;
  partner text;
begin
  for field_definition in select value from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) loop
    kind := field_definition ->> 'kind';
    if field_definition ? 'max_length' and jsonb_typeof(field_definition -> 'max_length') <> 'null' then
      if kind not in ('text', 'collection') or jsonb_typeof(field_definition -> 'max_length') <> 'number'
         or (field_definition ->> 'max_length')::numeric <> trunc((field_definition ->> 'max_length')::numeric)
         or (field_definition ->> 'max_length')::numeric not between 1 and 10000 then
        raise exception 'invalid max_length on field %', field_definition ->> 'id' using errcode = '22023';
      end if;
    end if;
    if (field_definition ? 'min_items' and jsonb_typeof(field_definition -> 'min_items') <> 'null')
       or (field_definition ? 'max_items' and jsonb_typeof(field_definition -> 'max_items') <> 'null')
       or (field_definition ? 'item_options' and jsonb_typeof(field_definition -> 'item_options') <> 'null') then
      if kind <> 'collection'
         or (jsonb_typeof(field_definition -> 'min_items') is not null and jsonb_typeof(field_definition -> 'min_items') not in ('number', 'null'))
         or (jsonb_typeof(field_definition -> 'max_items') is not null and jsonb_typeof(field_definition -> 'max_items') not in ('number', 'null'))
         or (jsonb_typeof(field_definition -> 'min_items') = 'number' and (field_definition ->> 'min_items')::numeric not between 0 and 200)
         or (jsonb_typeof(field_definition -> 'max_items') = 'number' and (field_definition ->> 'max_items')::numeric not between 0 and 200)
         or (jsonb_typeof(field_definition -> 'min_items') = 'number' and jsonb_typeof(field_definition -> 'max_items') = 'number'
             and (field_definition ->> 'min_items')::numeric > (field_definition ->> 'max_items')::numeric)
         or (jsonb_typeof(field_definition -> 'item_options') = 'array' and (
               jsonb_array_length(field_definition -> 'item_options') > 100
               or exists (select 1 from jsonb_array_elements(field_definition -> 'item_options') as o(value)
                           where jsonb_typeof(o.value) <> 'string' or char_length(o.value #>> '{}') not between 1 and 160)
               or (select count(distinct o.value) from jsonb_array_elements(field_definition -> 'item_options') as o(value))
                  <> jsonb_array_length(field_definition -> 'item_options')))
         or (jsonb_typeof(field_definition -> 'item_options') not in ('array', 'null')) then
        raise exception 'invalid item limits on field %', field_definition ->> 'id' using errcode = '22023';
      end if;
    end if;
    if field_definition ? 'paired_with' and jsonb_typeof(field_definition -> 'paired_with') <> 'null' then
      partner := field_definition ->> 'paired_with';
      if kind <> 'text' or jsonb_typeof(field_definition -> 'paired_with') <> 'string' or partner = field_definition ->> 'id'
         or not exists (select 1 from jsonb_array_elements(p_schema -> 'fields') as f(value)
                         where f.value ->> 'id' = partner and f.value ->> 'kind' = 'text') then
        raise exception 'invalid paired_with on field %', field_definition ->> 'id' using errcode = '22023';
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function private.validate_template_text_constraints(jsonb) from public;
grant execute on function private.validate_template_text_constraints(jsonb) to authenticated;

create or replace function private.validate_system_template_text_constraints()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
begin
  perform private.validate_template_text_constraints(new.schema);
  return new;
end;
$$;
revoke all on function private.validate_system_template_text_constraints() from public;
create trigger system_templates_validate_text_constraints
  before insert or update of schema on public.system_templates
  for each row execute function private.validate_system_template_text_constraints();

-- Field ids whose values break the template's text limits; empty when the values pass.
create or replace function private.sheet_text_constraint_violations(p_schema jsonb, p_values jsonb)
returns text[]
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  field_definition jsonb;
  field_value jsonb;
  item_count integer;
  violations text[] := array[]::text[];
  filled boolean;
  partner_value jsonb;
begin
  for field_definition in select value from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) loop
    field_value := p_values -> (field_definition ->> 'id');
    if field_value is null then continue; end if;
    if jsonb_typeof(field_value) = 'string' then
      if jsonb_typeof(field_definition -> 'max_length') = 'number'
         and char_length(field_value #>> '{}') > (field_definition ->> 'max_length')::integer then
        violations := array_append(violations, field_definition ->> 'id');
        continue;
      end if;
      filled := btrim(field_value #>> '{}') <> '';
      if filled and jsonb_typeof(field_definition -> 'paired_with') = 'string' then
        partner_value := p_values -> (field_definition ->> 'paired_with');
        if partner_value is null or jsonb_typeof(partner_value) <> 'string' or btrim(partner_value #>> '{}') = '' then
          violations := array_append(violations, field_definition ->> 'id');
        end if;
      end if;
    elsif jsonb_typeof(field_value) = 'array' then
      item_count := jsonb_array_length(field_value);
      if (jsonb_typeof(field_definition -> 'max_length') = 'number' and exists (
            select 1 from jsonb_array_elements(field_value) as i(value)
             where jsonb_typeof(i.value) = 'string' and char_length(i.value #>> '{}') > (field_definition ->> 'max_length')::integer))
         or (item_count > 0 and jsonb_typeof(field_definition -> 'min_items') = 'number' and item_count < (field_definition ->> 'min_items')::integer)
         or (jsonb_typeof(field_definition -> 'max_items') = 'number' and item_count > (field_definition ->> 'max_items')::integer)
         or (jsonb_typeof(field_definition -> 'item_options') = 'array' and (
               exists (select 1 from jsonb_array_elements(field_value) as i(value)
                        where not (field_definition -> 'item_options') @> jsonb_build_array(i.value))
               or (select count(distinct i.value) from jsonb_array_elements(field_value) as i(value)) <> item_count)) then
        violations := array_append(violations, field_definition ->> 'id');
      end if;
    end if;
  end loop;
  return violations;
end;
$$;
revoke all on function private.sheet_text_constraint_violations(jsonb, jsonb) from public;
grant execute on function private.sheet_text_constraint_violations(jsonb, jsonb) to authenticated;

create or replace function private.validate_sheet_text_constraints()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  template_schema jsonb;
  violations text[];
begin
  select schema into template_schema from public.system_templates
   where id = new.template_id and campaign_id = new.campaign_id;
  if template_schema is null then return new; end if;
  violations := private.sheet_text_constraint_violations(template_schema, new.values);
  if cardinality(violations) > 0 then
    raise exception 'text limits violated: %', array_to_string(violations, ', ') using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_sheet_text_constraints() from public;
create trigger character_sheets_validate_text_constraints
  before insert or update of values on public.character_sheets
  for each row execute function private.validate_sheet_text_constraints();

-- ATL-04: Hunter cells.
create table public.hunter_cells (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  danger smallint not null default 0 check (danger between 0 and 5),
  desperation smallint not null default 0 check (desperation between 0 and 5),
  notes text not null default '' check (char_length(notes) <= 4000),
  version integer not null default 1 check (version > 0),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, campaign_id),
  unique (campaign_id, name)
);
create index hunter_cells_campaign_idx on public.hunter_cells(campaign_id, updated_at desc);

create table public.hunter_cell_members (
  cell_id uuid not null,
  campaign_id uuid not null,
  sheet_id uuid not null,
  role text not null default '' check (char_length(role) <= 80),
  created_at timestamptz not null default now(),
  primary key (cell_id, sheet_id),
  foreign key (cell_id, campaign_id) references public.hunter_cells(id, campaign_id) on delete cascade,
  -- The sheet must belong to the same campaign as the cell.
  foreign key (sheet_id, campaign_id) references public.character_sheets(id, campaign_id) on delete cascade
);
create index hunter_cell_members_sheet_idx on public.hunter_cell_members(sheet_id);

create table public.hunter_cell_targets (
  id uuid primary key default gen_random_uuid(),
  cell_id uuid not null,
  campaign_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  kind text not null default 'antagonista' check (kind in ('antagonista', 'alvo')),
  status text not null default 'ativo' check (status in ('ativo', 'vigiado', 'neutralizado', 'fugitivo')),
  threat smallint not null default 1 check (threat between 0 and 5),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, cell_id),
  foreign key (cell_id, campaign_id) references public.hunter_cells(id, campaign_id) on delete cascade
);
create index hunter_cell_targets_cell_idx on public.hunter_cell_targets(cell_id);

-- A bond goes from a member sheet to another member or to a target of the same cell.
create table public.hunter_cell_bonds (
  id uuid primary key default gen_random_uuid(),
  cell_id uuid not null,
  campaign_id uuid not null,
  from_sheet_id uuid not null,
  to_sheet_id uuid,
  to_target_id uuid,
  kind text not null check (kind in ('confianca', 'divida', 'rivalidade', 'juramento', 'suspeita', 'protecao')),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  check ((to_sheet_id is null) <> (to_target_id is null)),
  check (to_sheet_id is distinct from from_sheet_id),
  foreign key (cell_id, campaign_id) references public.hunter_cells(id, campaign_id) on delete cascade,
  foreign key (cell_id, from_sheet_id) references public.hunter_cell_members(cell_id, sheet_id) on delete cascade,
  foreign key (cell_id, to_sheet_id) references public.hunter_cell_members(cell_id, sheet_id) on delete cascade,
  foreign key (to_target_id, cell_id) references public.hunter_cell_targets(id, cell_id) on delete cascade
);
create index hunter_cell_bonds_cell_idx on public.hunter_cell_bonds(cell_id);

create or replace function private.touch_hunter_cell()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.campaign_id is distinct from old.campaign_id then
      raise exception 'hunter cell identity cannot change';
    end if;
    new.version := old.version + 1;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_hunter_cell() from public, anon, authenticated;
create trigger hunter_cells_touch_version
  before insert or update on public.hunter_cells
  for each row execute function private.touch_hunter_cell();

create or replace function private.touch_hunter_cell_target()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and (new.cell_id is distinct from old.cell_id or new.campaign_id is distinct from old.campaign_id) then
    raise exception 'hunter cell target cannot move';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_hunter_cell_target() from public, anon, authenticated;
create trigger hunter_cell_targets_touch
  before insert or update on public.hunter_cell_targets
  for each row execute function private.touch_hunter_cell_target();

do $$
declare
  table_name text;
begin
  foreach table_name in array array['hunter_cells', 'hunter_cell_members', 'hunter_cell_targets', 'hunter_cell_bonds'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated using (private.is_campaign_member(campaign_id))', table_name);
    execute format('create policy "managers manage %1$s" on public.%1$I for all to authenticated using (private.can_manage_campaign(campaign_id)) with check (private.can_manage_campaign(campaign_id))', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('revoke all on public.%I from anon', table_name);
  end loop;
end;
$$;
