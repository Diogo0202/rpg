# 0002. Arquitetura hexagonal e Clean Code no código do RPG-Atlas

Estado: pedida pelo usuário em 18/11/2026; fase 1 (backend) concluída na branch `refactor/hexagonal` em 19/11/2026; fase 2 (frontend web) em andamento.

## Decisão

O backend FastAPI passa a ter três camadas com dependência num único sentido, de fora para dentro:

| Camada | Pasta | Conteúdo | Pode importar |
| --- | --- | --- | --- |
| Domínio | `backend/app/domain/` | regras de negócio, modelos (`models.py`) e erros (`DomainError` e subclasses) | apenas a biblioteca padrão, Pydantic e o próprio domínio |
| Aplicação | `backend/app/application/<contexto>/` | casos de uso (`SheetService`) e portas (`Protocol`) | domínio |
| Adaptadores | `backend/app/adapters/inbound/http/` e `backend/app/adapters/outbound/<serviço>/` | rotas FastAPI, cliente Supabase, repositórios, provedores externos | aplicação e domínio |

Um caso de uso nunca levanta `HTTPException` nem chama `httpx`. Ele levanta erros de domínio, e a rota os converte em status HTTP por meio de `DomainErrorRoute`. A composição de cada requisição fica em `adapters/inbound/http/dependencies.py`, que liga as portas aos adaptadores concretos.

Os testes de rota substituem o adaptador `supabase_session` por `tests/support/fake_supabase.py`, em vez de remendar funções privadas dos módulos com `monkeypatch`.

## Contexto

Antes da fase 1, 17 dos 19 módulos de rota em `backend/app/routes/` falavam diretamente com o Supabase ou com outro serviço HTTP. O módulo `routes/sheets.py` repetia três vezes a leitura de `SUPABASE_URL`, a checagem do token e o tratamento de erros do PostgREST. `routes/chronicle.py` e `services/supabase_rpc.py` mantinham clientes próprios, e a tabela de SQLSTATE de `supabase_rpc.py` traduz os mesmos códigos com mensagens diferentes das usadas pelas fichas. Os testes dependiam desses detalhes: havia cerca de 200 chamadas `monkeypatch.setattr` apontando para funções privadas como `_request`, `_rpc` e `_current_user_id`.

A alternativa de mover arquivos sem mudar as dependências deixaria a regra de negócio presa ao FastAPI e manteria os testes acoplados aos nomes internos. Reescrever todo o backend numa única entrega impediria conferir o comportamento módulo a módulo.

## Estratégia de migração

Cada contexto migra numa etapa própria, e a suíte do backend precisa continuar verde ao fim de cada uma. A linha de base é de 1814 testes aprovados.

1. Fichas (`sheets`): concluída. `SheetService`, `SheetRepository`, `SupabaseRestClient` e `SupabaseSheetRepository` substituem o antigo `routes/sheets.py`.
2. Experiência e Vampiro V5: concluída. `ExperienceService`, `V5RollService`, `V5BloodService`, `V5ActionService` e `V5SanguineService` dependem das portas `AdvanceRepository`, `V5Store`, `WeaponReader`, `SanguineStore` e `RollActivityRecorder`. Cada repositório traz a própria tabela de SQLSTATE ou de status HTTP, passada ao `SupabaseRestClient` por chamada. O módulo de compatibilidade `app/routes/sheets.py` foi removido.
3. Crônica, convites, marketplace e sincronização mobile: concluída. A leitura paginada da crônica ficou no adaptador e o limite de linhas no caso de uso (`LimitExceeded`, 413). O envio do convite separa a reserva no Supabase (`InviteReservations`) do provedor de e-mail (`InviteMailer`). O marketplace tem três portas, uma por nível de acesso: catálogo público, operações com o token do usuário e escritas com a chave de serviço. A sincronização mobile mantém um transporte próprio, mais estrito que o `SupabaseRestClient`, e a validação das respostas passou para `application/mobile_sync/validation.py`.
4. Provedores externos: concluída. A sala de voz separa o pedido no Supabase (`VoiceSessionRequests`) da criação no Discord (`VoiceRooms`). O Spotify tem a porta `SpotifyGateway`, e as regras de entrada (formato de ids, comando de tocar) ficam em `domain/spotify.py`. Na IA, `PaidGeneration` concentra o livro do orçamento: reserva, despacho, liquidação, e pedido incerto quando o consumo é desconhecido. `AiAssistanceService` cuida de propostas, rascunhos, tutor e aprovação, com as portas `AiCampaignStore` (token do usuário), `AiPrivateStore` (chave de serviço) e `AiProvider`. As integrações saíram de `services/` para `adapters/outbound/discord`, `adapters/outbound/spotify` e `adapters/outbound/ai`, e o e-mail de convite já tinha porta própria desde a etapa 3.
5. Rotas restantes: concluída. Segunda Inquisição, rolagens por sistema (com as ações de ficha do Vampiro V3), Caçador, geradores, regras, Companhia de O Um Anel e modificadores ganharam casos de uso e portas. As rotas que ficavam em `main.py` (saúde, dados, validação de modelo, cálculo de ficha e extração) foram para `adapters/inbound/http/tools.py`, e `main.py` só monta o app. O pacote `app/routes/` deixou de existir. Outras mudanças desta etapa:
   - `require_signed_in_user` saiu de `routes/generators.py` para `adapters/inbound/http/auth.py`, com as mensagens de erro corrigidas (estavam com acentos corrompidos no repositório).
   - O antigo `services/supabase_rpc.py` virou a tabela `CAMPAIGN_RPC_ERRORS`, usada pelo `SupabaseRestClient`. Não resta cliente HTTP do Supabase fora de `adapters/outbound/`.
   - O registro de rolagens na crônica foi dividido: o contrato (`RollChronicleContext`, `RollActivityResult` e a porta) fica em `application/roll_activity.py`, e a gravação fica em `adapters/outbound/supabase/roll_activity.py`.
   - A composição do e-mail de convite foi para `domain/invite_email.py`, e o envio por SMTP ou Resend foi para `adapters/outbound/email/invite_mailer.py`.
6. Regras puras e tabelas de SQLSTATE: concluída. Os 28 módulos de `services/` e o `app/models.py` foram para `domain/`, e a pasta `services/` deixou de existir. Para o domínio não depender da aplicação, `RollChronicleContext` e `RollActivityResult` saíram de `application/roll_activity.py` para `domain/roll_activity.py`; a porta `RollActivityRecorder` continua na aplicação. As traduções de erro do PostgREST ficaram em `adapters/outbound/supabase/errors.py`, com um formato único (`RpcErrors`). O dicionário `SqlStateErrors` e o segundo caminho de tradução em `rest_client.py` foram removidos. As RPCs sem tabela própria usam `SHEET_RPC_ERRORS`. Cada repositório mantém as próprias mensagens, porque o mesmo código tem sentidos diferentes em cada contexto (`23505` é compra repetida no avanço e ajuste repetido na ficha). As referências aos caminhos antigos em documentos e comentários do frontend e do mobile foram atualizadas, exceto nas migrações, que não se editam.

## Fase 2: frontend web

O levantamento de 19/11/2026 encontrou quatro problemas. O web e o mobile mantinham cópias das mesmas regras, 17 delas idênticas byte a byte. 36 componentes e páginas consultam o Supabase direto. 29 arquivos chamam a API, cada um com o próprio tratamento de status. E cinco componentes passam de 550 linhas misturando estado, dados e visual. A fase segue quatro etapas, da menor para a maior chance de quebrar uma tela:

1. F1, regras em `shared/rules/`: concluída. As 17 regras idênticas e `creation-grants.ts` saíram de `frontend/lib/` e `mobile/src/lib/`, e os dois apps importam o mesmo arquivo por caminho relativo, como já faziam com `shared/one-ring/` e `shared/sync/`. O `creation-grants.ts` do mobile continha o do web inteiro e mais três funções de checagem offline, por isso ele virou a versão comum. `theme.ts` continua separado: o web troca o tema por `data-theme`, e o mobile por classes, com modo escuro. Os testes de paridade entre as cópias foram removidos, e as checagens contra as fixtures do backend continuam. `scripts/package-mobile-source.mjs` passou a ler `shared/rules/`; o formato que o destino desse pacote espera não foi conferido: [falta detalhe real].
2. F2, cliente único da API em `frontend/lib/api/`: concluída. `http.ts` faz a chamada, aplica o prazo, lê o JSON e traduz o status em mensagem (`ApiError`, com `kind`, `status` e `detail`). Ele não depende do Supabase nem do React, e `tests/api-client.test.mjs` o testa com `node --test`. `session.ts` acrescenta a URL de `NEXT_PUBLIC_API_URL` e o token da sessão. Cada tela informa só as mensagens que muda (`ApiMessages`). Os 7 clientes de `lib/` com `fetch` próprio (e `experience-advances.ts`, que usa o de `sheet-adjustments.ts`) e os 14 componentes com `fetch` próprio passaram a usar esse cliente. A ficha e o histórico de versões, que liam a URL e o token por conta própria, também. Só `http.ts` chama a API com `fetch`. O cancelamento pedido pela tela continua chegando como `AbortError`. Mudanças de comportamento: falhas de rede mostram uma mensagem em português em vez do texto do navegador, e respostas 5xx sem mensagem fixa mostram "A API está indisponível" em vez do texto genérico de recusa de cada tela. O transporte da Companhia de O Um Anel continua em `shared/one-ring/`, porque o mobile também o usa.
3. F3, acesso ao Supabase fora das telas, com um repositório por contexto em `frontend/lib/data/` e hooks para as telas.
4. F4, componentes grandes divididos em hook de estado e componentes de visual.

As etapas F3 e F4 alteram telas que nenhum teste cobre. A conferência delas depende de abrir cada tela no navegador com um Supabase de desenvolvimento: [falta detalhe real]. O mobile (`mobile/src`) e o restante de `shared/` ficam para a fase 3.

## Regras de Clean Code adotadas

- Nomes descrevem a intenção no vocabulário de `CONTEXT.md` (ficha, modelo, narrador, campanha).
- Funções de rota só convertem o formato da requisição e chamam um caso de uso.
- Constantes nomeadas substituem números e listas de colunas repetidos (`SHEET_COLUMNS`, `MAX_VALUES_BYTES`).
- Uma única implementação para cada integração externa; cópias divergentes são removidas na etapa do contexto correspondente.
- Comentários explicam o motivo de uma regra, não o que a linha faz.

## Consequências

Testes de contrato com o PostgREST continuam possíveis, porque o Supabase falso grava método, caminho, parâmetros e corpo de cada chamada. Testes de caso de uso podem montar `SheetService` com repositórios em memória, sem FastAPI.

Durante a migração conviveram dois estilos: rotas antigas em `app/routes/` e rotas novas em `app/adapters/inbound/http/`. Uma rota só saiu de `app/routes/` quando todos os seus testes passaram a injetar adaptadores falsos. Ao fim da etapa 6 resta um estilo só.

Os modelos de `domain/models.py` também servem de corpo de requisição e resposta da API. Separar esses formatos do modelo de domínio fica para quando um contrato HTTP precisar divergir da regra.

## Critérios de verificação

A suíte completa do backend passa após cada etapa. Nenhum arquivo em `domain/` ou `application/` importa `fastapi`, `httpx`, `os.getenv` ou `app.adapters`, e nenhum arquivo em `domain/` importa `app.application`. Cada rota migrada recebe seus colaboradores por `Depends` e não por variáveis de módulo.
