-- Catálogo privado da campanha. O narrador registra apenas metadados curtos
-- após conferir sua fonte; descrições e páginas de livro não são copiadas.
create table public.demon_evocation_catalog (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  lore_field text not null check (lore_field ~ '^dou_[a-z_]{2,40}$'),
  required_rank smallint not null check (required_rank between 1 and 5),
  faith_cost smallint not null check (faith_cost between 1 and 10),
  source_title text not null check (char_length(btrim(source_title)) between 2 and 160),
  source_page integer not null check (source_page between 1 and 5000),
  verification_note text not null check (char_length(btrim(verification_note)) between 12 and 500),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (campaign_id, lore_field, name)
);
alter table public.demon_evocation_catalog enable row level security;
revoke all on public.demon_evocation_catalog from public, anon, authenticated;
grant select on public.demon_evocation_catalog to authenticated;
create policy "campaign members read verified demon powers" on public.demon_evocation_catalog
  for select to authenticated using (private.is_campaign_member(campaign_id) or private.can_manage_campaign(campaign_id));

create or replace function public.register_demon_evocation(
  p_campaign_id uuid, p_name text, p_lore_field text, p_required_rank integer,
  p_faith_cost integer, p_source_title text, p_source_page integer, p_verification_note text
) returns public.demon_evocation_catalog
language plpgsql security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  entry public.demon_evocation_catalog;
begin
  if auth.uid() is null or not private.can_manage_campaign(p_campaign_id) then
    raise exception 'campaign narrator required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.system_templates template
     where template.campaign_id = p_campaign_id and template.status = 'approved'
       and template.schema ->> 'system_key' = 'demon-the-fallen'
       and exists (
         select 1 from jsonb_array_elements(template.schema -> 'fields') field
          where field ->> 'id' = p_lore_field and field ->> 'kind' = 'number'
       )
  ) then
    raise exception 'approved Demon template with that lore is required' using errcode = '22023';
  end if;
  insert into public.demon_evocation_catalog (
    campaign_id, name, lore_field, required_rank, faith_cost,
    source_title, source_page, verification_note, reviewed_by
  ) values (
    p_campaign_id, btrim(p_name), p_lore_field, p_required_rank, p_faith_cost,
    btrim(p_source_title), p_source_page, btrim(p_verification_note), auth.uid()
  ) returning * into entry;
  return entry;
exception when check_violation or not_null_violation or numeric_value_out_of_range then
  raise exception 'invalid evocation metadata' using errcode = '22023';
end;
$$;
revoke all on function public.register_demon_evocation(uuid, text, text, integer, integer, text, integer, text) from public, anon;
grant execute on function public.register_demon_evocation(uuid, text, text, integer, integer, text, integer, text) to authenticated;

create table public.demon_evocation_activations (
  operation_id uuid primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  evocation_id uuid not null references public.demon_evocation_catalog(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  expected_version integer not null check (expected_version > 0),
  sheet_version integer not null check (sheet_version > expected_version),
  faith_cost smallint not null check (faith_cost between 1 and 10),
  faith_before smallint not null check (faith_before between 1 and 10),
  faith_after smallint not null check (faith_after between 0 and 10),
  sheet_event_id bigint references public.character_sheet_events(id) on delete set null,
  resolution text not null default 'awaiting_narrator' check (resolution = 'awaiting_narrator'),
  created_at timestamptz not null default now()
);
alter table public.demon_evocation_activations enable row level security;
revoke all on public.demon_evocation_activations from public, anon, authenticated;
grant select on public.demon_evocation_activations to authenticated;
create policy "sheet readers see demon activations" on public.demon_evocation_activations
  for select to authenticated using (
    exists (select 1 from public.character_sheets sheet where sheet.id = sheet_id)
  );

create or replace function public.activate_demon_evocation(
  p_sheet_id uuid, p_evocation_id uuid, p_operation_id uuid, p_expected_version integer
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  actor uuid := auth.uid();
  sheet public.character_sheets;
  power public.demon_evocation_catalog;
  prior public.demon_evocation_activations;
  spent jsonb;
  activation public.demon_evocation_activations;
  faith_before integer;
begin
  if actor is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_operation_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception 'operation and version required' using errcode = '22023';
  end if;
  select * into sheet from public.character_sheets where id = p_sheet_id for update;
  if not found or not (
    (sheet.owner_id = actor and private.is_campaign_member(sheet.campaign_id))
    or private.can_manage_campaign(sheet.campaign_id)
  ) then
    raise exception 'sheet not found or not writable' using errcode = '42501';
  end if;
  select * into prior from public.demon_evocation_activations where operation_id = p_operation_id;
  if found then
    if prior.sheet_id <> p_sheet_id or prior.evocation_id <> p_evocation_id
       or prior.actor_id <> actor or prior.expected_version <> p_expected_version then
      raise exception 'operation ID already used for another activation' using errcode = '23505';
    end if;
    return jsonb_build_object('activation', to_jsonb(prior), 'sheet', to_jsonb(sheet));
  end if;
  if sheet.version <> p_expected_version then
    raise exception 'sheet changed since version %', p_expected_version using errcode = '40001';
  end if;
  if not exists (
    select 1 from public.system_templates template
     where template.id = sheet.template_id and template.campaign_id = sheet.campaign_id
       and template.status = 'approved' and template.schema ->> 'system_key' = 'demon-the-fallen'
  ) then
    raise exception 'approved Demon sheet required' using errcode = '22023';
  end if;
  select * into power from public.demon_evocation_catalog
   where id = p_evocation_id and campaign_id = sheet.campaign_id;
  if not found then raise exception 'evocation not available in this campaign' using errcode = '22023'; end if;
  if jsonb_typeof(sheet.values -> power.lore_field) <> 'number'
     or (sheet.values ->> power.lore_field)::numeric <> trunc((sheet.values ->> power.lore_field)::numeric)
     or (sheet.values ->> power.lore_field)::numeric < power.required_rank then
    raise exception 'sheet lacks the required lore rank' using errcode = '22023';
  end if;
  if jsonb_typeof(sheet.values -> 'fe_atual') <> 'number' then
    raise exception 'sheet has no current Faith value' using errcode = '22023';
  end if;
  if (sheet.values ->> 'fe_atual')::numeric <> trunc((sheet.values ->> 'fe_atual')::numeric) then
    raise exception 'current Faith must be an integer' using errcode = '22023';
  end if;
  faith_before := (sheet.values ->> 'fe_atual')::integer;
  if faith_before < power.faith_cost then
    raise exception 'not enough Faith' using errcode = '23514';
  end if;
  spent := public.spend_meta_currency(sheet.id, 'fe', power.faith_cost, 'Evocação: ' || left(power.name, 120));
  insert into public.demon_evocation_activations (
    operation_id, campaign_id, sheet_id, evocation_id, actor_id, expected_version,
    sheet_version, faith_cost, faith_before, faith_after, sheet_event_id
  ) values (
    p_operation_id, sheet.campaign_id, sheet.id, power.id, actor, p_expected_version,
    (spent -> 'sheet' ->> 'version')::integer, power.faith_cost, faith_before,
    (spent -> 'sheet' -> 'values' ->> 'fe_atual')::integer,
    (spent -> 'event' ->> 'id')::bigint
  ) returning * into activation;
  return jsonb_build_object('activation', to_jsonb(activation), 'sheet', spent -> 'sheet');
end;
$$;
revoke all on function public.activate_demon_evocation(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.activate_demon_evocation(uuid, uuid, uuid, integer) to authenticated;
