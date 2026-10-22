# Assistência de IA para a campanha

Implementação em 19/10/2026. A integração fica desativada por padrão e não substitui o wizard manual nem o gerador procedural.

## Fluxos

- **Ficha:** o jogador escolhe um modelo aprovado, descreve o conceito e os campos que quer desenvolver. A proposta pode criar uma ficha ou atualizar uma ficha própria. O narrador revisa os valores em controles de formulário e compara os valores anteriores antes de aprovar. Fórmulas e rolagens não entram nas sugestões editáveis.
- **Sessão:** o narrador pede uma preparação nova ou seleciona uma sessão existente. A resposta contém resumo, cenas, pistas, conflitos e consequências. A aprovação guarda a preparação em área privada.
- **NPC:** o narrador cria um conceito ou expande um NPC existente. Motivações, voz, vínculos e segredos ficam privados após a aprovação. Publicar a descrição não altera as estatísticas de combate existentes.
- **Publicação:** o narrador marca os campos que deseja compartilhar. Segredos não fazem parte da lista publicável. Um destino novo exige nome ou título público explícito. Vínculos só entram no mundo quando o narrador seleciona sua publicação, e seus destinos precisam pertencer à mesma campanha.

Jogadores acompanham apenas seus pedidos e não recebem o resultado privado, mesmo quando o pedido é deles. O resultado aprovado de ficha passa pelas permissões normais de leitura da ficha. Pedidos e preparações de outra campanha não podem ser acessados por um gestor de fora.

## Contexto e aprovação

O seletor mostra sessões, eventos, entidades e fichas acessíveis ao narrador, com até 100 registros por categoria. Até 12 registros podem ser escolhidos por pedido. A prévia contém o conteúdo exato desses registros; o servidor reconsulta os dados e compara seu hash antes da geração. Se o registro mudou, responde 409 e exige nova prévia. Um destino existente de sessão ou NPC precisa estar incluído na seleção.

O pedido escrito, o modelo aprovado da ficha e o destino explicitamente escolhido também compõem a entrada. Nenhuma busca automática de livros, consulta à internet ou ferramenta de execução fica disponível ao modelo. Texto de campanha permanece separado das instruções de sistema. Isso limita a autoridade da saída; não representa uma garantia geral contra prompt injection.

Respostas passam por schemas e validação local. Aprovar uma ficha também exige todos os campos obrigatórios, opções dependentes válidas e cálculo no servidor. Uma sugestão parcial pode permanecer como rascunho enquanto o narrador preenche as lacunas. Não há alegação de conformidade com regras oficiais ausentes do modelo.

A aprovação ocorre em RPC autenticada, com bloqueio da proposta e conferência de versão. Gravar o destino e marcar a proposta como aprovada pertencem à mesma transação. Repetir a aprovação retorna o destino existente. Alterações concorrentes na ficha, no NPC ou na sessão provocam conflito e preservam a versão mais recente. Refinamentos têm identidade própria para evitar uma segunda geração quando o cliente repete a mesma operação.

O modelo aprovado da ficha também fica registrado na proposta. A transação bloqueia esse modelo durante a aprovação e recusa mudanças no schema ou na versão desde a geração. Os refinamentos recebem as edições feitas pelo narrador, preservando seu trabalho na próxima sugestão.

## Configuração privada

| Variável do backend | Padrão ou condição |
| --- | --- |
| `AI_ENABLED` | `false`; só habilitar após validar a configuração de destino |
| `OPENAI_API_KEY` | Segredo do servidor, fora do Git e do navegador |
| `AI_MODEL` | `gpt-5.4-mini-2026-03-17`; outros modelos são recusados nesta versão |
| `AI_INPUT_USD_PER_MILLION` | `0.75`; valores menores são recusados |
| `AI_OUTPUT_USD_PER_MILLION` | `4.50`; valores menores são recusados |
| `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` | Autenticação e consultas com JWT do solicitante |
| `SUPABASE_SERVICE_ROLE_KEY` | Persistência privada e coordenador de orçamento, somente no backend |

O cliente usa somente `NEXT_PUBLIC_API_URL` e sua sessão Supabase. Não recebe chaves do provedor nem do coordenador. A criação de chave pelo fluxo seguro não foi concluída porque a gravação local foi recusada; nenhum segredo foi criado ou escrito por esta entrega.

O adaptador chama a [Responses API](https://developers.openai.com/api/reference/responses/overview), com saída estruturada, `store:false`, esforço de raciocínio `none` e sem ferramentas. O [modelo escolhido](https://developers.openai.com/api/docs/models/gpt-5.4-mini) publica os preços usados como piso desta configuração. Preços e acesso da conta precisam ser conferidos antes da ativação. `store:false` não é uma promessa de retenção zero pelo provedor.

## Gastos e falhas

O coordenador PostgreSQL serializa a admissão por uma linha de orçamento compartilhada. O teto é 30.000.000 micro-USD por mês de calendário em `America/Sao_Paulo`, equivalente a US$ 30. O limite cobre chamadas feitas por este aplicativo, não despesas feitas com a mesma conta em outros serviços.

Antes de chamar o provedor, reserva o custo máximo conservador para a janela de entrada do modelo e 4.096 tokens de saída. Com os preços padrão, essa reserva é US$ 0,318432. O consumo informado pelo provedor acerta a reserva; desconto de cache não é presumido. Uma falha com cobrança incerta mantém a reserva. Não há repetição automática de chamadas pagas.

O consumo conhecido também é acertado quando a resposta falha na validação local, por exemplo, ao propor um vínculo fora do contexto selecionado. Uma falha de gravação após o acerto não repete a liquidação nem marca essa operação como incerta. O identificador financeiro deriva da proposta e da chave da operação; repetir a mesma chave de cliente em outra campanha não bloqueia seu orçamento.

Há no máximo duas gerações simultâneas no projeto, uma por campanha e duas gerações por UID em 60 segundos. Cada refinamento conta como nova geração. Os leases de concorrência duram 120 segundos, mas o timeout da chamada é de 40 segundos. Expirar o lease não devolve dinheiro reservado. Falhas antes do despacho podem devolver a reserva; resultados com consumo conhecido são acertados mesmo quando a resposta é recusada ou inválida.

Ao consultar os pedidos, o servidor recupera operações vencidas: pedidos em geração ficam com status de falha, sem apagar o conteúdo. Reservas sem despacho podem ser devolvidas; chamadas já despachadas mantêm o custo reservado quando o consumo permanece incerto. Um lease vencido não autoriza um novo despacho.

O corpo completo enviado ao provedor tem limite de 64 KiB. Respostas têm limite de leitura de 128 KiB e saída configurada de 4.096 tokens. Faltando chave, preços ou coordenador, a API recusa a geração. Logs registram tipo da tarefa, tokens e resultado operacional, sem corpo narrativo ou credenciais.

## Rotas e banco

Todas as rotas usam o prefixo `/api/v1/campaigns/{campaign_id}/ai` e sessão autenticada:

| Método e sufixo | Uso |
| --- | --- |
| GET `config` | Estado da integração |
| GET `context`, POST `context/preview` | Seleção e prévia, somente gestores |
| GET/POST `proposals` | Acompanhar ou solicitar propostas |
| GET `proposals/{id}` | Detalhes; resultado e contexto completos somente para gestores |
| POST `proposals/{id}/refine` | Refinar com nova operação e versão esperada |
| POST `proposals/{id}/approve` ou `reject` | Decisão do narrador |
| GET `preparations` | Preparações privadas dos gestores |
| POST `preparations/{id}/publish` | Publicar campos selecionados |

A migration `20261019090000_ai_assistance.sql` cria os pedidos, conteúdos privados, preparações e o ledger de gastos. Clientes não têm grants de escrita direta nessas tabelas. As RPCs financeiras são exclusivas do servidor; as RPCs de aprovação e publicação conferem o narrador autenticado.

## Verificação

Os testes Python usam provedor e transporte simulados, sem chamadas pagas. Os testes SQL executam migrations e cenários de autorização, publicação e orçamento em PostgreSQL local via PGlite, com fixtures de Auth/Storage. Isso não comprova a configuração do Supabase remoto.

O teste de navegador em `scripts/test-ai-ui.cjs` compila os componentes reais e intercepta todo tráfego da API. Ele depende de Playwright já instalado, disponível como módulo ou pelo caminho em `RPG_PLAYWRIGHT_MODULE`. Confere larguras de 1440 e 390 px, prévia de contexto, aprovação, publicação sem segredos, formulário preservado após falha, repetição idempotente e estado desativado. Sessão e API são fictícias nesse teste.

Validação local em 19/10/2026:

| Comando | Resultado |
| --- | --- |
| `.venv/Scripts/python.exe -m pytest -q` (na pasta backend, com `AI_ENABLED=false`) | 273 testes passaram |
| `npm --prefix frontend run test:domain` | 50 testes passaram |
| `node scripts/test-db.mjs` | 22 migrations aplicadas no banco descartável; 247 verificações passaram, sendo 90 específicas de IA |
| `npm --prefix frontend run lint` | TypeScript sem erros |
| `npm --prefix frontend run build` | Build concluído |
| `node scripts/test-ai-ui.cjs` | Fluxos em 1440 e 390 px passaram, sem erros de navegador ou largura excedente |

O build ainda aponta avisos de múltiplos lockfiles e `metadataBase`; esses avisos não impediram a compilação. Os totais incluem testes de outras partes do repositório e não representam testes exclusivos da assistência por IA.

Revisão de 21/10/2026: a suíte completa do backend passou com 279 testes e IA desativada. Foram acrescentados quatro cenários de regressão para consumo conhecido após validação inválida de ficha ou relação de NPC, falha de persistência após liquidação e chave de cliente repetida em campanhas distintas. Os cenários de falha de validação também conferem que repetir o pedido não gera outra chamada. Provedor e banco desses testes são simulados; não houve chamadas pagas ou alterações no banco remoto. O frontend não mudou nesta revisão.

Validação para publicação em 22/10/2026: 277 testes do backend passaram em uma cópia isolada de `HEAD` com apenas as correções financeiras, seus testes e esta documentação. Esse total exclui o trabalho paralelo ainda não incluído no commit. A IA permaneceu desativada.

Execute os comandos de teste da raiz e o build. Para ativar no destino, ainda é necessário aplicar as migrations revisadas em um projeto de teste, conferir sessões reais com papéis diferentes e configurar os segredos pelo fluxo seguro. Esta entrega não faz deploy, chamadas pagas nem migrations remotas.
