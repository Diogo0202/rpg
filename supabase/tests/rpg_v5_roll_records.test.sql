begin;
select plan(27);

insert into auth.users (id, aud, role, email)
values
  ('16000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'v5roll-player@example.test'),
  ('16000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'v5roll-master@example.test'),
  ('16000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'v5roll-other@example.test'),
  ('16000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'v5roll-outsider@example.test');
insert into public.campaigns (id, owner_id, name)
values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'V5 Rolls');
insert into public.campaign_members (campaign_id, user_id, role)
values
  ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 'player'),
  ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000003', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001',
        '16000000-0000-0000-0000-000000000002', 'V5 Rolls Template', 'approved',
        '{"fields":[{"id":"name","kind":"text"},{"id":"autocontrole","kind":"number"},{"id":"resolucao","kind":"number"},
          {"id":"vontade_superficial","kind":"number"},{"id":"vontade_agravada","kind":"number"},
          {"id":"vontade_max","kind":"formula","formula":"autocontrole + resolucao"}],
          "meta_currencies":[{"id":"vontade","label":"Vontade","field":"vontade_superficial","mode":"track","max_field":"vontade_max"}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values)
values ('46000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001',
        '16000000-0000-0000-0000-000000000001', 'Roll Sheet',
        '{"name":"A","autocontrole":2,"resolucao":1,"vontade_superficial":0,"vontade_agravada":0}'::jsonb);

-- Pure helpers (as owner).
select is(private.v5_roll_outcome('{10,10,3}', '{}', 4) ->> 'successes', '4', 'a pair of tens counts four successes');
select ok((private.v5_roll_outcome('{10,10,3}', '{}', 4) ->> 'clean_critical')::boolean, 'ordinary pair is a clean critical');
select ok((private.v5_roll_outcome('{10}', '{10}', 2) ->> 'messy_critical')::boolean, 'pair with a hunger ten is messy');
select ok((private.v5_roll_outcome('{2}', '{1}', 1) ->> 'bestial_failure')::boolean, 'failure with a hunger one is bestial');
select is((select count(distinct face)::integer from (select private.v5_random_die() as face from generate_series(1, 2000)) draws
           where face between 1 and 10), 10, 'random die covers exactly faces 1..10');

select ok(not has_table_privilege('authenticated', 'public.v5_roll_records', 'insert,update,delete'),
  'clients cannot write roll records directly');

-- Player rolls on own sheet.
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
create temporary table first_roll on commit drop as
  select public.record_v5_roll('46000000-0000-0000-0000-000000000001', 5, 2, 3, '{"note":"teste"}') as row;
select is((select jsonb_array_length(row -> 'normal_dice') from first_roll), 3, 'ordinary dice exclude hunger');
select is((select jsonb_array_length(row -> 'hunger_dice') from first_roll), 2, 'hunger dice are kept apart');
select ok((select bool_and(face::integer between 1 and 10)
             from first_roll, jsonb_array_elements_text((row -> 'normal_dice') || (row -> 'hunger_dice')) face),
  'stored faces are d10 results');
select is((select row -> 'outcome' from first_roll),
  (select private.v5_roll_outcome(
     array(select jsonb_array_elements_text(row -> 'normal_dice')::integer from first_roll),
     array(select jsonb_array_elements_text(row -> 'hunger_dice')::integer from first_roll), 3)),
  'stored outcome matches the dice');
select throws_ok($$select public.record_v5_roll('46000000-0000-0000-0000-000000000001', 3, 4, 2)$$,
  '22023', null, 'hunger cannot exceed the pool');

select throws_ok(format('select public.reroll_v5_roll(%L, ''{3}'')', (select row ->> 'id' from first_roll)),
  '22023', null, 'hunger dice cannot be chosen (index past ordinary dice)');
select throws_ok(format('select public.reroll_v5_roll(%L, ''{0,1,2,0}'')', (select row ->> 'id' from first_roll)),
  '22023', null, 'at most three dice');
select throws_ok(format('select public.reroll_v5_roll(%L, ''{1,1}'')', (select row ->> 'id' from first_roll)),
  '22023', null, 'dice must be distinct');

-- Other player reads but cannot roll or reroll on this sheet.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.v5_roll_records where sheet_id = '46000000-0000-0000-0000-000000000001'), 1,
  'campaign members read the history');
select throws_ok($$select public.record_v5_roll('46000000-0000-0000-0000-000000000001', 3, 0, 2)$$,
  '42501', null, 'another player cannot roll for this sheet');
select throws_ok(format('select public.reroll_v5_roll(%L, ''{0}'')', (select row ->> 'id' from first_roll)),
  '42501', null, 'only the author rerolls');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000004', true);
select is((select count(*)::integer from public.v5_roll_records), 0, 'outsiders read nothing');
select throws_ok($$select public.record_v5_roll('46000000-0000-0000-0000-000000000001', 3, 0, 2)$$,
  '42501', null, 'outsiders cannot roll');

-- Author rerolls ordinary dice 0 and 2 once and pays one Willpower.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
create temporary table first_reroll on commit drop as
  select public.reroll_v5_roll((select (row ->> 'id')::uuid from first_roll), '{2,0}') as result;
select ok((select (result ->> 'willpower_spent')::boolean from first_reroll), 'willpower was spent');
select is((select values ->> 'vontade_superficial' from public.character_sheets where id = '46000000-0000-0000-0000-000000000001'),
  '1', 'superficial willpower damage marked on the sheet');
select ok((select result -> 'roll' -> 'original_normal_dice' = (select row -> 'normal_dice' from first_roll)
              and result -> 'roll' -> 'normal_dice' -> 1 = (select row -> 'normal_dice' -> 1 from first_roll)
              and result -> 'roll' -> 'hunger_dice' = (select row -> 'hunger_dice' from first_roll)
              and result -> 'roll' -> 'rerolled_indices' = '[0, 2]'::jsonb
             from first_reroll),
  'unchosen ordinary dice and hunger dice keep their faces');
select is((select kind from public.character_sheet_events
            where id = (select (result -> 'roll' ->> 'willpower_event_id')::bigint from first_reroll)),
  'meta_currency', 'willpower spend is logged as a sheet event');
select throws_ok(format('select public.reroll_v5_roll(%L, ''{1}'')', (select row ->> 'id' from first_roll)),
  '23505', null, 'a roll cannot be rerolled twice');

-- Fill the track (max 3) and the next reroll is refused without side effects.
select public.reroll_v5_roll((public.record_v5_roll('46000000-0000-0000-0000-000000000001', 2, 0, 1) ->> 'id')::uuid, '{0}');
select public.reroll_v5_roll((public.record_v5_roll('46000000-0000-0000-0000-000000000001', 2, 0, 1) ->> 'id')::uuid, '{0}');
create temporary table full_roll on commit drop as
  select public.record_v5_roll('46000000-0000-0000-0000-000000000001', 2, 0, 1) as row;
select throws_ok(format('select public.reroll_v5_roll(%L, ''{0}'')', (select row ->> 'id' from full_roll)),
  '23514', null, 'a full willpower track cannot pay for a reroll');
select ok((select rerolled_at is null from public.v5_roll_records where id = (select (row ->> 'id')::uuid from full_roll)),
  'refused reroll leaves the roll untouched');

-- Retention: master rolls many times; only the newest 50 remain.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', true);
select count(public.record_v5_roll('46000000-0000-0000-0000-000000000001', 1, 0, 1)) from generate_series(1, 55);
select is((select count(*)::integer from public.v5_roll_records where sheet_id = '46000000-0000-0000-0000-000000000001'), 50,
  'history keeps the newest 50 rolls per character');

reset role;
select * from finish();
rollback;
