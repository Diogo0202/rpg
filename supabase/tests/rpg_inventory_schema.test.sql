begin;
select plan(8);
insert into auth.users(id) values ('61000000-0000-4000-8000-000000000001'),('61000000-0000-4000-8000-000000000002');
insert into public.campaigns(id,owner_id,name) values ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','Inventário modular');
insert into public.system_templates(id,campaign_id,owner_id,name,status,schema) values (
 '63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','Sistema modular','approved',
 '{"fields":[{"id":"nome","label":"Nome","kind":"text","required":true,"options":[],"expression":null}],"inventory_schema":[{"id":"peso","kind":"number","min":0,"max":10}]}'
);
insert into public.character_sheets(id,campaign_id,template_id,owner_id,name,values) values ('64000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','Mara','{"nome":"Mara"}');
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok($$insert into public.character_inventory(id,sheet_id,campaign_id,name,category,custom_values) values ('65000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','Corda','equipment','{"peso":2}')$$,'item accepts declared values');
select is((select custom_values->>'peso' from public.character_inventory where id='65000000-0000-4000-8000-000000000001'),'2','custom values persist');
select throws_ok($$update public.character_inventory set custom_values='{"peso":20}' where id='65000000-0000-4000-8000-000000000001'$$,'23514',null,'numeric limits enforced in database');
select throws_ok($$update public.character_inventory set custom_values='{"code":"execute"}' where id='65000000-0000-4000-8000-000000000001'$$,'23514',null,'unknown custom fields rejected');
select throws_ok($$update public.character_inventory set custom_values='{"peso":true}' where id='65000000-0000-4000-8000-000000000001'$$,'23514',null,'invalid field types rejected');
select public.restore_character_backup('62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','{"format":"rpg-nexus-sheet","format_version":1,"name":"Cópia","template":{"fields":[{"id":"nome","label":"Nome","kind":"text","required":true,"options":[],"expression":null}]},"values":{"nome":"Cópia"},"effects":[],"inventory":[{"name":"Corda restaurada","category":"equipment","quantity":1,"resource_cost":0,"damage_bonus":0,"protection":0,"notes":"","acquired":true,"equipped":false,"sort_order":0,"custom_values":{"peso":3}}]}');
select is((select custom_values->>'peso' from public.character_inventory where name='Corda restaurada'),'3','restore preserves dynamic item fields');
select ok(private.mobile_sync_field_allowlist('character_inventory') @> array['custom_values'],'mobile capabilities allow dynamic item fields');
reset role;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
set local role authenticated;
with modified as (update public.character_inventory set custom_values='{"peso":1}' where id='65000000-0000-4000-8000-000000000001' returning id)
select is(count(*),0::bigint,'outside account cannot update inventory') from modified;
reset role;
select * from finish();
rollback;
