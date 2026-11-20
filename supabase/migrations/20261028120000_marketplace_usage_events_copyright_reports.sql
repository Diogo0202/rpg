-- Marketplace: contagem de uso assíncrona e denúncias de copyright.
--
-- 1. A cópia (marketplace_clone) deixa de atualizar marketplace_systems.usage_count
--    na mesma transação. Ela grava um evento append-only em marketplace_usage_events;
--    marketplace_apply_usage_events() aplica os eventos pendentes em lote, de forma
--    idempotente (cada evento é marcado com applied_at uma única vez).
--    Disparo: a API agenda a agregação em segundo plano após cada cópia e um job
--    periódico chama a mesma RPC com a chave service_role. Se pg_cron existir, o job
--    é agendado abaixo; caso contrário agende externamente, a cada minuto:
--      POST {SUPABASE_URL}/rest/v1/rpc/marketplace_apply_usage_events
--      (apikey/Authorization = service_role, body {"p_batch_size": 5000})
--    ou POST /internal/maintenance/marketplace-usage na API com X-Maintenance-Token.
--    Leituras usam apenas a coluna usage_count; nunca COUNT() em tempo real.
-- 2. Denúncias ganham categoria ('abuse' | 'copyright'), campos de copyright,
--    limite de 10 denúncias por usuário em 24 horas e destaque na fila de moderação.
-- Nenhum fluxo do marketplace aceita arquivos: só JSON de modelo e links.

-- ---------------------------------------------------------------------------
-- Eventos de uso (append-only, sem acesso de clientes)
-- ---------------------------------------------------------------------------
create table public.marketplace_usage_events (
  id bigint generated always as identity primary key,
  system_id uuid not null references public.marketplace_systems(id) on delete cascade,
  clone_operation_id bigint not null unique,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index marketplace_usage_events_pending_idx on public.marketplace_usage_events(id) where applied_at is null;

alter table public.marketplace_usage_events enable row level security;
revoke all on public.marketplace_usage_events from public, anon, authenticated;
grant select, insert on public.marketplace_usage_events to service_role;
grant update (applied_at) on public.marketplace_usage_events to service_role;

-- Append-only: a única mudança permitida é marcar applied_at uma vez.
-- Exclusões só acontecem em cascata (remoção definitiva do sistema).
create or replace function private.guard_marketplace_usage_events()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'marketplace usage events are append-only' using errcode = '42501';
  end if;
  if old.applied_at is not null or new.applied_at is null
     or new.id <> old.id or new.system_id <> old.system_id
     or new.clone_operation_id <> old.clone_operation_id or new.created_at <> old.created_at then
    raise exception 'marketplace usage events are append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_marketplace_usage_events() from public;
create trigger marketplace_usage_events_append_only
  before update or delete on public.marketplace_usage_events
  for each row execute function private.guard_marketplace_usage_events();

-- Eventos já refletidos na coluna antes desta migration não são recriados.
insert into public.marketplace_usage_events(system_id, clone_operation_id, created_at, applied_at)
select op.system_id, op.id, op.created_at, now() from public.marketplace_clone_operations op;

-- Agregação idempotente em lote. Um único agregador por vez (try lock): chamadas
-- concorrentes retornam 0 sem esperar. Não altera updated_at.
create or replace function public.marketplace_apply_usage_events(p_batch_size integer default 1000)
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  applied integer := 0;
begin
  if p_batch_size is null or p_batch_size not between 1 and 50000 then
    raise exception 'invalid batch size' using errcode = '22023';
  end if;
  if not pg_try_advisory_xact_lock(hashtext('marketplace_apply_usage_events')) then
    return 0;
  end if;
  with picked as (
    select event.id from public.marketplace_usage_events event
     where event.applied_at is null
     order by event.id
     limit p_batch_size
     for update skip locked
  ), marked as (
    update public.marketplace_usage_events event set applied_at = now()
      from picked where event.id = picked.id
    returning event.system_id
  ), totals as (
    select marked.system_id, count(*)::bigint as uses from marked group by marked.system_id
  ), bumped as (
    update public.marketplace_systems item set usage_count = item.usage_count + totals.uses
      from totals where item.id = totals.system_id
    returning item.id
  )
  select coalesce(sum(totals.uses), 0)::integer into applied from totals;
  return applied;
end;
$$;
revoke all on function public.marketplace_apply_usage_events(integer) from public, anon, authenticated;
grant execute on function public.marketplace_apply_usage_events(integer) to service_role;
comment on function public.marketplace_apply_usage_events(integer) is
  'Service-only maintenance: applies pending marketplace_usage_events to usage_count in one batch and marks them applied. Safe to run repeatedly.';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$select cron.schedule('marketplace-usage-aggregation', '* * * * *', 'select public.marketplace_apply_usage_events(5000)')$cron$;
  end if;
end;
$$;

-- Ordenação por popularidade lê a coluna via índice parcial.
create index marketplace_systems_popular_idx on public.marketplace_systems(usage_count desc, id) where status = 'published';

drop function public.marketplace_search(text, text[], integer, integer);
create function public.marketplace_search(
  p_q text default null,
  p_tags text[] default '{}',
  p_page integer default 1,
  p_limit integer default 20,
  p_sort text default 'recent'
) returns table (
  id uuid, name text, description text, tags text[], author_name text, automation_level text,
  dependencies text[], updated_at timestamptz, usage_count bigint, likes bigint, dislikes bigint
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  page_size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  page_offset integer := (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if p_sort is not null and p_sort not in ('recent', 'popular') then
    raise exception 'invalid sort' using errcode = '22023';
  end if;
  if p_sort = 'popular' then
    return query
      select item.id, item.name, item.description, item.tags, item.author_name, item.automation_level,
             item.dependencies, item.updated_at, item.usage_count, item.likes, item.dislikes
        from public.marketplace_systems item
       where item.status = 'published'
         and (nullif(btrim(p_q), '') is null or item.search_document @@ plainto_tsquery('simple', btrim(p_q)))
         and (coalesce(cardinality(p_tags), 0) = 0 or item.tags && p_tags)
       order by item.usage_count desc, item.id
       limit page_size offset page_offset;
  else
    return query
      select item.id, item.name, item.description, item.tags, item.author_name, item.automation_level,
             item.dependencies, item.updated_at, item.usage_count, item.likes, item.dislikes
        from public.marketplace_systems item
       where item.status = 'published'
         and (nullif(btrim(p_q), '') is null or item.search_document @@ plainto_tsquery('simple', btrim(p_q)))
         and (coalesce(cardinality(p_tags), 0) = 0 or item.tags && p_tags)
       order by item.updated_at desc, item.id
       limit page_size offset page_offset;
  end if;
end;
$$;
revoke all on function public.marketplace_search(text, text[], integer, integer, text) from public;
grant execute on function public.marketplace_search(text, text[], integer, integer, text) to anon, authenticated;

-- Cópia: mesma lógica da versão de 20261026170000; o contador sai da transação quente.
-- A linha do sistema recebe lock compartilhado (cópias simultâneas não se bloqueiam;
-- ocultação/remoção concorrente ainda espera a cópia terminar).
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
  operation_id bigint;
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
  select * into source from public.marketplace_systems where id = p_system_id and status = 'published' for share;
  if not found then raise exception 'system unavailable' using errcode = 'P0001'; end if;
  new_name := left(source.name, 96) || ' [community-' || left(new_id::text, 8) || ']';
  insert into public.system_templates(id, campaign_id, owner_id, name, version, status, schema)
    values (new_id, p_campaign_id, actor, new_name, 1, 'needs_review', jsonb_set(source.template, '{name}', to_jsonb(new_name), true))
    returning * into inserted;
  insert into public.marketplace_clone_operations(system_id, campaign_id, user_id, idempotency_key, template_id)
    values (p_system_id, p_campaign_id, actor, p_idempotency_key, new_id)
    returning id into operation_id;
  insert into public.marketplace_usage_events(system_id, clone_operation_id) values (p_system_id, operation_id);
  return to_jsonb(inserted);
end;
$$;
revoke all on function public.marketplace_clone(uuid, uuid, text) from public;
grant execute on function public.marketplace_clone(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Denúncias: categoria copyright e limite por usuário
-- ---------------------------------------------------------------------------
alter table public.marketplace_reports
  add column category text not null default 'abuse' check (category in ('abuse', 'copyright')),
  add column claimed_work text check (claimed_work is null or char_length(claimed_work) between 2 and 300),
  add column rights_holder text check (rights_holder is null or char_length(rights_holder) between 2 and 200),
  add column evidence_url text check (evidence_url is null or (char_length(evidence_url) <= 500 and evidence_url ~ '^https?://[^[:space:]]+$')),
  add column good_faith_confirmed boolean not null default false,
  add constraint marketplace_reports_copyright_fields check (
    category <> 'copyright' or (claimed_work is not null and rights_holder is not null and good_faith_confirmed)
  );
create index marketplace_reports_reporter_recent_idx on public.marketplace_reports(reporter_id, created_at desc);

create or replace function private.marketplace_file_report(
  p_actor uuid, p_system_id uuid, p_reason text, p_category text,
  p_claimed_work text, p_rights_holder text, p_evidence_url text, p_good_faith boolean
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  report_id uuid;
begin
  if p_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 10 and 2000 then
    raise exception 'invalid report reason' using errcode = '22023';
  end if;
  -- Serializa as denúncias do mesmo usuário para que o limite não seja contornado em paralelo.
  perform pg_advisory_xact_lock(hashtext('marketplace_report'), hashtext(p_actor::text));
  if (select count(*) from public.marketplace_reports
       where reporter_id = p_actor and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'report limit reached' using errcode = '54000';
  end if;
  perform 1 from public.marketplace_systems where id = p_system_id and status = 'published' for update;
  if not found then raise exception 'system unavailable' using errcode = 'P0001'; end if;
  insert into public.marketplace_reports(system_id, reporter_id, reason, category, claimed_work, rights_holder, evidence_url, good_faith_confirmed)
    values (p_system_id, p_actor, btrim(p_reason), p_category, p_claimed_work, p_rights_holder, p_evidence_url, coalesce(p_good_faith, false))
    returning id into report_id;
  update public.marketplace_systems set status = 'hidden', updated_at = now() where id = p_system_id;
  return report_id;
end;
$$;
revoke all on function private.marketplace_file_report(uuid, uuid, text, text, text, text, text, boolean) from public;

-- Mesma regra da versão de 20261025101000 (oculta o sistema), agora com limite diário.
create or replace function public.marketplace_report(p_system_id uuid, p_reason text)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
  return private.marketplace_file_report(auth.uid(), p_system_id, p_reason, 'abuse', null, null, null, false);
end;
$$;
revoke all on function public.marketplace_report(uuid, text) from public;
grant execute on function public.marketplace_report(uuid, text) to authenticated;

create or replace function public.marketplace_report_copyright(
  p_system_id uuid,
  p_reason text,
  p_claimed_work text,
  p_rights_holder text,
  p_evidence_url text default null,
  p_good_faith boolean default false
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  work text := nullif(btrim(p_claimed_work), '');
  holder text := nullif(btrim(p_rights_holder), '');
  link text := nullif(btrim(p_evidence_url), '');
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_good_faith is not true then
    raise exception 'good faith statement required' using errcode = '22023';
  end if;
  if work is null or char_length(work) not between 2 and 300 or holder is null or char_length(holder) not between 2 and 200 then
    raise exception 'claimed work and rights holder are required' using errcode = '22023';
  end if;
  if link is not null and (char_length(link) > 500 or link !~ '^https?://[^[:space:]]+$') then
    raise exception 'invalid evidence link' using errcode = '22023';
  end if;
  return private.marketplace_file_report(auth.uid(), p_system_id, p_reason, 'copyright', work, holder, link, true);
end;
$$;
revoke all on function public.marketplace_report_copyright(uuid, text, text, text, text, boolean) from public;
grant execute on function public.marketplace_report_copyright(uuid, text, text, text, text, boolean) to authenticated;

-- Fila de moderação (versão de 20261027120000) + categoria e campos de copyright;
-- copyright aparece primeiro. Continua sem identificar quem denunciou.
drop function public.marketplace_moderation_queue(integer, integer);
create function public.marketplace_moderation_queue(p_page integer default 1, p_limit integer default 20)
returns table (
  id uuid, system_id uuid, system_name text, author_name text, system_status text,
  reason text, created_at timestamptz, open_reports bigint,
  category text, claimed_work text, rights_holder text, evidence_url text
) language plpgsql stable security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
  if not private.is_marketplace_admin() then
    raise exception 'marketplace administrator required' using errcode = '42501';
  end if;
  return query
    select report.id, report.system_id, item.name, item.author_name, item.status,
           report.reason, report.created_at,
           (select count(*) from public.marketplace_reports other
             where other.system_id = report.system_id and other.status = 'open'),
           report.category, report.claimed_work, report.rights_holder, report.evidence_url
      from public.marketplace_reports report
      join public.marketplace_systems item on item.id = report.system_id
     where report.status = 'open'
     order by (report.category = 'copyright') desc, report.created_at, report.id
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
    offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
revoke all on function public.marketplace_moderation_queue(integer, integer) from public;
grant execute on function public.marketplace_moderation_queue(integer, integer) to authenticated;

comment on table public.marketplace_usage_events is
  'Append-only clone usage events. Written by marketplace_clone, applied to marketplace_systems.usage_count by marketplace_apply_usage_events. No client access.';
