begin;
select plan(41);

insert into auth.users (id, aud, role, email)
values
  ('1a000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'h5-master@example.test'),
  ('1a000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'h5-player@example.test'),
  ('1a000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'h5-outsider@example.test');
insert into public.campaigns (id, owner_id, name)
values ('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', 'Hunter F4');
insert into public.campaign_members (campaign_id, user_id, role)
values ('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000002', 'player');
-- An old (v3) Hunter template: it still has the sheet field `desespero`.
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('3a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001',
  'Caçador v3', 'approved',
  '{"system_key":"hunter","fields":[{"id":"nome","kind":"text"},{"id":"celula","kind":"text"},{"id":"impulso","kind":"text"},
    {"id":"redencao","kind":"text"},{"id":"em_desespero","kind":"checkbox"},{"id":"desespero","kind":"number"},
    {"id":"triunfos","kind":"collection"},{"id":"autocontrole","kind":"number"},{"id":"resolucao","kind":"number"},
    {"id":"vontade_superficial","kind":"number"},{"id":"vontade_agravada","kind":"number"},
    {"id":"vontade_max","kind":"formula","formula":"autocontrole + resolucao"}],
    "meta_currencies":[{"id":"vontade","label":"Vontade","field":"vontade_superficial","mode":"track","max_field":"vontade_max"}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values)
values
  ('4a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001',
   '1a000000-0000-0000-0000-000000000002', 'Mara',
   '{"nome":"Mara","desespero":4,"impulso":"Vingança","redencao":"Encontrar quem levou meu irmão","triunfos":["Arsenal"],
     "autocontrole":2,"resolucao":1,"vontade_superficial":0,"vontade_agravada":0,"em_desespero":false}'),
  ('4a000000-0000-0000-0000-000000000002', '2a000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001',
   '1a000000-0000-0000-0000-000000000002', 'Solo', '{"nome":"Solo","desespero":3}'),
  ('4a000000-0000-0000-0000-000000000003', '2a000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001',
   '1a000000-0000-0000-0000-000000000001', 'Davi', '{"nome":"Davi","desespero":1,"celula":" vigília da ponte "}');
insert into public.hunter_cells (id, campaign_id, name, danger, desperation)
values ('5a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', 'Vigília da Ponte', 1, 2),
       ('5a000000-0000-0000-0000-000000000002', '2a000000-0000-0000-0000-000000000001', 'Outra', 0, 0);
insert into public.hunter_cell_members (cell_id, campaign_id, sheet_id)
values ('5a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', '4a000000-0000-0000-0000-000000000001');

select throws_ok($$insert into public.hunter_cell_members (cell_id, campaign_id, sheet_id) values
  ('5a000000-0000-0000-0000-000000000002', '2a000000-0000-0000-0000-000000000001', '4a000000-0000-0000-0000-000000000001')$$,
  '23505', null, 'a sheet belongs to one cell');

-- Migration: sheet Desperation goes to the linked cell.
select is(private.migrate_hunter_sheet_desperation(), 3, 'three Hunter sheets carried desespero');
select is((select desperation::integer from public.hunter_cells where id = '5a000000-0000-0000-0000-000000000001'), 4,
  'the cell keeps the highest Desperation of its members');
select ok(exists (select 1 from public.hunter_cell_members where sheet_id = '4a000000-0000-0000-0000-000000000003'
  and cell_id = '5a000000-0000-0000-0000-000000000001'), 'a sheet is linked by the name in Célula');
select is((select count(*)::integer from public.character_sheets where values ? 'desespero'), 0, 'sheets no longer hold desespero');
select is((select outcome from public.hunter_desperation_migration_reports where sheet_id = '4a000000-0000-0000-0000-000000000002'),
  'discarded_no_cell', 'a sheet without a cell is reported as discarded');
select is((select count(*)::integer from public.hunter_desperation_migration_reports where outcome = 'moved_to_cell'), 2,
  'two values moved to the cell');
select is(private.migrate_hunter_sheet_desperation(), 0, 'the migration is idempotent');

-- Outcome rules.
select is(private.hunter_roll_outcome('{10,10,6}', '{1}', 3) ->> 'successes', '5', 'a pair of tens adds two successes');
select is(private.hunter_roll_outcome('{10,10,6}', '{1}', 3) ->> 'desperation_consequence', 'table_choice', 'success with a 1: table choice');
select is(private.hunter_roll_outcome('{2}', '{1}', 1) ->> 'desperation_consequence', 'despair', 'failure with a 1: Despair');
select ok((private.hunter_roll_outcome('{10}', '{10}', 2) ->> 'critical')::boolean, 'tens on Desperation dice pair with ordinary tens');
select ok(not has_table_privilege('authenticated', 'public.hunter_roll_records', 'insert,update,delete'), 'clients cannot write rolls');

-- Rolls stored with fixed dice for the resolution tests.
insert into public.hunter_roll_records (id, campaign_id, sheet_id, cell_id, author_id, base_pool, desperation, difficulty,
  normal_dice, desperation_dice, outcome)
values
  ('6a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', '4a000000-0000-0000-0000-000000000001',
   '5a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000002', 3, 1, 2, '{7,8,2}', '{1}',
   private.hunter_roll_outcome('{7,8,2}', '{1}', 2)),
  ('6a000000-0000-0000-0000-000000000002', '2a000000-0000-0000-0000-000000000001', '4a000000-0000-0000-0000-000000000001',
   '5a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000002', 2, 1, 3, '{2,3}', '{1}',
   private.hunter_roll_outcome('{2,3}', '{1}', 3)),
  ('6a000000-0000-0000-0000-000000000003', '2a000000-0000-0000-0000-000000000001', '4a000000-0000-0000-0000-000000000001',
   '5a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000002', 4, 0, 2, '{2,3,4,5}', '{}',
   private.hunter_roll_outcome('{2,3,4,5}', '{}', 2));

set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000002', true);
create temporary table live_roll on commit drop as
  select public.record_hunter_roll('4a000000-0000-0000-0000-000000000001', 3, 2, true, '{"edge":"Arsenal"}') as row;
select is((select jsonb_array_length(row -> 'roll' -> 'desperation_dice') from live_roll), 4, 'the roll reads Desperation from the cell');
select is((select (row -> 'cell' ->> 'desperation')::integer from live_roll), 4, 'the roll reports the cell values');
select throws_ok($$select public.record_hunter_roll('4a000000-0000-0000-0000-000000000001', 3, 2, false, '{"edge":"Frota"}')$$,
  '22023', null, 'an Edge must be on the sheet');

-- Willpower reroll: once, ordinary dice only, one Willpower spent.
select throws_ok($$select public.reroll_hunter_roll('6a000000-0000-0000-0000-000000000003', '{0,1,2,3}')$$, '22023', null, 'at most three dice');
select is((public.reroll_hunter_roll('6a000000-0000-0000-0000-000000000003', '{0,1}') ->> 'willpower_spent')::boolean, true, 'reroll spends Willpower');
reset role;
select is((select (values ->> 'vontade_superficial')::integer from public.character_sheets where id = '4a000000-0000-0000-0000-000000000001'), 1,
  'one superficial Willpower damage marked');
select is((select cardinality(rerolled_indices) from public.hunter_roll_records where id = '6a000000-0000-0000-0000-000000000003'), 2, 'rerolled dice recorded');
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000002', true);
select throws_ok($$select public.reroll_hunter_roll('6a000000-0000-0000-0000-000000000003', '{0}')$$, '23505', null, 'only one reroll per roll');

-- Overreach and Despair.
select throws_ok($$select public.resolve_hunter_desperation('6a000000-0000-0000-0000-000000000003', 'despair')$$, '22023', null, 'no 1, nothing to resolve');
select is((public.resolve_hunter_desperation('6a000000-0000-0000-0000-000000000001', 'overreach') -> 'cell' ->> 'danger')::integer, 2,
  'Overreach raises the cell Danger');
select is((public.resolve_hunter_desperation('6a000000-0000-0000-0000-000000000001', 'overreach') ->> 'replayed')::boolean, true,
  'the same choice replays without raising Danger again');
select throws_ok($$select public.resolve_hunter_desperation('6a000000-0000-0000-0000-000000000001', 'despair')$$, '23505', null, 'the choice cannot change');
select throws_ok($$select public.reroll_hunter_roll('6a000000-0000-0000-0000-000000000001', '{0}')$$, '55000', null, 'no reroll after the resolution');
select throws_ok($$select public.resolve_hunter_desperation('6a000000-0000-0000-0000-000000000002', 'overreach')$$, '22023', null, 'a failure cannot Overreach');
select is((public.resolve_hunter_desperation('6a000000-0000-0000-0000-000000000002', 'despair') ->> 'in_despair')::boolean, true, 'Despair marks the sheet');
select throws_ok($$select public.record_hunter_roll('4a000000-0000-0000-0000-000000000001', 3, 2, true)$$, '55000', null,
  'a hunter in Despair adds no Desperation dice');
select throws_ok($$select public.record_hunter_roll('4a000000-0000-0000-0000-000000000001', 3, 2, false, '{"edge":"Arsenal"}')$$, '55000', null,
  'Edges are blocked in Despair');

-- Redemption: the player asks, the narrator decides.
create temporary table redemption on commit drop as
  select public.request_hunter_redemption('4a000000-0000-0000-0000-000000000001', 'Encarei o assassino') as row;
select is((select row -> 'redemption' ->> 'drive' from redemption), 'Vingança', 'the request is tied to the Drive');
select throws_ok(format('select public.decide_hunter_redemption(%L, true)', (select row -> 'redemption' ->> 'id' from redemption)),
  '42501', null, 'players cannot decide a Redemption');
select throws_ok($$select public.adjust_hunter_cell('5a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001', 0, 1)$$,
  '42501', null, 'players cannot adjust the cell');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000001', true);
select is((public.decide_hunter_redemption((select (row -> 'redemption' ->> 'id')::uuid from redemption), true, 'cumpriu o Ímpeto') ->> 'in_despair')::boolean,
  false, 'approval ends the Despair');
select throws_ok(format('select public.decide_hunter_redemption(%L, false)', (select row -> 'redemption' ->> 'id' from redemption)),
  '23505', null, 'a decided Redemption cannot flip');
select throws_ok($$select public.request_hunter_redemption('4a000000-0000-0000-0000-000000000001')$$, '55000', null, 'no Redemption outside Despair');

-- The narrator adjusts Danger and Desperation idempotently.
select is((public.adjust_hunter_cell('5a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000002', 0, 1, 'cena') -> 'cell' ->> 'desperation')::integer,
  5, 'Desperation goes up');
select is((public.adjust_hunter_cell('5a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000002', 0, 1, 'cena') ->> 'replayed')::boolean,
  true, 'a retried operation is not applied twice');
select throws_ok($$select public.adjust_hunter_cell('5a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000003', 0, 1)$$,
  '23514', null, 'Desperation stays at most 5');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000003', true);
select throws_ok($$select public.hunter_sheet_state('4a000000-0000-0000-0000-000000000001')$$, '42501', null, 'outsiders read no state');
select is((select count(*)::integer from public.hunter_roll_records) + (select count(*)::integer from public.hunter_events), 0,
  'outsiders read no rolls or events');

reset role;
select * from finish();
rollback;
