begin;
select plan(27);

insert into auth.users (id, aud, role, email)
values
  ('12000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'adjust-player@example.test'),
  ('12000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'adjust-master@example.test'),
  ('12000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'adjust-other-player@example.test'),
  ('12000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'adjust-outsider@example.test');
insert into public.campaigns (id, owner_id, name)
values ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000002', 'Adjust Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'player'),
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000003', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('32000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001',
        '12000000-0000-0000-0000-000000000002', 'Adjust Template', 'approved',
        '{"fields":[{"id":"name","kind":"text"},{"id":"saude_superficial","kind":"number"},
          {"id":"vontade_superficial","kind":"number"},{"id":"inspiracao","kind":"number"},
          {"id":"xp_disponivel","kind":"number"},{"id":"nota","kind":"text"}],
          "experience_field":"xp_disponivel",
          "meta_currencies":[
            {"id":"vontade","label":"Força de Vontade","field":"vontade_superficial","mode":"track","max":5},
            {"id":"inspiracao","label":"Inspiração","field":"inspiracao","mode":"pool","max":1}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values)
values
  ('42000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001',
   '12000000-0000-0000-0000-000000000001', 'Player Sheet', '{"name":"A","saude_superficial":0}'::jsonb),
  ('42000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001',
   '12000000-0000-0000-0000-000000000003', 'Other Player Sheet', '{"name":"B"}'::jsonb);

select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000002', 'Bad Currency', 'needs_review',
  '{"fields":[{"id":"nota","kind":"text"}],"meta_currencies":[{"id":"x","label":"X","field":"nota","mode":"pool"}]}'::jsonb)$$,
  null, null, 'meta currency must reference a number field');
select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000002', 'Bad XP', 'needs_review',
  '{"fields":[{"id":"nota","kind":"text"}],"experience_field":"nota"}'::jsonb)$$,
  null, null, 'experience_field must reference a number field');

-- Player: damage deltas sum without an expected version.
set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);
select is((public.adjust_sheet_number('42000000-0000-0000-0000-000000000001', 'saude_superficial', 2, 'golpe') -> 'sheet' -> 'values' ->> 'saude_superficial')::integer,
  2, 'owner adds superficial damage');
select is((public.adjust_sheet_number('42000000-0000-0000-0000-000000000001', 'saude_superficial', 1) -> 'sheet' -> 'values' ->> 'saude_superficial')::integer,
  3, 'a second delta adds to the current value instead of overwriting it');
select throws_ok($$select public.adjust_sheet_number('42000000-0000-0000-0000-000000000001', 'nota', 1)$$,
  '22023', null, 'text fields cannot be adjusted');
select throws_ok($$select public.adjust_sheet_number('42000000-0000-0000-0000-000000000001', 'saude_superficial', 5000)$$,
  '22023', null, 'delta is bounded');
select throws_ok($$select public.adjust_sheet_number('42000000-0000-0000-0000-000000000001', 'xp_disponivel', 10)$$,
  '22023', null, 'generic adjust cannot touch the experience field');
select throws_ok($$select public.adjust_sheet_number('42000000-0000-0000-0000-000000000001', 'inspiracao', 1)$$,
  '22023', null, 'generic adjust cannot touch a meta currency field');
select throws_ok($$select public.increment_xp('42000000-0000-0000-0000-000000000001', 5)$$,
  '42501', null, 'player cannot grant experience to self');
select throws_ok($$select public.spend_meta_currency('42000000-0000-0000-0000-000000000001', 'inspiracao', -1)$$,
  '42501', null, 'player cannot grant a pool currency to self');
select is((public.spend_meta_currency('42000000-0000-0000-0000-000000000001', 'vontade', 2, 'resistir') -> 'sheet' -> 'values' ->> 'vontade_superficial')::integer,
  2, 'spending willpower raises its damage track');
select throws_ok($$select public.spend_meta_currency('42000000-0000-0000-0000-000000000001', 'vontade', 4)$$,
  '23514', null, 'a track cannot exceed its fixed maximum');
select is((public.spend_meta_currency('42000000-0000-0000-0000-000000000001', 'vontade', -1) -> 'sheet' -> 'values' ->> 'vontade_superficial')::integer,
  1, 'owner may recover willpower');
select throws_ok($$select public.adjust_sheet_number('42000000-0000-0000-0000-000000000002', 'saude_superficial', 1)$$,
  '42501', null, 'player cannot adjust another player sheet');
select ok(not has_table_privilege('authenticated', 'public.character_sheet_events', 'insert,update,delete'), 'clients cannot write events directly');
select throws_ok($$select private.record_sheet_event('42000000-0000-0000-0000-000000000001', 'adjust', 'saude_superficial', null, 1, 0, 1, null)$$,
  '42501', null, 'an already logged sheet version cannot receive a forged event');

-- Master: grants XP and Inspiration on the player sheet.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000002', true);
select is((public.increment_xp('42000000-0000-0000-0000-000000000001', 10, 'sessão 3') -> 'sheet' -> 'values' ->> 'xp_disponivel')::integer,
  10, 'master grants experience');
select is((public.spend_meta_currency('42000000-0000-0000-0000-000000000001', 'inspiracao', -1) -> 'sheet' -> 'values' ->> 'inspiracao')::integer,
  1, 'master grants inspiration');
select throws_ok($$select public.spend_meta_currency('42000000-0000-0000-0000-000000000001', 'inspiracao', -1)$$,
  '23514', null, 'pool cannot exceed its maximum');

-- Player: spends what the master granted.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);
select is((public.increment_xp('42000000-0000-0000-0000-000000000001', -4, 'atributo') -> 'sheet' -> 'values' ->> 'xp_disponivel')::integer,
  6, 'owner spends experience');
select throws_ok($$select public.increment_xp('42000000-0000-0000-0000-000000000001', -7)$$,
  '23514', null, 'experience cannot go negative');
select throws_ok($$update public.character_sheets set values = values || '{"xp_disponivel":99}'::jsonb
  where id = '42000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'owner cannot raise experience by overwriting values');
select throws_ok($$update public.character_sheets set values = values || '{"inspiracao":2}'::jsonb
  where id = '42000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'owner cannot raise a pool currency by overwriting values');
select lives_ok($$update public.character_sheets set values = values || '{"xp_disponivel":5,"saude_superficial":0}'::jsonb
  where id = '42000000-0000-0000-0000-000000000001'$$,
  'owner may still lower experience and edit other fields directly');
select is((select count(*)::integer from public.character_sheet_events where sheet_id = '42000000-0000-0000-0000-000000000001'),
  7, 'every successful adjustment is logged');
select is((select (value_before, value_after, actor_id)::text from public.character_sheet_events
            where sheet_id = '42000000-0000-0000-0000-000000000001' and kind = 'experience' order by id limit 1),
  '(0,10,12000000-0000-0000-0000-000000000002)', 'event records before, after and the master as actor');

-- Outsider sees neither the sheet nor its events.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000004', true);
select is((select count(*)::integer from public.character_sheet_events), 0, 'outsider cannot read sheet events');

select * from finish();
rollback;
