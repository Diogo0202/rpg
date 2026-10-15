-- Security hardening identified during the beta readiness review. This
-- migration is local only until it is exercised against a Supabase staging DB.

-- The owner role is represented by campaigns.owner_id. It must not be minted
-- through the membership table by an otherwise privileged campaign member.
alter table public.campaign_members
  add constraint campaign_members_no_owner_role check (role <> 'owner');

-- A sheet owner must remain a member of its campaign; campaign managers may
-- administer sheets, but cannot assign a sheet to a user outside the campaign.
drop policy "sheet owners or masters read" on public.character_sheets;
drop policy "sheet owners or masters create" on public.character_sheets;
drop policy "sheet owners or masters update" on public.character_sheets;

create policy "sheet owner or master reads active campaign sheet"
  on public.character_sheets for select to authenticated
  using (
    (owner_id = (select auth.uid()) and private.is_campaign_member(campaign_id))
    or private.can_manage_campaign(campaign_id)
  );

create policy "sheet owner or master creates active campaign sheet"
  on public.character_sheets for insert to authenticated
  with check (
    private.is_campaign_member(campaign_id)
    and (
      owner_id = (select auth.uid())
      or private.can_manage_campaign(campaign_id)
    )
  );

create policy "sheet owner or master updates active campaign sheet"
  on public.character_sheets for update to authenticated
  using (
    (owner_id = (select auth.uid()) and private.is_campaign_member(campaign_id))
    or private.can_manage_campaign(campaign_id)
  )
  with check (
    private.is_campaign_member(campaign_id)
    and (
      owner_id = (select auth.uid())
      or private.can_manage_campaign(campaign_id)
    )
  );

-- Direct browser clients may queue only their own, rights-confirmed sources.
-- State and draft transitions are reserved for the trusted worker (service role).
drop policy "owners manage extraction jobs" on public.extraction_jobs;
create policy "source owner reads extraction jobs" on public.extraction_jobs for select to authenticated
  using (exists (
    select 1 from public.library_sources source
    where source.id = source_id and source.owner_id = (select auth.uid())
  ));
create policy "source owner queues rights-confirmed extraction" on public.extraction_jobs for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and exists (
      select 1 from public.library_sources source
      where source.id = source_id
        and source.owner_id = (select auth.uid())
        and source.rights_confirmed
    )
  );
create policy "source owner cancels queued extraction" on public.extraction_jobs for delete to authenticated
  using (
    status = 'queued'
    and requested_by = (select auth.uid())
    and exists (
      select 1 from public.library_sources source
      where source.id = source_id and source.owner_id = (select auth.uid())
    )
  );

-- Private map documents can contain GM-only layers. Until a separate,
-- redacted player view exists, only campaign managers can select maps/pins.
drop policy "members read maps" on public.maps;
drop policy "members read map pins" on public.map_pins;

-- Foreign keys prove an ID exists, not that it belongs to the same campaign.
-- These triggers reject cross-campaign links before a row can be persisted.
create or replace function private.enforce_campaign_scoped_references()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  first_campaign uuid;
  second_campaign uuid;
begin
  if tg_table_name = 'character_sheets' then
    select campaign_id into first_campaign from public.system_templates where id = new.template_id;
    if first_campaign is distinct from new.campaign_id then
      raise exception 'template must belong to the character sheet campaign';
    end if;
  elsif tg_table_name = 'world_relations' then
    select campaign_id into first_campaign from public.world_entities where id = new.from_entity_id;
    select campaign_id into second_campaign from public.world_entities where id = new.to_entity_id;
    if first_campaign is distinct from new.campaign_id or second_campaign is distinct from new.campaign_id then
      raise exception 'world relations cannot cross campaigns';
    end if;
  elsif tg_table_name = 'map_pins' then
    select campaign_id into first_campaign from public.maps where id = new.map_id;
    select campaign_id into second_campaign from public.world_entities where id = new.entity_id;
    if first_campaign is distinct from second_campaign then
      raise exception 'map pins cannot cross campaigns';
    end if;
  elsif tg_table_name = 'combat_sessions' and new.map_id is not null then
    select campaign_id into first_campaign from public.maps where id = new.map_id;
    if first_campaign is distinct from new.campaign_id then
      raise exception 'combat map must belong to the combat campaign';
    end if;
  end if;
  return new;
end;
$$;

create trigger character_sheets_campaign_scope
  before insert or update on public.character_sheets
  for each row execute function private.enforce_campaign_scoped_references();
create trigger world_relations_campaign_scope
  before insert or update on public.world_relations
  for each row execute function private.enforce_campaign_scoped_references();
create trigger map_pins_campaign_scope
  before insert or update on public.map_pins
  for each row execute function private.enforce_campaign_scoped_references();
create trigger combat_sessions_campaign_scope
  before insert or update on public.combat_sessions
  for each row execute function private.enforce_campaign_scoped_references();

revoke all on function private.enforce_campaign_scoped_references() from public;
