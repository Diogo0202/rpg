begin;
select plan(19);

insert into auth.users (id, aud, role, email)
values
  ('16000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'priority-player@example.test'),
  ('16000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'priority-master@example.test');
insert into public.campaigns (id, owner_id, name)
values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'Priority Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 'player');

-- Invalid declarations are refused when a template is saved.
select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'Bad budgets', 'needs_review',
  '{"fields":[{"id":"aa","kind":"number"},{"id":"bb","kind":"number"}],"creation_rules":[{"type":"priority_points","id":"x","label":"X","freebies":3,"fields":["aa","bb"],
    "pools":[{"id":"p","label":"P","cost":1,"budgets":[2],"groups":[{"label":"G1","fields":["aa"]},{"label":"G2","fields":["bb"]}]}]}]}'::jsonb)$$,
  '22023', null, 'a pool needs one budget per group');
select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'Twice', 'needs_review',
  '{"fields":[{"id":"aa","kind":"number"}],"creation_rules":[{"type":"priority_points","id":"x","label":"X","freebies":3,"fields":["aa"],
    "pools":[{"id":"p","label":"P","cost":1,"budgets":[1],"groups":[{"label":"G","fields":["aa"]}]},
             {"id":"q","label":"Q","cost":1,"budgets":[1],"groups":[{"label":"G","fields":["aa"]}]}]}]}'::jsonb)$$,
  '22023', null, 'a field cannot sit in two pools');
select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'Text pool', 'needs_review',
  '{"fields":[{"id":"aa","kind":"text"}],"creation_rules":[{"type":"priority_points","id":"x","label":"X","freebies":3,"fields":["aa"],
    "pools":[{"id":"p","label":"P","cost":1,"budgets":[1],"groups":[{"label":"G","fields":["aa"]}]}]}]}'::jsonb)$$,
  '22023', null, 'pool fields must be numbers');
select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'Cost', 'needs_review',
  '{"fields":[{"id":"aa","kind":"number"}],"creation_rules":[{"type":"priority_points","id":"x","label":"X","freebies":3,"fields":["aa"],
    "pools":[{"id":"p","label":"P","cost":101,"budgets":[1],"groups":[{"label":"G","fields":["aa"]}]}]}]}'::jsonb)$$,
  '22023', null, 'costs stay within 0 and 100');

-- a1,a2 | a3 with free budgets 2 and 1 (any order); clan A may raise d1, clan B d1 or d2;
-- humanity h starts at virtue v1; 3 freebie points, 2 per attribute dot, 3 per discipline dot, 1 per humanity dot.
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002',
  'Priority Template', 'approved',
  '{"fields":[{"id":"nome","kind":"text"},{"id":"cla","kind":"select","options":["A","B"]},
     {"id":"a1","kind":"number","min":1,"max":5},{"id":"a2","kind":"number","min":1,"max":5},{"id":"a3","kind":"number","min":1,"max":5},
     {"id":"d1","kind":"number","min":0,"max":5},{"id":"d2","kind":"number","min":0,"max":5},
     {"id":"v1","kind":"number","min":1,"max":5},{"id":"h","kind":"number","min":0,"max":10}],
    "creation_rules":[{"type":"priority_points","id":"criacao","label":"Criação","freebies":3,"exact":true,
     "fields":["a1","a2","a3","d1","d2","h","v1"],
     "pools":[
       {"id":"atributos","label":"Atributos","base":1,"cost":2,"budgets":[2,1],"groups":[{"label":"G1","fields":["a1","a2"]},{"label":"G2","fields":["a3"]}]},
       {"id":"disciplinas","label":"Disciplinas","base":0,"cost":3,"budgets":[1],"groups":[{"label":"D","fields":["d1","d2"]}],
        "allowed":{"field":"cla","cases":{"A":["d1"],"B":["d1","d2"]}}},
       {"id":"humanidade","label":"Humanidade","base_from":["v1"],"cost":1,"budgets":[0],"groups":[{"label":"H","fields":["h"]}]}]}]}'::jsonb);

create temporary table priority_case (label text primary key, values jsonb);
insert into priority_case values ('valid', '{"nome":"A","cla":"A","a1":3,"a2":1,"a3":2,"d1":1,"d2":0,"v1":1,"h":4}');
grant select on priority_case to authenticated;

create function pg_temp.violations(p_changes jsonb) returns text[] language sql as $$
  select private.creation_rule_violations(
    (select schema from public.system_templates where id = '36000000-0000-0000-0000-000000000001'),
    (select values from priority_case where label = 'valid') || p_changes)
$$;

select is(pg_temp.violations('{}'), array[]::text[], 'budgets spent and the freebies bought exactly: valid');
select is(pg_temp.violations('{"a1":2,"a2":1,"a3":3}'), array[]::text[], 'budgets may be matched to the groups in either order');
select is(pg_temp.violations('{"a1":5,"a2":5,"a3":5}'), array['criacao'], 'maxing every attribute spends far past the freebies');
select is(pg_temp.violations('{"a1":1,"a2":1,"a3":4}'), array['criacao'], 'a group below its budget is refused');
select is(pg_temp.violations('{"h":3}'), array['criacao'], 'freebies left unspent are refused when exact');
select is(pg_temp.violations('{"h":5}'), array['criacao'], 'freebies overspent are refused');
select is(pg_temp.violations('{"h":0}'), array['criacao'], 'a value below its base is refused');
select is(pg_temp.violations('{"v1":2,"h":5}'), array[]::text[], 'humanity is measured from its base fields: a higher virtue moves the base, not the cost');
select is(pg_temp.violations('{"d2":1,"d1":0}'), array['criacao'], 'a discipline outside clan A is refused');
select is(pg_temp.violations('{"cla":"B","d2":1,"d1":0}'), array[]::text[], 'the same dots are fine for clan B');
select is(pg_temp.violations('{"cla":"Z"}'), array['criacao'], 'an unknown clan unlocks nothing');
select is(pg_temp.violations('{"a1":"muito"}'), array['criacao'], 'a non-number is refused');

set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
select lives_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001',
  'Valid', (select values from priority_case where label = 'valid'))$$, 'a direct insert that follows the priorities is created');
select throws_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001',
  'Stolen', (select values from priority_case where label = 'valid') || '{"a1":5,"a2":5,"a3":5}'::jsonb)$$,
  '23514', null, 'a direct insert that ignores the priorities is rejected');
select lives_ok($$update public.character_sheets set values = values || '{"a1":5}'::jsonb where name = 'Valid'$$,
  'after creation, advancement may leave the creation budgets');

select * from finish();
rollback;
