create table public.chronicle_goals (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sheet_id uuid not null,
  goal_type text not null check (goal_type in ('ambition', 'desire')),
  statement text not null check (char_length(btrim(statement)) between 1 and 500),
  target_id text not null check (char_length(btrim(target_id)) between 1 and 80),
  target_label text not null check (char_length(btrim(target_label)) between 1 and 120),
  polarity text not null check (polarity in ('pursues', 'prevents')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, campaign_id),
  foreign key (sheet_id, campaign_id) references public.character_sheets(id, campaign_id) on delete cascade
);

create table public.chronicle_supporters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sheet_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, campaign_id),
  foreign key (sheet_id, campaign_id) references public.character_sheets(id, campaign_id) on delete cascade
);

create table public.chronicle_defects (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sheet_id uuid not null,
  statement text not null check (char_length(btrim(statement)) between 1 and 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, campaign_id),
  foreign key (sheet_id, campaign_id) references public.character_sheets(id, campaign_id) on delete cascade
);

create table public.chronicle_activity (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sheet_id uuid not null,
  occurred_on date not null,
  used_trait_ids text[] not null default '{}',
  used_goal_ids uuid[] not null default '{}',
  used_defect_ids uuid[] not null default '{}',
  threatened_supporter_ids uuid[] not null default '{}',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (cardinality(used_trait_ids) <= 50),
  check (cardinality(used_goal_ids) <= 50),
  check (cardinality(used_defect_ids) <= 50),
  check (cardinality(threatened_supporter_ids) <= 50),
  foreign key (sheet_id, campaign_id) references public.character_sheets(id, campaign_id) on delete cascade
);

create index chronicle_goals_campaign_sheet_idx on public.chronicle_goals(campaign_id, sheet_id);
create index chronicle_supporters_campaign_sheet_idx on public.chronicle_supporters(campaign_id, sheet_id);
create index chronicle_defects_campaign_sheet_idx on public.chronicle_defects(campaign_id, sheet_id);
create index chronicle_activity_campaign_date_idx on public.chronicle_activity(campaign_id, occurred_on desc, id);

alter table public.chronicle_goals enable row level security;
alter table public.chronicle_supporters enable row level security;
alter table public.chronicle_defects enable row level security;
alter table public.chronicle_activity enable row level security;

revoke all on public.chronicle_goals, public.chronicle_supporters, public.chronicle_defects, public.chronicle_activity from public, anon, authenticated;
grant select, insert, delete on public.chronicle_goals, public.chronicle_supporters, public.chronicle_defects, public.chronicle_activity to authenticated;

create policy "campaign managers manage chronicle goals" on public.chronicle_goals
  for all to authenticated using (private.can_manage_campaign(campaign_id))
  with check (private.can_manage_campaign(campaign_id) and created_by = (select auth.uid()));
create policy "campaign managers manage chronicle supporters" on public.chronicle_supporters
  for all to authenticated using (private.can_manage_campaign(campaign_id))
  with check (private.can_manage_campaign(campaign_id) and created_by = (select auth.uid()));
create policy "campaign managers manage chronicle defects" on public.chronicle_defects
  for all to authenticated using (private.can_manage_campaign(campaign_id))
  with check (private.can_manage_campaign(campaign_id) and created_by = (select auth.uid()));
create policy "campaign managers manage chronicle activity" on public.chronicle_activity
  for all to authenticated using (private.can_manage_campaign(campaign_id))
  with check (private.can_manage_campaign(campaign_id) and created_by = (select auth.uid()));


-- Activity references must resolve inside the selected ficha, campaign and approved model.
create or replace function private.validate_chronicle_activity_refs()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sheet_template_id uuid;
  model_schema jsonb;
  ref_id uuid;
  ref_count integer;
begin
  select sheet.template_id, template.schema
    into sheet_template_id, model_schema
    from public.character_sheets sheet
    join public.system_templates template on template.id = sheet.template_id
   where sheet.id = new.sheet_id
     and sheet.campaign_id = new.campaign_id
     and template.status = 'approved';
  if not found then
    raise exception 'activity requires a ficha with an approved model in the campaign';
  end if;

  if exists (
    select 1 from unnest(new.used_trait_ids) as used(trait_id)
    where not exists (
      select 1 from jsonb_array_elements(coalesce(model_schema->'fields', '[]'::jsonb)) as field(definition)
      where definition->>'id' = used.trait_id and definition->>'kind' = 'number'
    )
  ) then raise exception 'activity trait must belong to the ficha model'; end if;

  foreach ref_id in array new.used_goal_ids loop
    select count(*) into ref_count from public.chronicle_goals
     where id = ref_id and sheet_id = new.sheet_id and campaign_id = new.campaign_id;
    if ref_count <> 1 then raise exception 'activity goal must belong to the ficha and campaign'; end if;
  end loop;
  foreach ref_id in array new.used_defect_ids loop
    select count(*) into ref_count from public.chronicle_defects
     where id = ref_id and sheet_id = new.sheet_id and campaign_id = new.campaign_id;
    if ref_count <> 1 then raise exception 'activity defect must belong to the ficha and campaign'; end if;
  end loop;
  foreach ref_id in array new.threatened_supporter_ids loop
    select count(*) into ref_count from public.chronicle_supporters
     where id = ref_id and sheet_id = new.sheet_id and campaign_id = new.campaign_id;
    if ref_count <> 1 then raise exception 'activity supporter must belong to the ficha and campaign'; end if;
  end loop;
  return new;
end;
$$;

create trigger chronicle_activity_validate_refs
  before insert or update on public.chronicle_activity
  for each row execute function private.validate_chronicle_activity_refs();

-- Block direct deletion of referenced profile entries. During a ficha or campaign
-- cascade the parent is already being removed, so its dependent rows can cascade too.
create or replace function private.protect_referenced_chronicle_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.character_sheets sheet
     where sheet.id = old.sheet_id and sheet.campaign_id = old.campaign_id
  ) and (
    (tg_table_name = 'chronicle_goals' and exists (
      select 1 from public.chronicle_activity activity
       where activity.sheet_id = old.sheet_id and activity.campaign_id = old.campaign_id
         and old.id = any(activity.used_goal_ids)
    )) or
    (tg_table_name = 'chronicle_defects' and exists (
      select 1 from public.chronicle_activity activity
       where activity.sheet_id = old.sheet_id and activity.campaign_id = old.campaign_id
         and old.id = any(activity.used_defect_ids)
    )) or
    (tg_table_name = 'chronicle_supporters' and exists (
      select 1 from public.chronicle_activity activity
       where activity.sheet_id = old.sheet_id and activity.campaign_id = old.campaign_id
         and old.id = any(activity.threatened_supporter_ids)
    ))
  ) then
    raise exception 'referenced chronicle profile entry cannot be deleted';
  end if;
  return old;
end;
$$;

create trigger chronicle_goals_protect_activity_refs before delete on public.chronicle_goals
  for each row execute function private.protect_referenced_chronicle_profile();
create trigger chronicle_defects_protect_activity_refs before delete on public.chronicle_defects
  for each row execute function private.protect_referenced_chronicle_profile();
create trigger chronicle_supporters_protect_activity_refs before delete on public.chronicle_supporters
  for each row execute function private.protect_referenced_chronicle_profile();
