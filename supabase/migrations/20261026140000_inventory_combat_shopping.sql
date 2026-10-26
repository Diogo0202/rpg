-- Frente E: equipment in combat, catalog favorites, shopping lists and
-- atomic V5 damage with automatic superficial -> aggravated conversion.

-- INV-06: weapons declare the kind of damage they deal.
alter table public.character_inventory add column damage_type text not null default 'superficial'
  check (damage_type in ('superficial', 'aggravated'));
comment on column public.character_inventory.damage_type is
  'Damage kind dealt by a weapon (V5 Superficial or Aggravated). Read by the attack roll on the server.';

-- Damage events share the append-only audit log.
alter table public.character_sheet_events drop constraint character_sheet_events_kind_check;
alter table public.character_sheet_events add constraint character_sheet_events_kind_check
  check (kind in ('adjust', 'experience', 'meta_currency', 'damage'));

create or replace function private.record_sheet_damage_event(
  p_sheet_id uuid, p_operation_id uuid, p_field_id text, p_delta integer,
  p_before numeric, p_after numeric, p_reason text
)
returns public.character_sheet_events
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  result public.character_sheet_events;
begin
  select * into sheet from public.character_sheets where id = p_sheet_id and updated_at = now();
  if not found or auth.uid() is null then
    raise exception 'events can only be recorded with a sheet write' using errcode = '42501';
  end if;
  if exists (select 1 from public.character_sheet_events existing
              where existing.sheet_id = p_sheet_id and existing.sheet_version = sheet.version) then
    raise exception 'sheet version already has an event' using errcode = '23505';
  end if;
  insert into public.character_sheet_events
    (sheet_id, campaign_id, actor_id, kind, field_id, delta, value_before, value_after, sheet_version, reason, operation_id)
  values
    (sheet.id, sheet.campaign_id, auth.uid(), 'damage', p_field_id, p_delta, p_before, p_after, sheet.version, p_reason, p_operation_id)
  returning * into result;
  return result;
end;
$$;
revoke all on function private.record_sheet_damage_event(uuid, uuid, text, integer, numeric, numeric, text) from public;
grant execute on function private.record_sheet_damage_event(uuid, uuid, text, integer, numeric, numeric, text) to authenticated;

-- MOD-07 + INV-06: applies incoming damage to the Health or Willpower track in
-- one locked transaction. Equipped armor (Health only) absorbs Superficial
-- damage first. Rules (V5): new damage fills empty boxes; with no empty box,
-- each new point (Superficial or Aggravated) turns one Superficial box into
-- Aggravated; with the track full of Aggravated, extra points are overflow.
-- Security invoker: the sheet lock and update go through the sheet RLS.
create or replace function public.apply_v5_damage(
  p_sheet_id uuid, p_track text, p_superficial integer, p_aggravated integer,
  p_apply_armor boolean default true, p_operation_id uuid default null, p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  template_schema jsonb;
  sup_field text;
  agg_field text;
  first_value jsonb;
  second_value jsonb;
  maximum integer;
  sup integer;
  agg integer;
  sup_before integer;
  agg_before integer;
  incoming_sup integer;
  incoming_agg integer;
  armor_id uuid;
  armor_name text;
  armor_protection integer;
  absorbed integer := 0;
  converted integer := 0;
  overflow integer := 0;
  prior public.character_sheet_events;
  event public.character_sheet_events;
  summary text;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  if p_track is null or p_track not in ('health', 'willpower') then
    raise exception 'track must be health or willpower' using errcode = '22023';
  end if;
  if p_superficial is null or p_aggravated is null or p_superficial not between 0 and 30
     or p_aggravated not between 0 and 30 or p_superficial + p_aggravated = 0 then
    raise exception 'damage must be between 0 and 30 per kind and not empty' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(p_reason) > 120 then
    raise exception 'reason must have at most 120 characters' using errcode = '22023';
  end if;

  select * into sheet from public.character_sheets where id = p_sheet_id for update;
  if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;

  if p_operation_id is not null then
    select * into prior from public.character_sheet_events
     where sheet_id = p_sheet_id and campaign_id = sheet.campaign_id and actor_id = auth.uid()
       and operation_id = p_operation_id;
    if found then
      if prior.kind <> 'damage' then
        raise exception 'operation ID was already used for another adjustment' using errcode = '23505';
      end if;
      return jsonb_build_object('sheet', to_jsonb(sheet), 'event', to_jsonb(prior), 'replayed', true);
    end if;
  end if;

  sup_field := case p_track when 'health' then 'saude_superficial' else 'vontade_superficial' end;
  agg_field := case p_track when 'health' then 'saude_agravada' else 'vontade_agravada' end;
  select schema into template_schema from public.system_templates
   where id = sheet.template_id and campaign_id = sheet.campaign_id and status = 'approved';
  if (select count(*) from jsonb_array_elements(coalesce(template_schema -> 'fields', '[]'::jsonb)) as fields(field)
       where field ->> 'id' in (sup_field, agg_field) and field ->> 'kind' = 'number') <> 2 then
    raise exception 'template has no % damage track', p_track using errcode = '22023';
  end if;

  -- Same maximum the client shows: Health = Stamina + 3, Willpower = Composure + Resolve.
  first_value := sheet.values -> case p_track when 'health' then 'vigor' else 'autocontrole' end;
  second_value := case p_track when 'health' then '3'::jsonb else sheet.values -> 'resolucao' end;
  if jsonb_typeof(first_value) is distinct from 'number' or jsonb_typeof(second_value) is distinct from 'number' then
    raise exception 'sheet has no values to size the % track', p_track using errcode = '22023';
  end if;
  maximum := least(30, greatest(0, trunc((first_value #>> '{}')::numeric)::integer + trunc((second_value #>> '{}')::numeric)::integer));
  if maximum = 0 then raise exception 'the % track is empty', p_track using errcode = '22023'; end if;

  sup := case when jsonb_typeof(sheet.values -> sup_field) = 'number' then greatest(0, trunc((sheet.values ->> sup_field)::numeric)::integer) else 0 end;
  agg := case when jsonb_typeof(sheet.values -> agg_field) = 'number' then greatest(0, trunc((sheet.values ->> agg_field)::numeric)::integer) else 0 end;
  -- A track that shrank (lower Stamina) keeps its Aggravated boxes first.
  agg := least(agg, maximum);
  sup := least(sup, maximum - agg);
  sup_before := sup;
  agg_before := agg;
  incoming_sup := p_superficial;
  incoming_agg := p_aggravated;

  if p_track = 'health' and coalesce(p_apply_armor, true) then
    select id, name, protection into armor_id, armor_name, armor_protection from public.character_inventory
     where sheet_id = sheet.id and campaign_id = sheet.campaign_id
       and category = 'armor' and equipped and acquired
     limit 1;
    if armor_id is not null then
      absorbed := least(armor_protection, incoming_sup);
      incoming_sup := incoming_sup - absorbed;
    end if;
  end if;

  for i in 1..incoming_agg loop
    if sup + agg < maximum then agg := agg + 1;
    elsif sup > 0 then sup := sup - 1; agg := agg + 1; converted := converted + 1;
    else overflow := overflow + 1;
    end if;
  end loop;
  for i in 1..incoming_sup loop
    if sup + agg < maximum then sup := sup + 1;
    elsif sup > 0 then sup := sup - 1; agg := agg + 1; converted := converted + 1;
    else overflow := overflow + 1;
    end if;
  end loop;

  if sup <> sup_before or agg <> agg_before then
    perform set_config('rpg.atomic_adjustment', 'on', true);
    update public.character_sheets
       set values = jsonb_set(jsonb_set(values, array[sup_field], to_jsonb(sup)), array[agg_field], to_jsonb(agg))
     where id = p_sheet_id
    returning * into sheet;
    perform set_config('rpg.atomic_adjustment', 'off', true);
    if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
    summary := left(concat_ws(' · ', nullif(p_reason, ''),
      format('%s superficial, %s agravado', p_superficial, p_aggravated),
      case when absorbed > 0 then format('armadura -%s', absorbed) end,
      case when converted > 0 then format('%s convertido', converted) end), 200);
    event := private.record_sheet_damage_event(
      p_sheet_id, p_operation_id, case when agg <> agg_before then agg_field else sup_field end,
      incoming_sup + incoming_agg,
      case when agg <> agg_before then agg_before else sup_before end,
      case when agg <> agg_before then agg else sup end, summary);
  end if;

  return jsonb_build_object(
    'sheet', to_jsonb(sheet),
    'event', case when event.id is null then null else to_jsonb(event) end,
    'replayed', false,
    'track', p_track,
    'maximum', maximum,
    'superficial', sup,
    'aggravated', agg,
    'absorbed_by_armor', absorbed,
    'armor', case when armor_id is not null then jsonb_build_object('id', armor_id, 'name', armor_name, 'protection', armor_protection) end,
    'converted', converted,
    'overflow', overflow,
    'impaired', sup + agg >= maximum,
    'incapacitated', agg >= maximum
  );
end;
$$;
revoke all on function public.apply_v5_damage(uuid, text, integer, integer, boolean, uuid, text) from public, anon;
grant execute on function public.apply_v5_damage(uuid, text, integer, integer, boolean, uuid, text) to authenticated;

-- INV-07: catalog favorites per user and character.
create table public.character_catalog_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  sheet_id uuid not null,
  campaign_id uuid not null,
  catalog_item_id text not null check (catalog_item_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, sheet_id, catalog_item_id),
  foreign key (sheet_id, campaign_id) references public.character_sheets(id, campaign_id) on delete cascade
);
alter table public.character_catalog_favorites enable row level security;
revoke all on public.character_catalog_favorites from public, anon, authenticated;
grant select, insert, delete on public.character_catalog_favorites to authenticated;
create policy "users read own favorites" on public.character_catalog_favorites for select to authenticated
  using (user_id = (select auth.uid()));
create policy "users add favorites to readable sheets" on public.character_catalog_favorites for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.character_sheets s where s.id = sheet_id and s.campaign_id = character_catalog_favorites.campaign_id));
create policy "users remove own favorites" on public.character_catalog_favorites for delete to authenticated
  using (user_id = (select auth.uid()));

-- INV-07: shopping lists authored per character, optionally shared with the master.
create table public.character_shopping_lists (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null,
  campaign_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  shared_with_master boolean not null default false,
  notes text not null default '' check (char_length(notes) <= 2000),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, campaign_id),
  foreign key (sheet_id, campaign_id) references public.character_sheets(id, campaign_id) on delete cascade
);
create index character_shopping_lists_sheet_idx on public.character_shopping_lists(sheet_id, created_at);

create table public.character_shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null,
  campaign_id uuid not null,
  catalog_item_id text check (catalog_item_id is null or catalog_item_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  category text not null default 'equipment' check (category in ('weapon','armor','equipment','clothing','dwelling','vehicle','mount','animal')),
  resource_cost integer not null default 0 check (resource_cost between 0 and 10),
  quantity integer not null default 1 check (quantity between 1 and 99),
  notes text not null default '' check (char_length(notes) <= 1000),
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  created_at timestamptz not null default now(),
  foreign key (list_id, campaign_id) references public.character_shopping_lists(id, campaign_id) on delete cascade
);
create index character_shopping_list_items_list_idx on public.character_shopping_list_items(list_id, sort_order, id);

create or replace function private.can_read_shopping_list(p_list_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, private, auth
as $$
  select exists(select 1 from public.character_shopping_lists l where l.id = p_list_id
    and (l.owner_id = auth.uid() or (l.shared_with_master and private.can_manage_campaign(l.campaign_id))));
$$;
create or replace function private.can_write_shopping_list(p_list_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, private, auth
as $$
  select exists(select 1 from public.character_shopping_lists l where l.id = p_list_id and l.owner_id = auth.uid()
    and private.can_edit_character_inventory(l.sheet_id, l.campaign_id));
$$;
revoke all on function private.can_read_shopping_list(uuid) from public, anon;
revoke all on function private.can_write_shopping_list(uuid) from public, anon;
grant execute on function private.can_read_shopping_list(uuid) to authenticated;
grant execute on function private.can_write_shopping_list(uuid) to authenticated;

alter table public.character_shopping_lists enable row level security;
revoke all on public.character_shopping_lists from public, anon, authenticated;
grant select, insert, update, delete on public.character_shopping_lists to authenticated;
create policy "authors and masters read shared lists" on public.character_shopping_lists for select to authenticated
  using (owner_id = (select auth.uid()) or (shared_with_master and private.can_manage_campaign(campaign_id)));
create policy "sheet editors create own lists" on public.character_shopping_lists for insert to authenticated
  with check (owner_id = (select auth.uid()) and private.can_edit_character_inventory(sheet_id, campaign_id));
create policy "authors update own lists" on public.character_shopping_lists for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and private.can_edit_character_inventory(sheet_id, campaign_id));
create policy "authors delete own lists" on public.character_shopping_lists for delete to authenticated
  using (owner_id = (select auth.uid()));

alter table public.character_shopping_list_items enable row level security;
revoke all on public.character_shopping_list_items from public, anon, authenticated;
grant select, insert, update, delete on public.character_shopping_list_items to authenticated;
create policy "list readers read items" on public.character_shopping_list_items for select to authenticated
  using (private.can_read_shopping_list(list_id));
create policy "list authors insert items" on public.character_shopping_list_items for insert to authenticated
  with check (private.can_write_shopping_list(list_id));
create policy "list authors update items" on public.character_shopping_list_items for update to authenticated
  using (private.can_write_shopping_list(list_id)) with check (private.can_write_shopping_list(list_id));
create policy "list authors delete items" on public.character_shopping_list_items for delete to authenticated
  using (private.can_write_shopping_list(list_id));

create or replace function private.shopping_list_version()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.sheet_id is distinct from old.sheet_id
       or new.campaign_id is distinct from old.campaign_id or new.owner_id is distinct from old.owner_id then
      raise exception 'shopping list identity cannot change' using errcode = '23514';
    end if;
    new.version := old.version + 1;
    new.created_at := old.created_at;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.shopping_list_version() from public;
create trigger character_shopping_lists_version before insert or update on public.character_shopping_lists
  for each row execute function private.shopping_list_version();

create or replace function private.shopping_list_item_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' and (new.list_id is distinct from old.list_id or new.campaign_id is distinct from old.campaign_id) then
    raise exception 'shopping list item cannot move' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    perform 1 from public.character_shopping_lists where id = new.list_id for update;
    if (select count(*) from public.character_shopping_list_items where list_id = new.list_id) >= 100 then
      raise exception 'shopping list is limited to 100 items' using errcode = '23514';
    end if;
  end if;
  -- Touch the list so readers see a new version when its items change.
  update public.character_shopping_lists set updated_at = now() where id = new.list_id;
  return new;
end;
$$;
revoke all on function private.shopping_list_item_guard() from public;
create trigger character_shopping_list_items_guard before insert or update on public.character_shopping_list_items
  for each row execute function private.shopping_list_item_guard();

-- Totals follow the caller's RLS through security_invoker.
create view public.character_shopping_list_totals with (security_invoker = true) as
  select l.id as list_id, l.sheet_id, l.campaign_id,
    count(i.id)::integer as item_count,
    coalesce(sum(i.quantity), 0)::integer as total_quantity,
    coalesce(sum(i.resource_cost * i.quantity), 0)::integer as total_resource_cost,
    coalesce(max(i.resource_cost), 0)::integer as highest_resource_cost
  from public.character_shopping_lists l
  left join public.character_shopping_list_items i on i.list_id = l.id
  group by l.id, l.sheet_id, l.campaign_id;
revoke all on public.character_shopping_list_totals from public, anon;
grant select on public.character_shopping_list_totals to authenticated;

comment on table public.character_shopping_lists is
  'Shopping lists authored by a player for one character. The campaign master reads them only when shared_with_master.';
