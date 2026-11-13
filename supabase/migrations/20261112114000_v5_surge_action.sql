-- Blood Surge: one use per sheet/turn key; the Rouse result is resolved with the bonus.
alter table public.v5_blood_events drop constraint if exists v5_blood_events_kind_check;
alter table public.v5_blood_events add constraint v5_blood_events_kind_check
  check (kind in ('rouse', 'awaken', 'remorse', 'frenzy', 'compulsion', 'torpor', 'mend', 'surge'));
create unique index v5_blood_events_surge_turn_idx
  on public.v5_blood_events (sheet_id, (outcome ->> 'turn_key')) where kind = 'surge';

create or replace function public.v5_blood_surge(p_sheet_id uuid, p_operation_id uuid, p_turn_key text, p_base_pool integer)
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
  die integer;
  success boolean;
  hunger integer;
  hunger_after integer;
  outcome jsonb;
  event public.v5_blood_events;
begin
  if p_turn_key is null or length(btrim(p_turn_key)) not between 1 and 120 then
    raise exception 'turn key must contain 1 to 120 characters' using errcode = '22023';
  end if;
  select * into locked from private.v5_lock_blood_sheet(p_sheet_id);
  sheet := locked.sheet;
  replay := private.v5_blood_replay(sheet, p_operation_id, 'surge');
  if replay is not null then
    if replay -> 'event' -> 'outcome' ->> 'turn_key' is distinct from btrim(p_turn_key)
       or (replay -> 'event' -> 'outcome' ->> 'base_pool')::integer is distinct from p_base_pool then
      raise exception 'operation ID was already used in another turn' using errcode = '23505';
    end if;
    return replay;
  end if;
  select * into event from public.v5_blood_events previous
   where previous.sheet_id=sheet.id and previous.kind='surge' and previous.outcome->>'turn_key'=btrim(p_turn_key);
  if found then
    if event.actor_id <> auth.uid() or (event.outcome->>'base_pool')::integer is distinct from p_base_pool then
      raise exception 'Blood Surge already used this turn for another action' using errcode='23505';
    end if;
    return private.v5_blood_result(sheet,event) || jsonb_build_object('replayed',true);
  end if;
  if private.v5_sheet_int(sheet.values, 'fome', 0) >= 5 then
    raise exception 'Hunger 5 forbids voluntary Rouse checks' using errcode = '23514';
  end if;
  bp := greatest(0, least(10, private.v5_sheet_int(sheet.values, 'potencia_sangue', 0)));
  potency := private.v5_blood_potency(bp);
  if p_base_pool is null or p_base_pool not between 0 and 30
     or p_base_pool + (potency ->> 'surge')::integer > 30 then
    raise exception 'Blood Surge pool must stay between 1 and 30 dice' using errcode = '22023';
  end if;
  die := private.v5_random_die();
  success := die >= 6;
  hunger := greatest(0, least(5, private.v5_sheet_int(sheet.values, 'fome', 0)));
  hunger_after := case when success then hunger else least(5, hunger + 1) end;
  if hunger_after <> hunger then
    sheet := private.v5_write_blood_values(sheet.id, jsonb_build_object('fome', hunger_after));
  end if;
  outcome := jsonb_build_object('success', success, 'rouse_die', die, 'turn_key', btrim(p_turn_key), 'base_pool', p_base_pool,
    'bonus_dice', (potency ->> 'surge')::integer, 'blood_potency', bp,
    'hunger_before', hunger, 'hunger_after', hunger_after,
    'hunger_frenzy_test', not success and hunger = 5);
  event := private.v5_record_blood_event(sheet, p_operation_id, 'surge', array[die], outcome);
  return private.v5_blood_result(sheet, event);
end;
$$;
revoke all on function public.v5_blood_surge(uuid, uuid, text, integer) from public, anon;
grant execute on function public.v5_blood_surge(uuid, uuid, text, integer) to authenticated;

-- Security-definer V5 mutations must reject a former member even if they own the sheet.
create or replace function private.can_write_sheet(p_sheet public.character_sheets)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, private, auth
as $$
  select auth.uid() is not null and (
    (p_sheet.owner_id = auth.uid() and private.is_campaign_player(p_sheet.campaign_id))
    or private.can_manage_campaign(p_sheet.campaign_id)
  );
$$;
revoke all on function private.can_write_sheet(public.character_sheets) from public;
