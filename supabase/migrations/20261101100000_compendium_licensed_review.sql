-- A fonte licenciada exige uma referência de página e a conferência registrada
-- pelo narrador. O texto do livro não é gravado nesta tabela.
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
  if p_action = 'approve' and entry.source_kind = 'licensed' and
     (entry.source_page is null or char_length(btrim(coalesce(p_note, ''))) < 12) then
    raise exception 'licensed entry requires source page and authorization review note' using errcode = '22023';
  end if;
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
