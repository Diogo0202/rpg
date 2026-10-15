-- Character sheet effects stay within the existing sheet RLS and version trigger.
create or replace function private.valid_sheet_effects(p_effects jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_effect jsonb;
  v_tags jsonb;
  v_tag jsonb;
  v_id text;
  v_seen_ids text[] := array[]::text[];
  v_key text;
begin
  if jsonb_typeof(p_effects) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_effects) > 30
     or octet_length(p_effects::text) > 32768 then
    return false;
  end if;

  for v_effect in select value from jsonb_array_elements(p_effects)
  loop
    if jsonb_typeof(v_effect) is distinct from 'object' then
      return false;
    end if;

    if exists (
      select 1 from jsonb_object_keys(v_effect) as keys(key)
      where key not in (
        'id', 'label', 'delta', 'enabled', 'applies_to_tags',
        'exempt_tags', 'remaining_scenes', 'source_note'
      )
    ) then
      return false;
    end if;

    if jsonb_typeof(v_effect -> 'id') is distinct from 'string'
       or char_length(v_effect ->> 'id') not between 1 and 64
       or jsonb_typeof(v_effect -> 'label') is distinct from 'string'
       or char_length(v_effect ->> 'label') not between 1 and 120
       or jsonb_typeof(v_effect -> 'delta') is distinct from 'number' then
      return false;
    end if;
    if (v_effect ->> 'delta') !~ '^-?[0-9]+$' then
      return false;
    end if;
    if (v_effect ->> 'delta')::numeric not between -10 and 10 then
      return false;
    end if;

    v_id := v_effect ->> 'id';
    if v_id = any(v_seen_ids) then
      return false;
    end if;
    v_seen_ids := array_append(v_seen_ids, v_id);

    if v_effect ? 'enabled'
       and jsonb_typeof(v_effect -> 'enabled') is distinct from 'boolean' then
      return false;
    end if;

    foreach v_key in array array['applies_to_tags', 'exempt_tags']
    loop
      v_tags := coalesce(v_effect -> v_key, '[]'::jsonb);
      if jsonb_typeof(v_tags) is distinct from 'array' then
        return false;
      end if;
      if jsonb_array_length(v_tags) > 20 then
        return false;
      end if;
      for v_tag in select value from jsonb_array_elements(v_tags)
      loop
        if jsonb_typeof(v_tag) is distinct from 'string'
           or char_length(v_tag #>> '{}') not between 1 and 64 then
          return false;
        end if;
      end loop;
    end loop;

    if v_effect ? 'remaining_scenes'
       and jsonb_typeof(v_effect -> 'remaining_scenes') <> 'null' then
      if jsonb_typeof(v_effect -> 'remaining_scenes') is distinct from 'number'
         or (v_effect ->> 'remaining_scenes') !~ '^[0-9]+$' then
        return false;
      end if;
      if (v_effect ->> 'remaining_scenes')::numeric not between 0 and 1000 then
        return false;
      end if;
    end if;

    if v_effect ? 'source_note'
       and jsonb_typeof(v_effect -> 'source_note') <> 'null'
       and (
         jsonb_typeof(v_effect -> 'source_note') is distinct from 'string'
         or char_length(v_effect ->> 'source_note') > 500
       ) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

alter table public.character_sheets
  add column effects jsonb not null default '[]'::jsonb
  constraint character_sheets_effects_valid
  check (private.valid_sheet_effects(effects));

comment on column public.character_sheets.effects is
  'Efeitos versionados junto a ficha, validos por private.valid_sheet_effects.';
