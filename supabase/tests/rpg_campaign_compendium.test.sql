begin;
select plan(24);

insert into auth.users(id, aud, role, email) values
  ('ce000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'narrator@compendium.test'),
  ('ce000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@compendium.test'),
  ('ce000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'guest@compendium.test'),
  ('ce000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'outsider@compendium.test'),
  ('ce000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'second-player@compendium.test');
insert into public.campaigns(id, owner_id, name) values
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'Compendium campaign'),
  ('ce100000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000004', 'Other campaign');
insert into public.campaign_members(campaign_id, user_id, role) values
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'player'),
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000003', 'guest'),
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000005', 'player');

-- Player proposes an original entry.
select set_config('request.jwt.claim.sub', 'ce000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select set_config('test.entry_a', (select id::text from public.compendium_propose_entry(
  'ce100000-0000-4000-8000-000000000001', '  Eco da Vigília ', 'discipline', 2, array['Homebrew', 'homebrew', ' Observação '],
  '1 ponto ficcional', 'Raciocínio + Prontidão', 'Uma cena', 'Texto original da mesa.', 'Caderno da mesa', 12, 'homebrew')), false);
select is((select status from public.campaign_compendium_entries where id = current_setting('test.entry_a')::uuid), 'pending', 'player proposal starts pending');
select is((select title from public.campaign_compendium_entries where id = current_setting('test.entry_a')::uuid), 'Eco da Vigília', 'proposal title is trimmed');
select is((select tags from public.campaign_compendium_entries where id = current_setting('test.entry_a')::uuid), array['homebrew', 'observação'], 'tags are normalized and deduplicated');
select is((select source_page from public.campaign_compendium_entries where id = current_setting('test.entry_a')::uuid), 12, 'source page is persisted');
select throws_ok($$insert into public.campaign_compendium_entries(campaign_id, proposed_by, title, entry_type, level, description, source_title, source_kind, status)
  values ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'Direto', 'advantage', 1, 'x', 'y', 'homebrew', 'approved')$$,
  '42501', null, 'clients cannot insert entries directly and skip review');
select throws_ok($$update public.campaign_compendium_entries set status = 'approved' where id = current_setting('test.entry_a')::uuid$$,
  '42501', null, 'clients cannot approve by updating the row');
select throws_ok($$select public.compendium_review_entry(current_setting('test.entry_a')::uuid, 'approve', null)$$,
  '42501', null, 'player cannot review proposals');
select throws_ok($$select public.compendium_propose_entry('ce100000-0000-4000-8000-000000000001', 'Nível inválido', 'discipline', 9, '{}', '', '', '', 'x', 'Mesa', null, 'homebrew')$$,
  '22023', null, 'invalid level is rejected');
select throws_ok($$select public.compendium_propose_entry('ce100000-0000-4000-8000-000000000001', 'Tag vazia', 'discipline', 1, array[' '], '', '', '', 'x', 'Mesa', null, 'homebrew')$$,
  '22023', null, 'blank tag is rejected');
reset role;

-- Another player does not see pending proposals of others.
select set_config('request.jwt.claim.sub', 'ce000000-0000-4000-8000-000000000005', false);
set local role authenticated;
select is((select count(*) from public.campaign_compendium_entries), 0::bigint, 'other players do not see pending proposals');
reset role;

-- Guest and outsider cannot propose.
select set_config('request.jwt.claim.sub', 'ce000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select throws_ok($$select public.compendium_propose_entry('ce100000-0000-4000-8000-000000000001', 'Convidado', 'advantage', 1, '{}', '', '', '', 'x', 'Mesa', null, 'homebrew')$$,
  '42501', null, 'guests cannot propose entries');
reset role;
select set_config('request.jwt.claim.sub', 'ce000000-0000-4000-8000-000000000004', false);
set local role authenticated;
select throws_ok($$select public.compendium_propose_entry('ce100000-0000-4000-8000-000000000001', 'Intruso', 'advantage', 1, '{}', '', '', '', 'x', 'Mesa', null, 'homebrew')$$,
  '42501', null, 'outsiders cannot propose entries to another campaign');
select is((select count(*) from public.campaign_compendium_entries where campaign_id = 'ce100000-0000-4000-8000-000000000001'), 0::bigint, 'outsiders cannot read another campaign entries');
select throws_ok($$select public.compendium_review_entry(current_setting('test.entry_a')::uuid, 'approve', null)$$,
  '42501', null, 'narrator of another campaign cannot review');
reset role;

-- Narrator reviews.
select set_config('request.jwt.claim.sub', 'ce000000-0000-4000-8000-000000000001', false);
set local role authenticated;
select is((select count(*) from public.campaign_compendium_entries where status = 'pending'), 1::bigint, 'narrator sees the review queue');
select is((select status from public.compendium_review_entry(current_setting('test.entry_a')::uuid, 'approve', 'Ok para a mesa')), 'approved', 'narrator approves a proposal');
select throws_ok($$select public.compendium_review_entry(current_setting('test.entry_a')::uuid, 'reject', null)$$,
  'P0001', null, 'reviewed entries cannot be reviewed again');
select set_config('test.entry_b', (select id::text from public.compendium_propose_entry(
  'ce100000-0000-4000-8000-000000000001', 'ECO DA VIGÍLIA', 'discipline', 3, '{}', '', '', '', 'Duplicado.', 'Mesa', null, 'homebrew')), false);
select throws_ok($$select public.compendium_review_entry(current_setting('test.entry_b')::uuid, 'approve', null)$$,
  '23505', null, 'approved titles are unique per campaign regardless of case');
select is((select status from public.compendium_review_entry(current_setting('test.entry_b')::uuid, 'reject', 'Duplicado')), 'rejected', 'narrator rejects a proposal');
reset role;

-- Members see approved entries only; rejected stay private to proposer and narrator.
select set_config('request.jwt.claim.sub', 'ce000000-0000-4000-8000-000000000005', false);
set local role authenticated;
select is((select array_agg(title) from public.campaign_compendium_entries), array['Eco da Vigília'], 'members see approved entries only');
reset role;

-- Proposer withdraws a pending proposal but cannot delete an approved entry.
select set_config('request.jwt.claim.sub', 'ce000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select set_config('test.entry_c', (select id::text from public.compendium_propose_entry(
  'ce100000-0000-4000-8000-000000000001', 'Rascunho', 'advantage', 0, '{}', '', '', '', 'Retirar.', 'Mesa', null, 'homebrew')), false);
delete from public.campaign_compendium_entries where id = current_setting('test.entry_c')::uuid;
delete from public.campaign_compendium_entries where id = current_setting('test.entry_a')::uuid;
reset role;
select is((select count(*) from public.campaign_compendium_entries where id = current_setting('test.entry_c')::uuid), 0::bigint, 'proposer withdraws a pending proposal');
select is((select count(*) from public.campaign_compendium_entries where id = current_setting('test.entry_a')::uuid), 1::bigint, 'proposer cannot delete an approved entry');

set local role anon;
select throws_ok($$select count(*) from public.campaign_compendium_entries$$, '42501', null, 'anonymous users cannot read campaign entries');
reset role;
select is((select reviewed_by from public.campaign_compendium_entries where id = current_setting('test.entry_a')::uuid), 'ce000000-0000-4000-8000-000000000001'::uuid, 'review records the narrator');

select * from finish();
rollback;
