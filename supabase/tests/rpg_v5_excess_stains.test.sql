begin;
select plan(4);

insert into auth.users(id) values ('a5100000-0000-4000-8000-000000000001');
insert into public.campaigns(id, owner_id, name) values
  ('a5200000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','Manchas V5');
insert into public.system_templates(id,campaign_id,owner_id,name,status,schema) values (
  'a5300000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','V5 Teste','approved',
  '{"fields":[{"id":"fome","kind":"number"},{"id":"humanidade","kind":"number"},{"id":"manchas","kind":"number"},{"id":"potencia_sangue","kind":"number"},{"id":"autocontrole","kind":"number"},{"id":"resolucao","kind":"number"},{"id":"vontade_agravada","kind":"number"}]}');
insert into public.character_sheets(id,campaign_id,template_id,owner_id,name,values) values
 ('a5400000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000001','a5300000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','V5','{"fome":1,"humanidade":7,"manchas":2,"potencia_sangue":1,"autocontrole":2,"resolucao":2,"vontade_agravada":0}');

set local role authenticated;
select set_config('request.jwt.claim.sub','a5100000-0000-4000-8000-000000000001',true);
update public.character_sheets set values = values || '{"manchas":5}' where id='a5400000-0000-4000-8000-000000000001';
select is((select (values->>'vontade_agravada')::integer from public.character_sheets where id='a5400000-0000-4000-8000-000000000001'),2,
  'each newly excess stain adds one aggravated Willpower box');
update public.character_sheets set values = values || '{"manchas":5}' where id='a5400000-0000-4000-8000-000000000001';
select is((select (values->>'vontade_agravada')::integer from public.character_sheets where id='a5400000-0000-4000-8000-000000000001'),2,
  'retrying an unchanged Stains value does not apply damage twice');
update public.character_sheets set values = values || '{"manchas":0}' where id='a5400000-0000-4000-8000-000000000001';
select is((select (values->>'vontade_agravada')::integer from public.character_sheets where id='a5400000-0000-4000-8000-000000000001'),2,
  'clearing Stains does not heal aggravated Willpower');
update public.character_sheets set values = values || '{"humanidade":9,"manchas":4}' where id='a5400000-0000-4000-8000-000000000001';
select is((select (values->>'vontade_agravada')::integer from public.character_sheets where id='a5400000-0000-4000-8000-000000000001'),5,
  'a Humanity loss that creates new excess Stains also adds damage');

select * from finish();
rollback;
