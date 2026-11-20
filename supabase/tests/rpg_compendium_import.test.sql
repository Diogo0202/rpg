begin;
select plan(12);

insert into auth.users(id, aud, role, email) values
  ('ce300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'narrator@import.test'),
  ('ce300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@import.test');
insert into public.campaigns(id, owner_id, name) values
  ('ce310000-0000-4000-8000-000000000001', 'ce300000-0000-4000-8000-000000000001', 'Import');
insert into public.campaign_members(campaign_id, user_id, role) values
  ('ce310000-0000-4000-8000-000000000001', 'ce300000-0000-4000-8000-000000000002', 'player');

-- Jogador não importa.
select set_config('request.jwt.claim.sub', 'ce300000-0000-4000-8000-000000000002', false);
set local role authenticated;
select throws_ok($$select public.compendium_import_entries('ce310000-0000-4000-8000-000000000001',
  '[{"title":"A","entry_type":"merit","level":1,"description":"d","source_title":"s"}]'::jsonb)$$,
  '42501', null, 'jogador não pode importar');
-- Jogador pode propor os novos tipos.
select is((select entry_type from public.compendium_propose_entry(
  'ce310000-0000-4000-8000-000000000001', 'Defeito do jogador', 'flaw', 1, '{}', '', '', '',
  'Texto próprio.', 'Caderno', null, 'homebrew')), 'flaw', 'propose aceita o novo tipo flaw');
select is((select entry_type from public.compendium_propose_entry(
  'ce310000-0000-4000-8000-000000000001', 'Regra da casa', 'rule', 0, '{}', '', '', '',
  'Texto próprio.', 'Caderno', null, 'homebrew')), 'rule', 'propose aceita o novo tipo rule');
reset role;

select set_config('request.jwt.claim.sub', 'ce300000-0000-4000-8000-000000000001', false);
set local role authenticated;

select is(public.compendium_import_entries('ce310000-0000-4000-8000-000000000001', '[
  {"title":"Mérito A","entry_type":"merit","level":2,"tags":["Mesa","mesa","x"],"cost":"1","description":"Texto A","source_title":"Caderno"},
  {"title":"Magia B","entry_type":"spell","description":"Texto B","source_title":"Livro","source_page":10,"source_kind":"licensed"},
  {"title":"Item C","entry_type":"item","level":0,"description":"Texto C","source_title":"Caderno"}
]'::jsonb), '{"inserted":3,"errors":[]}'::jsonb, 'narrador importa três verbetes');
select is((select count(*)::int from public.campaign_compendium_entries
  where campaign_id = 'ce310000-0000-4000-8000-000000000001' and title in ('Mérito A', 'Magia B', 'Item C')
    and status = 'pending' and proposed_by = 'ce300000-0000-4000-8000-000000000001'), 3, 'importados ficam pendentes');
select is((select tags from public.campaign_compendium_entries where title = 'Mérito A'), array['mesa', 'x'], 'etiquetas são normalizadas');

select is(public.compendium_import_entries('ce310000-0000-4000-8000-000000000001', '[
  {"title":"Boa","entry_type":"power","description":"ok","source_title":"Caderno"},
  {"title":"Tipo ruim","entry_type":"banana","description":"ok","source_title":"Caderno"}
]'::jsonb), '{"inserted":0,"errors":[{"index":1,"message":"invalid entry_type"}]}'::jsonb, 'tipo inválido informa o índice');
select is(public.compendium_import_entries('ce310000-0000-4000-8000-000000000001', '[
  {"title":"Licenciada","entry_type":"ritual","description":"ok","source_title":"Livro","source_kind":"licensed"}
]'::jsonb), '{"inserted":0,"errors":[{"index":0,"message":"licensed entry requires source_page"}]}'::jsonb, 'licenciada sem página gera erro');
select is((select count(*)::int from public.campaign_compendium_entries where title in ('Boa', 'Licenciada')), 0, 'tudo ou nada: nada foi gravado');
select is((public.compendium_import_entries('ce310000-0000-4000-8000-000000000001', '[
  {"title":"","entry_type":"item","description":"ok","source_title":"c"},
  {"title":"Nível","entry_type":"item","level":9,"description":"ok","source_title":"c"}
]'::jsonb))->'errors'->1->>'index', '1', 'vários erros são reportados com seus índices');

select throws_ok($$select public.compendium_import_entries('ce310000-0000-4000-8000-000000000001',
  (select jsonb_agg(jsonb_build_object('title', 'T' || g, 'entry_type', 'item', 'description', 'd', 'source_title', 's')) from generate_series(1, 201) g))$$,
  '22023', null, 'mais de 200 verbetes é rejeitado');
select is((public.compendium_import_entries('ce310000-0000-4000-8000-000000000001',
  (select jsonb_agg(jsonb_build_object('title', 'Lote' || g, 'entry_type', 'item', 'description', 'd', 'source_title', 's')) from generate_series(1, 200) g)))->>'inserted',
  '200', 'exatamente 200 verbetes é aceito');
reset role;

select * from finish();
rollback;
