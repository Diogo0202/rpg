begin;
select plan(12);

insert into auth.users (id, aud, role, email) values
  ('1f000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'spotify-user@example.test'),
  ('1f000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'spotify-other@example.test');

select ok((select relrowsecurity from pg_class where oid = 'public.spotify_connections'::regclass), 'spotify connections have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.spotify_oauth_states'::regclass), 'spotify oauth states have RLS');
select ok(not has_table_privilege('anon', 'public.spotify_connections', 'select'), 'anon cannot read spotify tokens');
select ok(not has_table_privilege('authenticated', 'public.spotify_connections', 'select'), 'clients cannot read spotify tokens');
select ok(not has_table_privilege('authenticated', 'public.spotify_connections', 'insert,update,delete'), 'clients cannot write spotify tokens');
select ok(not has_table_privilege('authenticated', 'public.spotify_oauth_states', 'select,insert,update,delete'), 'clients cannot touch oauth states');

-- A API grava com a chave de serviço.
set local role service_role;
insert into public.spotify_oauth_states (state_hash, user_id, return_to, expires_at)
values (repeat('a', 64), '1f000000-0000-0000-0000-000000000001', '/app/campaign/2e000000-0000-4000-8000-000000000001', now() + interval '10 minutes');
select is((select count(*)::integer from public.spotify_oauth_states), 1, 'service role stores a pending authorization');

select throws_ok($$insert into public.spotify_oauth_states (state_hash, user_id, return_to, expires_at)
  values (repeat('b', 64), '1f000000-0000-0000-0000-000000000001', 'https://evil.example/app', now() + interval '10 minutes')$$,
  '23514', null, 'return path must be an app route');
select throws_ok($$insert into public.spotify_oauth_states (state_hash, user_id, return_to, expires_at)
  values (repeat('c', 64), '1f000000-0000-0000-0000-000000000001', '/app', now() + interval '1 day')$$,
  '23514', null, 'authorizations expire within 15 minutes');
select throws_ok($$insert into public.spotify_oauth_states (state_hash, user_id, return_to, expires_at)
  values ('raw-state-in-clear', '1f000000-0000-0000-0000-000000000001', '/app', now() + interval '10 minutes')$$,
  '23514', null, 'only the state hash is stored');

insert into public.spotify_connections (user_id, spotify_user_id, display_name, product, scopes, access_token, refresh_token, expires_at)
values ('1f000000-0000-0000-0000-000000000001', 'mesa.user', 'Mesa', 'premium', 'user-read-playback-state', 'access', 'refresh', now() + interval '1 hour');
select is((select product from public.spotify_connections), 'premium', 'service role stores the connection');

-- Usuário autenticado não vê nem o próprio token.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1f000000-0000-0000-0000-000000000001', true);
select throws_ok($$select access_token from public.spotify_connections$$, '42501', null, 'owner cannot read the token directly');

reset role;
select * from finish();
rollback;
