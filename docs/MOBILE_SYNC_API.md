# API de sincronização móvel

O adaptador FastAPI publica `router` em `app.routes.mobile_sync`. A montagem no aplicativo principal fica a cargo do agregador da mudança.

## Rotas

- `GET /api/v1/sync/campaigns` lista campanhas que o JWT autenticado pode ler por RLS.
- `GET /api/v1/campaigns/{campaign_id}/sync/capabilities` retorna `role` e `entity_fields` para a campanha visível pelo JWT. O cliente pode usar essa lista para habilitar edições; RPC e políticas RLS continuam validando cada registro.
- `POST /api/v1/campaigns/{campaign_id}/sync/push` recebe até 50 mutações no protocolo 1 e chama `public.mobile_sync_push`.
- `GET /api/v1/campaigns/{campaign_id}/sync/snapshot` aceita `entity_type`, `after_id` opcional e `limit` entre 1 e 200, chamando `public.mobile_sync_snapshot`.
- `GET /api/v1/campaigns/{campaign_id}/sync/changes` aceita `cursor` e `limit` entre 1 e 200, chamando `public.mobile_sync_changes`.

O cliente envia `Authorization: Bearer <JWT do usuário>`. As chamadas REST e RPC usam esse mesmo JWT com `SUPABASE_PUBLISHABLE_KEY`; a API não usa chave de serviço. O middleware confirma a sessão e grava a identidade em `Request.state.supabase_user`. As rotas recusam requisições sem essa identidade verificada.

## Validação e respostas

Os modelos recusam propriedades desconhecidas, booleanos em campos inteiros, JSON não finito, chaves `__proto__`, `prototype` e `constructor`, caminhos de array, caminhos sobrepostos e campos fora da allowlist SQL. Cada operação fica abaixo de 32 KB. O corpo geral usa o limite de 1 MiB já aplicado pelo middleware. Cursor, revisão e versão ficam limitados a `2**53 - 1` nas respostas para conservar inteiros exatos no cliente JavaScript.

O RPC aplica as validações SQL existentes para valores de `character_sheets`, como campos obrigatórios e ativos, tipos, opções, dependências e limites. Ele normaliza o nome, sincroniza o campo de nome do modelo, remove fórmula e rolagem dos valores persistidos e recusa modelos com `rules_profile_version` não nulo. A rota envia a mutação original para preservar o hash de idempotência nos retries; o RPC decide conflitos. `system_templates` aceita rascunhos com revisão pendente e o servidor define status, versão e autor. O sync valida a estrutura do schema no SQL, mas não cobre todas as verificações da API `POST /api/v1/templates/validate`, incluindo sintaxe e referências de expressões. Essa rota valida o payload, sem salvar ou aprovar o modelo. Modelos aprovados permanecem protegidos.

Os envelopes RPC são checados antes de voltar ao cliente. Campos desconhecidos, IDs inválidos, limites excedidos e versões incompatíveis viram HTTP 502 sem repassar detalhes do PostgREST. Negação remota vira 403, limite remoto 429 e indisponibilidade 503.

## Entidades

O push aceita as tabelas com escrita móvel habilitada pela migration. `campaigns` usa proprietário vindo do JWT e as políticas RLS existentes. `system_templates` permite CRUD de rascunhos pendentes de revisão; modelos aprovados não aceitam alterações. A allowlist de colunas acompanha a lista fornecida pelo SQL da migration. O cliente mantém IDs estáveis; campanha, proprietário, autor, timestamps e versões vêm do servidor. `entity_fields` em capabilities é uma orientação por role; permissões por registro, como edição de ficha e inventário próprios, seguem as políticas RLS e o RPC.
