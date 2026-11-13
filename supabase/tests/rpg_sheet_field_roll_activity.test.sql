begin;
select plan(9);
insert into auth.users(id,email) values
('13000000-0000-0000-0000-000000000091','field-owner@example.test'),
('13000000-0000-0000-0000-000000000092','field-player@example.test'),
('13000000-0000-0000-0000-000000000093','field-other@example.test');
insert into public.campaigns(id,owner_id,name) values
('23000000-0000-0000-0000-000000000091','13000000-0000-0000-0000-000000000091','Roll fields');
insert into public.campaign_members(campaign_id,user_id,role) values
('23000000-0000-0000-0000-000000000091','13000000-0000-0000-0000-000000000092','player');
insert into public.system_templates(id,campaign_id,owner_id,name,status,schema) values
('33000000-0000-0000-0000-000000000091','23000000-0000-0000-0000-000000000091','13000000-0000-0000-0000-000000000091','Roll field template','approved',
'{"fields":[{"id":"forca","kind":"number"},{"id":"teste","kind":"roll","expression":"2d6+3"}]}'::jsonb);
insert into public.character_sheets(id,campaign_id,template_id,owner_id,name,values) values
('43000000-0000-0000-0000-000000000091','23000000-0000-0000-0000-000000000091','33000000-0000-0000-0000-000000000091','13000000-0000-0000-0000-000000000092','Lia','{"forca":2}');
set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-0000-0000-000000000092',true);
select is(public.rpg_record_sheet_field_roll('43000000-0000-0000-0000-000000000091','teste','field:teste:1','2d6+3')->>'status','recorded','approved roll field records activity');
select is(public.rpg_record_sheet_field_roll('43000000-0000-0000-0000-000000000091','teste','field:teste:1','2d6+3')->>'status','duplicate','same roll key is idempotent');
select is((select used_trait_ids from public.chronicle_activity where roll_key='field:teste:1'),'{}'::text[],'roll field does not fabricate use of numeric traits');
select is(public.rpg_record_sheet_field_roll('43000000-0000-0000-0000-000000000091','teste','field:teste:2','30d6+3')->>'status','unapproved_template','edited expression is not logged as approved field');
select is(public.rpg_record_sheet_field_roll('43000000-0000-0000-0000-000000000091','forca','field:forca:1','2d6+3')->>'status','no_traits','number field cannot masquerade as roll field');
select is((select count(*)::integer from public.chronicle_activity),1,'replay and rejected context add no activities');
select set_config('request.jwt.claim.sub','13000000-0000-0000-0000-000000000093',true);
select is(public.rpg_record_sheet_field_roll('43000000-0000-0000-0000-000000000091','teste','field:teste:3','2d6+3')->>'status','not_in_campaign','outsider cannot log field rolls');
reset role;
delete from public.campaign_members where user_id='13000000-0000-0000-0000-000000000092';
set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-0000-0000-000000000092',true);
select is(public.rpg_record_sheet_field_roll('43000000-0000-0000-0000-000000000091','teste','field:teste:4','2d6+3')->>'status','not_in_campaign','revoked owner cannot log field rolls');
select ok(not has_function_privilege('anon','public.rpg_record_sheet_field_roll(uuid,text,text,text,uuid)','EXECUTE'),'anonymous RPC execution denied');
select * from finish();
rollback;
