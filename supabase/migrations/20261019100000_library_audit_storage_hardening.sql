-- Only the owner of a source who manages the target campaign may share it.
-- A grant can be revoked by that source owner or by a campaign manager.
drop policy if exists "source owner grants access" on public.library_grants;

create policy "source owners read their grants"
  on public.library_grants for select to authenticated
  using (exists (
    select 1 from public.library_sources source
    where source.id = source_id and source.owner_id = (select auth.uid())
  ));

create policy "campaign managers grant owned sources"
  on public.library_grants for insert to authenticated
  with check (
    granted_by = (select auth.uid())
    and private.can_manage_campaign(campaign_id)
    and exists (
      select 1 from public.library_sources source
      where source.id = source_id and source.owner_id = (select auth.uid())
    )
  );

create policy "source owners or campaign managers revoke grants"
  on public.library_grants for delete to authenticated
  using (
    private.can_manage_campaign(campaign_id)
    or exists (
      select 1 from public.library_sources source
      where source.id = source_id and source.owner_id = (select auth.uid())
    )
  );

-- There is no valid reason to edit the source, campaign, grantor or timestamp
-- of an existing grant. Revoke and issue a new grant instead.
revoke update on public.library_grants from public, anon, authenticated;

-- Campaign members may read their campaign's trail, but only trusted server
-- code may append to it. Existing entries remain for manual review.
drop policy if exists "members add own audit events" on public.audit_events;
revoke insert, update, delete, truncate on public.audit_events from public, anon, authenticated;
revoke update, delete, truncate on public.audit_events from service_role;
grant select, insert on public.audit_events to service_role;
revoke all on sequence public.audit_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.audit_events_id_seq to service_role;

alter table public.audit_events
  add constraint audit_events_event_type_length
    check (char_length(event_type) between 1 and 80) not valid,
  add constraint audit_events_subject_type_length
    check (char_length(subject_type) between 1 and 80) not valid,
  add constraint audit_events_metadata_shape_and_size
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 16384) not valid;

-- Bucket rules are enforced by the Storage API on uploads. Content parsing
-- must still verify the PDF signature before extraction.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library', 'library', false, 20971520, array['application/pdf']::text[])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
