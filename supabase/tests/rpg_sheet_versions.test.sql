begin;
select plan(22);

insert into auth.users (id, aud, role, email)
values
  ('16000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'versions-player@example.test'),
  ('16000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'versions-master@example.test'),
  ('16000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'versions-other@example.test'),
  ('16000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'versions-outsider@example.test');
insert into public.profiles (id, display_name)
values ('16000000-0000-0000-0000-000000000001', 'Jogadora Lia');
insert into public.campaigns (id, owner_id, name)
values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'Versions Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 'player'),
       ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000003', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002',
  'Versions Template', 'approved',
  '{"experience_field":"xp","fields":[{"id":"nome","kind":"text"},{"id":"vigor","kind":"number"},{"id":"xp","kind":"number"}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values)
values ('46000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001',
  '16000000-0000-0000-0000-000000000001', 'Lia', '{"nome":"Lia","vigor":1,"xp":0}'::jsonb);

select has_table('public', 'character_sheet_versions', 'the version history table exists');
select is((select count(*)::integer from public.character_sheet_versions where sheet_id = '46000000-0000-0000-0000-000000000001'), 1,
  'creating a sheet records version 1');

-- The owning player edits: a new snapshot with author and date.
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
update public.character_sheets set values = '{"nome":"Lia","vigor":3,"xp":0}'::jsonb where id = '46000000-0000-0000-0000-000000000001';
select is((select author_id::text || '|' || author_name from public.character_sheet_versions where version = 2),
  '16000000-0000-0000-0000-000000000001|Jogadora Lia', 'the edit records its author');
select is((select (values ->> 'vigor')::integer from public.character_sheet_versions where version = 2), 3, 'the snapshot keeps the edited values');
update public.character_sheets set values = values where id = '46000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.character_sheet_versions), 2, 'a write without changes to name or values adds no snapshot');
select is((select version from public.character_sheets where id = '46000000-0000-0000-0000-000000000001'), 3, 'the sheet version still advanced');
select throws_ok($$insert into public.character_sheet_versions (sheet_id, campaign_id, template_id, version, name, values)
  values ('46000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', 90, 'Falsa', '{}')$$,
  '42501', null, 'players cannot forge history rows');

-- Optimistic control and invalid restorations.
select throws_ok($$select public.restore_character_sheet_version('46000000-0000-0000-0000-000000000001', 1, 2)$$,
  '40001', null, 'a stale expected version is rejected');
select throws_ok($$select public.restore_character_sheet_version('46000000-0000-0000-0000-000000000001', 99, 3)$$,
  'P0002', null, 'a missing version is rejected');
select lives_ok($$select public.restore_character_sheet_version('46000000-0000-0000-0000-000000000001', 1, 3)$$,
  'the owner restores version 1');
select is((select (values ->> 'vigor')::integer || '/' || version from public.character_sheets where id = '46000000-0000-0000-0000-000000000001'),
  '1/4', 'restoring writes the old values as a new version');
select is((select restored_from from public.character_sheet_versions where version = 4), 1, 'the new snapshot records where it came from');
select throws_ok($$select public.restore_character_sheet_version('46000000-0000-0000-0000-000000000001', 4, 4)$$,
  '22023', null, 'the current version cannot be restored onto itself');

-- Visibility follows the sheet RLS.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.character_sheet_versions), 0, 'another player cannot read the history');
select throws_ok($$select public.restore_character_sheet_version('46000000-0000-0000-0000-000000000001', 2, 4)$$,
  '42501', null, 'another player cannot restore the sheet');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000004', true);
select is((select count(*)::integer from public.character_sheet_versions), 0, 'outsiders cannot read the history');

-- The master reads everything and grants XP; the player cannot restore a
-- snapshot that would raise XP above what the master left.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.character_sheet_versions), 3, 'the master reads the whole history');
update public.character_sheets set values = '{"nome":"Lia","vigor":1,"xp":5}'::jsonb where id = '46000000-0000-0000-0000-000000000001';
update public.character_sheets set values = '{"nome":"Lia","vigor":1,"xp":0}'::jsonb where id = '46000000-0000-0000-0000-000000000001';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
select throws_ok($$select public.restore_character_sheet_version('46000000-0000-0000-0000-000000000001', 5, 6)$$,
  '42501', null, 'restoring obeys the master-only XP guard');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', true);
select lives_ok($$select public.restore_character_sheet_version('46000000-0000-0000-0000-000000000001', 5, 6)$$,
  'the master may restore the XP grant');

-- Retention keeps only the latest 50 snapshots.
reset role;
do $$
begin
  for step in 1..60 loop
    update public.character_sheets set values = jsonb_set(values, '{vigor}', to_jsonb(step + 10))
     where id = '46000000-0000-0000-0000-000000000001';
  end loop;
end;
$$;
select is((select count(*)::integer from public.character_sheet_versions where sheet_id = '46000000-0000-0000-0000-000000000001'), 50,
  'only 50 versions are kept');
select is((select min(version) from public.character_sheet_versions where sheet_id = '46000000-0000-0000-0000-000000000001'),
  (select version - 49 from public.character_sheets where id = '46000000-0000-0000-0000-000000000001'), 'the oldest versions are pruned');

delete from public.character_sheets where id = '46000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.character_sheet_versions), 0, 'deleting the sheet removes its history');

select * from finish();
rollback;
