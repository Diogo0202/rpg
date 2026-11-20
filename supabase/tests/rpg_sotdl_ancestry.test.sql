begin;
select plan(5);

-- Shadow of the Demon Lord ancestry rule: base 10 per attribute, ancestry adds may be negative
-- (Goblin), and a choice raises one attribute (Humano). Mirrors the shadow-demon-lord starter.
create function pg_temp.sotdl_schema() returns jsonb language sql as $$
  select '{"fields":[{"id":"nome","kind":"text"},
     {"id":"ancestralidade","kind":"select","options":["Humano","Goblin"]},
     {"id":"ancestralidade_atributo","kind":"select","options":[],"depends_on":{"field_id":"ancestralidade","cases":[{"equals":"Humano","options":["Força +1","Vontade +1"]}]}},
     {"id":"forca","kind":"number","min":1,"max":20},{"id":"agilidade","kind":"number","min":1,"max":20},
     {"id":"vontade","kind":"number","min":1,"max":20},{"id":"bonus_percepcao","kind":"number","min":-10,"max":10}],
    "creation_rules":[{"type":"select_grants","id":"ancestralidade","label":"Ancestralidade","field":"ancestralidade",
      "fields":["forca","agilidade","vontade","bonus_percepcao"],"base":{"forca":10,"agilidade":10,"vontade":10},
      "cases":[{"equals":"Humano","choices":[{"field":"ancestralidade_atributo","label":"Atributo +1","options":[
          {"label":"Força +1","add":{"forca":1}},{"label":"Vontade +1","add":{"vontade":1}}]}]},
        {"equals":"Goblin","add":{"forca":-2,"agilidade":2,"vontade":-1,"bonus_percepcao":1}}]}]}'::jsonb
$$;

create function pg_temp.violations(p_values jsonb) returns text[] language sql as $$
  select private.creation_rule_violations(pg_temp.sotdl_schema(), p_values)
$$;

select is(pg_temp.violations('{"nome":"Vorek","ancestralidade":"Goblin","forca":8,"agilidade":12,"vontade":9,"bonus_percepcao":1}'),
  array[]::text[], 'a Goblin with the negative adjustments has no violations');
select ok('ancestralidade' = any(pg_temp.violations('{"nome":"Vorek","ancestralidade":"Goblin","forca":10,"agilidade":12,"vontade":9,"bonus_percepcao":1}')),
  'ignoring a negative ancestry adjustment is refused');
select is(pg_temp.violations('{"nome":"Martha","ancestralidade":"Humano","ancestralidade_atributo":"Vontade +1","forca":10,"agilidade":10,"vontade":11,"bonus_percepcao":0}'),
  array[]::text[], 'a Human with the chosen raise has no violations');
select ok('ancestralidade' = any(pg_temp.violations('{"nome":"Martha","ancestralidade":"Humano","forca":10,"agilidade":10,"vontade":11,"bonus_percepcao":0}')),
  'the Human raise must be chosen');
select ok('ancestralidade' = any(pg_temp.violations('{"nome":"Martha","ancestralidade":"Humano","ancestralidade_atributo":"Força +1","forca":12,"agilidade":10,"vontade":10,"bonus_percepcao":0}')),
  'raising more than the ancestry allows is refused');

select * from finish();
rollback;
