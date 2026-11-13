# O Um Anel v3: criação, Companhia e validação

Registro de 28/10/2026. Implementação no checkout `D:\rpg-github`.

O perfil v3 entrega criação inicial na web e no aplicativo mobile. A validação local passou; a etapa hospedada permanece pendente. Este módulo ainda não recebe 100% de conclusão.

## Funcionalidades entregues no código

- [x] Modelo novo `one-ring`, versão 3 e `rules_profile_version: 3`, disponível para aprovação pelo narrador. O botão de salvar modelo cria outro registro. Os modelos aprovados v1/v2 permanecem na campanha.
- [x] Ficha de criação em uma página, com navegação por âncoras, campos acessíveis e revisão das pendências.
- [x] Seis culturas, seis Chamados, seis conjuntos culturais de atributos e escolha adicional dos Patrulheiros. A soma inicial dos Patrulheiros considera o ponto extra.
- [x] Concessões separadas por origem. A troca de cultura preserva aumentos comprados e mantém escolhas incompatíveis visíveis para correção.
- [x] Dez pontos de Experiência Anterior, com custos intermediários acumulados e saldo separado da experiência de jogo. A interface mantém visível o saldo que ainda não foi gasto durante o preenchimento.
- [x] Valor e Sabedoria iniciais em 1; Virtude, Maestria, Recompensa e alvo compatível.
- [x] Equipamento cultural, padrão de vida, Carga, proteção e inventário inicial. Efeitos condicionais aparecem como lembretes.
- [x] Nomes do material consultado na ficha nova. Os identificadores equivalentes continuam estáveis: Força corresponde a `corpo`, Resistência atual a `vigor_marcha` e Bloqueio a `aparar`.
- [x] Retrato opcional no perfil v3. A exigência anterior permanece nos perfis legados da API web.
- [x] Finalização por RPC e triggers na mesma transação. A gravação direta e a criação pela sincronização repetem a validação do catálogo e geram o inventário.
- [x] Uma Companhia por campanha, com elenco, patrono, refúgios e Focos dirigidos. A resposta contém uma projeção dos dados compartilhados, sem valores privados das fichas.
- [x] Gastos e reposições por comandos do narrador, identificador idempotente, versão esperada e histórico. O encerramento da mesma sessão não repõe a reserva repetidas vezes.
- [x] Máximo de Sociedade calculado pelo elenco e bônus do catálogo. Mudanças no máximo preservam os gastos da sessão.
- [x] Rascunhos, projeção da Companhia e fila em IndexedDB por conta e campanha; a fila também distingue aparelho.
- [x] Web e mobile compartilham o catálogo, o avaliador e o adaptador de comandos da Companhia. Particionamento, identificadores e tratamento de erros/prazo de tentativa foram extraídos do motor de sincronização existente para `shared/sync/core.ts`.
- [x] Resposta perdida conserva o identificador da operação. Conflitos exibem o pedido pendente e buscam o estado confirmado para comparação, antes de reaplicar ou descartar.
- [x] Acesso revogado remove a projeção carregada e bloqueia as operações pendentes. Sair da conta remove seus dados locais deste módulo.
- [x] Entrada web `/offline/one-ring`, preparada após um carregamento conectado. O service worker guarda o shell público e arquivos estáticos; as APIs e páginas privadas ficam fora do cache de navegação.
- [x] Avisos mínimos de Realtime, seguidos por nova consulta autenticada.

## Fonte e cálculos

O catálogo mecânico fica em `backend/app/data/one_ring_2e.json`. Os clientes importam esse mesmo arquivo; o banco guarda uma cópia versionada conferida pelos testes.

Referência: livro básico de O Um Anel, 2ª edição, tradução brasileira beta 2.1 fornecida na etapa de leitura. O catálogo registra o identificador da fonte e suas páginas. Culturas: 32, 34, 36, 38, 40 e 42; Chamados: 44 a 46; equipamento: 47 a 50 e 100; Recompensas: 79; Virtudes: 80. As descrições detalhadas prevalecem sobre o resumo divergente da página 51. Os materiais de outras edições não entram neste perfil.

Exemplo coberto pelos testes: Anão com o primeiro conjunto e Resiliência começa com Resistência 31. Machado e Camisa de Couro somam Carga 4 após a redução cultural da armadura. Os identificadores antigos ficam preservados, sem impor a esse herói o limite geral de três perícias favorecidas.

## Contratos e migrations

- `POST /api/v1/campaigns/{campaign_id}/sheets/validate-creation`: validade, problemas por campo, derivados e saldo de Experiência Anterior.
- `POST /api/v1/campaigns/{campaign_id}/sheets`: perfil v3 encaminhado à finalização transacional.
- `GET /api/v1/campaigns/{campaign_id}/one-ring/company`: projeção autorizada da Companhia.
- `POST /api/v1/campaigns/{campaign_id}/one-ring/company/commands`: `operation_id`, `expected_version`, `kind` e `payload` específico.
- `20261030100000_one_ring_creation_v3.sql`: catálogo, validação, inventário inicial e passagem do perfil v3 pela sincronização existente.
- `20261030110000_one_ring_company.sql`: Companhia, Focos, operações, recibos e avisos mínimos.

As migrations deste módulo são adicionais. O perfil v3 depende das migrations anteriores do projeto; copiar apenas esses dois arquivos para um banco antigo não instala suas dependências.

## Evidência local

| Verificação | Resultado |
| :--- | :--- |
| Backend completo | 1.681 testes aprovados |
| Domínio web | 284 testes aprovados |
| Sincronização e paridade mobile | 57 testes aprovados |
| Suíte Vitest mobile | 140 testes aprovados em 31 arquivos |
| Banco descartável completo | 1.160 asserções aprovadas em 52 arquivos |
| Paridade de regras e gravação de O Um Anel | 735 casos aprovados no PostgreSQL local em WASM |
| Navegador Chromium | 15 cenários aprovados, sem erro de página |
| Compilação web/mobile e verificação TypeScript | aprovadas |

A paridade cobre as 36 combinações de cultura e Chamado, todos os conjuntos de atributos, cada atributo adicional dos Patrulheiros, Virtudes e alvos permitidos das Recompensas. Inclui inventário, itens úteis e compras de experiência.

Os cenários de navegador abrem os componentes reais em 390 px e 1.440 px. Cobrem teclado, restauração de rascunho, separação de contas e reabertura sem rede. Dois contextos de navegador ensaiam aparelhos distintos com IndexedDB real, comandos concorrentes, perda da resposta, reaplicação explícita e revogação simulada no transporte. A autorização é testada separadamente com papéis distintos no PostgreSQL descartável. Isso ainda não equivale ao fluxo hospedado com JWTs reais.

O shell da rota Next.js de produção também foi aberto sem rede após o preparo do service worker, sem erro de página. O banco descartável recebeu a publicação `supabase_realtime` na fixture, conforme a infraestrutura fornecida pelo Supabase.

Comandos de reprodução:

```powershell
npm run test:web
npm run test:mobile
npm run test:mobile:ui
npm run test:db
npm run test:one-ring:db
npm run test:one-ring:ui
npm run build
npm run build:mobile
# Dentro de backend:
.\.venv\Scripts\python.exe -m pytest -q
```

## Etapa hospedada pendente

- [x] Consulta somente de leitura ao projeto Supabase `rpg` (`frrqaqvqomvdydddyjxd`).
- [ ] Reconciliar as dependências do destino: na consulta desta etapa havia 14 migrations registradas; o banco descartável carregou 62. A função `private.mobile_sync_apply_one(uuid,uuid,jsonb)` não estava presente no destino.
- [ ] Validar a sequência de migrations em staging hospedado, antes de aplicar a atualização do destino.
- [ ] Configurar os clientes e a API para esse ambiente de staging. Os arquivos locais de configuração examinados não indicavam um destino ativo.
- [ ] Executar o fluxo autenticado com narrador, jogador e conta de outra campanha. Nenhuma credencial ou conta foi criada para simular essa evidência.
- [ ] Confirmar Realtime hospedado, perda de conexão e revogação de permissão com JWTs reais.
- [ ] Conferir o fluxo em celular físico, além dos ensaios de 390 px no Chromium.

Nenhuma migration remota foi aplicada nesta etapa. O catálogo só fica ativo na campanha após a aprovação do narrador. Progressão completa, herdeiros e automação integral das fases de Aventura e Sociedade continuam fora deste escopo.
