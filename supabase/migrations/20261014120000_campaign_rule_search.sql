-- Retrieval is scoped to a signed-in campaign member, a granted source whose
-- owner confirmed its rights, and a source referenced by an approved template.
create index document_chunks_content_search_idx
  on public.document_chunks using gin (to_tsvector('simple', content));

create or replace function public.search_campaign_rules(
  p_campaign_id uuid,
  p_query text,
  p_limit integer default 5
)
returns table (
  source_id uuid,
  source_title text,
  page_number integer,
  excerpt text,
  rank real
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  search_query tsquery;
begin
  if auth.uid() is null or not private.is_campaign_member(p_campaign_id) then
    raise exception 'campaign access denied' using errcode = '42501';
  end if;
  if p_query is null or char_length(btrim(p_query)) not between 2 and 160 then
    raise exception 'query length must be between 2 and 160' using errcode = '22023';
  end if;
  search_query := plainto_tsquery('simple', btrim(p_query));

  return query
    select source.id, source.title, chunk.page_number,
           left(chunk.content, 1600),
           ts_rank_cd(to_tsvector('simple', chunk.content), search_query)
      from public.document_chunks chunk
      join public.library_sources source on source.id = chunk.source_id
     where to_tsvector('simple', chunk.content) @@ search_query
       and source.rights_confirmed
       and exists (
         select 1 from public.library_grants grant_row
          where grant_row.source_id = source.id
            and grant_row.campaign_id = p_campaign_id
       )
       and exists (
         select 1 from public.system_templates template
          where template.source_id = source.id
            and template.campaign_id = p_campaign_id
            and template.status = 'approved'
            and template.approved_at is not null
       )
     order by 5 desc, source.title, chunk.page_number
     limit least(greatest(coalesce(p_limit, 5), 1), 10);
end;
$$;

create or replace function public.get_campaign_rule_page(
  p_campaign_id uuid,
  p_source_id uuid,
  p_page_number integer
)
returns table (
  source_id uuid,
  source_title text,
  page_number integer,
  content text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
  if auth.uid() is null or not private.is_campaign_member(p_campaign_id) then
    raise exception 'campaign access denied' using errcode = '42501';
  end if;
  if p_page_number is null or p_page_number < 1 then
    raise exception 'page number must be positive' using errcode = '22023';
  end if;

  return query
    select source.id, source.title, chunk.page_number,
           left(string_agg(left(chunk.content, 1000), E'\n' order by chunk.created_at, chunk.id), 12000)
      from public.library_sources source
      join lateral (
        select item.id, item.page_number, item.content, item.created_at
          from public.document_chunks item
         where item.source_id = source.id
           and item.page_number = p_page_number
         order by item.created_at, item.id
         limit 12
      ) chunk on true
     where source.id = p_source_id
       and source.rights_confirmed
       and exists (
         select 1 from public.library_grants grant_row
          where grant_row.source_id = source.id
            and grant_row.campaign_id = p_campaign_id
       )
       and exists (
         select 1 from public.system_templates template
          where template.source_id = source.id
            and template.campaign_id = p_campaign_id
            and template.status = 'approved'
            and template.approved_at is not null
       )
     group by source.id, source.title, chunk.page_number;
end;
$$;

revoke all on function public.search_campaign_rules(uuid, text, integer) from public, anon;
revoke all on function public.get_campaign_rule_page(uuid, uuid, integer) from public, anon;
grant execute on function public.search_campaign_rules(uuid, text, integer) to authenticated;
grant execute on function public.get_campaign_rule_page(uuid, uuid, integer) to authenticated;
