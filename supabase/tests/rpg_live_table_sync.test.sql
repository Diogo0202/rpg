begin;
select plan(24);

insert into auth.users (id, aud, role, email) values
  ('1d000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'live-master@example.test'),
  ('1d000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'live-player@example.test'),
  ('1d000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'live-outsider@example.test');
insert into public.campaigns (id, owner_id, name) values
  ('2d000000-0000-0000-0000-000000000001', '1d000000-0000-0000-0000-000000000001', 'Live Campaign'),
  ('2d000000-0000-0000-0000-000000000002', '1d000000-0000-0000-0000-000000000003', 'Other Live Campaign');
insert into public.campaign_members (campaign_id, user_id, role) values
  ('2d000000-0000-0000-0000-000000000001', '1d000000-0000-0000-0000-000000000002', 'player');
insert into public.world_entities (id, campaign_id, kind, name, created_by) values
  ('3d000000-0000-0000-0000-000000000001', '2d000000-0000-0000-0000-000000000001', 'npc', 'Baronesa', '1d000000-0000-0000-0000-000000000001'),
  ('3d000000-0000-0000-0000-000000000002', '2d000000-0000-0000-0000-000000000001', 'rule', 'Regra da casa', '1d000000-0000-0000-0000-000000000001'),
  ('3d000000-0000-0000-0000-000000000003', '2d000000-0000-0000-0000-000000000002', 'location', 'Outro porto', '1d000000-0000-0000-0000-000000000003'),
  ('3d000000-0000-0000-0000-000000000004', '2d000000-0000-0000-0000-000000000001', 'quest', 'Resgate', '1d000000-0000-0000-0000-000000000001');
insert into public.campaign_events (id, campaign_id, title, status) values
  ('4d000000-0000-0000-0000-000000000001', '2d000000-0000-0000-0000-000000000001', 'Incêndio no cais', 'consequence'),
  ('4d000000-0000-0000-0000-000000000002', '2d000000-0000-0000-0000-000000000001', 'Baile', 'resolved');

select has_table('public', 'campaign_event_entity_links', 'journal entity link table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.campaign_event_entity_links'::regclass), 'journal entity links have RLS');
select ok(not has_table_privilege('anon', 'public.campaign_event_entity_links', 'select,insert,update,delete'), 'anon has no access to links');
select ok(not has_column_privilege('authenticated', 'public.campaign_event_entity_links', 'campaign_id', 'update'), 'link campaign cannot be rewritten');
select ok(
  not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
  or (select count(*) from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename in ('combat_sessions', 'combat_events', 'campaign_event_entity_links')) = 3,
  'combat and link tables are in the Realtime publication when it exists');

-- Private channel authorization (presence + narrator ping).
set local role authenticated;
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000002', true);
select ok(private.can_use_campaign_realtime('campaign:2d000000-0000-0000-0000-000000000001:live', 'presence', false), 'player receives campaign presence');
select ok(private.can_use_campaign_realtime('campaign:2d000000-0000-0000-0000-000000000001:live', 'presence', true), 'player publishes own presence');
select ok(private.can_use_campaign_realtime('campaign:2d000000-0000-0000-0000-000000000001:live', 'broadcast', false), 'player receives narrator ping');
select ok(not private.can_use_campaign_realtime('campaign:2d000000-0000-0000-0000-000000000001:live', 'broadcast', true), 'player cannot send narrator ping');
select ok(not private.can_use_campaign_realtime('campaign:2d000000-0000-0000-0000-000000000002:live', 'presence', false), 'player cannot join another campaign channel');
select ok(not private.can_use_campaign_realtime('campaign:not-a-uuid:live', 'presence', false), 'malformed topic is rejected');
select ok(not private.can_use_campaign_realtime('party-status-2d000000-0000-0000-0000-000000000001', 'presence', false), 'foreign topic is rejected');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);
select ok(private.can_use_campaign_realtime('campaign:2d000000-0000-0000-0000-000000000001:live', 'broadcast', true), 'campaign owner sends narrator ping');

-- Journal consequences linked to world entities.
select lives_ok($$insert into public.campaign_event_entity_links (campaign_id, event_id, entity_id, link_kind)
  values ('2d000000-0000-0000-0000-000000000001', '4d000000-0000-0000-0000-000000000001', '3d000000-0000-0000-0000-000000000001', 'consequence')$$,
  'manager links a consequence to an NPC');
select lives_ok($$insert into public.campaign_event_entity_links (campaign_id, event_id, entity_id, link_kind)
  values ('2d000000-0000-0000-0000-000000000001', '4d000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000004', 'reward')$$,
  'manager links an event to a quest');
select throws_ok($$insert into public.campaign_event_entity_links (campaign_id, event_id, entity_id)
  values ('2d000000-0000-0000-0000-000000000001', '4d000000-0000-0000-0000-000000000001', '3d000000-0000-0000-0000-000000000002')$$,
  '23514', null, 'rules cannot receive journal consequences');
select throws_ok($$insert into public.campaign_event_entity_links (campaign_id, event_id, entity_id)
  values ('2d000000-0000-0000-0000-000000000001', '4d000000-0000-0000-0000-000000000001', '3d000000-0000-0000-0000-000000000003')$$,
  '23514', null, 'entities from another campaign cannot be linked');
select throws_ok($$insert into public.campaign_event_entity_links (campaign_id, event_id, entity_id, link_kind)
  values ('2d000000-0000-0000-0000-000000000001', '4d000000-0000-0000-0000-000000000001', '3d000000-0000-0000-0000-000000000001', 'consequence')$$,
  '23505', null, 'the same link cannot be duplicated');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.campaign_event_entity_links), 2, 'player reads campaign links');
select throws_ok($$insert into public.campaign_event_entity_links (campaign_id, event_id, entity_id, link_kind)
  values ('2d000000-0000-0000-0000-000000000001', '4d000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000001', 'involves')$$,
  '42501', null, 'player cannot create links');
delete from public.campaign_event_entity_links;

reset role;
select is((select count(*)::integer from public.campaign_event_entity_links), 2, 'player delete affects no rows');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.campaign_event_entity_links), 0, 'outsider cannot read links');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);
delete from public.campaign_events where id = '4d000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.campaign_event_entity_links), 1, 'deleting the event removes its links');
delete from public.world_entities where id = '3d000000-0000-0000-0000-000000000004';
select is((select count(*)::integer from public.campaign_event_entity_links), 0, 'deleting the entity removes its links');

reset role;
select * from finish();
rollback;
