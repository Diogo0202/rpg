-- Envio do e-mail do convite de campanha. A API FastAPI chama a RPC abaixo com
-- o token do usuário: o banco confirma o papel, devolve o destinatário (que
-- nunca vem do pedido) e registra a tentativa antes do envio, limitando
-- reenvios a 1 a cada 5 minutos e 5 por convite.

alter table public.campaign_invites
  add column email_sent_count integer not null default 0 check (email_sent_count between 0 and 5),
  add column last_email_sent_at timestamptz;

create or replace function public.reserve_campaign_invite_email(p_invite_id uuid)
returns table (
  invite_id uuid,
  email text,
  code text,
  role public.campaign_role,
  expires_at timestamptz,
  campaign_name text,
  inviter_name text,
  email_sent_count integer,
  last_email_sent_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, private, auth
as $$
declare
  invite public.campaign_invites;
begin
  select * into invite from public.campaign_invites i where i.id = p_invite_id for update;
  if not found or auth.uid() is null or not private.can_manage_campaign(invite.campaign_id) then
    raise exception 'campaign manager required' using errcode = '42501';
  end if;
  if invite.role = 'master' and not private.is_campaign_owner(invite.campaign_id) then
    raise exception 'only the owner manages master invites' using errcode = '42501';
  end if;
  if invite.email is null then
    raise exception 'invite has no e-mail address' using errcode = '22023';
  end if;
  if invite.status <> 'pending' or invite.expires_at <= now() then
    raise exception 'invite is no longer pending' using errcode = '55000';
  end if;
  if invite.email_sent_count >= 5 then
    raise exception 'invite e-mail limit reached' using errcode = '54000';
  end if;
  if invite.last_email_sent_at is not null and invite.last_email_sent_at > now() - interval '5 minutes' then
    raise exception 'invite e-mail sent recently' using errcode = '54001';
  end if;

  update public.campaign_invites i
     set email_sent_count = i.email_sent_count + 1, last_email_sent_at = now()
   where i.id = invite.id
  returning * into invite;

  return query
    select invite.id, invite.email, invite.code, invite.role, invite.expires_at, c.name,
           coalesce(nullif(btrim(p.display_name), ''), 'Um mestre da campanha'),
           invite.email_sent_count, invite.last_email_sent_at
      from public.campaigns c
      left join public.profiles p on p.id = invite.invited_by
     where c.id = invite.campaign_id;
end;
$$;

revoke all on function public.reserve_campaign_invite_email(uuid) from public, anon;
grant execute on function public.reserve_campaign_invite_email(uuid) to authenticated;
