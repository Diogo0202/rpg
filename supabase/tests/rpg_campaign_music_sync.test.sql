begin;
select plan(12);

insert into auth.users (id, aud, role, email) values
  ('1d000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'music-owner@example.test'),
  ('1d000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'music-player@example.test'),
  ('1d000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'music-outsider@example.test');
insert into public.campaigns (id, owner_id, name) values
  ('2d000000-0000-0000-0000-000000000001', '1d000000-0000-0000-0000-000000000001', 'Music Campaign');
insert into public.campaign_members (campaign_id, user_id, role) values
  ('2d000000-0000-0000-0000-000000000001', '1d000000-0000-0000-0000-000000000002', 'player');

select has_table('public', 'campaign_now_playing', 'now playing table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.campaign_now_playing'::regclass), 'now playing has RLS');
select ok(not has_table_privilege('anon', 'public.campaign_now_playing', 'select,insert,update,delete'), 'anon has no access');
select ok(
  not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
  or exists (select 1 from pg_catalog.pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_now_playing'),
  'now playing is in the Realtime publication when it exists');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);
select lives_ok($$insert into public.campaign_now_playing (campaign_id, context_uri, track_uri, track_name, position_ms, is_playing, started_at)
  values ('2d000000-0000-0000-0000-000000000001', 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', 'spotify:track:4uLU6hMCjMI75M1A2tKUQC', 'Faixa', 1000, true, now())$$,
  'narrator publishes now playing');
select lives_ok($$update public.campaign_now_playing set is_playing = false where campaign_id = '2d000000-0000-0000-0000-000000000001'$$,
  'narrator updates now playing');
select throws_ok($$update public.campaign_now_playing set context_uri = 'spotify:playlist:short' where campaign_id = '2d000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'invalid context uri is rejected');
select lives_ok($$insert into public.campaign_music_cues (campaign_id, title, scene_type, duration_seconds, spotify_uri)
  values ('2d000000-0000-0000-0000-000000000001', 'Cena com musica', 'combat', 120, 'spotify:track:4uLU6hMCjMI75M1A2tKUQC')$$,
  'cue accepts a spotify track uri');
select throws_ok($$insert into public.campaign_music_cues (campaign_id, title, scene_type, duration_seconds, spotify_uri)
  values ('2d000000-0000-0000-0000-000000000001', 'Cena ruim', 'combat', 120, 'https://evil.example/x')$$,
  '23514', null, 'cue rejects a non-spotify uri');

select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.campaign_now_playing), 1, 'member reads now playing');
select throws_ok($$insert into public.campaign_now_playing (campaign_id) values ('2d000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'player cannot write now playing');

select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.campaign_now_playing), 0, 'non-member cannot read now playing');

reset role;
select * from finish();
rollback;

