begin;
select plan(16);

insert into auth.users (id, aud, role, email)
values
  ('11000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'notify-player@example.test'),
  ('11000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'notify-master@example.test'),
  ('11000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'notify-other-manager@example.test'),
  ('11000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'notify-other-player@example.test');
insert into public.campaigns (id, owner_id, name)
values
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', 'Notify Campaign'),
  ('21000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000003', 'Other Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'player'),
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000004', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
        '11000000-0000-0000-0000-000000000002', 'Notification Template', 'approved',
        '{"fields":[{"id":"name","kind":"text"}]}'::jsonb),
       ('31000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002',
        '11000000-0000-0000-0000-000000000003', 'Other Notification Template', 'approved',
        '{"fields":[{"id":"name","kind":"text"}]}'::jsonb);
insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
values ('21000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000002',
        '11000000-0000-0000-0000-000000000003', 'Other Campaign Sheet', '{"name":"Other"}'::jsonb);
insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
values ('21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001',
        '11000000-0000-0000-0000-000000000004', 'Other Player Sheet', '{"name":"Other Player"}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
insert into public.character_sheets (campaign_id, template_id, owner_id, name, values)
values ('21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001',
        '11000000-0000-0000-0000-000000000001', 'Player Sheet', '{"name":"A"}'::jsonb);

select has_table('public', 'character_sheet_notifications', 'notification table exists');
select is((select count(*)::integer from information_schema.columns
  where table_schema = 'public' and table_name = 'character_sheet_notifications'), 4, 'notification table exposes four columns');
select ok((select relrowsecurity from pg_class where oid='public.character_sheet_notifications'::regclass), 'notification table has RLS');
select ok(not has_table_privilege('authenticated', 'public.character_sheet_notifications', 'insert,update,delete'), 'authenticated clients cannot write notifications');
select is((select count(*)::integer from public.character_sheet_notifications), 1, 'sheet owner reads own notification');
select is((select count(*)::integer from public.character_sheet_notifications where owner_id = '11000000-0000-0000-0000-000000000003'), 0, 'player cannot read another campaign notification');
select is((select count(*)::integer from public.character_sheet_notifications where owner_id = '11000000-0000-0000-0000-000000000004'), 0, 'player cannot read another player notification in the same campaign');
select throws_ok($$insert into public.character_sheet_notifications(campaign_id,owner_id,revision)
  values ('21000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',99)$$,
  '42501', null, 'direct client writes are denied');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
select is((select revision from public.character_sheet_notifications
  where campaign_id = '21000000-0000-0000-0000-000000000001'
    and owner_id = '11000000-0000-0000-0000-000000000001'), 1::bigint, 'campaign master reads owner notification');
select is((select count(*)::integer from public.character_sheet_notifications
  where campaign_id = '21000000-0000-0000-0000-000000000001'), 2, 'campaign master reads both player notifications');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.character_sheet_notifications), 1, 'other campaign manager reads its own notification');
select is((select count(*)::integer from public.character_sheet_notifications
  where campaign_id = '21000000-0000-0000-0000-000000000001'), 0, 'manager of another campaign cannot read this campaign notification');

reset role;
update public.character_sheets set owner_id = '11000000-0000-0000-0000-000000000002'
 where owner_id = '11000000-0000-0000-0000-000000000001';
select is((select revision from public.character_sheet_notifications
  where campaign_id = '21000000-0000-0000-0000-000000000001'
    and owner_id = '11000000-0000-0000-0000-000000000001'), 2::bigint, 'owner change increments old owner revision');
select is((select revision from public.character_sheet_notifications
  where campaign_id = '21000000-0000-0000-0000-000000000001'
    and owner_id = '11000000-0000-0000-0000-000000000002'), 1::bigint, 'owner change creates new owner revision');
delete from public.character_sheets where owner_id = '11000000-0000-0000-0000-000000000002';
select is((select revision from public.character_sheet_notifications
  where campaign_id = '21000000-0000-0000-0000-000000000001'
    and owner_id = '11000000-0000-0000-0000-000000000002'), 2::bigint, 'delete bumps revision without carrying sheet data');

select ok(
  not exists (select 1 from pg_catalog.pg_publication_tables
               where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'character_sheets')
  and (
    not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
    or exists (select 1 from pg_catalog.pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'character_sheet_notifications')
  ), 'Realtime publication contains only notification rows for sheet changes');

select * from finish();
rollback;
