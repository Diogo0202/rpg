begin;
select plan(17);

insert into auth.users (id, aud, role, email)
values
  ('17000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fix-player@example.test'),
  ('17000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'fix-master@example.test');
insert into public.campaigns (id, owner_id, name)
values ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', 'Audit Fix Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values
  ('37000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002',
   'Guarded', 'approved',
   '{"fields":[{"id":"name","kind":"text"},{"id":"vigor","kind":"number"},{"id":"esperanca","kind":"number"},{"id":"xp","kind":"number"}],
     "experience_field":"xp","meta_currencies":[{"id":"esperanca","label":"Esperança","field":"esperanca","mode":"pool"}]}'::jsonb),
  ('37000000-0000-0000-0000-000000000002', '27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002',
   'Unguarded copy', 'approved',
   '{"fields":[{"id":"name","kind":"text"},{"id":"vigor","kind":"number","max":1},{"id":"esperanca","kind":"number"},{"id":"xp","kind":"number"}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values)
values ('47000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001',
        '17000000-0000-0000-0000-000000000001', 'Existing', '{"name":"A","vigor":3}'::jsonb);

-- NV-1: a player creates sheets with XP and pool currencies at zero only.
set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000001', true);
select throws_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('27000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001',
          'Minted XP', '{"name":"B","xp":500}'::jsonb)$$,
  '42501', null, 'player cannot create a sheet with experience');
select throws_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('27000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001',
          'Minted Hope', '{"name":"C","esperanca":3}'::jsonb)$$,
  '42501', null, 'player cannot create a sheet with a pool currency');
select lives_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('27000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001',
          'Fresh', '{"name":"D","xp":0,"esperanca":0,"vigor":2}'::jsonb)$$,
  'player creates a sheet with zero XP and pool currencies');

-- NV-2: a player cannot move a sheet to another template.
select throws_ok($$update public.character_sheets set template_id = '37000000-0000-0000-0000-000000000002',
    values = values || '{"xp":500}'::jsonb
  where id = '47000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'player cannot switch template to raise experience');
select throws_ok($$update public.character_sheets set template_id = '37000000-0000-0000-0000-000000000002'
  where id = '47000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'player cannot switch template even without values');

-- NV-10: the private helper enforces the master-only rule on its own.
select throws_ok($$select private.apply_sheet_number_delta('47000000-0000-0000-0000-000000000001', 'xp', 10, null, null, 'adjust', null, null)$$,
  '42501', null, 'private delta helper refuses an XP grant from a player');
select throws_ok($$select private.apply_sheet_number_delta('47000000-0000-0000-0000-000000000001', 'esperanca', 1, null, null, 'adjust', null, null)$$,
  '42501', null, 'private delta helper refuses a pool grant from a player');
select is((private.apply_sheet_number_delta('47000000-0000-0000-0000-000000000001', 'vigor', -1, null, null, 'adjust', null, null)
            -> 'sheet' -> 'values' ->> 'vigor')::integer, 2, 'private delta helper still adjusts ordinary fields');

-- Master: may change the template, and the new template's limits now apply.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000002', true);
select throws_ok($$update public.character_sheets set template_id = '37000000-0000-0000-0000-000000000002'
  where id = '47000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'template switch re-checks the new template limits');
select lives_ok($$insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
  values ('27000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001',
          'Master Made', '{"name":"E","xp":12,"esperanca":2}'::jsonb)$$,
  'master may create a sheet with granted resources');

-- NV-9: template schemas are bounded and approved dependencies are validated at write time.
select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', 'Huge', 'needs_review',
          jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('id', 'name', 'kind', 'text', 'padding', repeat('x', 300000)))))$$,
  '23514', null, 'oversized template schema is rejected');
select throws_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', 'Duplicated ids', 'approved',
          '{"fields":[{"id":"name","kind":"text"},{"id":"name","kind":"text"}]}'::jsonb)$$,
  null, null, 'approved template dependencies are validated on write');
select lives_ok($$insert into public.system_templates (campaign_id, owner_id, name, status, schema)
  values ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', 'Draft', 'needs_review',
          '{"fields":[]}'::jsonb)$$,
  'drafts are not validated until approved');

-- NV-5: portraits cannot be renamed, and removed members cannot delete them.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000001', true);
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('character-portraits',
  '27000000-0000-0000-0000-000000000001/17000000-0000-0000-0000-000000000001/57000000-0000-0000-0000-000000000001.webp',
  '17000000-0000-0000-0000-000000000001')$$, 'player uploads a portrait');
select lives_ok($$update storage.objects set name =
  '28000000-0000-0000-0000-000000000009/17000000-0000-0000-0000-000000000001/57000000-0000-0000-0000-000000000001.webp'
  where bucket_id = 'character-portraits'$$, 'rename attempt runs without a matching policy');
reset role;
delete from public.campaign_members where user_id = '17000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000001', true);
delete from storage.objects where bucket_id = 'character-portraits';
reset role;
select is((select name from storage.objects where bucket_id = 'character-portraits'),
  '27000000-0000-0000-0000-000000000001/17000000-0000-0000-0000-000000000001/57000000-0000-0000-0000-000000000001.webp',
  'portrait was neither renamed into another campaign nor deleted after removal');
select ok(not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'uploaders replace own portraits'),
  'portrait update policy is gone');

select * from finish();
rollback;
