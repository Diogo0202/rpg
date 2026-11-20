-- Voz da sessão via Discord (sem bot WebSocket).
--
-- * public.campaign_voice_sessions guarda uma sessão de voz por campanha (a chave primária é a
--   campanha: uma sessão ativa por campanha). Status pending/ready/failed, canal, convite, validade
--   e um erro resumido, sem segredos.
-- * RLS: membros da campanha leem (inclusive invite_url). Nenhum cliente grava: authenticated só tem
--   SELECT. A API grava com a chave de serviço (service_role) depois de falar com o Discord.
-- * public.request_campaign_voice_session(campaign) é chamada pela API com o token do usuário:
--   confirma dono/mestre no banco, reaproveita convite válido ou pedido recente em andamento e só
--   então marca a sessão como pending, devolvendo should_create = true para a API agendar o Discord.

create table public.campaign_voice_sessions (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  channel_id text check (channel_id is null or channel_id ~ '^[0-9]{5,25}$'),
  invite_url text check (invite_url is null or invite_url ~ '^https://discord\.gg/[A-Za-z0-9-]{2,32}$'),
  expires_at timestamptz,
  error text check (error is null or char_length(error) <= 200),
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_voice_sessions_ready_has_invite check (status <> 'ready' or invite_url is not null)
);

alter table public.campaign_voice_sessions enable row level security;
create policy "members read campaign voice session" on public.campaign_voice_sessions
  for select to authenticated
  using (private.is_campaign_member(campaign_id));

revoke all on public.campaign_voice_sessions from public, anon, authenticated;
grant select on public.campaign_voice_sessions to authenticated;
grant select, insert, update, delete on public.campaign_voice_sessions to service_role;

-- Pedido do narrador. Pending recente (< 2 min) não agenda outra criação; convite que ainda vale
-- pelo menos 5 minutos (ou sem validade) é reaproveitado.
create or replace function public.request_campaign_voice_session(p_campaign_id uuid)
returns table (
  campaign_id uuid,
  campaign_name text,
  status text,
  channel_id text,
  invite_url text,
  expires_at timestamptz,
  error text,
  should_create boolean
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  caller uuid := auth.uid();
  current_row public.campaign_voice_sessions%rowtype;
  v_name text;
begin
  if caller is null or p_campaign_id is null or not private.can_manage_campaign(p_campaign_id) then
    raise exception 'only the campaign owner or a master opens the voice room' using errcode = '42501';
  end if;
  select left(c.name, 80) into v_name from public.campaigns c where c.id = p_campaign_id;

  insert into public.campaign_voice_sessions as v (campaign_id, status, requested_by)
  values (p_campaign_id, 'pending', caller)
  on conflict on constraint campaign_voice_sessions_pkey do nothing;
  if found then
    return query select p_campaign_id, v_name, 'pending'::text, null::text, null::text, null::timestamptz, null::text, true;
    return;
  end if;

  select * into current_row from public.campaign_voice_sessions v where v.campaign_id = p_campaign_id for update;

  if current_row.status = 'ready' and current_row.invite_url is not null
     and (current_row.expires_at is null or current_row.expires_at > now() + interval '5 minutes') then
    return query select p_campaign_id, v_name, current_row.status, current_row.channel_id, current_row.invite_url,
      current_row.expires_at, null::text, false;
    return;
  end if;

  if current_row.status = 'pending' and current_row.updated_at > now() - interval '2 minutes' then
    return query select p_campaign_id, v_name, current_row.status, current_row.channel_id, null::text,
      null::timestamptz, null::text, false;
    return;
  end if;

  update public.campaign_voice_sessions v
     set status = 'pending', invite_url = null, expires_at = null, error = null,
         requested_by = caller, updated_at = now()
   where v.campaign_id = p_campaign_id;
  return query select p_campaign_id, v_name, 'pending'::text, current_row.channel_id, null::text,
    null::timestamptz, null::text, true;
end;
$$;
revoke all on function public.request_campaign_voice_session(uuid) from public, anon;
grant execute on function public.request_campaign_voice_session(uuid) to authenticated;
