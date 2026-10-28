begin;
select plan(39);

-- Creation: Merits cost freebies, Flaws add them up to 7 (priority_points.freebie_items).
create temporary table v3_rule as select '{"creation_rules":[{"type":"priority_points","id":"criacao_v3","freebies":15,"exact":true,
  "fields":["x"],"pools":[{"id":"livre","cost":1,"budgets":[0],"groups":[{"label":"Livre","fields":["x"]}]}],
  "freebie_items":{"spend":["meritos"],"earn":{"collection":"defeitos","max":7}}}]}'::jsonb as schema;
grant select on v3_rule to authenticated;
select is(private.priority_point_violations((select schema from v3_rule), '{"x":15}'), array[]::text[], '15 freebies spent exactly');
select is(private.priority_point_violations((select schema from v3_rule), '{"x":15,"meritos":["Sortudo •••"]}'), array['criacao_v3'],
  'a Merit costs freebies');
select is(private.priority_point_violations((select schema from v3_rule), '{"x":16,"meritos":["Sortudo •••"],"defeitos":["Pesadelos •","Fobia (2)","Sono Pesado 1"]}'),
  array[]::text[], 'Flaws add their points: 16 + 3 = 15 + 4');
select is(private.priority_point_violations((select schema from v3_rule), '{"x":22,"defeitos":["Caçado ••••","Destino Sombrio •••••"]}'),
  array[]::text[], 'Flaw freebies stop at 7');
select is(private.priority_point_violations((select schema from v3_rule), '{"x":24,"defeitos":["Caçado ••••","Destino Sombrio •••••"]}'),
  array['criacao_v3'], 'Flaw points past 7 buy nothing');

-- Specializations only for traits at 4 or more (specialty_picks.min_value).
create temporary table v3_specialty as select '{"creation_rules":[{"type":"specialty_picks","id":"especializacoes_v3",
  "collection":"especialidades","skills":[{"field":"briga","label":"Briga"}],"required":["briga"],"free":0,"min_value":4,"fields":[]}]}'::jsonb as schema;
grant select on v3_specialty to authenticated;
select is(private.specialty_violations((select schema from v3_specialty), '{"briga":3,"especialidades":[]}'), array[]::text[], 'below 4 owes nothing');
select is(private.specialty_violations((select schema from v3_specialty), '{"briga":4,"especialidades":[]}'), array['especializacoes_v3'], 'at 4 a specialty is due');
select is(private.specialty_violations((select schema from v3_specialty), '{"briga":4,"especialidades":["Briga (Socos)"]}'), array[]::text[], 'the due specialty is taken');
select is(private.specialty_violations((select schema from v3_specialty), '{"briga":3,"especialidades":["Briga (Socos)"]}'), array['especializacoes_v3'],
  'a specialty below 4 is refused');
select throws_ok($$select private.validate_template_creation_rules('{"fields":[{"id":"x","kind":"number"}],"creation_rules":[{"type":"priority_points","id":"criacao_v3",
  "freebies":15,"fields":["x"],"pools":[{"id":"livre","cost":1,"budgets":[0],"groups":[{"label":"Livre","fields":["x"]}]}],
  "freebie_items":{"spend":["x"]}}]}'::jsonb)$$, '22023', null, 'freebie collections must be collections');
select throws_ok($$select private.validate_template_creation_rules('{"fields":[{"id":"x","kind":"number"},{"id":"e","kind":"collection"}],
  "creation_rules":[{"type":"specialty_picks","id":"esp","collection":"e","skills":[{"field":"x","label":"X"}],"min_value":0,"fields":[]}]}'::jsonb)$$,
  '22023', null, 'min_value starts at 1');

-- Dice.
select is(private.v3_read_dice(array[1, 6, 7], 6) ->> 'successes', '1', 'each 1 cancels one success');
select is((private.v3_read_dice(array[1, 2, 3], 6) ->> 'botch')::boolean, true, 'no success and a 1 is a botch');
select is((private.v3_read_dice(array[1, 6], 6) ->> 'botch')::boolean, false, 'a cancelled success is a plain failure');
select is((private.v3_read_dice(array[10, 10, 2], 10) ->> 'successes')::integer, 2, 'difficulty 10 needs a 10');
select ok((select bool_and(die between 1 and 10) and count(distinct die) = 10 from (select private.v3_d10() as die from generate_series(1, 2000)) as draws),
  'the database d10 covers 1 to 10');
select is((select per_turn from private.v3_blood_limits('{"ant_geracao":5}')), 3, '8th generation spends 3 per turn');
select is((select blood_max from private.v3_blood_limits('{"ant_geracao":4}')), 14, '9th generation holds 14');

-- Play RPCs.
insert into auth.users (id, aud, role, email) values
  ('13000000-0000-0000-0000-000000000031', 'authenticated', 'authenticated', 'v3-player@example.test'),
  ('13000000-0000-0000-0000-000000000032', 'authenticated', 'authenticated', 'v3-master@example.test');
insert into public.campaigns (id, owner_id, name)
values ('23000000-0000-0000-0000-000000000031', '13000000-0000-0000-0000-000000000032', 'V3 Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values ('23000000-0000-0000-0000-000000000031', '13000000-0000-0000-0000-000000000031', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema) values
  ('33000000-0000-0000-0000-000000000031', '23000000-0000-0000-0000-000000000031', '13000000-0000-0000-0000-000000000032', 'Vampire V3 Template', 'approved',
   '{"system_key":"vampire-v3","fields":[{"id":"ant_geracao","kind":"number"},{"id":"pontos_sangue","kind":"number"},
     {"id":"vontade_gasta","kind":"number"},{"id":"forca_vontade","kind":"number"},{"id":"dano_contundente","kind":"number"},
     {"id":"dano_letal","kind":"number"},{"id":"dano_agravado","kind":"number"},{"id":"autocontrole","kind":"number"},
     {"id":"consciencia","kind":"number"},{"id":"coragem","kind":"number"},{"id":"humanidade","kind":"number"},
     {"id":"trilha","kind":"select","options":["Humanidade"]},{"id":"em_frenesi","kind":"checkbox"},{"id":"em_rotschreck","kind":"checkbox"}],
     "meta_currencies":[{"id":"vontade","label":"Vontade","field":"vontade_gasta","mode":"track","max_field":"forca_vontade"},
                        {"id":"sangue","label":"Sangue","field":"pontos_sangue","mode":"pool"}]}'::jsonb),
  ('33000000-0000-0000-0000-000000000032', '23000000-0000-0000-0000-000000000031', '13000000-0000-0000-0000-000000000032', 'Other Template', 'approved',
   '{"fields":[{"id":"pontos_sangue","kind":"number"}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values) values
  ('43000000-0000-0000-0000-000000000031', '23000000-0000-0000-0000-000000000031', '33000000-0000-0000-0000-000000000031',
   '13000000-0000-0000-0000-000000000031', 'Mara',
   '{"ant_geracao":0,"pontos_sangue":0,"vontade_gasta":0,"forca_vontade":1,"dano_contundente":0,"dano_letal":0,"dano_agravado":0,
     "autocontrole":0,"consciencia":0,"coragem":0,"humanidade":7,"trilha":"Humanidade","em_frenesi":false,"em_rotschreck":false}'::jsonb),
  ('43000000-0000-0000-0000-000000000032', '23000000-0000-0000-0000-000000000031', '33000000-0000-0000-0000-000000000032',
   '13000000-0000-0000-0000-000000000031', 'Outra', '{"pontos_sangue":5}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000031', true);
select ok((public.v3_set_initial_blood('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000001') -> 'test' -> 'roll' ->> 'value')::integer
  between 1 and 10, 'the player rolls 1d10 starting blood within the 13th generation pool');
select throws_ok($$select public.v3_set_initial_blood('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'the player rolls the starting blood once');
select throws_ok($$select public.v3_set_initial_blood('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000003', 5)$$,
  '42501', null, 'only the narrator sets a value');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000032', true);
select throws_ok($$select public.v3_set_initial_blood('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000004', 11)$$,
  '22023', null, 'the narrator stays within the pool');
select is((public.v3_set_initial_blood('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000005', 8) -> 'sheet' -> 'values' ->> 'pontos_sangue')::integer,
  8, 'the narrator sets the starting blood');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000031', true);
select is((public.v3_spend_blood('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000010', 1, 'c1:r1') -> 'sheet' -> 'values' ->> 'pontos_sangue')::integer,
  7, 'spending blood lowers the pool');
select throws_ok($$select public.v3_spend_blood('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000011', 1, 'c1:r1')$$,
  '23514', null, '13th generation spends one point per turn');
select is((public.v3_spend_blood('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000010', 1, 'c1:r1') ->> 'replayed')::boolean,
  true, 'a retried operation is not applied twice');
select is((public.v3_spend_blood('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000012', 1, 'c1:r2') -> 'sheet' -> 'values' ->> 'pontos_sangue')::integer,
  6, 'the next turn spends again');
select is((public.v3_apply_damage('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000020', 'contundente', 3) ->> 'applied')::integer,
  1, 'vampires halve bashing damage, rounding down');
select is((public.v3_apply_damage('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000021', 'letal', 2) -> 'sheet' -> 'values' ->> 'dano_letal')::integer,
  2, 'lethal damage is marked whole');
select throws_ok($$select public.v3_heal('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000022', 2, 'c1:r3')$$,
  '23514', null, 'healing spends blood within the limit per turn');
select is((public.v3_heal('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000023', 1, 'c1:r4') -> 'sheet' -> 'values') - array['ant_geracao','vontade_gasta','forca_vontade','dano_agravado','autocontrole','consciencia','coragem','humanidade','trilha','em_frenesi','em_rotschreck'],
  '{"pontos_sangue":5,"dano_contundente":0,"dano_letal":2}'::jsonb, 'one blood heals one bashing level first');
select is((public.v3_spend_willpower('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000030') -> 'sheet' -> 'values' ->> 'vontade_gasta')::integer,
  1, 'Willpower is spent atomically');
select throws_ok($$select public.v3_spend_willpower('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000031')$$,
  '23514', null, 'no Willpower is spent past the rating');
select is((public.v3_frenzy_test('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000040', 'frenesi', 6) -> 'sheet' -> 'values' ->> 'em_frenesi')::boolean,
  true, 'with no Self-Control the vampire frenzies');
select is((public.v3_frenzy_test('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000041', 'rotschreck', 6) -> 'test' ->> 'trait'),
  'coragem', 'Rötschreck rolls Courage');
select is((public.v3_degeneration_test('43000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000050', 7) -> 'sheet' -> 'values' ->> 'humanidade')::integer,
  6, 'a failed Conscience roll lowers the Path');
select is((select count(*)::integer from public.v3_sheet_tests where sheet_id = '43000000-0000-0000-0000-000000000031'), 5,
  'starting blood, frenzy, Rötschreck and degeneration are logged');
select throws_ok($$select public.v3_spend_blood('43000000-0000-0000-0000-000000000032', '53000000-0000-0000-0000-000000000060', 1)$$,
  '22023', null, 'only Vampire V3 sheets take V3 actions');
select ok(not has_function_privilege('anon', 'public.v3_spend_blood(uuid,uuid,integer,text)', 'execute'), 'anonymous callers cannot spend blood');

select * from finish();
rollback;
