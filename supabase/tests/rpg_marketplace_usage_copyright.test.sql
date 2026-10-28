begin;
select plan(32);

insert into auth.users(id, aud, role, email) values
  ('e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'author@usage.test'),
  ('e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'gm@usage.test'),
  ('e1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'moderator@usage.test'),
  ('e1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'reporter@usage.test');
insert into public.campaigns(id, owner_id, name) values
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'Usage target');
insert into public.marketplace_admins(user_id) values ('e1000000-0000-4000-8000-000000000003');
set local role service_role;
insert into public.marketplace_systems(id, owner_id, name, description, tags, author_name, automation_level, template, updated_at) values
  ('e1200000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Copper Tide', 'Original sea game', array['Usage'], 'Author', 'static', '{"name":"Copper Tide","fields":[]}'::jsonb, '2026-10-01T00:00:00Z'),
  ('e1200000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'Iron Bloom', 'Original garden game', array['Usage'], 'Author', 'static', '{"name":"Iron Bloom","fields":[]}'::jsonb, '2026-10-05T00:00:00Z'),
  ('e1200000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 'Salt Crown', 'Original court game', array['Usage'], 'Author', 'static', '{"name":"Salt Crown","fields":[]}'::jsonb, '2026-10-03T00:00:00Z'),
  ('e1200000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001', 'Glass Road', 'Original road game', array['Usage'], 'Author', 'static', '{"name":"Glass Road","fields":[]}'::jsonb, '2026-10-04T00:00:00Z');
reset role;

-- Cópias gravam eventos; a coluna não muda na transação da cópia.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select public.marketplace_clone('e1200000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 'usage-key-0001');
select public.marketplace_clone('e1200000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 'usage-key-0001');
select public.marketplace_clone('e1200000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 'usage-key-0002');
select is((select usage_count from public.marketplace_systems where id = 'e1200000-0000-4000-8000-000000000001'), 0::bigint, 'clone no longer updates usage_count in the same transaction');
select throws_ok($$select count(*) from public.marketplace_usage_events$$, '42501', null, 'authenticated users cannot read usage events');
select throws_ok($$select public.marketplace_apply_usage_events(10)$$, '42501', null, 'authenticated users cannot run the aggregation');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.marketplace_usage_events$$, '42501', null, 'anonymous users cannot read usage events');
reset role;
select is((select count(*) from public.marketplace_usage_events where system_id = 'e1200000-0000-4000-8000-000000000001' and applied_at is null), 2::bigint, 'one pending event per new clone; retries add none');

-- Agregação idempotente em lote.
select set_config('test.updated_at', (select updated_at::text from public.marketplace_systems where id = 'e1200000-0000-4000-8000-000000000001'), false);
set local role service_role;
select is(public.marketplace_apply_usage_events(1), 1, 'batch size bounds one run');
select is(public.marketplace_apply_usage_events(1000), 1, 'next run applies the remaining event');
select is(public.marketplace_apply_usage_events(1000), 0, 'repeated run applies nothing');
reset role;
select is((select usage_count from public.marketplace_systems where id = 'e1200000-0000-4000-8000-000000000001'), 2::bigint, 'usage_count reflects each event exactly once');
select is((select count(*) from public.marketplace_usage_events where system_id = 'e1200000-0000-4000-8000-000000000001' and applied_at is null), 0::bigint, 'applied events are marked');
select is((select updated_at::text from public.marketplace_systems where id = 'e1200000-0000-4000-8000-000000000001'), current_setting('test.updated_at'), 'aggregation keeps updated_at');
select throws_ok($$update public.marketplace_usage_events set applied_at = null where system_id = 'e1200000-0000-4000-8000-000000000001'$$, '42501', null, 'applied events cannot be reopened');
select throws_ok($$delete from public.marketplace_usage_events where system_id = 'e1200000-0000-4000-8000-000000000001'$$, '42501', null, 'usage events cannot be deleted directly');
select throws_ok($$select public.marketplace_apply_usage_events(0)$$, '22023', null, 'invalid batch size is rejected');

-- Leituras usam somente a coluna, com índice para popularidade.
select is(position('count(' in lower(pg_get_functiondef('public.marketplace_search(text,text[],integer,integer,text)'::regprocedure))), 0, 'public search has no live COUNT');
select is(position('marketplace_usage_events' in pg_get_functiondef('public.marketplace_search(text,text[],integer,integer,text)'::regprocedure)), 0, 'public search never reads usage events');
select ok(exists (select 1 from pg_indexes where indexname = 'marketplace_systems_popular_idx' and indexdef ilike '%usage_count DESC%'), 'popularity order has an index');
set local role anon;
select is((select id from public.marketplace_search(null, array['Usage'], 1, 1, 'popular')), 'e1200000-0000-4000-8000-000000000001'::uuid, 'popular sort ranks by usage_count');
select is((select id from public.marketplace_search(null, array['Usage'], 1, 1)), 'e1200000-0000-4000-8000-000000000002'::uuid, 'default sort stays by recency');
select throws_ok($$select * from public.marketplace_search(null, '{}', 1, 1, 'random')$$, '22023', null, 'unknown sort is rejected');
-- Anônimo não denuncia.
select throws_ok($$select public.marketplace_report_copyright('e1200000-0000-4000-8000-000000000002', 'Copia o texto do livro', 'Livro X', 'Editora Y', null, true)$$, '42501', null, 'anonymous users cannot report copyright');
reset role;

-- Denúncia de copyright.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000004', false);
set local role authenticated;
select throws_ok($$select public.marketplace_report_copyright('e1200000-0000-4000-8000-000000000002', 'Copia o texto do livro', 'Livro X', 'Editora Y', null, false)$$, '22023', null, 'good faith statement is mandatory');
select throws_ok($$select public.marketplace_report_copyright('e1200000-0000-4000-8000-000000000002', 'Copia o texto do livro', ' ', 'Editora Y', null, true)$$, '22023', null, 'claimed work is mandatory');
select throws_ok($$select public.marketplace_report_copyright('e1200000-0000-4000-8000-000000000002', 'Copia o texto do livro', 'Livro X', 'Editora Y', 'javascript:alert(1)', true)$$, '22023', null, 'evidence link must be http(s)');
select ok(public.marketplace_report_copyright('e1200000-0000-4000-8000-000000000002', 'Copia o texto do livro sem licença', 'Livro X', 'Editora Y', 'https://example.test/obra', true) is not null, 'copyright report is filed');
reset role;
select is((select category || '|' || claimed_work || '|' || rights_holder || '|' || good_faith_confirmed::text from public.marketplace_reports where system_id = 'e1200000-0000-4000-8000-000000000002'), 'copyright|Livro X|Editora Y|true', 'copyright report keeps its fields');
select is((select status from public.marketplace_systems where id = 'e1200000-0000-4000-8000-000000000002'), 'hidden', 'copyright report uses the existing hide-on-report flow');

-- Fila de moderação destaca copyright.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select is((select category from public.marketplace_moderation_queue(1, 50) limit 1), 'copyright', 'copyright reports lead the moderation queue');
select is((select evidence_url from public.marketplace_moderation_queue(1, 50) where system_id = 'e1200000-0000-4000-8000-000000000002'), 'https://example.test/obra', 'queue shows the evidence link');
reset role;

-- Limite de 10 denúncias por usuário em 24 horas.
insert into public.marketplace_reports(system_id, reporter_id, reason, created_at)
select 'e1200000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000004', 'Earlier report number ' || n, now() - interval '1 hour'
  from generate_series(1, 8) n;
insert into public.marketplace_reports(system_id, reporter_id, reason, status, created_at) values
  ('e1200000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000004', 'Old report outside window', 'resolved', now() - interval '25 hours');
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000004', false);
set local role authenticated;
select ok(public.marketplace_report('e1200000-0000-4000-8000-000000000003', 'Tenth report inside the window') is not null, 'tenth report in 24h is accepted');
select throws_ok($$select public.marketplace_report_copyright('e1200000-0000-4000-8000-000000000004', 'Eleventh report today', 'Livro Z', 'Editora Z', null, true)$$, '54000', null, 'eleventh report in 24h is refused');
reset role;
select is((select status from public.marketplace_systems where id = 'e1200000-0000-4000-8000-000000000004'), 'published', 'refused report does not hide the system');

select * from finish();
rollback;
