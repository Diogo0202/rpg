begin;
select plan(40);

insert into auth.users (id, aud, role, email)
values
  ('17000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'san-player@example.test'),
  ('17000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'san-master@example.test'),
  ('17000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'san-other@example.test'),
  ('17000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'san-outsider@example.test');
insert into public.campaigns (id, owner_id, name)
values ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', 'SAN'),
       ('27000000-0000-0000-0000-000000000002', '17000000-0000-0000-0000-000000000004', 'Outra');
insert into public.campaign_members (campaign_id, user_id, role)
values ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', 'player'),
       ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000003', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('37000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001',
        '17000000-0000-0000-0000-000000000002', 'SAN Template', 'approved',
        '{"fields":[{"id":"nome","kind":"text"},{"id":"fome","kind":"number","min":0,"max":5},{"id":"potencia_sangue","kind":"number"},
          {"id":"ressonancia_atual","kind":"select","options":["Nenhuma","Colérica","Melancólica","Fleumática","Sanguínea","Animal","Vazia"]},
          {"id":"intensidade_ressonancia","kind":"select","options":["Nenhuma","Fugaz","Intensa","Aguda"]},
          {"id":"discrasia","kind":"text","max_length":160}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values, effects)
values ('47000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001',
        '17000000-0000-0000-0000-000000000001', 'Thrall', '{"nome":"Thrall","fome":4}'::jsonb,
        '[{"id":"ressonancia-antiga","label":"Ressonância antiga","delta":1,"enabled":true,"applies_to_tags":["disc_presenca"],"exempt_tags":[],"remaining_scenes":null,"source_note":"x"},
          {"id":"ferido","label":"Ferido","delta":-1,"enabled":true,"applies_to_tags":[],"exempt_tags":[],"remaining_scenes":null,"source_note":"y"}]'::jsonb),
       ('47000000-0000-0000-0000-000000000002', '27000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001',
        '17000000-0000-0000-0000-000000000003', 'Regente', '{"nome":"Regente","fome":1}'::jsonb, '[]'::jsonb),
       ('47000000-0000-0000-0000-000000000003', '27000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001',
        '17000000-0000-0000-0000-000000000001', 'Ancião', '{"nome":"Ancião","fome":4,"potencia_sangue":6}'::jsonb, '[]'::jsonb);
insert into public.world_entities (id, campaign_id, kind, name, created_by)
values ('57000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', 'npc', 'Príncipe', '17000000-0000-0000-0000-000000000002'),
       ('57000000-0000-0000-0000-000000000002', '27000000-0000-0000-0000-000000000001', 'location', 'Elísio', '17000000-0000-0000-0000-000000000002'),
       ('57000000-0000-0000-0000-000000000003', '27000000-0000-0000-0000-000000000002', 'npc', 'Estranho', '17000000-0000-0000-0000-000000000004');

-- Pure helpers.
select is(private.v5_resonance_disciplines('Colérica'), array['disc_potencia', 'disc_rapidez'], 'choleric resonance feeds Potence and Celerity');
select is(cardinality(private.v5_resonance_disciplines('Nenhuma')), 0, 'no resonance, no disciplines');
select is(private.v5_bond_degree_from(array['2026-01-01 22:00Z', '2026-01-01 23:00Z']::timestamptz[], 30, '2026-01-02Z'), 1,
  'two drinks on the same night count once');
select is(private.v5_bond_degree_from(array['2026-01-01 22:00Z', '2026-01-03 22:00Z', '2026-01-05 22:00Z', '2026-01-07 22:00Z']::timestamptz[], 30, '2026-01-08Z'), 3,
  'the bond stops at the third degree');
select is(private.v5_bond_degree_from(array['2026-01-01Z', '2026-01-03Z', '2026-01-05Z']::timestamptz[], 30, '2026-03-10Z'), 1,
  'sixty-odd days without drinking lose two degrees');
select is(private.v5_bond_degree_from(array['2026-01-01Z', '2026-03-05Z']::timestamptz[], 30, '2026-03-06Z'), 1,
  'decay between drinks happens before the next drink counts');
select is(private.v5_bond_degree_from(array['2026-05-01Z']::timestamptz[], 30, '2026-04-01Z'), 0, 'future drinks do not count');
select ok(not has_table_privilege('authenticated', 'public.v5_hunts', 'insert,update,delete')
       and not has_table_privilege('authenticated', 'public.v5_blood_bonds', 'insert,update,delete')
       and not has_table_privilege('authenticated', 'public.v5_blood_bond_drinks', 'insert,update,delete')
       and not has_table_privilege('authenticated', 'public.v5_regnant_actions', 'insert,update,delete'),
  'clients write SAN tables only through the RPCs');

-- SAN-01: the owner hunts.
set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000001', true);
create temporary table hunt on commit drop as
  select public.record_v5_hunt('47000000-0000-0000-0000-000000000001', '67000000-0000-0000-0000-000000000001',
    'Segurança da boate', 'Colérica', 'Aguda', 'Fúria contida', 2, false, 'na saída') as result;
select is((select values ->> 'fome' from public.character_sheets where id = '47000000-0000-0000-0000-000000000001'), '2',
  'hunting lowers Hunger by the slaked amount');
select is((select values ->> 'ressonancia_atual' || '/' || (values ->> 'intensidade_ressonancia') || '/' || (values ->> 'discrasia')
             from public.character_sheets where id = '47000000-0000-0000-0000-000000000001'),
  'Colérica/Aguda/Fúria contida', 'resonance, intensity and dyscrasia land on the sheet');
select is((select count(*)::integer from public.character_sheets, jsonb_array_elements(effects) item
            where id = '47000000-0000-0000-0000-000000000001' and item ->> 'id' like 'ressonancia-%'), 1,
  'the previous resonance effect is replaced');
select ok((select item -> 'applies_to_tags' = '["disc_potencia", "disc_rapidez"]'::jsonb and (item ->> 'delta')::integer = 1
             from public.character_sheets, jsonb_array_elements(effects) item
            where id = '47000000-0000-0000-0000-000000000001' and item ->> 'id' = (select result -> 'hunt' ->> 'effect_id' from hunt)),
  'the new effect adds one die to the resonance disciplines');
select ok(exists (select 1 from public.character_sheets, jsonb_array_elements(effects) item
                   where id = '47000000-0000-0000-0000-000000000001' and item ->> 'id' = 'ferido'),
  'unrelated effects stay');
select is((select delta from public.character_sheet_events where id = (select (result -> 'hunt' ->> 'sheet_event_id')::bigint from hunt)), -2,
  'the Hunger change is audited');
select is((select (public.record_v5_hunt('47000000-0000-0000-0000-000000000001', '67000000-0000-0000-0000-000000000001',
    'Segurança da boate', 'Colérica', 'Aguda', 'Fúria contida', 2, false, 'na saída') ->> 'replayed')::boolean), true,
  'replaying the same operation returns the stored hunt');
select is((select values ->> 'fome' from public.character_sheets where id = '47000000-0000-0000-0000-000000000001'), '2',
  'a replay does not lower Hunger twice');
select throws_ok($$select public.record_v5_hunt('47000000-0000-0000-0000-000000000001', '67000000-0000-0000-0000-000000000001',
    'Outra presa', 'Colérica', 'Aguda', null, 2, false)$$, '23505', null, 'an operation ID cannot be reused for another hunt');
select public.record_v5_hunt('47000000-0000-0000-0000-000000000001', '67000000-0000-0000-0000-000000000002', 'Rato', 'Animal', 'Fugaz', null, 5, false);
select is((select values ->> 'fome' from public.character_sheets where id = '47000000-0000-0000-0000-000000000001'), '1',
  'without killing Hunger stops at 1');
select is((select count(*)::integer from public.character_sheets, jsonb_array_elements(effects) item
            where id = '47000000-0000-0000-0000-000000000001' and item ->> 'id' like 'ressonancia-%'), 0,
  'a fleeting resonance clears the bonus and adds none');
select public.record_v5_hunt('47000000-0000-0000-0000-000000000001', '67000000-0000-0000-0000-000000000003', 'Vítima', 'Sanguínea', 'Intensa', null, 5, true);
select is((select values ->> 'fome' from public.character_sheets where id = '47000000-0000-0000-0000-000000000001'), '0',
  'killing the prey can reach Hunger 0');
select is((public.record_v5_hunt('47000000-0000-0000-0000-000000000003', gen_random_uuid(), 'Turista', 'Nenhuma', 'Nenhuma', null, 5, false)
             -> 'hunt' ->> 'hunger_after'), '2', 'high Blood Potency keeps Hunger at 2 without a kill (F1 table)');
select throws_ok($$select public.record_v5_hunt('47000000-0000-0000-0000-000000000001', gen_random_uuid(), 'X', 'Colérica', 'Intensa', 'não pode', 1, false)$$,
  '22023', null, 'dyscrasia only with acute resonance');
select throws_ok($$select public.record_v5_hunt('47000000-0000-0000-0000-000000000001', gen_random_uuid(), 'X', 'Nenhuma', 'Aguda', null, 1, false)$$,
  '22023', null, 'intensity needs a resonance');
select throws_ok($$select public.record_v5_bond_drink('47000000-0000-0000-0000-000000000001', gen_random_uuid(), '47000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'players cannot record blood bond drinks');

-- Another player cannot hunt for this sheet.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000003', true);
select throws_ok($$select public.record_v5_hunt('47000000-0000-0000-0000-000000000001', gen_random_uuid(), 'X', 'Nenhuma', 'Nenhuma', null, 1, false)$$,
  '42501', null, 'another player cannot hunt for this sheet');

-- SAN-02: the narrator records drinks.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000002', true);
select public.record_v5_bond_drink('47000000-0000-0000-0000-000000000001', '77000000-0000-0000-0000-000000000001',
  '47000000-0000-0000-0000-000000000002', null, now() - interval '3 days');
create temporary table second_drink on commit drop as
  select public.record_v5_bond_drink('47000000-0000-0000-0000-000000000001', '77000000-0000-0000-0000-000000000002',
    '47000000-0000-0000-0000-000000000002', null, now() - interval '1 day', 'no Elísio') as result;
select is((select (result ->> 'degree')::integer from second_drink), 2, 'two nights make the second degree');
select is((select regnant_label from public.v5_blood_bonds where thrall_sheet_id = '47000000-0000-0000-0000-000000000001'), 'Regente',
  'the bond keeps the donor name');
select is((select (public.record_v5_bond_drink('47000000-0000-0000-0000-000000000001', '77000000-0000-0000-0000-000000000002',
    '47000000-0000-0000-0000-000000000002', null, (select (result -> 'drink' ->> 'drank_at')::timestamptz from second_drink)) ->> 'degree')::integer), 2,
  'replaying a drink is idempotent');
select is((select count(*)::integer from public.v5_blood_bond_drinks), 2, 'two drinks in the history');
select public.record_v5_bond_drink('47000000-0000-0000-0000-000000000001', gen_random_uuid(), null, '57000000-0000-0000-0000-000000000001', now());
select throws_ok($$select public.record_v5_bond_drink('47000000-0000-0000-0000-000000000001', gen_random_uuid(), null, '57000000-0000-0000-0000-000000000002')$$,
  '22023', null, 'only NPC entities are donors');
select throws_ok($$select public.record_v5_bond_drink('47000000-0000-0000-0000-000000000001', gen_random_uuid(), null, '57000000-0000-0000-0000-000000000003')$$,
  '22023', null, 'the donor must be from the same campaign');
select is((public.configure_v5_blood_bond((select id from public.v5_blood_bonds where regnant_entity_id = '57000000-0000-0000-0000-000000000001'), 1)).decay_days, 1,
  'the narrator configures the decay');

-- RLS: the bonded owner reads; the donor player does not.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.v5_blood_bonds), 0, 'other players do not see the bond');
select is((select count(*)::integer from public.v5_blood_bond_drinks), 0, 'nor its drinks');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000001', true);
select is((select count(*)::integer from public.v5_blood_bonds), 2, 'the bonded owner reads the bonds');

-- SAN-03: the bonded owner asks to act against the regnant with a stored roll.
create temporary table resistance on commit drop as
  select public.request_v5_regnant_action(
    (select id from public.v5_blood_bonds where regnant_sheet_id = '47000000-0000-0000-0000-000000000002'),
    'Mentir para o Regente',
    (public.record_v5_roll('47000000-0000-0000-0000-000000000001', 4, 0, 2) ->> 'id')::uuid) as row;
select ok((select (row).status = 'pendente' and (row).bond_degree = 2 and (row).pool = 4 and (row).passed is not null from resistance),
  'the test is stored with its result and waits for the narrator');
select throws_ok(format('select public.decide_v5_regnant_action(%L, ''permitida'')', (select (row).id from resistance)),
  '42501', null, 'the player cannot decide');
select throws_ok(format('select public.request_v5_regnant_action(%L, ''De novo'', %L)',
    (select (row).bond_id from resistance), (select (row).roll_id from resistance)),
  '23505', null, 'one roll backs one action');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000002', true);
select is((public.decide_v5_regnant_action((select (row).id from resistance), 'negada', 'O Vínculo segura a língua')).status, 'negada',
  'the narrator denies the action');
select throws_ok(format('select public.decide_v5_regnant_action(%L, ''permitida'')', (select (row).id from resistance)),
  '23505', null, 'a decided action stays decided');

reset role;
select * from finish();
rollback;
