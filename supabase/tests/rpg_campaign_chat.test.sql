begin;
select plan(34);

insert into auth.users (id, aud, role, email) values
  ('1c000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'chat-owner@example.test'),
  ('1c000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'chat-player@example.test'),
  ('1c000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'chat-player2@example.test'),
  ('1c000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'chat-outsider@example.test'),
  ('1c000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'chat-master@example.test');
insert into public.profiles (id, display_name) values
  ('1c000000-0000-0000-0000-000000000001', 'Narradora'),
  ('1c000000-0000-0000-0000-000000000002', 'Jogadora Um');
insert into public.campaigns (id, owner_id, name) values
  ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000001', 'Chat Campaign'),
  ('2c000000-0000-0000-0000-000000000002', '1c000000-0000-0000-0000-000000000004', 'Other Chat Campaign'),
  ('2c000000-0000-0000-0000-000000000003', '1c000000-0000-0000-0000-000000000004', 'Retention Campaign');
insert into public.campaign_members (campaign_id, user_id, role) values
  ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000002', 'player'),
  ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000003', 'player'),
  ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000005', 'master');

select has_table('public', 'campaign_chat_messages', 'chat table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.campaign_chat_messages'::regclass), 'chat has RLS');
select ok(not has_table_privilege('anon', 'public.campaign_chat_messages', 'select,insert,update,delete'), 'anon has no chat access');
select ok(not has_column_privilege('authenticated', 'public.campaign_chat_messages', 'author_id', 'insert'), 'client cannot choose the author');
select ok(not has_column_privilege('authenticated', 'public.campaign_chat_messages', 'author_role', 'insert'), 'client cannot choose the role');
select ok(not has_column_privilege('authenticated', 'public.campaign_chat_messages', 'campaign_id', 'update'), 'campaign cannot be rewritten');
select ok(not has_column_privilege('authenticated', 'public.campaign_chat_messages', 'author_id', 'update'), 'author cannot be rewritten');
select ok(
  not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
  or exists (select 1 from pg_catalog.pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_chat_messages'),
  'chat is in the Realtime publication when it exists');

-- Player writes publicly and privately to the narrator.
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000002', true);
select lives_ok($$insert into public.campaign_chat_messages (id, campaign_id, body)
  values ('3c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001', 'OlÃ¡, mesa!')$$, 'player posts a public message');
select is((select author_role || '|' || author_name from public.campaign_chat_messages where id = '3c000000-0000-0000-0000-000000000001'),
  'jogador|Jogadora Um', 'role and name come from the database');
select lives_ok($$insert into public.campaign_chat_messages (id, campaign_id, recipient_id, body)
  values ('3c000000-0000-0000-0000-000000000002', '2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000001', 'Segredo para a narradora')$$,
  'player sends a private message to the narrator');
select throws_ok($$insert into public.campaign_chat_messages (campaign_id, recipient_id, body)
  values ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000003', 'Psiu')$$,
  '23514', null, 'players cannot whisper to other players');
select throws_ok($$insert into public.campaign_chat_messages (campaign_id, recipient_id, body)
  values ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000004', 'Oi')$$,
  '23514', null, 'recipient must be a campaign member');
select throws_ok($$insert into public.campaign_chat_messages (campaign_id, body)
  values ('2c000000-0000-0000-0000-000000000002', 'InvasÃ£o')$$,
  '42501', null, 'outsiders of a campaign cannot post there');
select throws_ok($$insert into public.campaign_chat_messages (campaign_id, body)
  values ('2c000000-0000-0000-0000-000000000001', repeat('a', 2001))$$,
  '23514', null, 'body is limited to 2000 characters');
select throws_ok($$insert into public.campaign_chat_messages (campaign_id, body)
  values ('2c000000-0000-0000-0000-000000000001', '   ')$$,
  '23514', null, 'blank body is rejected');
select throws_ok($$insert into public.campaign_chat_messages (campaign_id, author_id, body)
  values ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000001', 'Falsificada')$$,
  '42501', null, 'player cannot write as someone else');

-- Narrator whispers to player 1.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000001', true);
select lives_ok($$insert into public.campaign_chat_messages (id, campaign_id, recipient_id, body)
  values ('3c000000-0000-0000-0000-000000000003', '2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000002', 'Sussurro')$$,
  'narrator whispers to a player');
select is((select author_role from public.campaign_chat_messages where id = '3c000000-0000-0000-0000-000000000003'), 'narrador', 'owner is labeled narrator');
select is((select count(*)::integer from public.campaign_chat_messages), 3, 'narrator reads public and own private messages');
select is((select count(*)::integer from public.campaign_chat_participants('2c000000-0000-0000-0000-000000000001')), 4, 'members list chat participants');

-- Player 2 only sees the public message.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.campaign_chat_messages), 1, 'other player only reads public messages');
delete from public.campaign_chat_messages where id = '3c000000-0000-0000-0000-000000000001';
update public.campaign_chat_messages set body = 'hackeado' where id = '3c000000-0000-0000-0000-000000000001';
select is((select body from public.campaign_chat_messages where id = '3c000000-0000-0000-0000-000000000001'), 'OlÃ¡, mesa!', 'player cannot edit or delete others messages');

-- The co-master did not take part in the private messages.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000005', true);
select is((select count(*)::integer from public.campaign_chat_messages), 1, 'master does not read private messages of others');

-- Outsider reads nothing.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000004', true);
select is((select count(*)::integer from public.campaign_chat_messages), 0, 'outsider reads no messages');
select is((select count(*)::integer from public.campaign_chat_participants('2c000000-0000-0000-0000-000000000001')), 0, 'outsider gets no participants');

-- Author edits and deletes own message.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000002', true);
update public.campaign_chat_messages set body = 'OlÃ¡, mesa! (editado)' where id = '3c000000-0000-0000-0000-000000000001';
select ok((select edited_at is not null from public.campaign_chat_messages where id = '3c000000-0000-0000-0000-000000000001'), 'author edit marks edited_at');
delete from public.campaign_chat_messages where id = '3c000000-0000-0000-0000-000000000002';
select is((select count(*)::integer from public.campaign_chat_messages where id = '3c000000-0000-0000-0000-000000000002'), 0, 'author deletes own message');

-- Master moderates a public message.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000005', true);
delete from public.campaign_chat_messages where id = '3c000000-0000-0000-0000-000000000001';
reset role;
select is((select count(*)::integer from public.campaign_chat_messages where id = '3c000000-0000-0000-0000-000000000001'), 0, 'master deletes a public message');

-- Rate limit: 20 messages per minute per user.
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000003', true);
select lives_ok($$insert into public.campaign_chat_messages (campaign_id, body)
  select '2c000000-0000-0000-0000-000000000001', 'msg ' || n from generate_series(1, 20) n$$, 'twenty messages in a minute are accepted');
select throws_ok($$insert into public.campaign_chat_messages (campaign_id, body)
  values ('2c000000-0000-0000-0000-000000000001', 'demais')$$, 'P0429', null, 'the 21st message in a minute is rate limited');

-- Retention: only the newest 1000 messages per campaign are kept (service insert, no rate limit).
reset role;
select set_config('request.jwt.claim.sub', '', true);
insert into public.campaign_chat_messages (campaign_id, author_id, body)
  select '2c000000-0000-0000-0000-000000000003', '1c000000-0000-0000-0000-000000000004', 'linha ' || n from generate_series(1, 1005) n;
select is((select count(*)::integer from public.campaign_chat_messages where campaign_id = '2c000000-0000-0000-0000-000000000003'), 1000, 'retention keeps 1000 messages per campaign');
select is((select count(*)::integer from public.campaign_chat_messages where campaign_id = '2c000000-0000-0000-0000-000000000001'), 21, 'retention does not touch other campaigns');
select throws_ok($$insert into public.campaign_chat_messages (campaign_id, author_id, body)
  values ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000004', 'fora')$$,
  '42501', null, 'service inserts still require a member author');

select * from finish();
rollback;
