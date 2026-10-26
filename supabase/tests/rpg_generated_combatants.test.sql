begin;
select plan(24);

insert into auth.users (id, aud, role, email) values
  ('16000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'gen-master@example.test'),
  ('16000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'gen-player@example.test'),
  ('16000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'gen-outsider@example.test'),
  ('16000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'gen-player2@example.test');
insert into public.campaigns (id, owner_id, name) values
  ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 'Generated Campaign'),
  ('26000000-0000-0000-0000-000000000002', '16000000-0000-0000-0000-000000000003', 'Other Campaign');
insert into public.campaign_members (campaign_id, user_id, role) values
  ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'player'),
  ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000004', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema) values
  ('36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001',
   'Gen Template', 'approved', '{"fields":[{"id":"forca","kind":"number"},{"id":"atletismo","kind":"number"},{"id":"nome","kind":"text"}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name) values
  ('46000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001',
   '16000000-0000-0000-0000-000000000002', 'Mara');
insert into public.combat_sessions (id, campaign_id, title, state, active, created_by) values
  ('56000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', 'Cena aberta',
   '{"round":2,"turn":1,"paused":false,"participants":[{"id":"a","name":"Ana","initiative":9},{"id":"b","name":"Bruno","initiative":4}]}'::jsonb,
   true, '16000000-0000-0000-0000-000000000001'),
  ('56000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000001', 'Cena encerrada',
   '{"round":1,"turn":0,"paused":false,"participants":[]}'::jsonb, false, '16000000-0000-0000-0000-000000000001'),
  ('56000000-0000-0000-0000-000000000003', '26000000-0000-0000-0000-000000000002', 'Cena alheia',
   '{"initiative":[],"round":1}'::jsonb, true, '16000000-0000-0000-0000-000000000003');

set local role authenticated;

-- Jogador não aplica conteúdo gerado.
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', true);
select throws_ok($$select public.rpg_apply_generated_content('26000000-0000-0000-0000-000000000001', gen_random_uuid(),
  'generator', '{}'::jsonb, 'Vigia', 'npc', '{}'::jsonb, true, null, null, null, null)$$,
  '42501', null, 'player cannot apply generated content');

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
create temp table applied on commit drop as
select public.rpg_apply_generated_content('26000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001',
  'generator', '{"seed":7,"kind":"enemy"}'::jsonb, 'Vigia do Cais', 'npc', '{"description":"Guarda o cais."}'::jsonb, true,
  '56000000-0000-0000-0000-000000000001', 12, 7, '{"system":"v5","tier":"padrao"}'::jsonb) as result;

select ok((select (result->>'replayed')::boolean = false and result->>'entity_id' is not null and result->>'participant_id' is not null from applied),
  'manager saves entity and participant');
select is((select jsonb_array_length(state->'participants') from public.combat_sessions where id = '56000000-0000-0000-0000-000000000001'), 3,
  'participant appended to active combat');
select is((select state->'participants'->0->>'name' from public.combat_sessions where id = '56000000-0000-0000-0000-000000000001'), 'Vigia do Cais',
  'participants sorted by initiative');
select is((select (state->>'turn')::integer from public.combat_sessions where id = '56000000-0000-0000-0000-000000000001'), 2,
  'turn keeps pointing at the participant who was acting');
select is((select (state->'participants'->0->>'health')::integer from public.combat_sessions where id = '56000000-0000-0000-0000-000000000001'), 7,
  'participant carries health from the block');
select is((select (state->>'round')::integer from public.combat_sessions where id = '56000000-0000-0000-0000-000000000001'), 2,
  'round preserved');
select is((select body->'origin'->>'source_kind' from public.world_entities where id = (select (result->>'entity_id')::uuid from applied)), 'generator',
  'world entity records its origin');
select is((select count(*)::integer from public.combat_events where combat_id = '56000000-0000-0000-0000-000000000001' and event_type = 'generated_participant'), 1,
  'combat event logged');
select is((select combat_block->>'tier' from public.generated_content_applications where idempotency_key = '66000000-0000-0000-0000-000000000001'), 'padrao',
  'application keeps the combat block for the narrator');

-- Repetir a mesma chave não duplica nada.
select ok((public.rpg_apply_generated_content('26000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001',
  'generator', '{}'::jsonb, 'Vigia do Cais', 'npc', '{}'::jsonb, true, '56000000-0000-0000-0000-000000000001', 12, 7, null)->>'replayed')::boolean,
  'same idempotency key replays');
select is((select jsonb_array_length(state->'participants') from public.combat_sessions where id = '56000000-0000-0000-0000-000000000001'), 3,
  'replay adds no participant');

-- Nome repetido recebe sufixo; só combate, sem entidade.
select is(public.rpg_apply_generated_content('26000000-0000-0000-0000-000000000001', gen_random_uuid(),
  'second_inquisition', '{"response_kind":"containment_team"}'::jsonb, 'vigia do cais', 'npc', '{}'::jsonb, false,
  '56000000-0000-0000-0000-000000000001', 3, 5, null)->>'participant_name', 'vigia do cais 2', 'duplicate names get a suffix');

select throws_ok($$select public.rpg_apply_generated_content('26000000-0000-0000-0000-000000000001', gen_random_uuid(),
  'generator', '{}'::jsonb, 'X', 'npc', '{}'::jsonb, true, '56000000-0000-0000-0000-000000000002', 1, 1, null)$$,
  '55000', null, 'closed combat refuses participants');
select throws_ok($$select public.rpg_apply_generated_content('26000000-0000-0000-0000-000000000001', gen_random_uuid(),
  'generator', '{}'::jsonb, 'X', 'npc', '{}'::jsonb, true, '56000000-0000-0000-0000-000000000003', 1, 1, null)$$,
  'P0002', null, 'combat from another campaign is not found');
select throws_ok($$select public.rpg_apply_generated_content('26000000-0000-0000-0000-000000000001', gen_random_uuid(),
  'generator', '{}'::jsonb, 'X', 'npc', '{}'::jsonb, false, null, null, null, null)$$,
  '22023', null, 'needs an entity or a combat');

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.generated_content_applications), 0, 'players cannot read application records');

-- DRA-05: rolagem da própria ficha vira atividade sem duplicar.
select is(public.rpg_record_roll_activity('46000000-0000-0000-0000-000000000001', 'roll-1', array['forca','manchas','forca'])->>'status',
  'recorded', 'sheet owner roll is recorded');
select is(public.rpg_record_roll_activity('46000000-0000-0000-0000-000000000001', 'roll-1', array['forca'])->>'status',
  'duplicate', 'same roll key is not duplicated');
select is(public.rpg_record_roll_activity('46000000-0000-0000-0000-000000000001', 'roll-2', array['manchas'])->>'status',
  'no_traits', 'traits outside the model are not recorded');
select is(public.rpg_record_roll_activity('46000000-0000-0000-0000-000000000001', 'roll-3', array['forca'], '26000000-0000-0000-0000-000000000002')->>'status',
  'not_in_campaign', 'campaign mismatch is refused');

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000004', true);
select is(public.rpg_record_roll_activity('46000000-0000-0000-0000-000000000001', 'roll-4', array['forca'])->>'status',
  'not_allowed', 'other players cannot record rolls for this sheet');
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000003', true);
select is(public.rpg_record_roll_activity('46000000-0000-0000-0000-000000000001', 'roll-5', array['forca'])->>'status',
  'not_in_campaign', 'outsiders see the sheet as missing');

reset role;
insert into public.chronicle_activity (campaign_id, sheet_id, occurred_on, used_trait_ids, created_by)
select '26000000-0000-0000-0000-000000000001', '46000000-0000-0000-0000-000000000001', current_date, array['forca'], '16000000-0000-0000-0000-000000000001'
  from generate_series(1, 499);
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
select is(public.rpg_record_roll_activity('46000000-0000-0000-0000-000000000001', 'roll-6', array['atletismo'])->>'status',
  'limit_reached', 'the 500 activity limit is respected');

select * from finish();
rollback;
