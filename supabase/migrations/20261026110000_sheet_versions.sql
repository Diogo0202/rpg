-- FIC-18: histórico navegável de versões da ficha e restauração.
-- Cada gravação que muda nome ou valores guarda um retrato da ficha
-- (versão, autor e data). Só as últimas 50 versões de cada ficha ficam
-- guardadas. A restauração regrava o retrato como uma nova versão, passando
-- pelas mesmas validações, regras de criação e guardas de XP/recursos de
-- qualquer edição, e exige a versão atual esperada (controle otimista, FIC-13).

create table public.character_sheet_versions (
  id bigint generated always as identity primary key,
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  template_id uuid not null,
  version integer not null check (version > 0),
  name text not null,
  values jsonb not null,
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  restored_from integer check (restored_from is null or restored_from > 0),
  created_at timestamptz not null default now(),
  unique (sheet_id, version)
);
comment on table public.character_sheet_versions is
  'Retratos das últimas 50 versões de cada ficha (nome e valores), gravados por trigger.';

alter table public.character_sheet_versions enable row level security;
revoke all on public.character_sheet_versions from public, anon, authenticated;
grant select on public.character_sheet_versions to authenticated;
-- As versões são visíveis exatamente quando a ficha é visível pela RLS dela.
create policy "sheet readers read sheet versions"
  on public.character_sheet_versions for select to authenticated
  using (exists (select 1 from public.character_sheets sheet where sheet.id = sheet_id));

create or replace function private.record_character_sheet_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  cutoff integer;
begin
  if tg_op = 'UPDATE'
     and new.values is not distinct from old.values
     and new.name is not distinct from old.name then
    return null;
  end if;
  insert into public.character_sheet_versions
    (sheet_id, campaign_id, template_id, version, name, values, author_id, author_name, restored_from)
  values (
    new.id, new.campaign_id, new.template_id, new.version, new.name, new.values, auth.uid(),
    (select profile.display_name from public.profiles profile where profile.id = auth.uid()),
    nullif(current_setting('rpg.sheet_restored_from', true), '')::integer
  )
  on conflict (sheet_id, version) do nothing;

  select kept.version into cutoff
    from public.character_sheet_versions kept
   where kept.sheet_id = new.id
   order by kept.version desc
  offset 49 limit 1;
  if cutoff is not null then
    delete from public.character_sheet_versions old_version
     where old_version.sheet_id = new.id and old_version.version < cutoff;
  end if;
  return null;
end;
$$;
revoke all on function private.record_character_sheet_version() from public, anon, authenticated;

create trigger character_sheets_record_version
  after insert or update on public.character_sheets
  for each row execute function private.record_character_sheet_version();

-- Fichas existentes começam o histórico com o estado atual.
insert into public.character_sheet_versions (sheet_id, campaign_id, template_id, version, name, values, created_at)
select sheet.id, sheet.campaign_id, sheet.template_id, sheet.version, sheet.name, sheet.values, sheet.updated_at
  from public.character_sheets sheet
on conflict (sheet_id, version) do nothing;

-- Security invoker: o bloqueio e a gravação passam pela RLS da ficha, então só
-- o jogador dono ou quem administra a campanha restaura. Códigos de erro:
--   42501 sem acesso de escrita · 40001 a ficha mudou (versão esperada)
--   P0002 versão não existe no histórico · 22023 restauração inválida
create or replace function public.restore_character_sheet_version(
  p_sheet_id uuid, p_version integer, p_expected_version integer
)
returns public.character_sheets
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  snapshot public.character_sheet_versions;
begin
  if auth.uid() is null then raise exception 'session required' using errcode = '42501'; end if;
  select * into sheet from public.character_sheets where id = p_sheet_id for update;
  if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  if p_expected_version is null or sheet.version <> p_expected_version then
    raise exception 'sheet changed since version %', p_expected_version using errcode = '40001';
  end if;
  select * into snapshot from public.character_sheet_versions
   where sheet_id = p_sheet_id and version = p_version;
  if not found then raise exception 'version % not in sheet history', p_version using errcode = 'P0002'; end if;
  if snapshot.template_id is distinct from sheet.template_id then
    raise exception 'version % uses another template', p_version using errcode = '22023';
  end if;
  if snapshot.version = sheet.version then
    raise exception 'version % is already the current version', p_version using errcode = '22023';
  end if;
  perform set_config('rpg.sheet_restored_from', p_version::text, true);
  update public.character_sheets
     set name = snapshot.name, values = snapshot.values
   where id = p_sheet_id
  returning * into sheet;
  if not found then raise exception 'sheet not found or not writable' using errcode = '42501'; end if;
  perform set_config('rpg.sheet_restored_from', '', true);
  return sheet;
end;
$$;
revoke all on function public.restore_character_sheet_version(uuid, integer, integer) from public, anon;
grant execute on function public.restore_character_sheet_version(uuid, integer, integer) to authenticated;
