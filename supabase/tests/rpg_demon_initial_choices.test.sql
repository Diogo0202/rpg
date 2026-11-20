begin;
select plan(6);

create temporary table demon_initial_case (schema jsonb, values jsonb);
insert into demon_initial_case values (
  '{"creation_rules":[{"type":"priority_points","id":"demon","label":"Demônio","fields":["lore_a","lore_b","faith_max","will_max"],
    "freebies":0,"initial_equal":[{"field":"faith_now","source":"faith_max"},{"field":"will_now","source":"will_max"}],
    "pools":[{"id":"lores","label":"Doutrinas","base":0,"cost":7,"budgets":[3],
      "groups":[{"label":"Doutrinas","fields":["lore_a","lore_b"]}],
      "allowed":{"field":"house","cases":{"A":["lore_a"],"B":["lore_b"]}},
      "primary_choice":{"field":"primary_lore","options":{"A Lore":"lore_a","B Lore":"lore_b"}}}]}]}'::jsonb,
  '{"house":"A","primary_lore":"A Lore","lore_a":3,"lore_b":0,
    "faith_max":3,"faith_now":3,"will_max":5,"will_now":5}'::jsonb
);

select is(private.priority_choice_violations((select schema from demon_initial_case), (select values from demon_initial_case)),
  array[]::text[], 'valid main lore and initial resources pass');
select is(private.priority_choice_violations((select schema from demon_initial_case),
  (select values || '{"primary_lore":"B Lore"}'::jsonb from demon_initial_case)),
  array['demon'], 'another House lore is rejected');
select is(private.priority_choice_violations((select schema from demon_initial_case),
  (select values || '{"primary_lore":""}'::jsonb from demon_initial_case)),
  array['demon'], 'missing main lore is rejected');
select is(private.priority_choice_violations((select schema from demon_initial_case),
  (select values || '{"lore_a":1,"lore_b":2}'::jsonb from demon_initial_case)),
  array['demon'], 'main lore must have the highest rating');
select is(private.priority_choice_violations((select schema from demon_initial_case),
  (select values || '{"faith_now":2}'::jsonb from demon_initial_case)),
  array['demon'], 'current Faith starts at maximum');
select is(private.priority_choice_violations((select schema from demon_initial_case),
  (select values || '{"will_now":4}'::jsonb from demon_initial_case)),
  array['demon'], 'current Willpower starts at maximum');

select * from finish();
rollback;
