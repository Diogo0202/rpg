-- Leituras da interface de moderação do marketplace. Toda verificação de moderador
-- acontece aqui (marketplace_admins); o cliente nunca informa a própria permissão.
-- Nenhuma leitura devolve owner_id, reporter_id ou moderator_id.

-- Liga ações vindas de denúncias ao histórico privado.
alter table public.marketplace_moderation_log
  add column report_id uuid references public.marketplace_reports(id) on delete set null;

create or replace function private.is_marketplace_admin()
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null and exists (select 1 from public.marketplace_admins where user_id = auth.uid());
$$;
revoke all on function private.is_marketplace_admin() from public;

-- Consulta segura para a interface: responde apenas sobre a sessão atual.
create or replace function public.marketplace_is_moderator()
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth, private
as $$
  select private.is_marketplace_admin();
$$;
revoke all on function public.marketplace_is_moderator() from public;
grant execute on function public.marketplace_is_moderator() to anon, authenticated;

-- Fila de denúncias abertas, sem identificar quem denunciou.
create or replace function public.marketplace_moderation_queue(p_page integer default 1, p_limit integer default 20)
returns table (
  id uuid, system_id uuid, system_name text, author_name text, system_status text,
  reason text, created_at timestamptz, open_reports bigint
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
             where other.system_id = report.system_id and other.status = 'open')
      from public.marketplace_reports report
      join public.marketplace_systems item on item.id = report.system_id
     where report.status = 'open'
     order by report.created_at, report.id
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
    offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
revoke all on function public.marketplace_moderation_queue(integer, integer) from public;
grant execute on function public.marketplace_moderation_queue(integer, integer) to authenticated;

-- Busca de sistemas em qualquer estado para ação direta (ocultar, restaurar, remover).
create or replace function public.marketplace_moderation_systems(
  p_status text default null, p_q text default null, p_page integer default 1, p_limit integer default 20
) returns table (
  id uuid, name text, author_name text, status text, updated_at timestamptz, open_reports bigint
) language plpgsql stable security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
  if not private.is_marketplace_admin() then
    raise exception 'marketplace administrator required' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('published', 'hidden', 'removed') then
    raise exception 'invalid status filter' using errcode = '22023';
  end if;
  if p_q is not null and char_length(p_q) > 120 then
    raise exception 'search too long' using errcode = '22023';
  end if;
  return query
    select item.id, item.name, item.author_name, item.status, item.updated_at,
           (select count(*) from public.marketplace_reports report
             where report.system_id = item.id and report.status = 'open')
      from public.marketplace_systems item
     where (p_status is null or item.status = p_status)
       and (nullif(btrim(p_q), '') is null or item.search_document @@ plainto_tsquery('simple', btrim(p_q))
            or item.name ilike '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     order by item.updated_at desc, item.id
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
    offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
revoke all on function public.marketplace_moderation_systems(text, text, integer, integer) from public;
grant execute on function public.marketplace_moderation_systems(text, text, integer, integer) to authenticated;

-- Histórico do log privado; indica apenas se a ação foi da própria sessão.
create or replace function public.marketplace_moderation_history(p_page integer default 1, p_limit integer default 20)
returns table (
  id bigint, system_id uuid, system_name text, action text, previous_status text, current_status text,
  note text, from_report boolean, by_me boolean, created_at timestamptz
) language plpgsql stable security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
  if not private.is_marketplace_admin() then
    raise exception 'marketplace administrator required' using errcode = '42501';
  end if;
  return query
    select log.id, log.system_id, item.name, log.action, log.previous_status, item.status,
           log.note, log.report_id is not null, log.moderator_id = auth.uid(), log.created_at
      from public.marketplace_moderation_log log
      join public.marketplace_systems item on item.id = log.system_id
     order by log.created_at desc, log.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
    offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
revoke all on function public.marketplace_moderation_history(integer, integer) from public;
grant execute on function public.marketplace_moderation_history(integer, integer) to authenticated;

-- Resolver denúncia passa a registrar no histórico (mesmas regras da versão anterior).
create or replace function public.marketplace_resolve_report(p_report_id uuid, p_action text, p_resolution_note text default null)
returns void language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor uuid := auth.uid();
  report public.marketplace_reports%rowtype;
  current_status text;
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
  select status into current_status from public.marketplace_systems where id = report.system_id for update;
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
  insert into public.marketplace_moderation_log(system_id, moderator_id, action, previous_status, note, report_id)
    values (report.system_id, actor, p_action, current_status, nullif(btrim(p_resolution_note), ''), p_report_id);
end;
$$;
revoke all on function public.marketplace_resolve_report(uuid, text, text) from public;
grant execute on function public.marketplace_resolve_report(uuid, text, text) to authenticated;

comment on function public.marketplace_is_moderator() is 'True only when the current session belongs to marketplace_admins. UI hint; every moderation RPC re-checks.';
