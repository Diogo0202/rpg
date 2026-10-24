# RPG-Atlas Mobile

Plano aprovado: PWA Lovable ligada à API compartilhada, com edição local e sincronização autenticada.

- [x] Confirmar o escopo offline com o usuário.
- [x] Registrar o protocolo v1 em `docs/MOBILE_SYNC_CONTRACT.md`.
- [x] Implementar estruturas SQL, revisões e recebimento idempotente. Em 21/10, `test:db` executou 23 migrations e 263 assertions pgTAP locais em PGlite; 50 cobrem a migration `20261018200000_mobile_sync.sql`.
- [x] Implementar rotas autenticadas de snapshot, mudanças e envio. Evidência anterior: 27 testes da API/adaptador.
- [x] Implementar IndexedDB, projeção local e fila persistente. Suíte do núcleo repetida em 21/10: 21 testes, incluindo IndexedDB e `fetch` nativo no Chromium.
- [x] Ligar no código local o SDK Supabase e o transporte para a API. Fixture local no navegador aceitou login de teste, carregou campanha e modelo aprovados, criou ficha com Vida 6 e Vigor 3 e item dependente; resultado observado: 2 aceitas, 0 pendentes.
- [x] Verificar o fluxo local do transporte até API e PGlite com Auth/Storage de teste. Sete verificações repetidas em 21/10, incluindo replay, conflito, transferência de dono e revogação. Isso não acessa Supabase hospedado.
- [x] Criar fichas pelo assistente com os modelos aprovados da campanha. Modelo personalizado de teste carregado do banco, nome e Vigor preenchidos, Vida calculada em 6 para Vigor 3.
- [x] Exportar e importar backup v1 com inventário. Arquivo baixado no navegador e reimportado na mesma campanha; nova ficha e novo item sincronizados, duas operações aceitas e fila vazia. Efeitos de ficha no backup conectado são recusados com orientação para o cofre web.
- [x] Adaptar entidades, mapas e marcadores ao contrato remoto. Marcadores conectados exigem uma entidade e respeitam a dimensão do documento em células; quatro testes do painel passaram.
- [x] Corrigir atualização do contexto React e confirmação acessível de saída. Testes cobrem contexto compartilhado, cancelamento, Escape, retorno do foco e chamada única de saída.
- [x] Corrigir o shell offline entre builds e recarregar Mesa, Fichas e Nova ficha no navegador com o servidor local desligado. O teste de revisão confirma que o novo service worker aponta para o shell atual e não inclui páginas privadas.
- [x] Exibir probabilidades V5 locais antes da rolagem, com dificuldade e comparação de Vontade. Quatro casos numéricos coincidem com o cálculo do backend; o painel foi conferido no navegador em largura de telefone. Condições da ficha ainda exigem a API do servidor.
- [x] Preparar a previsão V5 vinculada à ficha conectada. A nova rota lê Fome, efeitos e dano da ficha por consulta com JWT e RLS, sem aceitar esses campos no corpo enviado pelo navegador. O mobile permite selecionar a ficha e mostra o cálculo do servidor separado do cálculo local. A execução com Supabase hospedado ainda não foi confirmada.
- [x] Acrescentar tema escuro opcional nas configurações, salvo no aparelho. A escolha permaneceu após recarga na prévia local; 63 testes mobile, typecheck e build local passaram.
- [ ] Atualizar a prévia do Lovable para incluir as mudanças locais. O workspace ficou sem créditos; a prévia ainda está atrás desta cópia.
- [ ] Fechar as ferramentas do narrador e os perfis completos de regras. O material autorizado continua necessário para as regras específicas; música, Segunda Inquisição e diagnóstico dramático ainda não têm sincronização mobile.
- [ ] Aplicar migrations no Supabase de staging e testar RLS com contas reais distintas.
- [ ] Confirmar instalação em telefone e abertura completa sem rede.

## Evidências em 20/10/2026

A fonte local do app veio do commit `dce7685898f1a1fca310b4b899dbc81881c311a5`. O checkout local tem mudanças posteriores e não corresponde à prévia atual do Lovable. Os créditos do workspace acabaram antes de uma nova publicação ou prévia.

Em 20/10, passaram 48 testes da interface em 14 arquivos, o typecheck, 21 testes do núcleo e sete verificações de integração. As contagens de 27 testes da API/adaptador e 50 assertions SQL são evidências anteriores, não foram repetidas nesta rodada. A fixture de navegador é local: usa Auth de teste, API FastAPI e PGlite local. Ela demonstra o percurso de login, leitura de campanha/modelo, envio e reimportação de ficha com inventário. Não valida contas ou banco hospedados.

O build padrão e o build local com Node.js passaram em 20/10. `npm run build:local` e `npm run preview:local` permitem servir a compilação em `http://127.0.0.1:4174`; o destino padrão do Lovable permanece separado. O lint completo ainda aponta diferenças de formatação no código gerado e avisos de Fast Refresh; os dois erros de código encontrados foram corrigidos. Os checks direcionados passaram.

O navegador reabriu as telas Mais e Nova ficha com o servidor da origem desligado, sem rolagem horizontal em 390 px. A repetição após um novo build revelou cache de HTML SSR antigo, com referências a assets removidos. Em 21/10, o build passou a copiar o shell atual antes de gerar o service worker; 52 testes mobile e o typecheck passaram. Após desligar o servidor local, a aba recarregou Mesa, Fichas e Nova ficha com os dados locais. Isso ainda não comprova instalação ou abertura offline em telefone. Um diálogo nativo na aba descartável de autenticação bloqueou interações posteriores; a confirmação de saída agora usa um diálogo dentro do app, validado em teste de componente.

O sync local cobre campanhas, modelos em revisão, fichas, inventário, entidades e relações de mundo, mapas e marcadores, sessões, facções, eventos e cenas de combate. Música, Segunda Inquisição e dados dramáticos ficam fora da lista atual. Perfis de regras não suportados são recusados. O bloco de ferramentas do narrador segue pendente.

Em 21/10, `npm.cmd run build` passou com o destino padrão do Lovable. A saída `.output/public` contém `_shell.html` e `sw.js`; o service worker referencia o shell e não inclui rotas de API ou autenticação no precache. `npm.cmd run test:db` passou com 23 migrations e 263 assertions pgTAP, `npm.cmd run test:mobile` com 21 testes e `npm.cmd run test:mobile:integration` com sete verificações. Esses resultados são locais; staging hospedado e instalação em telefone continuam pendentes.

O painel Dados agora estima atingir a dificuldade, crítico sujo e falha bestial antes da rolagem. A comparação de Vontade rerrola até três dados comuns que falharam. O cálculo segue o serviço Python para paradas de 0 a 30 dados e Fome de 0 a 5, sem efeitos de ficha no modo local. Após essa mudança, 58 testes mobile, typecheck e build local passaram.

A integração de ficha acrescentou `POST /api/v1/v5/sheets/{sheet_id}/probabilities`. O servidor carrega a ficha permitida para o JWT e calcula modificadores e trilhas de dano. O painel consulta novamente quando a versão sincronizada muda e identifica a rolagem local sem condições da ficha. Nesta rodada, 62 testes mobile, 275 testes da API, typecheck, lint direcionado e build local passaram. Os testes de interface usam Auth/API simulados; falta executar a rota com contas reais em staging.

Referências: `docs/MOBILE_SYNC_CONTRACT.md`, `docs/MOBILE_LOVABLE_PROJECT.md`, `docs/MOBILE_STAGING_RUNBOOK.md` e `mobile/README.md`.
