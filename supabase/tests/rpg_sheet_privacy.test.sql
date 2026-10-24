begin;
select plan(10);

insert into auth.users (id, aud, role, email)
values
  ('15000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'privacy-player@example.test'),
  ('15000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'privacy-master@example.test'),
  ('15000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'privacy-other@example.test'),
  ('15000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'privacy-outsider@example.test');
insert into public.campaigns (id, owner_id, name)
values ('25000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000002', 'Privacy Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values ('25000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', 'player'),
       ('25000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000003', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('35000000-0000-0000-0000-000000000001', '25000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000002',
  'Privacy Template', 'approved',
  '{"fields":[{"id":"nome","kind":"text"},{"id":"fome","kind":"number"},
    {"id":"compulsao_atual","kind":"select","options":["Nenhuma","Paranoia"],"private":true},
    {"id":"segredos","kind":"text","private":true}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values)
values ('45000000-0000-0000-0000-000000000001', '25000000-0000-0000-0000-000000000001', '35000000-0000-0000-0000-000000000001',
  '15000000-0000-0000-0000-000000000001', 'Lia', '{"nome":"Lia","fome":3,"compulsao_atual":"Paranoia","segredos":"Matou o senescal"}'::jsonb);
insert into public.character_sheet_secrets (sheet_id, campaign_id, notes)
values ('45000000-0000-0000-0000-000000000001', '25000000-0000-0000-0000-000000000001', 'Lia é a traidora');

-- Another player sees the party member but not the private fields.
set local role authenticated;
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.character_sheets), 0, 'another player still cannot read the raw sheet');
select is((select values ->> 'fome' from public.party_status_public where id = '45000000-0000-0000-0000-000000000001'), '3', 'public fields reach the party');
select ok(not ((select values from public.party_status_public where id = '45000000-0000-0000-0000-000000000001') ? 'compulsao_atual'), 'the compulsion is stripped');
select ok(not ((select values from public.party_status_public where id = '45000000-0000-0000-0000-000000000001') ? 'segredos'), 'secrets are stripped');
select is((select count(*)::integer from public.character_sheet_secrets), 0, 'players cannot read master notes');

-- The owner keeps their own private fields but not the master notes.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000001', true);
select is((select values ->> 'compulsao_atual' from public.character_sheets where id = '45000000-0000-0000-0000-000000000001'), 'Paranoia', 'the owner reads their own private field');
select is((select count(*)::integer from public.character_sheet_secrets), 0, 'the owner cannot read master notes');

-- The master reads the notes; outsiders see nothing at all.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000002', true);
select is((select notes from public.character_sheet_secrets), 'Lia é a traidora', 'the master reads the notes');
select lives_ok($$update public.character_sheet_secrets set notes = 'Revisado' where sheet_id = '45000000-0000-0000-0000-000000000001'$$, 'the master edits the notes');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000004', true);
select is((select count(*)::integer from public.party_status_public), 0, 'outsiders see no party rows');

select * from finish();
rollback;
