create table public.character_sheet_notifications (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, owner_id)
);

alter table public.character_sheet_notifications enable row level security;
revoke all on public.character_sheet_notifications from public, anon, authenticated;
grant select on public.character_sheet_notifications to authenticated;

create policy "sheet owners and managers read notifications"
  on public.character_sheet_notifications for select to authenticated
  using (
    (owner_id = (select auth.uid()) and private.is_campaign_member(campaign_id))
    or private.can_manage_campaign(campaign_id)
  );

-- Seed one invalidation marker for every existing owner/campaign pair.
insert into public.character_sheet_notifications (campaign_id, owner_id, revision, updated_at)
select campaign_id, owner_id, 1, max(updated_at)
  from public.character_sheets
 group by campaign_id, owner_id
on conflict (campaign_id, owner_id) do nothing;

create or replace function private.notify_character_sheet_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  target_campaigns uuid[];
  target_owners uuid[];
  target_campaign uuid;
  target_owner uuid;
  target_updated_at timestamptz;
  i integer;
begin
  if tg_op = 'INSERT' then
    target_campaigns := array[new.campaign_id];
    target_owners := array[new.owner_id];
    target_updated_at := new.updated_at;
  elsif tg_op = 'DELETE' then
    target_campaigns := array[old.campaign_id];
    target_owners := array[old.owner_id];
    target_updated_at := now();
  elsif old.campaign_id is distinct from new.campaign_id
     or old.owner_id is distinct from new.owner_id then
    target_campaigns := array[old.campaign_id, new.campaign_id];
    target_owners := array[old.owner_id, new.owner_id];
    target_updated_at := new.updated_at;
  else
    target_campaigns := array[new.campaign_id];
    target_owners := array[new.owner_id];
    target_updated_at := new.updated_at;
  end if;

  for i in 1..coalesce(array_length(target_campaigns, 1), 0) loop
    target_campaign := target_campaigns[i];
    target_owner := target_owners[i];
    -- Cascading parent/user deletion can remove these rows before this trigger runs.
    if exists (select 1 from public.campaigns where id = target_campaign)
       and exists (select 1 from auth.users where id = target_owner) then
      insert into public.character_sheet_notifications (campaign_id, owner_id, revision, updated_at)
      values (target_campaign, target_owner, 1, target_updated_at)
      on conflict (campaign_id, owner_id) do update
        set revision = public.character_sheet_notifications.revision + 1,
            updated_at = greatest(public.character_sheet_notifications.updated_at, excluded.updated_at);
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.notify_character_sheet_change() from public, anon, authenticated;
create trigger character_sheets_realtime_notification
  after insert or update or delete on public.character_sheets
  for each row execute function private.notify_character_sheet_change();

-- Move Realtime from raw sheet rows to the minimal invalidation table. If the
-- publication uses all-table or schema-level membership, the table cannot be
-- removed individually, so fail the migration and require an explicit admin change.
do $$
declare
  realtime_publication oid;
  includes_all_tables boolean;
begin
  select oid, puballtables into realtime_publication, includes_all_tables
    from pg_catalog.pg_publication
   where pubname = 'supabase_realtime';

  if realtime_publication is null then
    return;
  end if;
  if includes_all_tables then
    raise exception 'supabase_realtime publishes all tables; remove all-table membership manually before rerunning this migration';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_publication_namespace pn
      join pg_catalog.pg_namespace ns on ns.oid = pn.pnnspid
     where pn.pnpubid = realtime_publication and ns.nspname = 'public'
  ) then
    raise exception 'supabase_realtime publishes the public schema; remove schema-level membership manually before rerunning this migration';
  end if;

  if exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'character_sheets'
  ) then
    alter publication supabase_realtime drop table public.character_sheets;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'character_sheet_notifications'
  ) then
    alter publication supabase_realtime add table public.character_sheet_notifications;
  end if;
end;
$$;
