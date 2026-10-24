create table public.marketplace_systems (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 3 and 120),
  description text not null check (char_length(description) between 1 and 2000),
  tags text[] not null check (cardinality(tags) between 1 and 20),
  author_name text not null check (char_length(author_name) between 1 and 80),
  automation_level text not null check (automation_level in ('static', 'formulas')),
  dependencies text[] not null default '{}',
  template jsonb not null check (jsonb_typeof(template) = 'object'),
  status text not null default 'published' check (status in ('published', 'hidden', 'removed')),
  updated_at timestamptz not null default now(),
  usage_count bigint not null default 0 check (usage_count >= 0),
  likes bigint not null default 0 check (likes >= 0),
  dislikes bigint not null default 0 check (dislikes >= 0),
  search_document tsvector not null default ''::tsvector
);
create or replace function private.refresh_marketplace_search_document()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
begin
  new.search_document := setweight(to_tsvector('simple', coalesce(new.name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(new.tags, ' '), '')), 'B');
  return new;
end;
$$;
revoke all on function private.refresh_marketplace_search_document() from public;
create trigger marketplace_systems_refresh_search
  before insert or update of name, tags on public.marketplace_systems
  for each row execute function private.refresh_marketplace_search_document();
create index marketplace_systems_search_idx on public.marketplace_systems using gin(search_document);
create index marketplace_systems_public_order_idx on public.marketplace_systems(updated_at desc, id) where status = 'published';

create table public.marketplace_votes (
  system_id uuid not null references public.marketplace_systems(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (system_id, user_id)
);

create table public.marketplace_reports (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references public.marketplace_systems(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(reason) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete restrict,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000)
);
create index marketplace_reports_open_idx on public.marketplace_reports(system_id, created_at) where status = 'open';

create table public.marketplace_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.marketplace_clone_operations (
  id bigint generated always as identity primary key,
  system_id uuid not null references public.marketplace_systems(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  template_id uuid not null references public.system_templates(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (campaign_id, user_id, idempotency_key)
);

alter table public.marketplace_systems enable row level security;
alter table public.marketplace_votes enable row level security;
alter table public.marketplace_reports enable row level security;
alter table public.marketplace_admins enable row level security;
alter table public.marketplace_clone_operations enable row level security;

revoke all on public.marketplace_systems, public.marketplace_votes, public.marketplace_reports,
  public.marketplace_admins, public.marketplace_clone_operations from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select (id, name, description, tags, author_name, automation_level, dependencies, template, status, updated_at,
  usage_count, likes, dislikes) on public.marketplace_systems to anon, authenticated;
grant all on public.marketplace_systems, public.marketplace_votes, public.marketplace_reports,
  public.marketplace_admins, public.marketplace_clone_operations to service_role;

create policy "published marketplace systems are public" on public.marketplace_systems
  for select to anon, authenticated using (status = 'published');

create or replace function public.marketplace_search(
  p_q text default null,
  p_tags text[] default '{}',
  p_page integer default 1,
  p_limit integer default 20
) returns table (
  id uuid, name text, description text, tags text[], author_name text, automation_level text,
  dependencies text[], updated_at timestamptz, usage_count bigint, likes bigint, dislikes bigint
)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select item.id, item.name, item.description, item.tags, item.author_name, item.automation_level,
         item.dependencies, item.updated_at, item.usage_count, item.likes, item.dislikes
    from public.marketplace_systems item
   where item.status = 'published'
     and (nullif(btrim(p_q), '') is null or item.search_document @@ plainto_tsquery('simple', btrim(p_q)))
     and (coalesce(cardinality(p_tags), 0) = 0 or item.tags && p_tags)
   order by item.updated_at desc, item.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
revoke all on function public.marketplace_search(text, text[], integer, integer) from public;
grant execute on function public.marketplace_search(text, text[], integer, integer) to anon, authenticated;

create or replace function public.marketplace_vote(p_system_id uuid, p_value integer)
returns void language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor uuid := auth.uid();
  previous smallint;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_value not in (-1, 1) then raise exception 'invalid vote' using errcode = '22023'; end if;
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
    dislikes = dislikes + (case when p_value = -1 then 1 else 0 end) - (case when previous = -1 then 1 else 0 end),
    updated_at = now()
  where id = p_system_id;
end;
$$;
revoke all on function public.marketplace_vote(uuid, integer) from public;
grant execute on function public.marketplace_vote(uuid, integer) to authenticated;

create or replace function public.marketplace_report(p_system_id uuid, p_reason text)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor uuid := auth.uid();
  report_id uuid;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 10 and 2000 then
    raise exception 'invalid report reason' using errcode = '22023';
  end if;
  perform 1 from public.marketplace_systems where id = p_system_id and status = 'published' for update;
  if not found then raise exception 'system unavailable' using errcode = 'P0001'; end if;
  insert into public.marketplace_reports(system_id, reporter_id, reason) values (p_system_id, actor, btrim(p_reason)) returning id into report_id;
  update public.marketplace_systems set status = 'hidden', updated_at = now() where id = p_system_id;
  return report_id;
end;
$$;
revoke all on function public.marketplace_report(uuid, text) from public;
grant execute on function public.marketplace_report(uuid, text) to authenticated;

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
  select * into source from public.marketplace_systems where id = p_system_id and status = 'published' for update;
  if not found then raise exception 'system unavailable' using errcode = 'P0001'; end if;
  select * into prior from public.marketplace_clone_operations
   where campaign_id = p_campaign_id and user_id = actor and idempotency_key = p_idempotency_key;
  if found then
    if prior.system_id <> p_system_id then raise exception 'idempotency key already used' using errcode = '22023'; end if;
    select * into inserted from public.system_templates where id = prior.template_id;
    return to_jsonb(inserted);
  end if;
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

create or replace function public.marketplace_list_reports(p_page integer default 1, p_limit integer default 20)
returns table (
  id uuid, system_id uuid, reporter_id uuid, reason text, status text, created_at timestamptz,
  system_name text, author_name text
) language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not exists (select 1 from public.marketplace_admins where user_id = actor) then
    raise exception 'marketplace administrator required' using errcode = '42501';
  end if;
  return query
    select report.id, report.system_id, report.reporter_id, report.reason, report.status, report.created_at,
           system.name, system.author_name
      from public.marketplace_reports report
      join public.marketplace_systems system on system.id = report.system_id
     where report.status = 'open'
     order by report.created_at, report.id
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
    offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
revoke all on function public.marketplace_list_reports(integer, integer) from public;
grant execute on function public.marketplace_list_reports(integer, integer) to authenticated;

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
  select * into report from public.marketplace_reports where id = p_report_id for update;
  if not found then raise exception 'report unavailable' using errcode = 'P0001'; end if;
  if p_action not in ('restore', 'remove') then
    raise exception 'invalid moderation action' using errcode = '22023';
  end if;
  if p_resolution_note is not null and char_length(p_resolution_note) > 2000 then
    raise exception 'resolution note too long' using errcode = '22023';
  end if;
  update public.marketplace_reports set status = 'resolved', resolved_at = now(), resolved_by = actor,
    resolution_note = nullif(btrim(p_resolution_note), '') where id = p_report_id;
  if p_action = 'restore' and not exists (
    select 1 from public.marketplace_reports where system_id = report.system_id and status = 'open' and id <> p_report_id
  ) then
    update public.marketplace_systems set status = 'published', updated_at = now() where id = report.system_id and status = 'hidden';
  elsif p_action = 'remove' then
    update public.marketplace_systems set status = 'removed', updated_at = now() where id = report.system_id;
  end if;
end;
$$;
revoke all on function public.marketplace_resolve_report(uuid, text, text) from public;
grant execute on function public.marketplace_resolve_report(uuid, text, text) to authenticated;

comment on table public.marketplace_reports is 'Private rights and abuse reports. Read access is reserved to service_role; changes use authenticated RPCs.';
comment on table public.marketplace_admins is 'Membership is written by service_role and checked by the moderation resolution RPC.';
