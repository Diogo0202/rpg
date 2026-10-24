-- What the table may see of each character, and what only the master sees.
--   * fields[].private = true: visible to the sheet owner and the master
--     (character_sheets RLS), never in party_status_public, overlays or
--     another player's screen (e.g. the V5 current compulsion, secrets).
--   * character_sheet_secrets: notes only the master reads, not even the owner.
-- Realtime still carries only invalidation rows (character_sheet_notifications);
-- clients re-read this view, so no private value ever travels on a socket.

create or replace function private.public_sheet_values(p_template_id uuid, p_values jsonb)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb)
    from jsonb_each(p_values) as item(key, value)
   where not exists (
     select 1
       from public.system_templates template,
            jsonb_array_elements(coalesce(template.schema -> 'fields', '[]'::jsonb)) as fields(field)
      where template.id = p_template_id
        and fields.field ->> 'id' = item.key
        and (fields.field ->> 'private')::boolean is true
   );
$$;
revoke all on function private.public_sheet_values(uuid, jsonb) from public;
-- Callers of the view need EXECUTE; the function only filters the values it is given.
grant execute on function private.public_sheet_values(uuid, jsonb) to authenticated;

-- Owner-privileged view: it bypasses the per-owner sheet RLS on purpose so a
-- player sees the rest of the party, and filters membership and fields itself.
create view public.party_status_public with (security_barrier = true) as
  select sheet.id, sheet.campaign_id, sheet.owner_id, sheet.template_id, sheet.name, sheet.version,
         sheet.updated_at, sheet.portrait_path,
         private.public_sheet_values(sheet.template_id, sheet.values) as values
    from public.character_sheets sheet
   where private.is_campaign_member(sheet.campaign_id);
revoke all on public.party_status_public from public, anon;
grant select on public.party_status_public to authenticated;
comment on view public.party_status_public is
  'Party data safe for every campaign member and overlays: private template fields are removed.';

create table public.character_sheet_secrets (
  sheet_id uuid primary key references public.character_sheets(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  notes text not null default '' check (char_length(notes) <= 10000),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
alter table public.character_sheet_secrets enable row level security;
revoke all on public.character_sheet_secrets from public, anon, authenticated;
grant select, insert, update, delete on public.character_sheet_secrets to authenticated;
create policy "masters manage sheet secrets" on public.character_sheet_secrets for all to authenticated
  using (private.can_manage_campaign(campaign_id)) with check (private.can_manage_campaign(campaign_id));

create or replace function private.version_sheet_secret()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not exists (select 1 from public.character_sheets where id = new.sheet_id and campaign_id = new.campaign_id) then
    raise exception 'secret must belong to a sheet of the same campaign' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.sheet_id is distinct from old.sheet_id or new.campaign_id is distinct from old.campaign_id then
      raise exception 'secret identity cannot change' using errcode = '22023';
    end if;
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.version_sheet_secret() from public;
create trigger character_sheet_secrets_version
  before insert or update on public.character_sheet_secrets
  for each row execute function private.version_sheet_secret();
