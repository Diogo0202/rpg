begin;
select plan(14);

insert into auth.users (id, aud, role, email)
values
  ('14000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'rules-player@example.test'),
  ('14000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'rules-master@example.test');
insert into public.campaigns (id, owner_id, name)
values ('24000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000002', 'Rules Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values ('24000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', 'player');

select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('24000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000002', 'Bad limit', 'needs_review',
  '{"fields":[{"id":"nome","kind":"text","max":3}]}'::jsonb)$$, '22023', null, 'limits only on number fields');
select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('24000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000002', 'Bad rule', 'needs_review',
  '{"fields":[{"id":"nome","kind":"text"}],"creation_rules":[{"type":"group_sum","id":"x","fields":["nome"],"max":1}]}'::jsonb)$$,
  '22023', null, 'rules only over number fields');
select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('24000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000002', 'Bad type', 'needs_review',
  '{"fields":[{"id":"aa","kind":"number"}],"creation_rules":[{"type":"script","id":"x","fields":["aa"]}]}'::jsonb)$$,
  '22023', null, 'unknown rule types are rejected');

-- Three attributes distributed as one 3, one 2, one 1; plus a budget over two skills.
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('34000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000002',
  'Rules Template', 'approved',
  '{"fields":[{"id":"nome","kind":"text"},
     {"id":"forca","kind":"number","min":1,"max":5},{"id":"agilidade","kind":"number","min":1,"max":5},{"id":"mente","kind":"number","min":1,"max":5},
     {"id":"luta","kind":"number","min":0,"max":5},{"id":"furtividade","kind":"number","min":0,"max":5}],
    "creation_rules":[
     {"type":"group_distribution","id":"atributos","label":"Atributos","fields":["forca","agilidade","mente"],
      "options":[{"label":"Padrão","counts":{"3":1,"2":1,"1":1}}]},
     {"type":"points_budget","id":"pericias","label":"Perícias","fields":["luta","furtividade"],
      "costs":{"0":0,"1":1,"2":2,"3":4},"budget":3}]}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000001', true);
select lives_ok($$insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values)
  values ('44000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000001', 'Valid', '{"nome":"A","forca":3,"agilidade":1,"mente":2,"luta":2,"furtividade":1}'::jsonb)$$,
  'a sheet that follows the distribution and the budget is created');
select throws_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001',
  'Bad dist', '{"nome":"B","forca":3,"agilidade":3,"mente":1,"luta":2,"furtividade":1}'::jsonb)$$,
  '23514', null, 'a wrong distribution is rejected on direct insert');
select throws_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001',
  'Over budget', '{"nome":"C","forca":3,"agilidade":2,"mente":1,"luta":3,"furtividade":1}'::jsonb)$$,
  '23514', null, 'spending over the budget is rejected');
select throws_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001',
  'Missing', '{"nome":"D","forca":3,"agilidade":2,"luta":2,"furtividade":1}'::jsonb)$$,
  '23514', null, 'a missing field counts as zero and breaks the distribution');
select throws_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001',
  'Out of range', '{"nome":"E","forca":6,"agilidade":2,"mente":1,"luta":2,"furtividade":1}'::jsonb)$$,
  '23514', null, 'a value above the field maximum is rejected');

-- After creation, advancement may leave the distribution but never the field limits.
select lives_ok($$update public.character_sheets set values = values || '{"agilidade":3}'::jsonb
  where id = '44000000-0000-0000-0000-000000000001'$$, 'advancing past the creation distribution is allowed');
select throws_ok($$update public.character_sheets set values = values || '{"mente":9}'::jsonb
  where id = '44000000-0000-0000-0000-000000000001'$$, '23514', null, 'updates still obey the field limits');

-- Backups: a player restore must follow the rules, a master restore may skip them.
select throws_ok($$select public.restore_character_backup('24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001',
  jsonb_build_object('format','rpg-nexus-sheet','format_version','1','name','Forged',
    'values','{"nome":"F","forca":5,"agilidade":5,"mente":5,"luta":3,"furtividade":3}'::jsonb,'effects','[]'::jsonb,
    'template', jsonb_build_object('fields', (select schema -> 'fields' from public.system_templates where id = '34000000-0000-0000-0000-000000000001'))))$$,
  '23514', null, 'a forged player backup cannot skip the creation rules');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000002', true);
select lives_ok($$select public.restore_character_backup('24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001',
  jsonb_build_object('format','rpg-nexus-sheet','format_version','1','name','Veteran',
    'values','{"nome":"G","forca":5,"agilidade":4,"mente":4,"luta":3,"furtividade":3}'::jsonb,'effects','[]'::jsonb,
    'template', jsonb_build_object('fields', (select schema -> 'fields' from public.system_templates where id = '34000000-0000-0000-0000-000000000001'))))$$,
  'a master restores an advanced sheet');
select throws_ok($$select public.restore_character_backup('24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001',
  jsonb_build_object('format','rpg-nexus-sheet','format_version','1','name','Broken',
    'values','{"nome":"H","forca":7,"agilidade":4,"mente":4,"luta":3,"furtividade":3}'::jsonb,'effects','[]'::jsonb,
    'template', jsonb_build_object('fields', (select schema -> 'fields' from public.system_templates where id = '34000000-0000-0000-0000-000000000001'))))$$,
  '23514', null, 'restores still obey the field limits');
select is(private.creation_rule_violations(
  (select schema from public.system_templates where id = '34000000-0000-0000-0000-000000000001'),
  '{"forca":1,"agilidade":2,"mente":3,"luta":0,"furtividade":2}'::jsonb), array['pericias'],
  'violations name the rules that failed');

select * from finish();
rollback;
