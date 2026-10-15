alter table public.character_sheets add constraint character_sheets_id_campaign_unique unique (id, campaign_id);

create table public.character_inventory (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null,
  campaign_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  category text not null check (category in ('weapon','armor','equipment','clothing','dwelling','vehicle','mount','animal')),
  quantity integer not null default 1 check (quantity between 1 and 999),
  resource_cost integer not null default 0 check (resource_cost between 0 and 10),
  damage_bonus integer not null default 0 check (damage_bonus between 0 and 10),
  protection integer not null default 0 check (protection between 0 and 10),
  notes text not null default '' check (char_length(notes) <= 4000),
  acquired boolean not null default false,
  equipped boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  foreign key (sheet_id,campaign_id) references public.character_sheets(id,campaign_id) on delete cascade,
  check (not equipped or (acquired and category in ('weapon','armor')))
);

create index character_inventory_sheet_idx on public.character_inventory(sheet_id,sort_order,id);
create unique index character_inventory_one_equipment_idx on public.character_inventory(sheet_id,category)
  where equipped and category in ('weapon','armor');

alter table public.character_inventory enable row level security;
revoke all on public.character_inventory from public,anon,authenticated;
grant select,insert,update,delete on public.character_inventory to authenticated;

create or replace function private.can_edit_character_inventory(p_sheet_id uuid,p_campaign_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog,public,private,auth
as $$
  select exists(select 1 from public.character_sheets s where s.id=p_sheet_id and s.campaign_id=p_campaign_id
    and (private.can_manage_campaign(s.campaign_id) or (s.owner_id=auth.uid() and private.is_campaign_player(s.campaign_id))));
$$;
revoke all on function private.can_edit_character_inventory(uuid,uuid) from public,anon;
grant execute on function private.can_edit_character_inventory(uuid,uuid) to authenticated;

create policy "sheet readers read inventory" on public.character_inventory for select to authenticated
using (exists(select 1 from public.character_sheets s where s.id=character_inventory.sheet_id and s.campaign_id=character_inventory.campaign_id));
create policy "sheet editors insert inventory" on public.character_inventory for insert to authenticated
with check (private.can_edit_character_inventory(sheet_id,campaign_id));
create policy "sheet editors update inventory" on public.character_inventory for update to authenticated
using (private.can_edit_character_inventory(sheet_id,campaign_id))
with check (private.can_edit_character_inventory(sheet_id,campaign_id));
create policy "sheet editors delete inventory" on public.character_inventory for delete to authenticated
using (private.can_edit_character_inventory(sheet_id,campaign_id));

create or replace function private.inventory_version()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.sheet_id is distinct from old.sheet_id or new.campaign_id is distinct from old.campaign_id then
      raise exception 'inventory identity cannot change';
    end if;
    new.version:=old.version+1;
  else new.version:=1;
  end if;
  new.updated_at:=now();
  return new;
end;
$$;
revoke all on function private.inventory_version() from public;
create trigger character_inventory_version before insert or update on public.character_inventory for each row execute function private.inventory_version();

create or replace function public.equip_character_item(p_item_id uuid,p_expected_version integer)
returns public.character_inventory language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare target public.character_inventory; result public.character_inventory;
begin
  select * into target from public.character_inventory where id=p_item_id;
  if not found or not private.can_edit_character_inventory(target.sheet_id,target.campaign_id) then
    raise exception 'item access denied' using errcode='42501';
  end if;
  -- Serialize equipment changes for the same character without changing sheet values.
  perform 1 from public.character_sheets where id=target.sheet_id for update;
  select * into target from public.character_inventory where id=p_item_id for update;
  if not found or target.version<>p_expected_version then raise exception 'item version conflict' using errcode='40001'; end if;
  if not target.acquired or target.category not in ('weapon','armor') then raise exception 'item cannot be equipped'; end if;
  update public.character_inventory set equipped=false where sheet_id=target.sheet_id and category=target.category and equipped and id<>target.id;
  update public.character_inventory set equipped=true where id=target.id returning * into result;
  return result;
end;
$$;
revoke all on function public.equip_character_item(uuid,integer) from public,anon;
grant execute on function public.equip_character_item(uuid,integer) to authenticated;
