begin;
select plan(9);

insert into auth.users (id, aud, role, email)
values
  ('12000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'delta-player@example.test'),
  ('12000000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 'delta-master@example.test');
insert into public.campaigns (id, owner_id, name)
values ('22000000-0000-0000-0000-000000000011', '12000000-0000-0000-0000-000000000012', 'Delta Campaign');
insert into public.campaign_members (campaign_id, user_id, role)
values ('22000000-0000-0000-0000-000000000011', '12000000-0000-0000-0000-000000000011', 'player');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('32000000-0000-0000-0000-000000000011', '22000000-0000-0000-0000-000000000011',
  '12000000-0000-0000-0000-000000000012', 'Delta Template', 'approved',
  '{"fields":[{"id":"health","kind":"number"}]}'::jsonb);
insert into public.character_sheets (id, campaign_id, template_id, owner_id, name, values)
values ('42000000-0000-0000-0000-000000000011', '22000000-0000-0000-0000-000000000011',
  '32000000-0000-0000-0000-000000000011', '12000000-0000-0000-0000-000000000011', 'Player Sheet',
  '{"health":5}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000011', true);
select is((public.adjust_sheet_number_idempotent(
  '42000000-0000-0000-0000-000000000011', '52000000-0000-0000-0000-000000000011', 'health', -2, 'damage'
  ) -> 'sheet' -> 'values' ->> 'health')::integer, 3, 'first operation applies its delta');
select is((public.adjust_sheet_number_idempotent(
  '42000000-0000-0000-0000-000000000011', '52000000-0000-0000-0000-000000000011', 'health', -2, 'damage'
  ) -> 'sheet' -> 'values' ->> 'health')::integer, 3, 'retry returns without applying the delta again');
select is((select count(*)::integer from public.character_sheet_events
  where sheet_id = '42000000-0000-0000-0000-000000000011' and operation_id = '52000000-0000-0000-0000-000000000011'),
  1, 'the stable operation ID has one audit event');
select is((select delta from public.character_sheet_events
  where sheet_id = '42000000-0000-0000-0000-000000000011' and operation_id = '52000000-0000-0000-0000-000000000011'),
  -2, 'audit event retains the committed delta');
select throws_ok($$select public.adjust_sheet_number_idempotent(
  '42000000-0000-0000-0000-000000000011', '52000000-0000-0000-0000-000000000011', 'health', -1, 'damage')$$,
  '23505', null, 'the same operation ID cannot change its payload');
select throws_ok($$select public.adjust_sheet_number_idempotent(
  '42000000-0000-0000-0000-000000000011', '52000000-0000-0000-0000-000000000012', 'missing', -1, 'damage')$$,
  '22023', null, 'an operation cannot target a field outside the approved template');
select ok(not has_function_privilege('anon', 'public.adjust_sheet_number_idempotent(uuid,uuid,text,integer,text)', 'execute'),
  'anonymous callers cannot run the idempotent RPC');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000012', true);
select is((public.adjust_sheet_number_idempotent(
  '42000000-0000-0000-0000-000000000011', '52000000-0000-0000-0000-000000000011', 'health', -2, 'damage'
  ) -> 'sheet' -> 'values' ->> 'health')::integer, 1, 'the operation key is scoped to its actor');
select is((select count(*)::integer from public.character_sheet_events
  where sheet_id = '42000000-0000-0000-0000-000000000011' and operation_id = '52000000-0000-0000-0000-000000000011'),
  2, 'both actors have separate receipts for the same operation UUID');

select * from finish();
rollback;
