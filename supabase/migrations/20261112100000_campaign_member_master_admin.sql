-- Donos e mestres podem administrar outros mestres. O dono da campanha
-- continua sendo uma identidade da tabela campaigns, nunca um membro editável.

drop policy "managers add members within their authority" on public.campaign_members;
drop policy "managers update members within their authority" on public.campaign_members;
drop policy "managers remove members or member leaves" on public.campaign_members;

create policy "managers add campaign members" on public.campaign_members
  for insert to authenticated
  with check (
    private.can_manage_campaign(campaign_id)
    and role in ('master', 'player', 'guest')
    and not exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.owner_id = user_id
    )
  );
create policy "managers update campaign members" on public.campaign_members
  for update to authenticated
  using (
    private.can_manage_campaign(campaign_id)
    and not exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.owner_id = user_id
    )
  )
  with check (
    private.can_manage_campaign(campaign_id)
    and role in ('master', 'player', 'guest')
    and not exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.owner_id = user_id
    )
  );
create policy "managers remove members or member leaves" on public.campaign_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (private.can_manage_campaign(campaign_id)
        and not exists (
          select 1 from public.campaigns c
          where c.id = campaign_id and c.owner_id = user_id
        ))
  );

create or replace function private.guard_campaign_member_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and
     (new.campaign_id is distinct from old.campaign_id or new.user_id is distinct from old.user_id) then
    raise exception 'campaign member identity is immutable' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.user_id = auth.uid() and new.role is distinct from old.role then
    raise exception 'members cannot change their own role' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and new.role = 'owner' then
    raise exception 'campaign owner is not a member role' using errcode = '42501';
  end if;
  if tg_op <> 'INSERT' and exists (
    select 1 from public.campaigns c
    where c.id = old.campaign_id and c.owner_id = old.user_id
  ) then
    raise exception 'campaign owner cannot be changed as a member' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and exists (
    select 1 from public.campaigns c
    where c.id = new.campaign_id and c.owner_id = new.user_id
  ) then
    raise exception 'campaign owner cannot be added as a member' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_campaign_member_identity() from public, anon, authenticated;
create trigger campaign_members_guard_identity
  before insert or update or delete on public.campaign_members
  for each row execute function private.guard_campaign_member_identity();

create or replace function public.create_campaign_invite(
  p_campaign_id uuid,
  p_role public.campaign_role default 'player',
  p_email text default null
)
returns public.campaign_invites
language plpgsql
volatile
security definer
set search_path = public, private, auth
as $$
declare
  normalized_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  invite public.campaign_invites;
begin
  if auth.uid() is null or not private.can_manage_campaign(p_campaign_id) then
    raise exception 'campaign manager required' using errcode = '42501';
  end if;
  if p_role not in ('master', 'player', 'guest') then
    raise exception 'invalid invite role' using errcode = '22023';
  end if;
  if normalized_email is not null and normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid invite email' using errcode = '22023';
  end if;
  if (select count(*) from public.campaign_invites
      where campaign_id = p_campaign_id and status = 'pending' and expires_at > now()) >= 50 then
    raise exception 'too many pending invites' using errcode = '54000';
  end if;
  insert into public.campaign_invites (campaign_id, invited_by, email, code, role)
  values (p_campaign_id, auth.uid(), normalized_email,
          upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)), p_role)
  returning * into invite;
  return invite;
end;
$$;

create or replace function public.revoke_campaign_invite(p_invite_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, private, auth
as $$
declare
  invite public.campaign_invites;
begin
  select * into invite from public.campaign_invites where id = p_invite_id for update;
  if not found or auth.uid() is null or not private.can_manage_campaign(invite.campaign_id) then
    raise exception 'campaign manager required' using errcode = '42501';
  end if;
  if invite.status <> 'pending' then
    raise exception 'invite is no longer pending' using errcode = '55000';
  end if;
  update public.campaign_invites set status = 'revoked', responded_at = now() where id = p_invite_id;
end;
$$;

create or replace function public.set_campaign_member_role(p_campaign_id uuid, p_user_id uuid, p_role public.campaign_role)
returns void
language plpgsql
volatile
security definer
set search_path = public, private, auth
as $$
declare
  current_role_value public.campaign_role;
begin
  if auth.uid() is null or not private.can_manage_campaign(p_campaign_id) then
    raise exception 'campaign manager required' using errcode = '42501';
  end if;
  if p_role not in ('master', 'player', 'guest') then
    raise exception 'invalid member role' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'members cannot change their own role' using errcode = '42501';
  end if;
  if exists (select 1 from public.campaigns where id = p_campaign_id and owner_id = p_user_id) then
    raise exception 'campaign owner cannot be changed as a member' using errcode = '42501';
  end if;
  select role into current_role_value from public.campaign_members
   where campaign_id = p_campaign_id and user_id = p_user_id for update;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  update public.campaign_members set role = p_role
   where campaign_id = p_campaign_id and user_id = p_user_id;
end;
$$;

create or replace function public.remove_campaign_member(p_campaign_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, private, auth
as $$
declare
  target_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select owner_id into target_owner from public.campaigns where id = p_campaign_id;
  if target_owner = p_user_id then
    raise exception 'campaign owner cannot be removed' using errcode = '42501';
  end if;
  if p_user_id <> auth.uid() and not private.can_manage_campaign(p_campaign_id) then
    raise exception 'campaign manager required' using errcode = '42501';
  end if;
  delete from public.campaign_members where campaign_id = p_campaign_id and user_id = p_user_id;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.create_campaign_invite(uuid, public.campaign_role, text) from public, anon;
revoke all on function public.revoke_campaign_invite(uuid) from public, anon;
revoke all on function public.set_campaign_member_role(uuid, uuid, public.campaign_role) from public, anon;
revoke all on function public.remove_campaign_member(uuid, uuid) from public, anon;
grant execute on function public.create_campaign_invite(uuid, public.campaign_role, text) to authenticated;
grant execute on function public.revoke_campaign_invite(uuid) to authenticated;
grant execute on function public.set_campaign_member_role(uuid, uuid, public.campaign_role) to authenticated;
grant execute on function public.remove_campaign_member(uuid, uuid) to authenticated;
