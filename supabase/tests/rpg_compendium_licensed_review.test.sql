begin;
select plan(4);

insert into auth.users(id, aud, role, email) values
  ('ce200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'narrator@licensed.test'),
  ('ce200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@licensed.test');
insert into public.campaigns(id, owner_id, name) values
  ('ce210000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000001', 'Licensed review');
insert into public.campaign_members(campaign_id, user_id, role) values
  ('ce210000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000002', 'player');

select set_config('request.jwt.claim.sub', 'ce200000-0000-4000-8000-000000000002', false);
set local role authenticated;
select set_config('test.licensed_without_page', (select id::text from public.compendium_propose_entry(
  'ce210000-0000-4000-8000-000000000001', 'Sem página', 'discipline', 1, '{}', '', '', '',
  'Descrição criada pela mesa.', 'Livro da mesa', null, 'licensed')), false);
select set_config('test.licensed_with_page', (select id::text from public.compendium_propose_entry(
  'ce210000-0000-4000-8000-000000000001', 'Com página', 'discipline', 1, '{}', '', '', '',
  'Outra descrição criada pela mesa.', 'Livro da mesa', 42, 'licensed')), false);
reset role;

select set_config('request.jwt.claim.sub', 'ce200000-0000-4000-8000-000000000001', false);
set local role authenticated;
select throws_ok($$select public.compendium_review_entry(current_setting('test.licensed_without_page')::uuid, 'approve', 'Licença conferida pela mesa')$$,
  '22023', null, 'licenciada sem página não é aprovada');
select throws_ok($$select public.compendium_review_entry(current_setting('test.licensed_with_page')::uuid, 'approve', null)$$,
  '22023', null, 'licenciada sem nota de autorização não é aprovada');
select throws_ok($$select public.compendium_review_entry(current_setting('test.licensed_with_page')::uuid, 'approve', 'ok')$$,
  '22023', null, 'nota genérica curta não autoriza aprovação');
select is((select status from public.compendium_review_entry(current_setting('test.licensed_with_page')::uuid,
  'approve', 'Licença de uso conferida pelo narrador para esta campanha')), 'approved',
  'narrador registra a conferência e aprova o verbete');
reset role;

select * from finish();
rollback;
