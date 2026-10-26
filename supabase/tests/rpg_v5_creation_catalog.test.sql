begin;
select plan(24);

insert into auth.users (id, aud, role, email)
values ('17000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'catalog-master@example.test');
insert into public.campaigns (id, owner_id, name)
values ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', 'Catalog Campaign');

create temporary table catalog_schema (schema jsonb);
insert into catalog_schema values ('{"fields":[{"id":"nome","kind":"text"},
   {"id":"cla","kind":"select","options":["Brujah","Sangue-Ralo","Caitiff"]},
   {"id":"predador","kind":"select","options":["Leech","Farmer"]},
   {"id":"geracao","kind":"number"},{"id":"recursos","kind":"number"},
   {"id":"academicos","kind":"number"},{"id":"oficios","kind":"number"},{"id":"briga","kind":"number"},{"id":"medicina","kind":"number"},
   {"id":"vantagens","kind":"collection"},{"id":"defeitos","kind":"collection"},{"id":"especialidades","kind":"collection"}],
  "creation_rules":[
   {"type":"select_grants","id":"predador_bonus","label":"Predador","field":"predador","fields":["recursos"],
    "cases":[{"equals":"Leech","items":{"defeitos":["Exclusão de Presa: mortais ••"],"especialidades":["Briga (Membros)"]}},{"equals":"Farmer"}]},
   {"type":"collection_points","id":"vantagens_pontos","label":"Vantagens","collection":"vantagens","fields":[],"points":7,
    "catalog":[{"name":"Aliados","costs":[1,2,3,4,5]},{"name":"Refúgio","costs":[1,2,3]},{"name":"Bela","costs":[2]}],"allow_homebrew":false},
   {"type":"collection_points","id":"defeitos_pontos","label":"Defeitos","collection":"defeitos","fields":[],"points":2,
    "catalog":[{"name":"Vício","costs":[1]},{"name":"Vício Irremediável","costs":[2]}]},
   {"type":"select_ranges","id":"cla_geracao","label":"Clã e geração","field":"cla","fields":[],
    "cases":[{"equals":["Sangue-Ralo"],"ranges":{"geracao":{"min":14,"max":16}},"exclude":{"predador":["Leech"]}}],
    "default":{"ranges":{"geracao":{"min":10,"max":13}}}},
   {"type":"specialty_picks","id":"especializacoes","label":"Especializações","collection":"especialidades","fields":[],
    "skills":[{"field":"academicos","label":"Acadêmicos"},{"field":"oficios","label":"Ofícios"},{"field":"briga","label":"Briga"},{"field":"medicina","label":"Medicina"}],
    "required":["academicos","oficios"],"free":1}]}');

select lives_ok($$insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
  values ('37000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002',
  'Catalog Template', 'approved', (select schema from catalog_schema))$$, 'catalog, range and specialty rules are accepted');

select throws_ok($$select private.validate_template_creation_rules(jsonb_set((select schema from catalog_schema), '{creation_rules,1,catalog,0,costs}', '[0]'))$$,
  '22023', null, 'catalog costs start at 1');
select throws_ok($$select private.validate_template_creation_rules(jsonb_set((select schema from catalog_schema), '{creation_rules,3,field}', '"nome"'))$$,
  '22023', null, 'select_ranges follows a select');
select throws_ok($$select private.validate_template_creation_rules(jsonb_set((select schema from catalog_schema), '{creation_rules,3,default,ranges,nome}', '{"min":1,"max":2}'))$$,
  '22023', null, 'ranges name number fields');
select throws_ok($$select private.validate_template_creation_rules(jsonb_set((select schema from catalog_schema), '{creation_rules,3,default,ranges,geracao,min}', '20'))$$,
  '22023', null, 'a range needs min up to max');
select throws_ok($$select private.validate_template_creation_rules(jsonb_set((select schema from catalog_schema), '{creation_rules,4,required}', '["nome"]'))$$,
  '22023', null, 'required skills come from the list');
select throws_ok($$select private.validate_template_creation_rules(jsonb_set((select schema from catalog_schema), '{creation_rules,4,fields}', '["briga"]'))$$,
  '22023', null, 'specialty_picks keeps fields empty');
select throws_ok($$select private.validate_template_creation_rules(jsonb_set((select schema from catalog_schema), '{creation_rules,4,id}', '"vantagens_pontos"'))$$,
  '22023', null, 'rule ids stay unique across the new types');

create temporary table catalog_values (values jsonb);
insert into catalog_values values ('{"nome":"A","cla":"Brujah","predador":"Leech","geracao":13,"recursos":0,"oficios":2,"briga":1,
  "vantagens":["Aliados: polícia •••","Refúgio (Biblioteca) (2)","Bela ••"],
  "defeitos":["Exclusão de Presa: mortais ••","Vício Irremediável ••"],
  "especialidades":["Briga (Membros)","Ofícios (Marcenaria)","briga (Bares)"]}');

create function pg_temp.violations(p_changes jsonb) returns text[] language sql as $$
  select private.creation_rule_violations((select schema from catalog_schema), (select values from catalog_values) || p_changes)
$$;

select is(pg_temp.violations('{}'), array[]::text[], 'catalog names with detail, the clan''s generation and 1 + 1 specialties pass');
select is(private.creation_item_name('Aliados (polícia) (2)'), 'Aliados', 'detail and points are dropped from the name');
select is(private.creation_item_name('Segredo Sombrio: Diablerista ••'), 'Segredo Sombrio', 'detail after a colon is dropped');
select ok('vantagens_pontos' = any(pg_temp.violations('{"vantagens":["Aliados •••","Refúgio (2)","Pacto Antigo ••"]}')), 'a name outside the catalog is refused');
select ok('vantagens_pontos' = any(pg_temp.violations('{"vantagens":["Aliados ••••","Refúgio (2)","Bela •"]}')), 'a listed name at a refused cost is refused');
select ok('defeitos_pontos' = any(pg_temp.violations('{"defeitos":["Exclusão de Presa: mortais ••","Vício ••"]}')), 'flaws follow their own catalog');
select is(private.creation_rule_violations(jsonb_set((select schema from catalog_schema), '{creation_rules,1,allow_homebrew}', 'true'),
  (select values from catalog_values) || '{"vantagens":["Aliados •••","Refúgio (2)","Pacto Antigo ••"]}'), array[]::text[], 'the narrator may open the catalog');
select ok('cla_geracao' = any(pg_temp.violations('{"geracao":14}')), 'other clans stay at the 10th-13th generation');
select ok('cla_geracao' = any(pg_temp.violations('{"cla":"Sangue-Ralo","predador":"Farmer","geracao":13,"defeitos":["Vício Irremediável ••"],"especialidades":["Ofícios (Marcenaria)","Briga (Bares)"]}')),
  'thin-blooded need the 14th-16th generation');
select is(pg_temp.violations('{"cla":"Sangue-Ralo","predador":"Farmer","geracao":15,"defeitos":["Vício Irremediável ••"],"especialidades":["Ofícios (Marcenaria)","Briga (Bares)"]}'),
  array[]::text[], 'a thin-blood of the 15th generation passes');
select ok('cla_geracao' = any(pg_temp.violations('{"cla":"Sangue-Ralo","geracao":15}')), 'thin-blooded refuse the Blood Potency predator');
select is(pg_temp.violations('{"cla":"Caitiff"}'), array[]::text[], 'Caitiff use the default generations');
select ok('especializacoes' = any(pg_temp.violations('{"especialidades":["Briga (Membros)","Briga (Bares)"]}')), 'a skill with dots in the required list needs its specialty');
select ok('especializacoes' = any(pg_temp.violations('{"especialidades":["Briga (Membros)","Ofícios (Marcenaria)","Medicina (Cirurgia)"]}')), 'a specialty needs dots in its skill');
select ok('especializacoes' = any(pg_temp.violations('{"especialidades":["Briga (Membros)","Ofícios (Marcenaria)","Briga (Bares)","Ofícios (Couro)"]}')), 'one free specialty only');
select ok('especializacoes' = any(pg_temp.violations('{"especialidades":["Briga (Membros)","Ofícios (Marcenaria)","Corrida"]}')), 'the Skill (specialty) format is required');

select * from finish();
rollback;
