# Cliente offline do RPG-Atlas

O diretório `frontend/lib/mobile-sync/` é um cliente TypeScript independente de React e Next. Pode ser copiado para um projeto Vite ou Lovable. Ele fala com a API FastAPI definida em `docs/MOBILE_SYNC_CONTRACT.md` e grava a base confirmada, a projeção local e a outbox no IndexedDB `rpg-nexus-mobile-v1`.

## Exports

Importe do barrel `index.ts` ou de cada módulo:

- `types.ts`: contratos JSON, mudanças, mutações, resultados, campanhas e interfaces do store/transport.
- `merge.ts`: `validateChanges`, `applyChanges`, `rebaseChanges`, `projectRecord`, `fieldValuesEqual`.
- `store.ts`: `SyncStore`, `MemorySyncStore`, `MemoryCoordinator`, `IndexedDbSyncStore`, `openSyncStore`, `pendingEntries`.
- `engine.ts`: `SyncEngine`, `createOperationId`, `createDeviceId`, `createEntityId`.
- `transport.ts`: `FastApiSyncTransport`, `SyncHttpError`, `parseRetryAfter`.

## Integração React/Lovable

Crie uma instância por sessão autenticada. O provider de token consulta Supabase Auth a cada chamada e pede refresh após `401`; o token só existe na memória da chamada HTTP. Não o copie para o estado do sync, IndexedDB, logs ou arquivo exportado.

```ts
import { createClient } from "@supabase/supabase-js";
import { FastApiSyncTransport, SyncEngine, openSyncStore } from "./lib/mobile-sync/index.ts";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const store = openSyncStore();
const transport = new FastApiSyncTransport({
  baseUrl: import.meta.env.VITE_NEXUS_API_URL,
  getAccessToken: async (refresh = false) => {
    const { data, error } = refresh
      ? await supabase.auth.refreshSession()
      : await supabase.auth.getSession();
    if (error) return null;
    return data.session?.access_token ?? null;
  },
});

const deviceId = await store.getOrCreateDeviceId(user.id);
const capabilities = await transport.capabilities(campaignId);
const engine = new SyncEngine({
  accountId: user.id,
  campaignId,
  deviceId,
  // Receba esta lista de capacidades de uma resposta autorizada do servidor.
  // Não infira campos graváveis dos dados locais ou do schema do formulário.
  entityFields: capabilities.entity_fields,
}, store, transport);

await engine.bootstrap(["character_sheets", "character_inventory", "world_entities", "world_relations", "maps", "map_pins"]);
await engine.enqueue({
  entityType: "map_pins",
  entityId: crypto.randomUUID(),
  action: "create",
  changes: [
    { path: ["label"], before: { exists: false }, after: { exists: true, value: "Entrada norte" } },
    { path: ["x"], before: { exists: false }, after: { exists: true, value: 0.42 } },
  ],
});
const report = await engine.sync();
```

`createDeviceId()` gera um UUID, mas o app deve chamar `store.getOrCreateDeviceId(accountId)` para manter o mesmo aparelho após recarregar. Criações sem `entityId` recebem um UUID antes de entrar na outbox. IDs excluídos não são reutilizados. As chaves do cache incluem conta, campanha e aparelho. O store IndexedDB aplica transações read-write serializadas pelo navegador; um lease persistido impede duas abas de enviar a mesma fila ao mesmo tempo. Mutações `inflight` voltam à fila quando o lease vence após fechamento inesperado.

`bootstrap()` lê snapshots paginados com um watermark do servidor e depois busca mudanças a partir dele. O cursor de pull só avança depois de processar cada página. O cursor retornado por push não move o cursor de pull, pois poderia pular eventos gravados por outro aparelho.

Operações criadas offline encadeiam `base_version` pela versão projetada: criar começa em 1, cada edição incrementa a versão e uma exclusão usa a versão projetada mais recente. Se push informar `applied` ou `duplicate` sem incluir o registro, o cliente mantém a mutação como `accepted`, continua a projetá-la localmente e aguarda pull confirmar o cursor. Ele não envia essa operação outra vez nem inventa uma base confirmada.

`getRecord()` devolve a projeção confirmada com a fila local reaplicada. Um evento remoto não descarta mudanças locais. Quando o mesmo campo diverge, a entrada fica em estado `conflict` e a projeção mantém o valor local para a tela mostrar lado a lado com a base remota. `resolveConflict(operationId, changes)` exige valores `before` da base atual e cria outra operação, com UUID novo e nova versão-base. Uma exclusão remota pode ser tratada como rascunho para criar um novo registro com outro UUID ou descartada pelo usuário.

Em `401`, o transporte atualiza a sessão e repete o corpo original. Em `403` de push, pull ou snapshot, a cópia confirmada em cache e o cursor são removidos; a outbox fica marcada como `denied` para revisão explícita e os rascunhos seguem projetados para a tela. Um tombstone remoto mantém a base como removida e marca edições pendentes como `conflict`, preservando os valores `before` e `after` para a interface. `429` e `503` respeitam `Retry-After` limitado a dois minutos e fazem novas tentativas com espera crescente. `engine.logout()` apaga as partições locais e o ID do aparelho da conta.

`exportPendingDrafts()` exporta um envelope `rpg-nexus-mobile-v1-pending-drafts`. Ele serve para recuperar rascunhos da fila e **não** é um backup RPG-Atlas compatível com o formato de fichas v1.

## Contrato e limites

O cliente valida campos contra `entityFields` recebido do servidor, caminhos duplicados/sobrepostos, caminhos de protótipo, limite de mudanças, profundidade e tamanho de operação. O transporte aceita apenas HTTPS, com HTTP liberado para loopback durante desenvolvimento, limita respostas a 2 MB e lotes push a 1 MB. Arrays são tratados como valores atômicos. IDs e permissões enviados pelo aparelho não concedem acesso; FastAPI permanece responsável pela autorização, validação de fichas, concorrência e idempotência.

O endpoint de capacidades entrega a lista gravável para a campanha e o papel autenticado, mas o servidor ainda valida cada chamada e campo. A lista de nomes do contrato não comprova suporte no servidor. A cópia local só pode ser chamada sincronizada depois que rotas, migrations, políticas e entidades forem executadas e verificadas no servidor real. O módulo não registra tokens, não cria tabelas paralelas e não executa lógica de regras de jogo.

## Verificação local

Na pasta `frontend`, rode os dois arquivos diretamente, sem alterar `package.json`:

```powershell
node --experimental-strip-types --test tests/mobile-sync.test.mjs tests/mobile-sync-indexeddb.test.mjs
```

O primeiro arquivo simula dois aparelhos contra um coordenador em memória para testar mescla de campos, conflito no mesmo campo, exclusão de marcador, reload, repetição idempotente e isolamento por conta. O segundo abre Chromium/Playwright e exercita IndexedDB real, escrita concorrente, persistência após recarga e limpeza por conta. Ele pula com uma justificativa se Playwright ou Chromium não estiver disponível. Nenhum pacote é baixado pelo teste.

