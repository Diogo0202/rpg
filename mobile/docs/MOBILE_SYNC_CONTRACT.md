# RPG-Atlas Mobile: contrato de sincronização v1

Plano aprovado em 18/10/2026. A interface no Lovable compartilha Supabase Auth e a API FastAPI do Nexus. Não há banco paralelo nem credencial de serviço no navegador. A edição offline completa mantém dados e pendências em IndexedDB, separados por usuário e campanha.

## Envelope comum

`protocol_version` é sempre 1. IDs de dispositivo, operação e entidades são UUIDs gerados no cliente, sem autoridade para definir permissões. `entity_type` identifica uma tabela permitida pelo servidor. `version` do protocolo corresponde a `sync_version`, separado das versões de modelos de regras e do controle de concorrência já existente.

Uma operação contém `operation_id`, `entity_type`, `entity_id`, `action` (`create`, `update`, `delete`), `base_version` (0 na criação), `changes` e `depends_on` (IDs de operações anteriores). Cada mudança tem `path` (lista de chaves, sem índices de arrays), `before` e `after`. Os valores before/after têm `{exists: boolean, value?: JSON}`. `exists:false` é diferente de JSON null. Changes em caminhos sobrepostos são inválidas. A remoção não contém changes. Limites iniciais: 50 operações por lote, 200 mudanças por operação, profundidade de caminho 12, 32 KB por operação e corpo total limitado pelo middleware atual.

`create` aceita apenas campos declarados por entidade. O servidor define usuário, campanha, timestamps e revisões. `update` não altera IDs nem vínculo entre campanhas. Fórmulas e dados de permissão não são gravados como valores confiáveis enviados pelo cliente. A criação de fichas usa o modelo aprovado e a validação de criação já existente.

## Rotas

- `GET /api/v1/sync/campaigns`: campanhas acessíveis para bootstrap.
- `POST /api/v1/campaigns/{campaign_id}/sync/push`: `{protocol_version,device_id,mutations}`. Responde resultados por operação, preservando a ordem. Estados: `applied`, `duplicate`, `conflict`, `denied`, `invalid`, `dependency_failed`. Cada resultado inclui operation_id e, quando autorizado/disponível, record atual e caminhos em conflito. Uma falha não aplica os dependentes. Não há retry automático de conflito como sobrescrita.
- `GET /api/v1/campaigns/{campaign_id}/sync/snapshot?entity_type=...&after_id=...&limit=100`: página autorizada, cursor da campanha e records. Paginação por ID estável, `next_after_id` e `has_more`. O cliente guarda o cursor inicial e depois busca todas as mudanças posteriores; records podem ser mais recentes que esse cursor e são aplicados por versão.
- `GET /api/v1/campaigns/{campaign_id}/sync/changes?cursor=...&limit=100`: `{protocol_version,campaign_id,cursor,has_more,changes}`. Cada change contém revisão, entidade, ID, ação, version e record autorizado ou tombstone. Exclusões têm version igual à última sync_version mais um; o cache retém essa versão para ignorar respostas antigas. IDs excluídos não são reaproveitados, e uma restauração cria outro ID. O cursor é do servidor, não do relógio do aparelho. Eventos ocultos também fazem o cursor avançar, sem expor seus IDs ou conteúdo. Cursor fora da retenção exige novo snapshot.

Mutações idempotentes preservam o hash da operação original e o resultado. Repetir o mesmo ID com outro conteúdo é inválido. Receipts não expiram enquanto puderem receber retries; limpeza futura exige checkpoint de dispositivo ou resnapshot, sem reaplicar IDs antigos.

## Conflitos e estado local

Com a versão original, a operação é aplicada. Com versão diferente, mudanças em campos independentes podem ser mescladas se todos os before ainda correspondem ao dado atual. Se o mesmo campo mudou, o servidor retorna conflito sem substituir o estado. Delete exige a versão atual. Arrays são valores atômicos; objetos do mapa terão IDs estáveis, evitando depender da posição em arrays.

O cache mantém a base confirmada separada da projeção otimista. Receber um record do servidor nunca apaga uma edição pendente. Confirmar uma operação atualiza a base e reaplica as demais na ordem. Fechar ou recarregar o app não apaga a fila. Logout limpa os dados da conta; acesso revogado interrompe o envio, remove a cópia remota em cache e preserva o tratamento explícito de rascunhos pendentes para o usuário.

Criações usam IDs estáveis; dependências garantem modelo/ficha/item e mapa/marcador. Conflitos mostram base, local e remoto. A decisão do usuário gera nova operação com nova base, sem reenviar indefinidamente a operação recusada.

## Banco e autorização

Novas estruturas: sync_devices, campaign_sync_state, sync_changes e mutation_receipts. A revisão da campanha e o evento são gravados na mesma transação da mudança. Writes feitos pelas rotas web antigas também produzem eventos. Logs não são expostos diretamente; RPCs fazem autorização por campanha e por entidade. Tokens de acesso não são persistidos em outbox ou backups. O limite global de dez chamadas continua no servidor.

As primeiras entidades devem cobrir campanhas, modelos, fichas, inventário, mundo/relações, mapas/marcadores, diário/facções/sessões e cenas de combate. Ampliar para música e motores dramáticos mantém o mesmo protocolo. A lista exata e a cobertura comprovada serão registradas no checklist; nenhuma tela pode anunciar sincronização de uma entidade ainda sem suporte no servidor.

## Verificação obrigatória

Dois dispositivos devem sincronizar criações uma única vez, mesclar campos independentes, preservar conflitos no mesmo campo e respeitar exclusões. Replays após perda de resposta não duplicam inventário. RLS e RPCs recusam acesso entre campanhas e tentativas de trocar proprietário. O cofre funciona após recarregar sem rede. Cache e fila são isolados por conta. Remoção de participante bloqueia operações na reconexão. Migrations precisam ser executadas em banco de teste para provar atomicidade e políticas, não apenas analisadas como texto.

