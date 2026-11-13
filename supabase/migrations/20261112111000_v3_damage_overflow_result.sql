-- Report V3 damage that exceeds the seven marked health levels. The narrator
-- decides incapacity, torpor or Final Death; the system must show unapplied levels.
create or replace function public.v3_apply_damage(p_sheet_id uuid, p_operation_id uuid, p_kind text, p_amount integer)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  sheet public.character_sheets;
  prior public.character_sheet_events;
  field_id text;
  applied integer;
  effective integer;
  marked integer;
  reason text;
begin
  if p_operation_id is null then raise exception 'operation ID required' using errcode = '22023'; end if;
  if p_kind not in ('contundente', 'letal', 'agravado') or p_amount is null or p_amount not between 1 and 20 then
    raise exception 'damage needs a kind (contundente, letal, agravado) and 1 to 20 levels' using errcode = '22023';
  end if;
  reason := 'v3 dano ' || p_kind || ' ' || p_amount;
  field_id := 'dano_' || p_kind;
  sheet := private.v3_lock_sheet(p_sheet_id);
  prior := private.v3_prior_event(sheet, p_operation_id);
  if prior.id is not null then return private.v3_replay(sheet, prior, reason); end if;
  marked := private.v3_number(sheet.values, 'dano_contundente') + private.v3_number(sheet.values, 'dano_letal')
          + private.v3_number(sheet.values, 'dano_agravado');
  effective := case when p_kind = 'contundente' then p_amount / 2 else p_amount end;
  applied := least(effective, greatest(0, 7 - marked));
  if applied = 0 then
    return jsonb_build_object('sheet', to_jsonb(sheet), 'event', null, 'replayed', false,
      'applied', 0, 'unapplied', effective);
  end if;
  return private.v3_write(sheet, p_operation_id,
    jsonb_build_object(field_id, private.v3_number(sheet.values, field_id) + applied), field_id, applied, reason)
    || jsonb_build_object('applied', applied, 'unapplied', effective - applied);
end;
$$;
revoke all on function public.v3_apply_damage(uuid, uuid, text, integer) from public, anon;
grant execute on function public.v3_apply_damage(uuid, uuid, text, integer) to authenticated;
