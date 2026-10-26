-- Frente A (CAM-08, CAM-09, CAM-10): convites, papéis, edição/exclusão de
-- campanha e perfil. Toda escrita sensível passa por RPC security definer com
-- verificação explícita de papel; as tabelas continuam protegidas por RLS.

create or replace function private.is_campaign_owner(target_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = target_campaign and c.owner_id = (select auth.uid())
  );
$$;
revoke all on function private.is_campaign_owner(uuid) from public;
grant execute on function private.is_campaign_owner(uuid) to authenticated;

-- Mestres administram jogadores e convidados; só o dono cria, altera ou remove
-- mestres. Um membro também pode sair da campanha por conta própria.
drop policy "masters invite members" on public.campaign_members;
drop policy "masters update members" on public.campaign_members;
drop policy "masters remove members" on public.campaign_members;

create policy "managers add members within their authority" on public.campaign_members
  for insert to authenticated
  with check (
    private.can_manage_campaign(campaign_id)
    and (role <> 'master' or private.is_campaign_owner(campaign_id))
  );
create policy "managers update members within their authority" on public.campaign_members
  for update to authenticated
  using (
    private.can_manage_campaign(campaign_id)
    and (role <> 'master' or private.is_campaign_owner(campaign_id))
    and user_id <> (select auth.uid())
  )
  with check (
    private.can_manage_campaign(campaign_id)
    and (role <> 'master' or private.is_campaign_owner(campaign_id))
  );
create policy "managers remove members or member leaves" on public.campaign_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (private.can_manage_campaign(campaign_id)
        and (role <> 'master' or private.is_campaign_owner(campaign_id)))
  );

-- Convites: por e-mail (endereçado) ou por código aberto, de uso único.
create table public.campaign_invites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  email text check (email is null or (char_length(email) between 3 and 320 and email = lower(email) and email like '%_@_%')),
  code text not null unique check (code ~ '^[A-F0-9]{12}$'),
  role public.campaign_role not null default 'player' check (role in ('master', 'player', 'guest')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'declined')),
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  responded_at timestamptz,
  check (expires_at > created_at)
);
create index campaign_invites_campaign_idx on public.campaign_invites(campaign_id, status);
create index campaign_invites_email_idx on public.campaign_invites(email) where status = 'pending';

alter table public.campaign_invites enable row level security;
revoke all on public.campaign_invites from public, anon, authenticated;
grant select on public.campaign_invites to authenticated;
create policy "managers read campaign invites" on public.campaign_invites
  for select to authenticated using (private.can_manage_campaign(campaign_id));

create trigger access_audit_write after insert or update or delete on public.campaign_invites
  for each row execute function private.audit_campaign_table_write();

create or replace function private.current_user_email()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(u.email) from auth.users u where u.id = (select auth.uid());
$$;
revoke all on function private.current_user_email() from public;

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
  if p_role = 'master' and not private.is_campaign_owner(p_campaign_id) then
    raise exception 'only the owner invites masters' using errcode = '42501';
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
  if invite.role = 'master' and not private.is_campaign_owner(invite.campaign_id) then
    raise exception 'only the owner revokes master invites' using errcode = '42501';
  end if;
  if invite.status <> 'pending' then
    raise exception 'invite is no longer pending' using errcode = '55000';
  end if;
  update public.campaign_invites set status = 'revoked', responded_at = now() where id = p_invite_id;
end;
$$;

-- Convites endereçados ao e-mail da conta autenticada (o convidado não lê a
-- campanha por RLS antes de aceitar, então o nome vem desta função).
create or replace function public.list_my_campaign_invites()
returns table (id uuid, campaign_id uuid, campaign_name text, role public.campaign_role, expires_at timestamptz)
language sql
stable
security definer
set search_path = public, private, auth
as $$
  select i.id, i.campaign_id, c.name, i.role, i.expires_at
  from public.campaign_invites i
  join public.campaigns c on c.id = i.campaign_id
  where auth.uid() is not null
    and i.email = private.current_user_email()
    and i.status = 'pending'
    and i.expires_at > now()
    and c.owner_id <> auth.uid()
    and not exists (select 1 from public.campaign_members m where m.campaign_id = i.campaign_id and m.user_id = auth.uid())
  order by i.created_at desc;
$$;

create or replace function private.accept_invite_row(invite public.campaign_invites)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, private, auth
as $$
begin
  if invite.status <> 'pending' or invite.expires_at <= now() then
    raise exception 'invite is not valid' using errcode = 'P0002';
  end if;
  if invite.email is not null and invite.email is distinct from private.current_user_email() then
    raise exception 'invite addressed to another account' using errcode = '42501';
  end if;
  if exists (select 1 from public.campaigns where id = invite.campaign_id and owner_id = auth.uid()) then
    raise exception 'the owner is already in the campaign' using errcode = '23505';
  end if;
  if exists (select 1 from public.campaign_members where campaign_id = invite.campaign_id and user_id = auth.uid()) then
    raise exception 'already a campaign member' using errcode = '23505';
  end if;
  insert into public.campaign_members (campaign_id, user_id, role)
  values (invite.campaign_id, auth.uid(), invite.role);
  update public.campaign_invites
     set status = 'accepted', accepted_by = auth.uid(), responded_at = now()
   where id = invite.id;
  return invite.campaign_id;
end;
$$;
revoke all on function private.accept_invite_row(public.campaign_invites) from public;

create or replace function public.accept_campaign_invite(p_code text default null, p_invite_id uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, private, auth
as $$
declare
  invite public.campaign_invites;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_invite_id is not null then
    select * into invite from public.campaign_invites where id = p_invite_id for update;
    -- Por identificador só se aceita convite endereçado ao próprio e-mail.
    if found and invite.email is null then
      raise exception 'invite is not valid' using errcode = 'P0002';
    end if;
  else
    select * into invite from public.campaign_invites
     where code = upper(btrim(coalesce(p_code, ''))) for update;
  end if;
  if not found then
    raise exception 'invite is not valid' using errcode = 'P0002';
  end if;
  return private.accept_invite_row(invite);
end;
$$;

create or replace function public.decline_campaign_invite(p_invite_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, private, auth
as $$
begin
  update public.campaign_invites
     set status = 'declined', responded_at = now()
   where id = p_invite_id
     and status = 'pending'
     and email is not null
     and email = private.current_user_email();
  if not found then
    raise exception 'invite is not valid' using errcode = 'P0002';
  end if;
end;
$$;

-- Lista de participantes com nome de exibição. E-mail só para dono e mestres.
create or replace function public.list_campaign_members(p_campaign_id uuid)
returns table (user_id uuid, role public.campaign_role, display_name text, email text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, private, auth
as $$
declare
  manager boolean;
begin
  if auth.uid() is null or not private.is_campaign_member(p_campaign_id) then
    raise exception 'campaign access denied' using errcode = '42501';
  end if;
  manager := private.can_manage_campaign(p_campaign_id);
  return query
    select c.owner_id, 'owner'::public.campaign_role, p.display_name,
           case when manager then u.email else null end, c.created_at
      from public.campaigns c
      left join public.profiles p on p.id = c.owner_id
      left join auth.users u on u.id = c.owner_id
     where c.id = p_campaign_id
    union all
    select m.user_id, m.role, p.display_name,
           case when manager then u.email else null end, m.created_at
      from public.campaign_members m
      left join public.profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
     where m.campaign_id = p_campaign_id
    order by 5;
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
  select role into current_role_value from public.campaign_members
   where campaign_id = p_campaign_id and user_id = p_user_id for update;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if (current_role_value = 'master' or p_role = 'master') and not private.is_campaign_owner(p_campaign_id) then
    raise exception 'only the owner manages masters' using errcode = '42501';
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
  current_role_value public.campaign_role;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select role into current_role_value from public.campaign_members
   where campaign_id = p_campaign_id and user_id = p_user_id for update;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if p_user_id <> auth.uid() then
    if not private.can_manage_campaign(p_campaign_id) then
      raise exception 'campaign manager required' using errcode = '42501';
    end if;
    if current_role_value = 'master' and not private.is_campaign_owner(p_campaign_id) then
      raise exception 'only the owner removes masters' using errcode = '42501';
    end if;
  end if;
  delete from public.campaign_members where campaign_id = p_campaign_id and user_id = p_user_id;
end;
$$;

-- CAM-09: edição e exclusão pelo dono. A exclusão exige repetir o nome exato.
create or replace function public.update_campaign_details(p_campaign_id uuid, p_name text, p_description text)
returns void
language plpgsql
volatile
security definer
set search_path = public, private, auth
as $$
declare
  clean_name text := btrim(coalesce(p_name, ''));
  clean_description text := btrim(coalesce(p_description, ''));
begin
  if auth.uid() is null or not private.is_campaign_owner(p_campaign_id) then
    raise exception 'campaign owner required' using errcode = '42501';
  end if;
  if char_length(clean_name) not between 3 and 120 or char_length(clean_description) > 2000 then
    raise exception 'invalid campaign details' using errcode = '22023';
  end if;
  update public.campaigns
     set name = clean_name, description = clean_description, updated_at = now()
   where id = p_campaign_id;
end;
$$;

create or replace function public.delete_campaign(p_campaign_id uuid, p_confirm_name text)
returns void
language plpgsql
volatile
security definer
set search_path = public, private, auth
as $$
declare
  target public.campaigns;
begin
  select * into target from public.campaigns where id = p_campaign_id for update;
  if not found or auth.uid() is null or target.owner_id <> auth.uid() then
    raise exception 'campaign owner required' using errcode = '42501';
  end if;
  if coalesce(p_confirm_name, '') <> target.name then
    raise exception 'campaign name confirmation does not match' using errcode = '22023';
  end if;
  -- Fichas referenciam modelos com restrict; removê-las antes evita que a
  -- ordem da cascata bloqueie a exclusão.
  delete from public.character_sheets where campaign_id = p_campaign_id;
  delete from public.campaigns where id = p_campaign_id;
end;
$$;

-- CAM-10: perfil próprio (nome de exibição). Não há bucket de avatar; só texto.
create or replace function public.upsert_my_profile(p_display_name text)
returns public.profiles
language plpgsql
volatile
security invoker
set search_path = public, auth
as $$
declare
  clean_name text := btrim(regexp_replace(coalesce(p_display_name, ''), '\s+', ' ', 'g'));
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(clean_name) not between 2 and 80 then
    raise exception 'invalid display name' using errcode = '22023';
  end if;
  insert into public.profiles (id, display_name) values (auth.uid(), clean_name)
  on conflict (id) do update set display_name = excluded.display_name
  returning * into result;
  return result;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.create_campaign_invite(uuid, public.campaign_role, text)',
    'public.revoke_campaign_invite(uuid)',
    'public.list_my_campaign_invites()',
    'public.accept_campaign_invite(text, uuid)',
    'public.decline_campaign_invite(uuid)',
    'public.list_campaign_members(uuid)',
    'public.set_campaign_member_role(uuid, uuid, public.campaign_role)',
    'public.remove_campaign_member(uuid, uuid)',
    'public.update_campaign_details(uuid, text, text)',
    'public.delete_campaign(uuid, text)',
    'public.upsert_my_profile(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
