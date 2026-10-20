begin;
select plan(50);

select ok(has_function_privilege('authenticated','public.mobile_sync_push(uuid,uuid,jsonb)','execute'),'authenticated can push sync mutations');
select ok(not has_function_privilege('anon','public.mobile_sync_push(uuid,uuid,jsonb)','execute'),'anon cannot push sync mutations');
select ok(not has_function_privilege('service_role','public.mobile_sync_push(uuid,uuid,jsonb)','execute'),'service role is not the browser sync client');
select ok(not has_table_privilege('authenticated','private.sync_changes','select'),'authenticated cannot read the private change log');
select ok(not has_table_privilege('authenticated','private.mutation_receipts','select'),'authenticated cannot read receipts directly');
select ok((select relrowsecurity from pg_class where oid='private.sync_devices'::regclass),'device registry has RLS');
select ok((select relrowsecurity from pg_class where oid='private.campaign_sync_state'::regclass),'campaign sync state has RLS');

insert into auth.users(id,aud,role,email) values
 ('a1000000-0000-0000-0000-000000000001','authenticated','authenticated','sync-owner@example.test'),
 ('a1000000-0000-0000-0000-000000000002','authenticated','authenticated','sync-player@example.test'),
 ('a1000000-0000-0000-0000-000000000003','authenticated','authenticated','sync-outsider@example.test'),
 ('a1000000-0000-0000-0000-000000000004','authenticated','authenticated','sync-new-owner@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);

select is(
  public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000001","entity_type":"campaigns","entity_id":"b1000000-0000-0000-0000-000000000001","action":"create","base_version":0,"changes":[{"path":["name"],"before":{"exists":false},"after":{"exists":true,"value":"Campaign One"}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}',
  'applied','campaign bootstrap creates owner from JWT and applies once'
);

select is(
  public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000001","entity_type":"campaigns","entity_id":"b1000000-0000-0000-0000-000000000001","action":"create","base_version":0,"changes":[{"path":["name"],"before":{"exists":false},"after":{"exists":true,"value":"Campaign One"}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}',
  'duplicate','same device and operation replay returns the saved outcome'
);

select is(
  public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000001","entity_type":"campaigns","entity_id":"b1000000-0000-0000-0000-000000000001","action":"create","base_version":0,"changes":[{"path":["name"],"before":{"exists":false},"after":{"exists":true,"value":"Changed"}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}',
  'invalid','reusing an operation id with a changed payload is rejected'
);

update public.campaigns set name='Remote name' where id='b1000000-0000-0000-0000-000000000001';
select is(
  public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000002","entity_type":"campaigns","entity_id":"b1000000-0000-0000-0000-000000000001","action":"update","base_version":1,"changes":[{"path":["description"],"before":{"exists":true,"value":""},"after":{"exists":true,"value":"Offline description"}}],"depends_on":["d1000000-0000-0000-0000-000000000001"]}]'::jsonb
  )#>>'{results,0,status}',
  'applied','disjoint fields merge when every before-image still matches'
);
select is((select name from public.campaigns where id='b1000000-0000-0000-0000-000000000001'),'Remote name','merge preserves the remote field');
select is((select description from public.campaigns where id='b1000000-0000-0000-0000-000000000001'),'Offline description','merge applies the offline field');
select is((select sync_version from public.campaigns where id='b1000000-0000-0000-0000-000000000001'),3::bigint,'sync version advances for legacy and RPC writes');

select is(
  public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000003","entity_type":"campaigns","entity_id":"b1000000-0000-0000-0000-000000000001","action":"update","base_version":1,"changes":[{"path":["name"],"before":{"exists":true,"value":"Campaign One"},"after":{"exists":true,"value":"Offline conflict"}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}',
  'conflict','same-field edits return a conflict'
);
select ok((public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000004","entity_type":"campaigns","entity_id":"b1000000-0000-0000-0000-000000000001","action":"update","base_version":1,"changes":[{"path":["name"],"before":{"exists":true,"value":"Campaign One"},"after":{"exists":true,"value":"Offline conflict"}}],"depends_on":[]}]'::jsonb
  )#>'{results,0,conflict_paths}') is not null,'conflict includes the changed path');
select is(public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000003","entity_type":"campaigns","entity_id":"b1000000-0000-0000-0000-000000000001","action":"update","base_version":1,"changes":[{"path":["name"],"before":{"exists":true,"value":"Campaign One"},"after":{"exists":true,"value":"Offline conflict"}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}','conflict','replaying a conflict preserves its original outcome');
select is((public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000003","entity_type":"campaigns","entity_id":"b1000000-0000-0000-0000-000000000001","action":"update","base_version":1,"changes":[{"path":["name"],"before":{"exists":true,"value":"Campaign One"},"after":{"exists":true,"value":"Offline conflict"}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,record,entity_id}'),'b1000000-0000-0000-0000-000000000001','conflict result keeps its entity ID in record DTO');
select is((public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000003","entity_type":"campaigns","entity_id":"b1000000-0000-0000-0000-000000000001","action":"update","base_version":1,"changes":[{"path":["name"],"before":{"exists":true,"value":"Campaign One"},"after":{"exists":true,"value":"Offline conflict"}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,record,data,name}'),'Remote name','conflict result keeps data under its DTO wrapper');
select is(public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000005","entity_type":"campaigns","entity_id":"b1000000-0000-0000-0000-000000000001","action":"update","base_version":3,"changes":[{"path":["owner_id"],"before":{"exists":true,"value":"a1000000-0000-0000-0000-000000000001"},"after":{"exists":true,"value":"a1000000-0000-0000-0000-000000000003"}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}','invalid','owner changes are rejected by the SQL field allowlist');
select is(public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000012","entity_type":"system_templates","entity_id":"e1000000-0000-0000-0000-000000000012","action":"create","base_version":0,"changes":[{"path":["name"],"before":{"exists":false},"after":{"exists":true,"value":"Bad draft"}},{"path":["schema"],"before":{"exists":false},"after":{"exists":true,"value":{"fields":[]}}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}','invalid','empty template schemas are rejected by SQL');
select is(public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000009","entity_type":"system_templates","entity_id":"e1000000-0000-0000-0000-000000000009","action":"create","base_version":0,"changes":[{"path":["name"],"before":{"exists":false},"after":{"exists":true,"value":"Offline draft"}},{"path":["schema"],"before":{"exists":false},"after":{"exists":true,"value":{"fields":[{"id":"character_name","label":"Name","kind":"text","character_name":true}],"rules_profile_version":2}}},{"path":["page_references"],"before":{"exists":false},"after":{"exists":true,"value":[]}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}','applied','offline template creation creates a draft');
select is((select status::text from public.system_templates where id='e1000000-0000-0000-0000-000000000009'),'needs_review','template create forces review status');
select is(public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000010","entity_type":"system_templates","entity_id":"e1000000-0000-0000-0000-000000000009","action":"update","base_version":1,"changes":[{"path":["name"],"before":{"exists":true,"value":"Offline draft"},"after":{"exists":true,"value":"Edited draft"}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}','applied','draft template can be edited offline');
update public.system_templates set status='approved' where id='e1000000-0000-0000-0000-000000000009';
select is(public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000011","entity_type":"system_templates","entity_id":"e1000000-0000-0000-0000-000000000009","action":"update","base_version":3,"changes":[{"path":["name"],"before":{"exists":true,"value":"Edited draft"},"after":{"exists":true,"value":"Edited approved template"}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}','denied','approved templates cannot be changed through mobile sync');
select is(public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000013","entity_type":"character_sheets","entity_id":"e1000000-0000-0000-0000-000000000013","action":"create","base_version":0,"changes":[{"path":["template_id"],"before":{"exists":false},"after":{"exists":true,"value":"e1000000-0000-0000-0000-000000000009"}},{"path":["name"],"before":{"exists":false},"after":{"exists":true,"value":"Rule profile test"}},{"path":["values"],"before":{"exists":false},"after":{"exists":true,"value":{"character_name":"Rule profile test"}}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}','invalid','non-null rules profile is rejected for mobile sheet creation');

insert into public.campaign_members(campaign_id,user_id,role)
values ('b1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002','player');
insert into public.campaign_members(campaign_id,user_id,role)
values ('b1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000004','player');
insert into public.maps(id,campaign_id,name,created_by)
values ('e1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','GM private map','a1000000-0000-0000-0000-000000000001');
insert into public.world_entities(id,campaign_id,kind,name,created_by)
values ('e1000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','location','Pin target','a1000000-0000-0000-0000-000000000001');
insert into public.map_pins(map_id,entity_id,x,y)
values ('e1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000002',1,2);
select is((select campaign_id from public.map_pins where id is not null limit 1),'b1000000-0000-0000-0000-000000000001'::uuid,'map pin stores its derived campaign and has a stable UUID');

insert into public.character_sheets(id,campaign_id,template_id,owner_id,name,values)
values ('e1000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000009','a1000000-0000-0000-0000-000000000002','Transferred sheet','{}');
insert into public.character_inventory(id,sheet_id,campaign_id,name,category)
values ('e1000000-0000-0000-0000-000000000005','e1000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000001','Transferred item','equipment');
select is(public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000014","entity_type":"character_sheets","entity_id":"e1000000-0000-0000-0000-000000000004","action":"update","base_version":1,"changes":[{"path":["name"],"before":{"exists":true,"value":"Transferred sheet"},"after":{"exists":true,"value":"Changed sheet"}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}','invalid','non-null rules profile is rejected for mobile sheet updates');
update public.character_sheets set owner_id='a1000000-0000-0000-0000-000000000004' where id='e1000000-0000-0000-0000-000000000004';
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000002',true);
select ok(exists(select 1 from jsonb_array_elements(public.mobile_sync_changes('b1000000-0000-0000-0000-000000000001',0,100)->'changes') e where e->>'entity_id'='e1000000-0000-0000-0000-000000000004' and e->>'action'='delete' and e->>'tombstone'='true' and not (e ? 'record')),'former sheet owner receives a content-free sheet tombstone');
select ok(exists(select 1 from jsonb_array_elements(public.mobile_sync_changes('b1000000-0000-0000-0000-000000000001',0,100)->'changes') e where e->>'entity_id'='e1000000-0000-0000-0000-000000000005' and e->>'action'='delete' and e->>'tombstone'='true' and not (e ? 'record')),'former sheet owner receives a content-free inventory tombstone');
select ok(position('Transferred sheet' in public.mobile_sync_changes('b1000000-0000-0000-0000-000000000001',0,100)::text)=0,'former owner receives no transferred sheet content');
select is((public.mobile_sync_snapshot('b1000000-0000-0000-0000-000000000001','character_sheets',null,20)->>'records'),'[]','former owner cannot snapshot the transferred sheet');
select is((public.mobile_sync_snapshot('b1000000-0000-0000-0000-000000000001','character_inventory',null,20)->>'records'),'[]','former owner cannot snapshot the transferred inventory');
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000004',true);
select ok(exists(select 1 from jsonb_array_elements(public.mobile_sync_changes('b1000000-0000-0000-0000-000000000001',0,100)->'changes') e where e->>'entity_id'='e1000000-0000-0000-0000-000000000004' and e ? 'record'),'new owner receives current sheet data');
select ok(exists(select 1 from jsonb_array_elements(public.mobile_sync_changes('b1000000-0000-0000-0000-000000000001',0,100)->'changes') e where e->>'entity_id'='e1000000-0000-0000-0000-000000000005' and e ? 'record'),'new owner receives current inventory data');
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from jsonb_array_elements(public.mobile_sync_changes('b1000000-0000-0000-0000-000000000001',0,100)->'changes') e where e->>'entity_id' in ('e1000000-0000-0000-0000-000000000004','e1000000-0000-0000-0000-000000000005') and e->>'action'='delete'),0,'campaign manager does not receive owner-specific revocation tombstones');

insert into public.campaign_factions(id,campaign_id,name)
values ('e1000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001','Tombstone faction');
select is(public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000006","entity_type":"campaign_factions","entity_id":"e1000000-0000-0000-0000-000000000003","action":"delete","base_version":1,"changes":[],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}','applied','delete requires the current sync version');
select is(public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000007","entity_type":"campaign_factions","entity_id":"e1000000-0000-0000-0000-000000000003","action":"create","base_version":0,"changes":[{"path":["name"],"before":{"exists":false},"after":{"exists":true,"value":"Reuse attempt"}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}','invalid','a deleted entity UUID cannot be reused');
select is(public.mobile_sync_push(
    'b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
    '[{"operation_id":"d1000000-0000-0000-0000-000000000008","entity_type":"maps","entity_id":"e1000000-0000-0000-0000-000000000001","action":"update","base_version":1,"changes":[{"path":["document","layers","unexpected"],"before":{"exists":false},"after":{"exists":true,"value":{}}}],"depends_on":[]}]'::jsonb
  )#>>'{results,0,status}','invalid','nested mutation cannot traverse a JSON array');
select is((select c->>'version' from jsonb_array_elements(public.mobile_sync_changes('b1000000-0000-0000-0000-000000000001',0,100)->'changes') c where c->>'entity_id'='e1000000-0000-0000-0000-000000000003' and c->>'action'='delete'),'2','delete tombstone increments the entity version');
select is((select c->>'tombstone' from jsonb_array_elements(public.mobile_sync_changes('b1000000-0000-0000-0000-000000000001',0,100)->'changes') c where c->>'entity_id'='e1000000-0000-0000-0000-000000000003' and c->>'action'='delete'),'true','delete change contains a tombstone');

select is((public.mobile_sync_snapshot('b1000000-0000-0000-0000-000000000001','campaigns',null,20)->>'protocol_version'),'1','snapshot returns protocol v1');
select ok((public.mobile_sync_snapshot('b1000000-0000-0000-0000-000000000001','campaigns',null,20)->>'cursor')::bigint>0,'snapshot cursor includes legacy writes');
select ok(not ((public.mobile_sync_snapshot('b1000000-0000-0000-0000-000000000001','campaigns',null,20)->'records'->0->'data') ? 'sync_version'),'sync version is carried beside data in the record DTO');
select is((public.mobile_sync_snapshot('b1000000-0000-0000-0000-000000000001','campaigns',null,20)->'records'->0->>'version'),'3','snapshot returns the current sync version');
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000002',true);
select ok((public.mobile_sync_changes('b1000000-0000-0000-0000-000000000001',0,100)->>'cursor')::bigint>0,'changes cursor advances for a campaign player');
select ok(position('e1000000-0000-0000-0000-000000000001' in public.mobile_sync_changes('b1000000-0000-0000-0000-000000000001',0,100)::text)=0,'hidden map IDs are not returned to players');
select is((public.mobile_sync_snapshot('b1000000-0000-0000-0000-000000000001','maps',null,20)->>'records'),'[]','existing map RLS keeps GM maps out of player snapshots');
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.mobile_sync_snapshot('b1000000-0000-0000-0000-000000000001','maps',null,20)$$,'42501',null,'outsider cannot snapshot a campaign');
select throws_ok($$select public.mobile_sync_changes('b1000000-0000-0000-0000-000000000001',0,20)$$,'42501',null,'outsider cannot pull campaign changes');

select * from finish();
rollback;
