begin;
select plan(10);
insert into auth.users(id) values ('71000000-0000-4000-8000-000000000001');
insert into public.campaigns(id,owner_id,name) values ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Dano de armas');
insert into public.system_templates(id,campaign_id,owner_id,name,status,schema) values (
 '73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Sistema de armas','approved',
 '{"fields":[{"id":"nome","label":"Nome","kind":"text","required":true,"options":[],"expression":null}]}'
);
insert into public.character_sheets(id,campaign_id,template_id,owner_id,name,values) values ('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Mara','{"nome":"Mara"}');

select ok(private.mobile_sync_field_allowlist('character_inventory') @> array['damage_type'],'mobile sync accepts the weapon damage kind');
select is(private.mobile_sync_record_dto('character_inventory','{"id":"75000000-0000-4000-8000-000000000009","sync_version":2,"damage_type":"aggravated","private_note":"x"}')->'data',
  '{"id":"75000000-0000-4000-8000-000000000009","damage_type":"aggravated"}'::jsonb,'sync DTO carries damage_type and still drops undeclared columns');

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
set local role authenticated;

select is(public.mobile_sync_push('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001',
  '[{"operation_id":"77000000-0000-4000-8000-000000000001","entity_type":"character_inventory","entity_id":"75000000-0000-4000-8000-000000000001","action":"create","base_version":0,"changes":[
    {"path":["sheet_id"],"before":{"exists":false},"after":{"exists":true,"value":"74000000-0000-4000-8000-000000000001"}},
    {"path":["name"],"before":{"exists":false},"after":{"exists":true,"value":"Estaca flamejante"}},
    {"path":["category"],"before":{"exists":false},"after":{"exists":true,"value":"weapon"}},
    {"path":["damage_type"],"before":{"exists":false},"after":{"exists":true,"value":"aggravated"}}],"depends_on":[]}]'::jsonb)#>>'{results,0,status}',
  'applied','mobile create stores the weapon damage kind');
select is((select damage_type from public.character_inventory where id='75000000-0000-4000-8000-000000000001'),'aggravated','synced weapon keeps aggravated damage');
select is((public.mobile_sync_snapshot('72000000-0000-4000-8000-000000000001','character_inventory',null,10)#>>'{records,0,data,damage_type}'),'aggravated','snapshot returns damage_type to the device');
select isnt(public.mobile_sync_push('72000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001',
  '[{"operation_id":"77000000-0000-4000-8000-000000000002","entity_type":"character_inventory","entity_id":"75000000-0000-4000-8000-000000000002","action":"create","base_version":0,"changes":[
    {"path":["sheet_id"],"before":{"exists":false},"after":{"exists":true,"value":"74000000-0000-4000-8000-000000000001"}},
    {"path":["name"],"before":{"exists":false},"after":{"exists":true,"value":"Faca"}},
    {"path":["category"],"before":{"exists":false},"after":{"exists":true,"value":"weapon"}},
    {"path":["damage_type"],"before":{"exists":false},"after":{"exists":true,"value":"lethal"}}],"depends_on":[]}]'::jsonb)#>>'{results,0,status}',
  'applied','an unknown damage kind is not applied');

select public.restore_character_backup('72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','{"format":"rpg-nexus-sheet","format_version":1,"name":"Cópia","template":{"fields":[{"id":"nome","label":"Nome","kind":"text","required":true,"options":[],"expression":null}]},"values":{"nome":"Cópia"},"effects":[],"inventory":[
  {"name":"Garra restaurada","category":"weapon","quantity":1,"resource_cost":0,"damage_bonus":2,"damage_type":"aggravated","protection":0,"notes":"","acquired":true,"equipped":true,"sort_order":0},
  {"name":"Bastão antigo","category":"weapon","quantity":1,"resource_cost":0,"damage_bonus":1,"protection":0,"notes":"","acquired":true,"equipped":false,"sort_order":1}]}');
select is((select damage_type from public.character_inventory where name='Garra restaurada'),'aggravated','restore keeps the declared damage kind');
select is((select damage_type from public.character_inventory where name='Bastão antigo'),'superficial','older backups without damage_type restore as superficial');
select throws_ok($$select public.restore_character_backup('72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','{"format":"rpg-nexus-sheet","format_version":1,"name":"Ruim","template":{"fields":[{"id":"nome","label":"Nome","kind":"text","required":true,"options":[],"expression":null}]},"values":{"nome":"Ruim"},"effects":[],"inventory":[{"name":"Faca","category":"weapon","quantity":1,"resource_cost":0,"damage_bonus":0,"damage_type":"lethal","protection":0,"notes":"","acquired":true,"equipped":false,"sort_order":0}]}')$$,
  'P0001','invalid inventory item','restore rejects unknown damage kinds');
select throws_ok($$select public.restore_character_backup('72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','{"format":"rpg-nexus-sheet","format_version":1,"name":"Nulo","template":{"fields":[{"id":"nome","label":"Nome","kind":"text","required":true,"options":[],"expression":null}]},"values":{"nome":"Nulo"},"effects":[],"inventory":[{"name":"Faca","category":"weapon","quantity":1,"resource_cost":0,"damage_bonus":0,"damage_type":null,"protection":0,"notes":"","acquired":true,"equipped":false,"sort_order":0}]}')$$,
  'P0001','invalid inventory item','restore rejects a null damage kind');
reset role;
select * from finish();
rollback;
