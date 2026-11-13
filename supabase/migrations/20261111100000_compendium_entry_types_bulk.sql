-- Novos tipos de verbete (mérito, defeito, ritual, magia, poder, item, regra) e importação
-- em lote pelo narrador. Os verbetes importados entram como pendentes e passam pela mesma
-- revisão das propostas individuais; nenhum texto de livro oficial é incluído.

alter table public.campaign_compendium_entries
  drop constraint if exists campaign_compendium_entries_entry_type_check;
alter table public.campaign_compendium_entries
  add constraint campaign_compendium_entries_entry_type_check
  check (entry_type in ('discipline', 'advantage', 'merit', 'flaw', 'ritual', 'spell', 'power', 'item', 'rule'));

-- Mesmas regras de compendium_propose_entry (limites da tabela), mais página obrigatória
-- para fonte licenciada. Devolve a mensagem de erro ou null quando o verbete é válido.
create or replace function private.compendium_import_entry_error(p jsonb)
returns text language plpgsql stable
set search_path = pg_catalog, public, private
as $$
declare
  v text;
  k text;
  kind text;
  page integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'entry must be an object'; end if;

  if jsonb_typeof(p->'title') is distinct from 'string' then return 'title is required'; end if;
  v := btrim(p->>'title');
  if char_length(v) not between 1 and 120 then return 'title must have 1 to 120 characters'; end if;

  if jsonb_typeof(p->'entry_type') is distinct from 'string'
     or (p->>'entry_type') not in ('discipline', 'advantage', 'merit', 'flaw', 'ritual', 'spell', 'power', 'item', 'rule') then
    return 'invalid entry_type';
  end if;

  if p->'level' is not null and jsonb_typeof(p->'level') <> 'null'
     and (jsonb_typeof(p->'level') <> 'number' or (p->>'level') !~ '^[0-5]$') then
    return 'level must be an integer from 0 to 5';
  end if;

  if p->'tags' is not null and jsonb_typeof(p->'tags') <> 'null' then
    if jsonb_typeof(p->'tags') <> 'array'
       or exists (select 1 from jsonb_array_elements(p->'tags') t where jsonb_typeof(t) <> 'string') then
      return 'tags must be a list of text';
    end if;
    begin
      perform private.normalized_compendium_tags(array(select jsonb_array_elements_text(p->'tags')));
    exception when others then
      return 'invalid tags (up to 20 tags of up to 40 characters)';
    end;
  end if;

  foreach k in array array['cost', 'pool', 'duration'] loop
    if p->k is not null and jsonb_typeof(p->k) <> 'null' then
      if jsonb_typeof(p->k) <> 'string' or char_length(btrim(p->>k)) > 240 then
        return k || ' must be text with up to 240 characters';
      end if;
    end if;
  end loop;

  if jsonb_typeof(p->'description') is distinct from 'string'
     or char_length(btrim(p->>'description')) not between 1 and 4000 then
    return 'description must have 1 to 4000 characters';
  end if;

  if jsonb_typeof(p->'source_title') is distinct from 'string'
     or char_length(btrim(p->>'source_title')) not between 1 and 240 then
    return 'source_title must have 1 to 240 characters';
  end if;

  kind := case when p->'source_kind' is null or jsonb_typeof(p->'source_kind') = 'null' then 'homebrew' else p->>'source_kind' end;
  if jsonb_typeof(coalesce(p->'source_kind', '"homebrew"'::jsonb)) not in ('string', 'null')
     or kind not in ('homebrew', 'licensed') then
    return 'source_kind must be homebrew or licensed';
  end if;

  if p->'source_page' is not null and jsonb_typeof(p->'source_page') <> 'null' then
    if jsonb_typeof(p->'source_page') <> 'number' or (p->>'source_page') !~ '^[0-9]{1,4}$' then
      return 'source_page must be an integer from 1 to 5000';
    end if;
    page := (p->>'source_page')::integer;
    if page not between 1 and 5000 then return 'source_page must be an integer from 1 to 5000'; end if;
  end if;
  if kind = 'licensed' and page is null then return 'licensed entry requires source_page'; end if;

  return null;
end;
$$;
revoke all on function private.compendium_import_entry_error(jsonb) from public;

create or replace function public.compendium_import_entries(p_campaign_id uuid, p_entries jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  actor uuid := auth.uid();
  total integer;
  errors jsonb := '[]'::jsonb;
  item jsonb;
  idx integer := 0;
  msg text;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not private.can_manage_campaign(p_campaign_id) then
    raise exception 'campaign narrator required' using errcode = '42501';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'entries must be a list' using errcode = '22023';
  end if;
  total := jsonb_array_length(p_entries);
  if total > 200 then raise exception 'too many entries (max 200)' using errcode = '22023'; end if;

  for item in select value from jsonb_array_elements(p_entries) loop
    msg := private.compendium_import_entry_error(item);
    if msg is not null then
      errors := errors || jsonb_build_array(jsonb_build_object('index', idx, 'message', msg));
    end if;
    idx := idx + 1;
  end loop;

  if jsonb_array_length(errors) > 0 then
    return jsonb_build_object('inserted', 0, 'errors', errors);
  end if;

  insert into public.campaign_compendium_entries(
    campaign_id, proposed_by, title, entry_type, level, tags, cost, pool, duration,
    description, source_title, source_page, source_kind
  )
  select
    p_campaign_id, actor, btrim(e->>'title'), e->>'entry_type',
    coalesce((e->>'level')::smallint, 0::smallint),
    private.normalized_compendium_tags(
      case when jsonb_typeof(e->'tags') = 'array' then array(select jsonb_array_elements_text(e->'tags')) else '{}'::text[] end),
    btrim(coalesce(e->>'cost', '')), btrim(coalesce(e->>'pool', '')), btrim(coalesce(e->>'duration', '')),
    btrim(e->>'description'), btrim(e->>'source_title'),
    (e->>'source_page')::integer,
    coalesce(e->>'source_kind', 'homebrew')
  from jsonb_array_elements(p_entries) with ordinality as t(e, ord)
  order by ord;

  return jsonb_build_object('inserted', total, 'errors', '[]'::jsonb);
exception
  when check_violation or not_null_violation or numeric_value_out_of_range then
    raise exception 'invalid compendium entry' using errcode = '22023';
end;
$$;
revoke all on function public.compendium_import_entries(uuid, jsonb) from public, anon;
grant execute on function public.compendium_import_entries(uuid, jsonb) to authenticated;
