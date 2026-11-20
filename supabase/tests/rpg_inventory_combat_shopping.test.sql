begin;
select plan(39);

insert into auth.users(id) values
  ('71000000-0000-4000-8000-000000000001'),
  ('71000000-0000-4000-8000-000000000002'),
  ('71000000-0000-4000-8000-000000000003');
insert into public.campaigns(id,owner_id,name) values
  ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Frente E');
insert into public.campaign_members(campaign_id,user_id,role) values
  ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','player');
insert into public.system_templates(id,campaign_id,owner_id,name,status,schema) values (
  '73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','V5 combate','approved',
  '{"fields":[{"id":"vigor","label":"Vigor","kind":"number"},{"id":"autocontrole","label":"Autocontrole","kind":"number"},{"id":"resolucao","label":"Resolução","kind":"number"},{"id":"saude_superficial","label":"Saúde superficial","kind":"number"},{"id":"saude_agravada","label":"Saúde agravada","kind":"number"},{"id":"vontade_superficial","label":"Vontade superficial","kind":"number"},{"id":"vontade_agravada","label":"Vontade agravada","kind":"number"}]}');
insert into public.character_sheets(id,campaign_id,template_id,owner_id,name,values) values (
  '74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000002','Lia',
  '{"vigor":2,"autocontrole":1,"resolucao":2,"saude_superficial":0,"saude_agravada":0,"vontade_superficial":0,"vontade_agravada":0}');
insert into public.character_inventory(id,sheet_id,campaign_id,name,category,damage_bonus,damage_type,protection,acquired) values
  ('75000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','Faca','weapon',1,'superficial',0,true),
  ('75000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','Estaca flamejante','weapon',2,'aggravated',0,true),
  ('75000000-0000-4000-8000-000000000003','74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','Colete','armor',0,'superficial',2,true),
  ('75000000-0000-4000-8000-000000000004','74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','Rifle encomendado','weapon',3,'superficial',0,false);

-- INV-03: exclusive equipment RPC as the sheet owner.
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select is((public.equip_character_item('75000000-0000-4000-8000-000000000001',1)).equipped,true,'first weapon is equipped');
select throws_ok($$select public.equip_character_item('75000000-0000-4000-8000-000000000001',1)$$,'40001',null,
  'a second client holding the same read version is rejected');
select is((public.equip_character_item('75000000-0000-4000-8000-000000000002',1)).equipped,true,'second weapon takes the weapon slot');
select is((select count(*)::integer from public.character_inventory where sheet_id='74000000-0000-4000-8000-000000000001' and category='weapon' and equipped),
  1,'only one weapon remains equipped');
select is((select equipped from public.character_inventory where id='75000000-0000-4000-8000-000000000001'),false,'previous weapon was unequipped atomically');
select throws_ok($$select public.equip_character_item('75000000-0000-4000-8000-000000000001',2)$$,'40001',null,
  'stale version after the slot changed is rejected');
select is((select id from public.character_inventory where sheet_id='74000000-0000-4000-8000-000000000001' and category='weapon' and equipped),
  '75000000-0000-4000-8000-000000000002'::uuid,'rejected stale call leaves the slot unchanged');
select throws_ok($$update public.character_inventory set equipped=true where id='75000000-0000-4000-8000-000000000001'$$,'23505',null,
  'direct write cannot put two weapons in the same slot');
select throws_ok($$select public.equip_character_item('75000000-0000-4000-8000-000000000004',1)$$,'P0001','item cannot be equipped',
  'pending acquisition cannot be equipped');
select is((public.equip_character_item('75000000-0000-4000-8000-000000000003',1)).equipped,true,'armor uses its own slot');
select is((select count(*)::integer from public.character_inventory where sheet_id='74000000-0000-4000-8000-000000000001' and equipped),
  2,'weapon and armor slots coexist');

-- MOD-07 + INV-06: atomic damage with armor and conversion. Health max = Vigor 2 + 3 = 5.
select is((public.apply_v5_damage('74000000-0000-4000-8000-000000000001','health',3,0) ->> 'absorbed_by_armor')::integer,2,
  'equipped armor absorbs superficial damage');
select is((select values->>'saude_superficial' from public.character_sheets where id='74000000-0000-4000-8000-000000000001'),'1',
  'only the unabsorbed superficial point is stored');
select is((public.apply_v5_damage('74000000-0000-4000-8000-000000000001','health',0,3) ->> 'aggravated')::integer,3,
  'armor does not reduce aggravated damage');
select is(public.apply_v5_damage('74000000-0000-4000-8000-000000000001','health',3,0,false) ->> 'converted','2',
  'superficial overflow on a full track converts superficial boxes into aggravated');
select is((select values->>'saude_superficial' || '/' || (values->>'saude_agravada') from public.character_sheets where id='74000000-0000-4000-8000-000000000001'),'0/5',
  'track becomes fully aggravated after conversion');
select is((select (r->>'overflow')::integer || ':' || (r->>'incapacitated') || ':' || coalesce(r->>'event','none')
  from (select public.apply_v5_damage('74000000-0000-4000-8000-000000000001','health',0,1) r) x),'1:true:none',
  'damage beyond a fully aggravated track is reported as overflow without a write');
-- Willpower max = Composure 1 + Resolve 2 = 3; armor never applies to Willpower.
select is((select (r->>'superficial') || '/' || (r->>'aggravated') || '/' || (r->>'absorbed_by_armor')
  from (select public.apply_v5_damage('74000000-0000-4000-8000-000000000001','willpower',4,0) r) x),'2/1/0',
  'willpower overflow converts one superficial box and ignores armor');
select is(public.apply_v5_damage('74000000-0000-4000-8000-000000000001','willpower',0,1,true,'76000000-0000-4000-8000-000000000001') ->> 'replayed','false',
  'first damage operation applies');
select is(public.apply_v5_damage('74000000-0000-4000-8000-000000000001','willpower',0,1,true,'76000000-0000-4000-8000-000000000001') ->> 'replayed','true',
  'retry with the same operation ID replays');
select is((select values->>'vontade_superficial' || '/' || (values->>'vontade_agravada') from public.character_sheets where id='74000000-0000-4000-8000-000000000001'),'1/2',
  'replayed operation does not apply damage twice');
select is((select count(*)::integer from public.character_sheet_events where sheet_id='74000000-0000-4000-8000-000000000001' and kind='damage'),5,
  'each applied damage write has one audit event');
select throws_ok($$select public.apply_v5_damage('74000000-0000-4000-8000-000000000001','blood',1,0)$$,'22023',null,'unknown track rejected');
select throws_ok($$select public.apply_v5_damage('74000000-0000-4000-8000-000000000001','health',0,0)$$,'22023',null,'empty damage rejected');
select ok(not has_function_privilege('anon','public.apply_v5_damage(uuid,text,integer,integer,boolean,uuid,text)','execute'),
  'anonymous callers cannot apply damage');

-- INV-07: favorites and shopping lists.
insert into public.character_catalog_favorites(user_id,sheet_id,campaign_id,catalog_item_id) values
  ('71000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','faca');
select is((select count(*)::integer from public.character_catalog_favorites),1,'author reads own favorite');
select throws_ok($$insert into public.character_catalog_favorites(user_id,sheet_id,campaign_id,catalog_item_id) values
  ('71000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','taco')$$,'42501',null,
  'favorites cannot be written for another account');
insert into public.character_shopping_lists(id,sheet_id,campaign_id,name) values
  ('77000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','Arsenal de inverno');
insert into public.character_shopping_list_items(list_id,campaign_id,catalog_item_id,name,category,resource_cost,quantity) values
  ('77000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','faca','Faca robusta','weapon',1,2),
  ('77000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','espada','Espada cerimonial','weapon',3,1);
select is((select total_resource_cost || '/' || highest_resource_cost || '/' || item_count || '/' || total_quantity
  from public.character_shopping_list_totals where list_id='77000000-0000-4000-8000-000000000001'),'5/3/2/3',
  'totals sum Resources by quantity and report the highest cost');
select is((select owner_id from public.character_shopping_lists where id='77000000-0000-4000-8000-000000000001'),
  '71000000-0000-4000-8000-000000000002'::uuid,'list author defaults to the caller');
select is((select version from public.character_shopping_lists where id='77000000-0000-4000-8000-000000000001'),3,
  'item changes bump the list version');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.character_shopping_lists),0,'master cannot read an unshared list');
select is((select count(*)::integer from public.character_catalog_favorites),0,'master cannot read the player favorites');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
update public.character_shopping_lists set shared_with_master=true where id='77000000-0000-4000-8000-000000000001';
select throws_ok($$update public.character_shopping_lists set owner_id='71000000-0000-4000-8000-000000000001' where id='77000000-0000-4000-8000-000000000001'$$,
  '23514',null,'list author cannot be reassigned');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select is((select total_resource_cost from public.character_shopping_list_totals where list_id='77000000-0000-4000-8000-000000000001'),5,
  'master reads totals of a shared list');
select is((select count(*)::integer from public.character_shopping_list_items),2,'master reads shared items');
select throws_ok($$insert into public.character_shopping_list_items(list_id,campaign_id,name) values
  ('77000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','Granada')$$,'42501',null,
  'master cannot write into the player list');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from public.character_shopping_lists),0,'outsider reads no lists');
select throws_ok($$select public.equip_character_item('75000000-0000-4000-8000-000000000001',3)$$,'42501',null,'outsider cannot equip');
select throws_ok($$select public.apply_v5_damage('74000000-0000-4000-8000-000000000001','health',1,0)$$,'42501',null,'outsider cannot apply damage');
reset role;

select * from finish();
rollback;
