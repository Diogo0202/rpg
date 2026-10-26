begin;
select plan(51);

-- 1 dono, 2 mestre, 3 jogador, 4 dono de outra campanha, 5 convidado por e-mail, 6 convidado por código.
insert into auth.users (id, aud, role, email)
values
  ('1a000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'cam-owner@example.test'),
  ('1a000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'cam-master@example.test'),
  ('1a000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'cam-player@example.test'),
  ('1a000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'cam-outsider@example.test'),
  ('1a000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'Cam-Invitee@Example.test'),
  ('1a000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'cam-code@example.test');
insert into public.campaigns (id, owner_id, name)
values ('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', 'Mesa Principal'),
       ('2a000000-0000-0000-0000-000000000002', '1a000000-0000-0000-0000-000000000004', 'Outra Mesa');
insert into public.campaign_members (campaign_id, user_id, role)
values ('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000002', 'master'),
       ('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000003', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('3a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001',
        'Modelo da Mesa', 'approved', '{"fields":[{"id":"nome","kind":"text"}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values)
values ('4a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001',
        '1a000000-0000-0000-0000-000000000003', 'Lia', '{"nome":"Lia"}'::jsonb);
insert into public.world_entities (campaign_id, kind, name, created_by)
values ('2a000000-0000-0000-0000-000000000001', 'npc', 'Senescal', '1a000000-0000-0000-0000-000000000001');

select has_table('public', 'campaign_invites', 'invites table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.campaign_invites'::regclass), 'invites have RLS');
select ok(not has_table_privilege('authenticated', 'public.campaign_invites', 'insert'), 'invites are written only through RPCs');

-- Dono: convida mestre por e-mail e jogador por código; edita a campanha.
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000001', true);
select lives_ok($$select public.create_campaign_invite('2a000000-0000-0000-0000-000000000001', 'master', ' Cam-Invitee@example.TEST ')$$,
  'owner invites a master by e-mail');
select lives_ok($$select public.create_campaign_invite('2a000000-0000-0000-0000-000000000001', 'player')$$,
  'owner creates an open code invite');
select is((select email from public.campaign_invites where role = 'master'), 'cam-invitee@example.test', 'invite e-mail is normalized');
select throws_ok($$select public.create_campaign_invite('2a000000-0000-0000-0000-000000000001', 'owner')$$,
  '22023', null, 'nobody invites a second owner');
select throws_ok($$select public.create_campaign_invite('2a000000-0000-0000-0000-000000000001', 'player', 'sem-arroba')$$,
  '22023', null, 'invalid e-mail is rejected');
select lives_ok($$select public.update_campaign_details('2a000000-0000-0000-0000-000000000001', '  Mesa Renomeada ', 'Nova descrição')$$,
  'owner edits name and description');
select is((select name from public.campaigns where id = '2a000000-0000-0000-0000-000000000001'), 'Mesa Renomeada', 'name is trimmed and saved');
select throws_ok($$select public.update_campaign_details('2a000000-0000-0000-0000-000000000001', 'ab', '')$$,
  '22023', null, 'short campaign names are rejected');
reset role;
select set_config('test.code', (select code from public.campaign_invites where email is null), true);
select set_config('test.mail_invite', (select id::text from public.campaign_invites where email is not null), true);

-- Mestre: administra jogadores, mas não mestres nem a campanha.
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000002', true);
select lives_ok($$select public.create_campaign_invite('2a000000-0000-0000-0000-000000000001', 'guest')$$, 'master invites a guest');
select throws_ok($$select public.create_campaign_invite('2a000000-0000-0000-0000-000000000001', 'master')$$,
  '42501', null, 'master cannot invite another master');
select is((select count(*)::integer from public.campaign_invites), 3, 'master reads campaign invites');
select lives_ok($$select public.set_campaign_member_role('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000003', 'guest')$$,
  'master changes a player to guest');
select throws_ok($$select public.set_campaign_member_role('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000003', 'master')$$,
  '42501', null, 'master cannot promote to master');
select throws_ok($$update public.campaign_members set role = 'master'
  where campaign_id = '2a000000-0000-0000-0000-000000000001' and user_id = '1a000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'RLS also blocks direct promotion by a master');
select throws_ok($$select public.update_campaign_details('2a000000-0000-0000-0000-000000000001', 'Mesa do Mestre', '')$$,
  '42501', null, 'master cannot edit campaign details');
select throws_ok($$select public.delete_campaign('2a000000-0000-0000-0000-000000000001', 'Mesa Renomeada')$$,
  '42501', null, 'master cannot delete the campaign');
select lives_ok($$select public.set_campaign_member_role('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000003', 'player')$$,
  'master restores the player role');

-- Jogador: vê participantes sem e-mail e não administra nada.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000003', true);
select lives_ok($$select public.upsert_my_profile('  Lia   Prado ')$$, 'player saves a display name');
select is((select display_name from public.profiles where id = '1a000000-0000-0000-0000-000000000003'), 'Lia Prado', 'display name is normalized');
select throws_ok($$select public.upsert_my_profile('L')$$, '22023', null, 'short display names are rejected');
select is((select count(*)::integer from public.list_campaign_members('2a000000-0000-0000-0000-000000000001')), 3, 'player lists owner, master and player');
select is((select count(*)::integer from public.list_campaign_members('2a000000-0000-0000-0000-000000000001') where email is not null), 0, 'player does not see e-mails');
select is((select count(*)::integer from public.campaign_invites), 0, 'player cannot read invites');
select throws_ok($$select public.create_campaign_invite('2a000000-0000-0000-0000-000000000001', 'player')$$,
  '42501', null, 'player cannot invite');
select throws_ok($$select public.remove_campaign_member('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'player cannot remove the master');

-- Membro de outra campanha: nada vê nem altera.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000004', true);
select throws_ok($$select public.list_campaign_members('2a000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'outsider cannot list members');
select is((select count(*)::integer from public.campaign_invites), 0, 'outsider cannot read invites');
select throws_ok($$select public.accept_campaign_invite(null, current_setting('test.mail_invite')::uuid)$$,
  '42501', null, 'outsider cannot accept an invite addressed to another e-mail');
select throws_ok($$select public.revoke_campaign_invite(current_setting('test.mail_invite')::uuid)$$,
  '42501', null, 'outsider cannot revoke invites');
select throws_ok($$select public.delete_campaign('2a000000-0000-0000-0000-000000000001', 'Mesa Renomeada')$$,
  '42501', null, 'outsider cannot delete the campaign');
select throws_ok($$select public.set_campaign_member_role('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000003', 'guest')$$,
  '42501', null, 'outsider cannot change roles');
select is((select count(*)::integer from public.list_my_campaign_invites()), 0, 'outsider has no pending invites');

-- Convidado por e-mail: vê e aceita o convite endereçado a ele.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000005', true);
select is((select campaign_name from public.list_my_campaign_invites()), 'Mesa Renomeada', 'invitee sees the campaign name before joining');
select is(public.accept_campaign_invite(null, current_setting('test.mail_invite')::uuid), '2a000000-0000-0000-0000-000000000001'::uuid, 'invitee accepts');
select is((select role::text from public.campaign_members where user_id = '1a000000-0000-0000-0000-000000000005'), 'master', 'invitee joins with the invited role');
select throws_ok($$select public.accept_campaign_invite(null, current_setting('test.mail_invite')::uuid)$$,
  'P0002', null, 'an invite is single use');

-- Convidado por código.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000006', true);
select lives_ok($$select public.accept_campaign_invite(lower(current_setting('test.code')))$$, 'code invite is accepted case-insensitively');
select is((select role::text from public.campaign_members where user_id = '1a000000-0000-0000-0000-000000000006'), 'player', 'code invitee is a player');

-- Mestre remove jogador, mas não outro mestre.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000002', true);
select throws_ok($$select public.remove_campaign_member('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000005')$$,
  '42501', null, 'master cannot remove another master');
select lives_ok($$select public.remove_campaign_member('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000006')$$,
  'master removes a player');

-- Jogador sai por conta própria.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000003', true);
select lives_ok($$select public.remove_campaign_member('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000003')$$,
  'player leaves the campaign');

-- Dono remove mestre, revoga convite e exclui a campanha com confirmação.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000001', true);
select lives_ok($$select public.remove_campaign_member('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000005')$$,
  'owner removes a master');
select lives_ok($$select public.revoke_campaign_invite((select id from public.campaign_invites where role = 'guest'))$$, 'owner revokes a pending invite');
select is((select status from public.campaign_invites where role = 'guest'), 'revoked', 'revoked invite is marked');
select throws_ok($$select public.delete_campaign('2a000000-0000-0000-0000-000000000001', 'mesa renomeada')$$,
  '22023', null, 'deletion requires the exact campaign name');
select lives_ok($$select public.delete_campaign('2a000000-0000-0000-0000-000000000001', 'Mesa Renomeada')$$,
  'owner deletes the campaign with sheets, templates and world data');
reset role;
select is((select count(*)::integer from public.campaigns where id = '2a000000-0000-0000-0000-000000000001')
        + (select count(*)::integer from public.character_sheets where campaign_id = '2a000000-0000-0000-0000-000000000001')
        + (select count(*)::integer from public.campaign_invites where campaign_id = '2a000000-0000-0000-0000-000000000001'),
  0, 'campaign, sheets and invites are gone');
select is((select count(*)::integer from public.campaigns where id = '2a000000-0000-0000-0000-000000000002'), 1, 'the other campaign is untouched');

select * from finish();
rollback;
