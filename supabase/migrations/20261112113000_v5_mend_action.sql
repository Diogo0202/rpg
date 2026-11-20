-- Remendar always heals; the Rouse Check determines whether Hunger rises.
-- Licensed Free Basic Rules: app.roll20.net/compendium/vtm/Rules:Rouse%20checks%20and%20using%20the%20Blood
alter table public.v5_blood_events drop constraint if exists v5_blood_events_kind_check;
alter table public.v5_blood_events add constraint v5_blood_events_kind_check
  check (kind in ('rouse', 'awaken', 'remorse', 'frenzy', 'compulsion', 'torpor', 'mend'));

create or replace function public.v5_mend(p_sheet_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  locked record;
  sheet public.character_sheets;
  replay jsonb;
  bp integer;
  potency jsonb;
  dice integer[];
  success boolean;
  hunger integer;
  hunger_after integer;
  health_before integer;
  health_after integer;
  healed integer;
  outcome jsonb;
  event public.v5_blood_events;
begin
  select * into locked from private.v5_lock_blood_sheet(p_sheet_id);
  sheet := locked.sheet;
  replay := private.v5_blood_replay(sheet, p_operation_id, 'mend');
  if replay is not null then return replay; end if;
  if (private.v5_template_field(locked.template_schema, 'saude_superficial') ->> 'kind') is distinct from 'number' then
    raise exception 'sheet has no superficial Health track' using errcode = '22023';
  end if;
  if private.v5_sheet_int(sheet.values, 'fome', 0) >= 5 then
    raise exception 'Hunger 5 forbids voluntary Rouse checks' using errcode = '23514';
  end if;
  bp := greatest(0, least(10, private.v5_sheet_int(sheet.values, 'potencia_sangue', 0)));
  potency := private.v5_blood_potency(bp);
  dice := array[private.v5_random_die()];
  success := dice[1] >= 6;
  hunger := greatest(0, least(5, private.v5_sheet_int(sheet.values, 'fome', 0)));
  hunger_after := case when success then hunger else least(5, hunger + 1) end;
  health_before := greatest(0, private.v5_sheet_int(sheet.values, 'saude_superficial', 0));
  healed := least(health_before, (potency ->> 'mend')::integer);
  health_after := health_before - healed;
  if hunger_after <> hunger or health_after <> health_before then
    sheet := private.v5_write_blood_values(sheet.id,
      jsonb_build_object('fome', hunger_after, 'saude_superficial', health_after));
  end if;
  outcome := jsonb_build_object(
    'success', success, 'hunger_before', hunger, 'hunger_after', hunger_after,
    'hunger_frenzy_test', not success and hunger = 5,
    'health_before', health_before, 'health_after', health_after, 'healed', healed,
    'maximum_healing', (potency ->> 'mend')::integer, 'blood_potency', bp);
  event := private.v5_record_blood_event(sheet, p_operation_id, 'mend', dice, outcome);
  return private.v5_blood_result(sheet, event);
end;
$$;
revoke all on function public.v5_mend(uuid, uuid) from public, anon;
grant execute on function public.v5_mend(uuid, uuid) to authenticated;
