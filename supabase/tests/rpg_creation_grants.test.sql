begin;
select plan(15);

insert into auth.users (id, aud, role, email)
values
  ('15000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'grants-player@example.test'),
  ('15000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'grants-master@example.test');
insert into public.campaigns (id, owner_id, name)
values ('25000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000002', 'Grants Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values ('25000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', 'player');

select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('25000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000002', 'No controller', 'needs_review',
  '{"fields":[{"id":"aa","kind":"number"}],"creation_rules":[{"type":"select_grants","id":"x","fields":["aa"],"cases":[{"equals":"A"}]}]}'::jsonb)$$,
  '22023', null, 'select_grants needs its controlling select');

-- Clan A grants x and y, clan B grants z. Predator Leech costs one Humanity, grants a flaw and a
-- discipline pick; the Z pick needs clan B. Powers: x has a (1) and b (2), y has c (1).
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('35000000-0000-0000-0000-000000000001', '25000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000002',
  'Grants Template', 'approved',
  '{"fields":[{"id":"nome","kind":"text"},
     {"id":"cla","kind":"select","options":["A","B"]},{"id":"predador","kind":"select","options":["Leech"]},
     {"id":"predador_disciplina","kind":"select","options":[],"depends_on":{"field_id":"predador","cases":[{"equals":"Leech","options":["X","Z"]}]}},
     {"id":"disc_x","kind":"number","min":0,"max":5},{"id":"disc_y","kind":"number","min":0,"max":5},{"id":"disc_z","kind":"number","min":0,"max":5},
     {"id":"humanidade","kind":"number","min":0,"max":10},
     {"id":"disciplinas","kind":"collection"},{"id":"defeitos","kind":"collection"}],
    "creation_rules":[
     {"type":"select_grants","id":"cla","label":"Clã","field":"cla","fields":["disc_x","disc_y","disc_z"],
      "cases":[{"equals":"A","add":{"disc_x":1,"disc_y":1}},{"equals":"B","add":{"disc_z":1}}]},
     {"type":"select_grants","id":"predador","label":"Predador","field":"predador","fields":["humanidade","disc_x","disc_y","disc_z"],
      "base":{"humanidade":7},
      "cases":[{"equals":"Leech","add":{"humanidade":-1},"items":{"defeitos":["Presa"]},
        "choices":[{"field":"predador_disciplina","label":"Disciplina","options":[
          {"label":"X","add":{"disc_x":1}},{"label":"Z","add":{"disc_z":1},"requires":{"field":"cla","in":["B"]}}]}]}]},
     {"type":"power_picks","id":"poderes","label":"Poderes","collection":"disciplinas","fields":["disc_x","disc_y"],
      "sources":[{"field":"disc_x","label":"Ex","count":"dots","max_level":"dots","powers":[{"name":"a","level":1},{"name":"b","level":2}]},
                 {"field":"disc_y","label":"Ey","count":"dots","max_level":"dots","powers":[{"name":"c","level":1}]}]}]}'::jsonb);

create temporary table grant_case_values (label text primary key, values jsonb);
insert into grant_case_values values ('valid',
  '{"nome":"A","cla":"A","predador":"Leech","predador_disciplina":"X","disc_x":2,"disc_y":1,"disc_z":0,"humanidade":6,
    "defeitos":["Presa"],"disciplinas":["Ex: a","Ex: b","Ey: c"]}');
grant select on grant_case_values to authenticated;

create function pg_temp.violations(p_changes jsonb) returns text[] language sql as $$
  select private.creation_rule_violations(
    (select schema from public.system_templates where id = '35000000-0000-0000-0000-000000000001'),
    (select values from grant_case_values where label = 'valid') || p_changes)
$$;

select is(pg_temp.violations('{}'), array[]::text[], 'a sheet that matches clan, predator and powers has no violations');
select ok('cla' = any(pg_temp.violations('{"disc_z":1}')), 'an off-clan discipline dot is refused');
select ok('predador' = any(pg_temp.violations('{"humanidade":7}')), 'the predator Humanity cost is enforced');
select ok('predador' = any(pg_temp.violations('{"defeitos":[]}')), 'granted flaws must stay on the sheet');
select ok('predador' = any(pg_temp.violations('{"disc_x":1,"disc_z":1,"predador_disciplina":"Z","disciplinas":["Ex: a","Ey: c"]}')),
  'a clan-only pick is refused for another clan');
select ok('predador' = any(pg_temp.violations('{"disc_x":1,"predador_disciplina":null,"disciplinas":["Ex: a","Ey: c"]}')),
  'the predator pick is required');
select is(pg_temp.violations('{"disciplinas":["Ex: a","Ex: b"]}'), array['poderes'], 'each dot needs a power');
select is(pg_temp.violations('{"disciplinas":["Ex: a","Ex: zzz","Ey: c"]}'), array['poderes'], 'powers outside the list are refused');
select is(pg_temp.violations('{"disciplinas":["Ex: a","Ex: a","Ey: c"]}'), array['poderes'], 'a power cannot be taken twice');
select is(pg_temp.violations('{"predador":null,"predador_disciplina":null,"disc_x":1,"humanidade":7,"defeitos":[],"disciplinas":["Ex: b","Ey: c"]}'),
  array['poderes'], 'a power above the dots is refused');

set local role authenticated;
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000001', true);
select lives_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('25000000-0000-0000-0000-000000000001', '35000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001',
  'Valid', (select values from grant_case_values where label = 'valid'))$$, 'a direct insert that follows the grants is created');
select throws_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('25000000-0000-0000-0000-000000000001', '35000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001',
  'Stolen dots', (select values from grant_case_values where label = 'valid') || '{"disc_y":3,"disciplinas":["Ex: a","Ex: b","Ey: c"]}'::jsonb)$$,
  '23514', null, 'a direct insert with extra discipline dots is rejected');
select throws_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('25000000-0000-0000-0000-000000000001', '35000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001',
  'Free power', (select values from grant_case_values where label = 'valid') || '{"disciplinas":["Ex: a","Ex: b","Ey: c","Ey: d"]}'::jsonb)$$,
  '23514', null, 'a direct insert with an unlisted power is rejected');
select lives_ok($$update public.character_sheets set values = values || '{"disc_y":2}'::jsonb where name = 'Valid'$$,
  'after creation, experience may raise a discipline');

select * from finish();
rollback;
