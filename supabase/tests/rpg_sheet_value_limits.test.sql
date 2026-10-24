begin;
select plan(17);

insert into auth.users (id, aud, role, email)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'sheet-player@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'sheet-other@example.test'),
  ('10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'sheet-master@example.test');
insert into public.campaigns (id, owner_id, name)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'Limit Test');
insert into public.campaign_members (campaign_id, user_id, role)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'player'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000003', 'Limit Template', 'approved',
        '{"fields":[{"id":"name","kind":"text","required":true},
                     {"id":"score","kind":"number"},
                     {"id":"clan","kind":"select","options":["Brujah"]},
                     {"id":"active","kind":"checkbox","required":true},
                     {"id":"items","kind":"collection"},
                     {"id":"pool","kind":"formula"}]}'::jsonb);

insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000002', 'Other Player Sheet',
        '{"name":"Other","active":true}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001', 'Player Sheet',
        jsonb_build_object('name', repeat('n', 10000), 'score', 1000000,
          'clan', 'Brujah', 'active', true, 'items',
          (select jsonb_agg('x'::text) from generate_series(1, 200)), 'pool', null));
select is((select count(*)::integer from public.character_sheets), 1, 'player reads own sheet');
select is((select count(*)::integer from public.character_sheets where owner_id = '10000000-0000-0000-0000-000000000002'), 0, 'player cannot read another player sheet');
update public.character_sheets set values = jsonb_set(values, '{score}', '3'::jsonb)
 where owner_id = '10000000-0000-0000-0000-000000000001';
select is((select values->>'score' from public.character_sheets limit 1), '3', 'player can edit own valid values');
with changed as (
  update public.character_sheets set values = '{"name":"stolen","active":true}'::jsonb
   where owner_id = '10000000-0000-0000-0000-000000000002' returning 1
)
select is((select count(*)::integer from changed), 0, 'player cannot edit another player sheet');

select throws_ok($$insert into public.character_sheets(campaign_id,template_id,owner_id,name,values)
  values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Bad Text',jsonb_build_object('name',repeat('x',10001),'active',true))$$,
  'P0001', 'field name must be text of at most 10000 characters', 'rejects oversized text');
select throws_ok($$insert into public.character_sheets(campaign_id,template_id,owner_id,name,values)
  values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Bad Number',jsonb_build_object('name','ok','active',true,'score',1000001))$$,
  'P0001', 'field score must be a finite number between -1000000 and 1000000', 'rejects out of range number');
select throws_ok($$insert into public.character_sheets(campaign_id,template_id,owner_id,name,values)
  values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Bad Collection',jsonb_build_object('name','ok','active',true,'items',jsonb_build_array(1)))$$,
  'P0001', 'field items contains an invalid collection value', 'rejects non-string collection values');
select throws_ok($$insert into public.character_sheets(campaign_id,template_id,owner_id,name,values)
  values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Long Item',jsonb_build_object('name','ok','active',true,'items',jsonb_build_array(repeat('x',501))))$$,
  'P0001', 'field items contains an invalid collection value', 'rejects collection strings above 500 characters');
select throws_ok($$insert into public.character_sheets(campaign_id,template_id,owner_id,name,values)
  values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Long Collection',jsonb_build_object('name','ok','active',true,'items',(select jsonb_agg('x'::text) from generate_series(1,201))))$$,
  'P0001', 'field items must be an array of at most 200 strings', 'rejects collections above 200 items');
select throws_ok($$insert into public.character_sheets(campaign_id,template_id,owner_id,name,values)
  values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Too Large',jsonb_build_object('name','ok','active',true,'items',(select jsonb_agg(repeat('x',500)) from generate_series(1,100))))$$,
  'P0001', 'sheet values exceed the storage limits', 'rejects values over 32 KiB');
select throws_ok($$insert into public.character_sheets(campaign_id,template_id,owner_id,name,values)
  values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Bad Required',jsonb_build_object('name','   ','active',true))$$,
  'P0001', 'required field missing: name', 'rejects blank required text');
select throws_ok($$insert into public.character_sheets(campaign_id,template_id,owner_id,name,values)
  values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Whitespace Required',jsonb_build_object('name',E'\t\n','active',true))$$,
  'P0001', 'required field missing: name', 'rejects tab and newline for required text');
select throws_ok($$insert into public.character_sheets(campaign_id,template_id,owner_id,name,values)
  values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Bad Checkbox',jsonb_build_object('name','ok','active',false))$$,
  'P0001', 'required field missing: active', 'requires true for a required checkbox');
select throws_ok($$insert into public.character_sheets(campaign_id,template_id,owner_id,name,values)
  values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Calculated',jsonb_build_object('name','ok','active',true,'pool',12))$$,
  'P0001', 'calculated field pool cannot be persisted as an input', 'rejects calculated field input');
select throws_ok($$insert into public.character_sheets(campaign_id,template_id,owner_id,name,values)
  values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Unknown',jsonb_build_object('name','ok','active',true,'unknown',1))$$,
  'P0001', 'unknown field id: unknown', 'rejects unknown field id');
-- An approved model with more than 200 fields is rejected when it is written,
-- so no sheet can be bound to it.
reset role;
select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'Field Count Template', 'approved',
    jsonb_build_object('fields', (select jsonb_agg(jsonb_build_object('id', 'f'||g, 'kind', 'number')) from generate_series(1,201) g)))$$,
  'P0001', 'template fields must have unique ids and at most 200 fields', 'rejects an approved model with more than 200 fields');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.character_sheets), 2, 'master can read campaign sheets');

select * from finish();
rollback;
