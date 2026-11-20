begin;
select plan(22);

insert into auth.users (id, aud, role, email)
values
  ('19000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'cell-master@example.test'),
  ('19000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'cell-player@example.test'),
  ('19000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'cell-outsider@example.test');
insert into public.campaigns (id, owner_id, name)
values ('29000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'Cell Campaign'),
       ('29000000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000003', 'Other Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values ('29000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000002', 'player');

-- Structured text limits on templates.
select throws_ok($$select private.validate_template_text_constraints('{"fields":[{"id":"n","kind":"number","max_length":3}]}')$$,
  '22023', null, 'max_length is only for text and collections');
select throws_ok($$select private.validate_template_text_constraints('{"fields":[{"id":"c","kind":"collection","min_items":3,"max_items":2}]}')$$,
  '22023', null, 'min_items cannot exceed max_items');
select throws_ok($$select private.validate_template_text_constraints('{"fields":[{"id":"a","kind":"text","paired_with":"b"}]}')$$,
  '22023', null, 'paired_with must name an existing text field');
select throws_ok($$select private.validate_template_text_constraints('{"fields":[{"id":"c","kind":"collection","item_options":["x","x"]}]}')$$,
  '22023', null, 'item options are unique');

insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('39000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001',
  'Hunter v3', 'approved',
  '{"fields":[{"id":"nome","kind":"text"},
    {"id":"conviccao_1","kind":"text","max_length":10,"paired_with":"pedra_toque_1"},
    {"id":"pedra_toque_1","kind":"text","max_length":10,"paired_with":"conviccao_1"},
    {"id":"favoritas","kind":"collection","max_items":2,"item_options":["Busca","Cura","Enigmas"]}]}'::jsonb),
  ('39000000-0000-0000-0000-000000000002', '29000000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000003',
  'Other', 'approved', '{"fields":[{"id":"nome","kind":"text"}]}'::jsonb);

select is(private.sheet_text_constraint_violations((select schema from public.system_templates where id = '39000000-0000-0000-0000-000000000001'),
  '{"conviccao_1":"Proteger","pedra_toque_1":"Clara","favoritas":["Busca","Cura"]}'), array[]::text[], 'complete pairs and listed items pass');
select is(private.sheet_text_constraint_violations((select schema from public.system_templates where id = '39000000-0000-0000-0000-000000000001'),
  '{"conviccao_1":"Proteger","pedra_toque_1":" "}'), array['conviccao_1'], 'a conviction needs its touchstone');
select is(private.sheet_text_constraint_violations((select schema from public.system_templates where id = '39000000-0000-0000-0000-000000000001'),
  '{"conviccao_1":"texto longo demais","pedra_toque_1":"x"}'), array['conviccao_1'], 'max_length is enforced');
select is(private.sheet_text_constraint_violations((select schema from public.system_templates where id = '39000000-0000-0000-0000-000000000001'),
  '{"favoritas":["Busca","Voar"]}'), array['favoritas'], 'items outside the closed list are rejected');
select is(private.sheet_text_constraint_violations((select schema from public.system_templates where id = '39000000-0000-0000-0000-000000000001'),
  '{"favoritas":["Busca","Cura","Enigmas"]}'), array['favoritas'], 'max_items is enforced');

insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values)
values ('49000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '39000000-0000-0000-0000-000000000001',
  '19000000-0000-0000-0000-000000000002', 'Mara', '{"nome":"Mara","conviccao_1":"Proteger","pedra_toque_1":"Clara"}'),
  ('49000000-0000-0000-0000-000000000002', '29000000-0000-0000-0000-000000000001', '39000000-0000-0000-0000-000000000001',
  '19000000-0000-0000-0000-000000000001', 'Davi', '{"nome":"Davi"}'),
  ('49000000-0000-0000-0000-000000000003', '29000000-0000-0000-0000-000000000002', '39000000-0000-0000-0000-000000000002',
  '19000000-0000-0000-0000-000000000003', 'Alheio', '{"nome":"Alheio"}');
select throws_ok($$update public.character_sheets set values = values || '{"pedra_toque_1":""}' where id = '49000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'the sheet trigger rejects an unpaired conviction');

-- Hunter cells: the master manages.
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
select lives_ok($$insert into public.hunter_cells (id, campaign_id, name, danger, desperation)
  values ('59000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', 'Vigília da Ponte', 2, 1)$$, 'the master creates a cell');
select lives_ok($$insert into public.hunter_cell_members (cell_id, campaign_id, sheet_id, role) values
  ('59000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000001', 'Batedora'),
  ('59000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000002', 'Líder')$$, 'campaign sheets join the cell');
select throws_ok($$insert into public.hunter_cell_members (cell_id, campaign_id, sheet_id) values
  ('59000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000003')$$,
  '23503', null, 'a sheet from another campaign cannot join');
select lives_ok($$insert into public.hunter_cell_targets (id, cell_id, campaign_id, name, kind, threat) values
  ('69000000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', 'O Senhor do Cais', 'antagonista', 4)$$, 'the master adds an antagonist');
select lives_ok($$insert into public.hunter_cell_bonds (cell_id, campaign_id, from_sheet_id, to_sheet_id, to_target_id, kind) values
  ('59000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000002', null, 'confianca'),
  ('59000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000002', null, '69000000-0000-0000-0000-000000000001', 'juramento')$$,
  'bonds link members to members and targets');
select throws_ok($$insert into public.hunter_cell_bonds (cell_id, campaign_id, from_sheet_id, to_sheet_id, to_target_id, kind) values
  ('59000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000001',
   '49000000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000001', 'suspeita')$$, '23514', null, 'a bond has exactly one destination');
select lives_ok($$update public.hunter_cells set desperation = 3 where id = '59000000-0000-0000-0000-000000000001'$$, 'the master edits the cell');
select is((select version from public.hunter_cells where id = '59000000-0000-0000-0000-000000000001'), 2, 'edits bump the version');

-- A player reads but cannot write.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.hunter_cell_members), 2, 'members read the cell roster');
select is((select count(*)::integer from public.hunter_cell_targets), 1, 'members read the targets');
update public.hunter_cells set danger = 5;
select is((select danger::integer from public.hunter_cells), 2, 'players cannot edit the cell');

-- Outsiders see nothing.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.hunter_cells) + (select count(*)::integer from public.hunter_cell_bonds), 0,
  'outsiders read no cells or bonds');

reset role;
select * from finish();
rollback;
