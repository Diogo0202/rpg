begin;
select plan(5);

create temporary table demon_rule_case (schema jsonb, values jsonb);
insert into demon_rule_case values (
  '{"fields":[{"id":"v1","kind":"number"},{"id":"v2","kind":"number"},
    {"id":"v3","kind":"number"},{"id":"wp","kind":"number"}],
    "creation_rules":[{"type":"priority_points","id":"demon","label":"Demônio","freebies":0,
    "fields":["v1","v2","v3","wp"],"pools":[
      {"id":"virtues","label":"Virtudes","base":1,"cost":2,"budgets":[3],
       "groups":[{"label":"Virtudes","fields":["v1","v2","v3"]}]},
      {"id":"willpower","label":"Vontade","base_from_highest":["v1","v2","v3"],
       "highest_count":2,"cost":1,"budgets":[0],"groups":[{"label":"Vontade","fields":["wp"]}]}
    ]}]}'::jsonb,
  '{"v1":3,"v2":2,"v3":1,"wp":5}'::jsonb
);

select lives_ok($$select private.validate_template_creation_rules((select schema from demon_rule_case))$$,
  'a template may derive willpower from two highest virtues');
select is(private.priority_point_violations((select schema from demon_rule_case), (select values from demon_rule_case)),
  array[]::text[], '3, 2, 1 gives willpower 5');
select is(private.priority_point_violations((select schema from demon_rule_case),
  (select values || '{"v1":1,"v2":3,"v3":2,"wp":5}'::jsonb from demon_rule_case)),
  array[]::text[], 'the order of virtues does not change willpower');
select is(private.priority_point_violations((select schema from demon_rule_case),
  (select values || '{"wp":4}'::jsonb from demon_rule_case)),
  array['demon'], 'willpower below the derived base is rejected');
select throws_ok($$select private.validate_template_creation_rules(
  (select jsonb_set(schema, '{creation_rules,0,pools,1,highest_count}', '4'::jsonb) from demon_rule_case))$$,
  '22023', null, 'highest_count cannot exceed the source field count');

select * from finish();
rollback;
