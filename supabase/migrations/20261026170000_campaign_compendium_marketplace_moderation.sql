-- Frente H: verbetes de compêndio por campanha com revisão do narrador e
-- correções de moderação do marketplace. Nenhum texto de livro oficial é incluído.

-- ---------------------------------------------------------------------------
-- COM-05: verbetes por campanha
-- ---------------------------------------------------------------------------
create table public.campaign_compendium_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  proposed_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 120 and title = btrim(title)),
  entry_type text not null check (entry_type in ('discipline', 'advantage')),
  level smallint not null check (level between 0 and 5),
  tags text[] not null default '{}' check (cardinality(tags) <= 20 and array_position(tags, null) is null),
  cost text not null default '' check (char_length(cost) <= 240),
  pool text not null default '' check (char_length(pool) <= 240),
  duration text not null default '' check (char_length(duration) <= 240),
  description text not null check (char_length(btrim(description)) between 1 and 4000),
  source_title text not null check (char_length(btrim(source_title)) between 1 and 240),
  source_page integer check (source_page is null or source_page between 1 and 5000),
  source_kind text not null check (source_kind in ('homebrew', 'licensed')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text check (review_note is null or char_length(review_note) <= 2000),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'pending') = (reviewed_by is null and reviewed_at is null))
);
create unique index campaign_compendium_approved_title_idx
  on public.campaign_compendium_entries(campaign_id, lower(title)) where status = 'approved';
create index campaign_compendium_campaign_status_idx
  on public.campaign_compendium_entries(campaign_id, status, updated_at desc);
create index campaign_compendium_proposer_idx
  on public.campaign_compendium_entries(proposed_by, campaign_id);

alter table public.campaign_compendium_entries enable row level security;
revoke all on public.campaign_compendium_entries from public, anon, authenticated;
grant select, delete on public.campaign_compendium_entries to authenticated;
grant all on public.campaign_compendium_entries to service_role;

-- Membros veem verbetes aprovados e as próprias propostas; o narrador vê tudo da campanha.
create policy "compendium entries visible by campaign role" on public.campaign_compendium_entries
  for select to authenticated using (
    (status = 'approved' and private.is_campaign_member(campaign_id))
    or (proposed_by = (select auth.uid()) and private.is_campaign_member(campaign_id))
    or private.can_manage_campaign(campaign_id)
  );
-- O autor retira a própria proposta pendente; o narrador pode excluir verbetes da campanha.
create policy "compendium entries removable by proposer or narrator" on public.campaign_compendium_entries
  for delete to authenticated using (
    (status = 'pending' and proposed_by = (select auth.uid()) and private.is_campaign_member(campaign_id))
    or private.can_manage_campaign(campaign_id)
  );

create or replace function private.normalized_compendium_tags(p_tags text[])
returns text[] language plpgsql immutable
set search_path = pg_catalog
as $$
declare
  result text[] := '{}';
  tag text;
begin
  foreach tag in array coalesce(p_tags, '{}') loop
    tag := lower(btrim(coalesce(tag, '')));
    if tag = '' or char_length(tag) > 40 then
      raise exception 'invalid compendium tag' using errcode = '22023';
    end if;
    if not tag = any(result) then result := result || tag; end if;
  end loop;
  if cardinality(result) > 20 then raise exception 'too many compendium tags' using errcode = '22023'; end if;
  return result;
end;
$$;
revoke all on function private.normalized_compendium_tags(text[]) from public;

create or replace function public.compendium_propose_entry(
  p_campaign_id uuid,
  p_title text,
  p_entry_type text,
  p_level integer,
  p_tags text[],
  p_cost text,
  p_pool text,
  p_duration text,
  p_description text,
  p_source_title text,
  p_source_page integer,
  p_source_kind text
) returns public.campaign_compendium_entries
language plpgsql security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  actor uuid := auth.uid();
  inserted public.campaign_compendium_entries%rowtype;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not (
    exists (select 1 from public.campaigns where id = p_campaign_id and owner_id = actor)
    or exists (select 1 from public.campaign_members where campaign_id = p_campaign_id and user_id = actor and role in ('owner', 'master', 'player'))
  ) then
    raise exception 'campaign member required' using errcode = '42501';
  end if;
  if (select count(*) from public.campaign_compendium_entries
       where campaign_id = p_campaign_id and proposed_by = actor and status = 'pending') >= 50 then
    raise exception 'too many pending proposals' using errcode = '22023';
  end if;
  insert into public.campaign_compendium_entries(
    campaign_id, proposed_by, title, entry_type, level, tags, cost, pool, duration,
    description, source_title, source_page, source_kind
  ) values (
    p_campaign_id, actor, btrim(p_title), p_entry_type, p_level::smallint, private.normalized_compendium_tags(p_tags),
    btrim(coalesce(p_cost, '')), btrim(coalesce(p_pool, '')), btrim(coalesce(p_duration, '')),
    btrim(p_description), btrim(p_source_title), p_source_page, p_source_kind
  ) returning * into inserted;
  return inserted;
exception
  when check_violation or not_null_violation or numeric_value_out_of_range then
    raise exception 'invalid compendium entry' using errcode = '22023';
end;
$$;
revoke all on function public.compendium_propose_entry(uuid, text, text, integer, text[], text, text, text, text, text, integer, text) from public;
grant execute on function public.compendium_propose_entry(uuid, text, text, integer, text[], text, text, text, text, text, integer, text) to authenticated;

create or replace function public.compendium_review_entry(p_entry_id uuid, p_action text, p_note text default null)
returns public.campaign_compendium_entries
language plpgsql security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  actor uuid := auth.uid();
  entry public.campaign_compendium_entries%rowtype;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_action not in ('approve', 'reject') then raise exception 'invalid review action' using errcode = '22023'; end if;
  if p_note is not null and char_length(p_note) > 2000 then raise exception 'review note too long' using errcode = '22023'; end if;
  select * into entry from public.campaign_compendium_entries where id = p_entry_id for update;
  if not found or not private.can_manage_campaign(entry.campaign_id) then
    raise exception 'campaign narrator required' using errcode = '42501';
  end if;
  if entry.status <> 'pending' then raise exception 'entry already reviewed' using errcode = 'P0001'; end if;
  if p_action = 'approve' and exists (
    select 1 from public.campaign_compendium_entries
     where campaign_id = entry.campaign_id and status = 'approved' and lower(title) = lower(entry.title)
  ) then
    raise exception 'an approved entry with this title already exists' using errcode = '23505';
  end if;
  update public.campaign_compendium_entries set
    status = case when p_action = 'approve' then 'approved' else 'rejected' end,
    review_note = nullif(btrim(p_note), ''),
    reviewed_by = actor,
    reviewed_at = now(),
    updated_at = now()
  where id = p_entry_id
  returning * into entry;
  return entry;
end;
$$;
revoke all on function public.compendium_review_entry(uuid, text, text) from public;
grant execute on function public.compendium_review_entry(uuid, text, text) to authenticated;

comment on table public.campaign_compendium_entries is
  'Campaign-scoped compendium entries. Members propose through compendium_propose_entry; narrators review with compendium_review_entry. Holds table-authored or licensed references, never bundled official book text.';

-- ---------------------------------------------------------------------------
-- Marketplace: correções encontradas pelos testes
-- ---------------------------------------------------------------------------

-- Votos não podem alterar updated_at: a lista pública é ordenada por atualização do conteúdo.
create or replace function public.marketplace_vote(p_system_id uuid, p_value integer)
returns void language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor uuid := auth.uid();
  previous smallint;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_value is null or p_value not in (-1, 1) then raise exception 'invalid vote' using errcode = '22023'; end if;
  perform 1 from public.marketplace_systems where id = p_system_id and status = 'published' for update;
  if not found then raise exception 'system unavailable' using errcode = 'P0001'; end if;
  if exists (select 1 from public.marketplace_systems where id = p_system_id and owner_id = actor) then
    raise exception 'authors cannot vote for their own system' using errcode = '42501';
  end if;
  select value into previous from public.marketplace_votes where system_id = p_system_id and user_id = actor for update;
  if previous is not distinct from p_value then return; end if;
  insert into public.marketplace_votes(system_id, user_id, value) values (p_system_id, actor, p_value)
    on conflict (system_id, user_id) do update set value = excluded.value, updated_at = now();
  update public.marketplace_systems set
    likes = likes + (case when p_value = 1 then 1 else 0 end) - (case when previous = 1 then 1 else 0 end),
    dislikes = dislikes + (case when p_value = -1 then 1 else 0 end) - (case when previous = -1 then 1 else 0 end)
  where id = p_system_id;
end;
$$;
revoke all on function public.marketplace_vote(uuid, integer) from public;
grant execute on function public.marketplace_vote(uuid, integer) to authenticated;

-- Retentativa idempotente devolve a cópia já feita mesmo que o sistema tenha sido ocultado depois.
create or replace function public.marketplace_clone(p_system_id uuid, p_campaign_id uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  actor uuid := auth.uid();
  source public.marketplace_systems%rowtype;
  prior public.marketplace_clone_operations%rowtype;
  new_id uuid := gen_random_uuid();
  new_name text;
  inserted public.system_templates%rowtype;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if not private.can_manage_campaign(p_campaign_id) then raise exception 'campaign manager required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(actor::text), hashtext(p_campaign_id::text || ':' || p_idempotency_key));
  select * into prior from public.marketplace_clone_operations
   where campaign_id = p_campaign_id and user_id = actor and idempotency_key = p_idempotency_key;
  if found then
    if prior.system_id <> p_system_id then raise exception 'idempotency key already used' using errcode = '22023'; end if;
    select * into inserted from public.system_templates where id = prior.template_id;
    return to_jsonb(inserted);
  end if;
  select * into source from public.marketplace_systems where id = p_system_id and status = 'published' for update;
  if not found then raise exception 'system unavailable' using errcode = 'P0001'; end if;
  new_name := left(source.name, 96) || ' [community-' || left(new_id::text, 8) || ']';
  insert into public.system_templates(id, campaign_id, owner_id, name, version, status, schema)
    values (new_id, p_campaign_id, actor, new_name, 1, 'needs_review', jsonb_set(source.template, '{name}', to_jsonb(new_name), true))
    returning * into inserted;
  insert into public.marketplace_clone_operations(system_id, campaign_id, user_id, idempotency_key, template_id)
    values (p_system_id, p_campaign_id, actor, p_idempotency_key, new_id);
  update public.marketplace_systems set usage_count = usage_count + 1 where id = p_system_id;
  return to_jsonb(inserted);
end;
$$;
revoke all on function public.marketplace_clone(uuid, uuid, text) from public;
grant execute on function public.marketplace_clone(uuid, uuid, text) to authenticated;

-- Denúncias já resolvidas não podem ser resolvidas de novo (evita trocar o moderador e reabrir sistemas removidos).
create or replace function public.marketplace_resolve_report(p_report_id uuid, p_action text, p_resolution_note text default null)
returns void language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor uuid := auth.uid();
  report public.marketplace_reports%rowtype;
begin
  if actor is null or not exists (select 1 from public.marketplace_admins where user_id = actor) then
    raise exception 'marketplace administrator required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('restore', 'remove') then
    raise exception 'invalid moderation action' using errcode = '22023';
  end if;
  if p_resolution_note is not null and char_length(p_resolution_note) > 2000 then
    raise exception 'resolution note too long' using errcode = '22023';
  end if;
  select * into report from public.marketplace_reports where id = p_report_id for update;
  if not found then raise exception 'report unavailable' using errcode = 'P0001'; end if;
  if report.status <> 'open' then raise exception 'report already resolved' using errcode = 'P0001'; end if;
  perform 1 from public.marketplace_systems where id = report.system_id for update;
  update public.marketplace_reports set status = 'resolved', resolved_at = now(), resolved_by = actor,
    resolution_note = nullif(btrim(p_resolution_note), '') where id = p_report_id;
  if p_action = 'restore' and not exists (
    select 1 from public.marketplace_reports where system_id = report.system_id and status = 'open'
  ) then
    update public.marketplace_systems set status = 'published', updated_at = now() where id = report.system_id and status = 'hidden';
  elsif p_action = 'remove' then
    update public.marketplace_reports set status = 'resolved', resolved_at = now(), resolved_by = actor,
      resolution_note = coalesce(resolution_note, 'closed by removal')
     where system_id = report.system_id and status = 'open';
    update public.marketplace_systems set status = 'removed', updated_at = now() where id = report.system_id;
  end if;
end;
$$;
revoke all on function public.marketplace_resolve_report(uuid, text, text) from public;
grant execute on function public.marketplace_resolve_report(uuid, text, text) to authenticated;

-- Ação direta do moderador, sem depender de uma denúncia aberta.
create table public.marketplace_moderation_log (
  id bigint generated always as identity primary key,
  system_id uuid not null references public.marketplace_systems(id) on delete cascade,
  moderator_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('hide', 'restore', 'remove')),
  previous_status text not null,
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now()
);
alter table public.marketplace_moderation_log enable row level security;
revoke all on public.marketplace_moderation_log from public, anon, authenticated;
grant all on public.marketplace_moderation_log to service_role;

create or replace function public.marketplace_moderate_system(p_system_id uuid, p_action text, p_note text default null)
returns text language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor uuid := auth.uid();
  current_status text;
  next_status text;
begin
  if actor is null or not exists (select 1 from public.marketplace_admins where user_id = actor) then
    raise exception 'marketplace administrator required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('hide', 'restore', 'remove') then
    raise exception 'invalid moderation action' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then raise exception 'moderation note too long' using errcode = '22023'; end if;
  select status into current_status from public.marketplace_systems where id = p_system_id for update;
  if not found then raise exception 'system unavailable' using errcode = 'P0001'; end if;
  next_status := case p_action when 'hide' then 'hidden' when 'remove' then 'removed' else 'published' end;
  if p_action = 'restore' and exists (
    select 1 from public.marketplace_reports where system_id = p_system_id and status = 'open'
  ) then
    raise exception 'resolve open reports before restoring' using errcode = 'P0001';
  end if;
  if p_action = 'remove' then
    update public.marketplace_reports set status = 'resolved', resolved_at = now(), resolved_by = actor,
      resolution_note = coalesce(nullif(btrim(p_note), ''), 'closed by removal')
     where system_id = p_system_id and status = 'open';
  end if;
  if current_status <> next_status then
    update public.marketplace_systems set status = next_status, updated_at = now() where id = p_system_id;
  end if;
  insert into public.marketplace_moderation_log(system_id, moderator_id, action, previous_status, note)
    values (p_system_id, actor, p_action, current_status, nullif(btrim(p_note), ''));
  return next_status;
end;
$$;
revoke all on function public.marketplace_moderate_system(uuid, text, text) from public;
grant execute on function public.marketplace_moderate_system(uuid, text, text) to authenticated;
