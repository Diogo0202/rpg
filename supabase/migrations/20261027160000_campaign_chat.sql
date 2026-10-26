-- MES-05: chat entre participantes da campanha.
--
-- * public.campaign_chat_messages guarda mensagens públicas da mesa e privadas (jogador -> narrador
--   ou sussurro do narrador -> jogador). Nome e papel do autor são gravados pelo banco no insert,
--   nunca pelo cliente.
-- * RLS: membros leem as públicas da campanha e as privadas em que são autor ou destinatário; só
--   escrevem como si mesmos; o autor edita o texto e apaga a própria; dono/mestre apagam (moderação).
-- * Limite de taxa (20 mensagens/minuto por usuário) e retenção (1000 mais recentes por campanha).
-- * Realtime: a tabela entra na publication; o Realtime aplica a RLS de SELECT de cada assinante.

create table public.campaign_chat_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null default '' check (char_length(author_name) <= 80),
  author_role text not null default 'convidado' check (author_role in ('narrador', 'jogador', 'convidado')),
  recipient_id uuid references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000 and char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint campaign_chat_messages_not_self check (recipient_id is null or recipient_id <> author_id)
);
create index campaign_chat_messages_campaign_created_idx on public.campaign_chat_messages(campaign_id, created_at desc, id desc);
create index campaign_chat_messages_author_created_idx on public.campaign_chat_messages(author_id, created_at desc);
create index campaign_chat_messages_recipient_idx on public.campaign_chat_messages(recipient_id) where recipient_id is not null;

-- Papel de um usuário na campanha, sem depender de auth.uid() (usado nos gatilhos).
create or replace function private.campaign_chat_role(p_campaign uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when exists (select 1 from public.campaigns c where c.id = p_campaign and c.owner_id = p_user) then 'narrador'
    else (select case when cm.role::text in ('owner', 'master') then 'narrador'
                      when cm.role::text = 'player' then 'jogador'
                      else 'convidado' end
            from public.campaign_members cm
           where cm.campaign_id = p_campaign and cm.user_id = p_user)
  end
$$;
revoke all on function private.campaign_chat_role(uuid, uuid) from public, anon, authenticated;

-- Antes do insert: autor e papel vêm do banco, destinatário válido e limite de taxa.
create or replace function private.campaign_chat_before_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  author_kind text;
  recipient_kind text;
  recent integer;
begin
  if caller is not null then
    new.author_id := caller;
  end if;
  if new.author_id is null then
    raise exception 'chat message needs an author' using errcode = '23502';
  end if;
  author_kind := private.campaign_chat_role(new.campaign_id, new.author_id);
  if author_kind is null then
    raise exception 'only campaign members can chat' using errcode = '42501';
  end if;
  new.author_role := author_kind;
  new.author_name := coalesce((select left(p.display_name, 80) from public.profiles p where p.id = new.author_id), '');
  new.created_at := now();
  new.edited_at := null;

  if new.recipient_id is not null then
    recipient_kind := private.campaign_chat_role(new.campaign_id, new.recipient_id);
    if recipient_kind is null then
      raise exception 'private message recipient must be a campaign member' using errcode = '23514';
    end if;
    -- Privadas só entre jogador e narrador: ou o autor ou o destinatário narra a campanha.
    if author_kind <> 'narrador' and recipient_kind <> 'narrador' then
      raise exception 'private messages go to or come from the narrator' using errcode = '23514';
    end if;
  end if;

  if caller is not null then
    perform pg_advisory_xact_lock(hashtextextended('campaign_chat:' || caller::text, 0));
    select count(*) into recent from public.campaign_chat_messages m
     where m.author_id = caller and m.created_at > now() - interval '1 minute';
    if recent >= 20 then
      raise exception 'chat rate limit: wait a moment before sending again' using errcode = 'P0429';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.campaign_chat_before_insert() from public, anon, authenticated;
create trigger campaign_chat_messages_before_insert
  before insert on public.campaign_chat_messages
  for each row execute function private.campaign_chat_before_insert();

-- Edição: só o texto muda; marca edited_at.
create or replace function private.campaign_chat_before_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.campaign_id is distinct from old.campaign_id or new.author_id is distinct from old.author_id
     or new.recipient_id is distinct from old.recipient_id or new.created_at is distinct from old.created_at
     or new.author_role is distinct from old.author_role or new.author_name is distinct from old.author_name then
    raise exception 'only the message body can be edited' using errcode = '42501';
  end if;
  if new.body is distinct from old.body then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;
revoke all on function private.campaign_chat_before_update() from public, anon, authenticated;
create trigger campaign_chat_messages_before_update
  before update on public.campaign_chat_messages
  for each row execute function private.campaign_chat_before_update();

-- Retenção: mantém as 1000 mensagens mais recentes de cada campanha.
create or replace function private.campaign_chat_retention()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.campaign_chat_messages m
   where m.id in (
     select old_message.id from public.campaign_chat_messages old_message
      where old_message.campaign_id = new.campaign_id
      order by old_message.created_at desc, old_message.id desc
      offset 1000
   );
  return null;
end;
$$;
revoke all on function private.campaign_chat_retention() from public, anon, authenticated;
create trigger campaign_chat_messages_retention
  after insert on public.campaign_chat_messages
  for each row execute function private.campaign_chat_retention();

alter table public.campaign_chat_messages enable row level security;
create policy "members read visible chat messages" on public.campaign_chat_messages
  for select to authenticated
  using (
    private.is_campaign_member(campaign_id)
    and (recipient_id is null or author_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  );
create policy "members send chat as themselves" on public.campaign_chat_messages
  for insert to authenticated
  with check (private.is_campaign_member(campaign_id) and author_id = (select auth.uid()));
create policy "authors edit own chat messages" on public.campaign_chat_messages
  for update to authenticated
  using (author_id = (select auth.uid()) and private.is_campaign_member(campaign_id))
  with check (author_id = (select auth.uid()) and private.is_campaign_member(campaign_id));
create policy "authors and managers delete chat messages" on public.campaign_chat_messages
  for delete to authenticated
  using (author_id = (select auth.uid()) or private.can_manage_campaign(campaign_id));

revoke all on public.campaign_chat_messages from anon, authenticated;
grant select, delete on public.campaign_chat_messages to authenticated;
-- id pode vir do cliente para reenvio idempotente e para casar a mensagem otimista com o eco Realtime.
grant insert (id, campaign_id, recipient_id, body) on public.campaign_chat_messages to authenticated;
grant update (body) on public.campaign_chat_messages to authenticated;

-- Participantes que podem receber mensagens privadas, com nome e papel vindos do banco.
-- Só responde para quem é membro da campanha.
create or replace function public.campaign_chat_participants(p_campaign uuid)
returns table (user_id uuid, display_name text, role text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with people as (
    select c.owner_id as user_id from public.campaigns c where c.id = p_campaign
    union
    select cm.user_id from public.campaign_members cm where cm.campaign_id = p_campaign
  )
  select people.user_id,
         coalesce((select left(p.display_name, 80) from public.profiles p where p.id = people.user_id), '') as display_name,
         private.campaign_chat_role(p_campaign, people.user_id) as role
    from people
   where private.is_campaign_member(p_campaign)
$$;
revoke all on function public.campaign_chat_participants(uuid) from public, anon;
grant execute on function public.campaign_chat_participants(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_catalog.pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_chat_messages') then
    alter publication supabase_realtime add table public.campaign_chat_messages;
  end if;
end;
$$;
