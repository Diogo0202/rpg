begin;
select plan(17);

-- 1 dono, 2 mestre, 3 jogador, 4 estranho.
insert into auth.users (id, aud, role, email)
values
  ('1e000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'mail-owner@example.test'),
  ('1e000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'mail-master@example.test'),
  ('1e000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'mail-player@example.test'),
  ('1e000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'mail-outsider@example.test');
insert into public.campaigns (id, owner_id, name)
values ('2e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001', 'Mesa do Correio');
insert into public.campaign_members (campaign_id, user_id, role)
values ('2e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000002', 'master'),
       ('2e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000003', 'player');
insert into public.profiles (id, display_name) values ('1e000000-0000-0000-0000-000000000001', 'Dona da Mesa');
insert into public.campaign_invites (id, campaign_id, invited_by, email, code, role)
values
  ('3e000000-0000-0000-0000-000000000001', '2e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001',
   'convidada@example.test', 'ABCDEF123456', 'player'),
  ('3e000000-0000-0000-0000-000000000002', '2e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001',
   null, 'ABCDEF654321', 'player'),
  ('3e000000-0000-0000-0000-000000000003', '2e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001',
   'mestra@example.test', 'ABCDEF000111', 'master');

select has_function('public', 'reserve_campaign_invite_email', array['uuid'], 'reservation RPC exists');
select ok(not has_function_privilege('anon', 'public.reserve_campaign_invite_email(uuid)', 'execute'), 'anon cannot reserve sends');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true);
select is((select email from public.reserve_campaign_invite_email('3e000000-0000-0000-0000-000000000001')),
  'convidada@example.test', 'owner reserves a send and gets the stored recipient');
select is((select inviter_name || '|' || campaign_name from public.reserve_campaign_invite_email('3e000000-0000-0000-0000-000000000003')),
  'Dona da Mesa|Mesa do Correio', 'reservation returns campaign and inviter names');
select throws_ok($$select * from public.reserve_campaign_invite_email('3e000000-0000-0000-0000-000000000001')$$,
  '54001', null, 'a second send within 5 minutes is refused');
select is((select email_sent_count from public.campaign_invites where id = '3e000000-0000-0000-0000-000000000001'), 1,
  'refused send is not counted');
select throws_ok($$select * from public.reserve_campaign_invite_email('3e000000-0000-0000-0000-000000000002')$$,
  '22023', null, 'code-only invites have no recipient');
select throws_ok($$select * from public.reserve_campaign_invite_email('3e000000-0000-0000-0000-0000000000ff')$$,
  '42501', null, 'unknown invites are not revealed');
reset role;

-- Depois do intervalo, novos envios até o limite de 5 por convite.
update public.campaign_invites set last_email_sent_at = now() - interval '6 minutes', email_sent_count = 4
 where id = '3e000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000002', true);
select is((select email_sent_count from public.reserve_campaign_invite_email('3e000000-0000-0000-0000-000000000001')), 5,
  'master resends after the cooldown');
select throws_ok($$select * from public.reserve_campaign_invite_email('3e000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'master cannot send master invites');
reset role;
update public.campaign_invites set last_email_sent_at = now() - interval '1 hour'
 where id = '3e000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000002', true);
select throws_ok($$select * from public.reserve_campaign_invite_email('3e000000-0000-0000-0000-000000000001')$$,
  '54000', null, 'the sixth send is refused');

-- Jogador e estranho não enviam.
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000003', true);
select throws_ok($$select * from public.reserve_campaign_invite_email('3e000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'player cannot send invites');
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000004', true);
select throws_ok($$select * from public.reserve_campaign_invite_email('3e000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'outsider cannot send invites');
select throws_ok($$update public.campaign_invites set email_sent_count = 0$$,
  '42501', null, 'counters cannot be reset directly');
reset role;

-- Convite revogado ou expirado não recebe e-mail.
update public.campaign_invites set status = 'revoked', last_email_sent_at = null where id = '3e000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true);
select throws_ok($$select * from public.reserve_campaign_invite_email('3e000000-0000-0000-0000-000000000003')$$,
  '55000', null, 'revoked invites are not sent');
reset role;
select throws_ok($$update public.campaign_invites set email_sent_count = 6 where id = '3e000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'the counter is capped at 5 by a constraint');
select is((select count(*)::integer from public.campaign_invites where last_email_sent_at is not null), 1,
  'last send time is recorded');

select * from finish();
rollback;
