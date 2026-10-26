begin;
select plan(13);

insert into auth.users (id, aud, role, email)
values ('16000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'points-master@example.test');
insert into public.campaigns (id, owner_id, name)
values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'Points Campaign');

select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'Bad collection', 'needs_review',
  '{"fields":[{"id":"nome","kind":"text"}],"creation_rules":[{"type":"collection_points","id":"x","collection":"nome","fields":[],"points":7}]}'::jsonb)$$,
  '22023', null, 'collection_points needs a collection field');
select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'Bad band', 'needs_review',
  '{"fields":[{"id":"p","kind":"select","options":["A"]},{"id":"g","kind":"number"},{"id":"bp","kind":"number"},{"id":"h","kind":"number"}],
    "creation_rules":[{"type":"select_grants","id":"x","field":"p","fields":["h"],"base_by":{"field":"g","bands":[{"min":1,"max":2,"add":{"bp":1}}]},
    "cases":[{"equals":"A"}]}]}'::jsonb)$$,
  '22023', null, 'a band may only add to the rule''s fields');

-- Predator Leech: Potency +1 and a granted advantage; bands give Potency 1 at 12-13 and 2 at 10-11.
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002',
  'Points Template', 'approved',
  '{"fields":[{"id":"nome","kind":"text"},{"id":"predador","kind":"select","options":["Leech"]},
     {"id":"geracao","kind":"number"},{"id":"potencia","kind":"number"},{"id":"recursos","kind":"number"},
     {"id":"vantagens","kind":"collection"},{"id":"defeitos","kind":"collection"}],
    "creation_rules":[
     {"type":"select_grants","id":"predador","label":"Predador","field":"predador","fields":["potencia"],
      "base_by":{"field":"geracao","bands":[{"min":12,"max":13,"add":{"potencia":1}},{"min":10,"max":11,"add":{"potencia":2}}]},
      "cases":[{"equals":"Leech","add":{"potencia":1},"items":{"vantagens":["Rebanho ••"]}}]},
     {"type":"collection_points","id":"vantagens_pontos","label":"Vantagens","collection":"vantagens","fields":["recursos"],"points":7},
     {"type":"collection_points","id":"defeitos_pontos","label":"Defeitos","collection":"defeitos","fields":[],"points":2}]}'::jsonb);

create temporary table point_case_values (label text primary key, values jsonb);
insert into point_case_values values ('valid',
  '{"nome":"A","predador":"Leech","geracao":13,"potencia":2,"recursos":1,
    "vantagens":["Rebanho ••","Aliados •••","Refúgio (2)","Contatos 1"],"defeitos":["Vício ••"]}');

create function pg_temp.violations(p_changes jsonb) returns text[] language sql as $$
  select private.creation_rule_violations(
    (select schema from public.system_templates where id = '36000000-0000-0000-0000-000000000001'),
    (select values from point_case_values where label = 'valid') || p_changes)
$$;

select is(pg_temp.violations('{}'), array[]::text[], 'band base, predator add and 7 + 2 own points pass');
select ok('predador' = any(pg_temp.violations('{"potencia":1}')), 'Blood Potency must follow the band plus the predator');
select is(pg_temp.violations('{"geracao":11,"potencia":3}'), array[]::text[], 'an older generation raises the base');
select ok('predador' = any(pg_temp.violations('{"geracao":9,"potencia":1}')), 'a generation outside the bands is refused');
select ok('vantagens_pontos' = any(pg_temp.violations('{"vantagens":["Rebanho ••","Aliados •••","Refúgio (2)"]}')), 'six own points are short');
select ok('vantagens_pontos' = any(pg_temp.violations('{"recursos":2}')), 'number fields count toward the points');
select ok('vantagens_pontos' = any(pg_temp.violations('{"vantagens":["Rebanho ••","Aliados •••","Refúgio (2)","Mawla"]}')), 'an item without points is refused');
select ok('vantagens_pontos' = any(pg_temp.violations('{"predador":null,"potencia":1}')), 'without the predator its advantage counts as the player''s');
select ok('defeitos_pontos' = any(pg_temp.violations('{"defeitos":[]}')), 'two points of flaws are required');
select ok('defeitos_pontos' = any(pg_temp.violations('{"defeitos":[3]}')), 'non-text flaws are refused');
select is(private.creation_item_points('Aliados (12)'), 12, 'a trailing number in parentheses is the item''s worth');

select * from finish();
rollback;
