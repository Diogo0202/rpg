-- Each increase in excess Stains causes persistent Aggravated Willpower damage.
-- The row trigger makes the effect atomic for RPC and direct sheet writes alike.
create or replace function private.v5_apply_excess_stain_damage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  template_schema jsonb;
  old_humanity integer := 7;
  old_stains integer := 0;
  new_humanity integer := 7;
  new_stains integer := 0;
  old_excess integer := 0;
  new_excess integer := 0;
  added integer := 0;
  aggravated integer := 0;
begin
  select schema into template_schema from public.system_templates
   where id = new.template_id and campaign_id = new.campaign_id;
  if template_schema is null or not private.v5_is_vampire_schema(template_schema) then
    return new;
  end if;

  new_humanity := greatest(0, least(10, private.v5_sheet_int(new.values, 'humanidade', 7)));
  new_stains := greatest(0, least(10, private.v5_sheet_int(new.values, 'manchas', 0)));
  new_excess := greatest(0, new_stains - (10 - new_humanity));
  if tg_op = 'UPDATE' then
    old_humanity := greatest(0, least(10, private.v5_sheet_int(old.values, 'humanidade', 7)));
    old_stains := greatest(0, least(10, private.v5_sheet_int(old.values, 'manchas', 0)));
    old_excess := greatest(0, old_stains - (10 - old_humanity));
  end if;

  added := greatest(0, new_excess - old_excess);
  if added = 0 then return new; end if;

  aggravated := greatest(0, private.v5_sheet_int(new.values, 'vontade_agravada', 0));
  new.values := jsonb_set(new.values, '{vontade_agravada}', to_jsonb(least(30, aggravated + added)), true);
  return new;
end;
$$;
revoke all on function private.v5_apply_excess_stain_damage() from public;

create trigger character_sheets_v5_excess_stain_damage
  before insert or update of values on public.character_sheets
  for each row execute function private.v5_apply_excess_stain_damage();
