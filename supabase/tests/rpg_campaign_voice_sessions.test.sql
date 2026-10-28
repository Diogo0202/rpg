begin;
select plan(18);

insert into auth.users (id, aud, role, email) values
  ('1e000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'voice-owner@example.test'),
  ('1e000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'voice-player@example.test'),
  ('1e000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'voice-outsider@example.test'),
  ('1e000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'voice-master@example.test');
insert into public.campaigns (id, owner_id, name) values
  ('2e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001', 'Mesa com Voz'),
  ('2e000000-0000-0000-0000-000000000002', '1e000000-0000-0000-0000-000000000003', 'Outra Mesa');
insert into public.campaign_members (campaign_id, user_id, role) values
  ('2e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000002', 'player'),
  ('2e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000004', 'master');

select ok((select relrowsecurity from pg_class where oid = 'public.campaign_voice_sessions'::regclass), 'voice sessions have RLS');
select ok(not has_table_privilege('anon', 'public.campaign_voice_sessions', 'select'), 'anon cannot read voice sessions');
select ok(not has_table_privilege('authenticated', 'public.campaign_voice_sessions', 'insert,update,delete'), 'clients cannot write voice sessions');
select ok(not has_function_privilege('anon', 'public.request_campaign_voice_session(uuid)', 'execute'), 'anon cannot request a voice room');

-- Jogador não pede sala.
set local role authenticated;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000002', true);
select throws_ok($$select * from public.request_campaign_voice_session('2e000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'player cannot request the voice room');
select throws_ok($$insert into public.campaign_voice_sessions (campaign_id, status, invite_url)
  values ('2e000000-0000-0000-0000-000000000001', 'ready', 'https://discord.gg/abcdef')$$,
  '42501', null, 'player cannot forge an invite');

-- Mestre pede: cria pending e agenda.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000004', true);
select is((select should_create from public.request_campaign_voice_session('2e000000-0000-0000-0000-000000000001')), true, 'master request schedules creation');
select is((select should_create from public.request_campaign_voice_session('2e000000-0000-0000-0000-000000000001')), false, 'recent pending request is not duplicated');
select throws_ok($$update public.campaign_voice_sessions set status = 'ready', invite_url = 'https://discord.gg/abcdef'$$,
  '42501', null, 'master cannot write the session directly');

-- A API grava com a chave de serviço.
reset role;
set local role service_role;
update public.campaign_voice_sessions
   set status = 'ready', channel_id = '123456789012345678', invite_url = 'https://discord.gg/abcDEF12',
       expires_at = now() + interval '1 day', updated_at = now()
 where campaign_id = '2e000000-0000-0000-0000-000000000001';
select throws_ok($$update public.campaign_voice_sessions set invite_url = 'https://evil.example/x'
  where campaign_id = '2e000000-0000-0000-0000-000000000001'$$, '23514', null, 'only discord.gg invite URLs are stored');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000002', true);
select is((select invite_url from public.campaign_voice_sessions), 'https://discord.gg/abcDEF12', 'player reads the invite');
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.campaign_voice_sessions), 0, 'outsider cannot read the invite');
select throws_ok($$select * from public.request_campaign_voice_session('2e000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'outsider cannot request the voice room');

-- Dono reaproveita convite válido.
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true);
select is((select should_create from public.request_campaign_voice_session('2e000000-0000-0000-0000-000000000001')), false, 'valid invite is reused');
select is((select invite_url from public.request_campaign_voice_session('2e000000-0000-0000-0000-000000000001')), 'https://discord.gg/abcDEF12', 'reused invite is returned');

-- Convite quase expirando gera nova criação, mantendo o canal.
reset role;
set local role service_role;
update public.campaign_voice_sessions set expires_at = now() + interval '1 minute'
 where campaign_id = '2e000000-0000-0000-0000-000000000001';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true);
select is((select channel_id from public.request_campaign_voice_session('2e000000-0000-0000-0000-000000000001') where should_create),
  '123456789012345678', 'expiring invite schedules a new one for the same channel');
select is((select status || coalesce(invite_url, '-') from public.campaign_voice_sessions), 'pending-', 'stale invite is cleared while pending');

reset role;
set local role service_role;
update public.campaign_voice_sessions set status = 'failed', error = 'Discord respondeu 403', updated_at = now() - interval '10 minutes'
 where campaign_id = '2e000000-0000-0000-0000-000000000001';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000004', true);
select is((select should_create from public.request_campaign_voice_session('2e000000-0000-0000-0000-000000000001')), true, 'failed session can be retried');

reset role;
select * from finish();
rollback;
