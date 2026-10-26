# Checklist: status das implementações

Atualizado em 27/10/2026, depois de concluir as 10 frentes (A a J) e as 7 pendências de código (P1 a P7). Nada foi commitado, nenhuma migration foi aplicada no Supabase remoto e nenhuma tela nova foi aberta no navegador.

## Critério dos percentuais

- **100%:** entregue e validado no ambiente real.
- **90%:** código completo e testado localmente; falta só validar no ambiente real (Supabase de destino, contas, aparelhos).
- **85%:** código completo e testado localmente, mas regras ou conteúdo ainda precisam ser conferidos no livro ou cadastrados.
- **75%:** código conectado; muitos números ainda não conferidos, além da validação real.

## Status por funcionalidade

| Funcionalidade | 25/10 | 26/10 | Agora | O que falta |
| --- | ---: | ---: | ---: | --- |
| Site responsivo | 75% | 75% | 75% | Conferir em aparelhos reais e abrir as telas novas no navegador |
| App mobile, modo offline e sincronização | 75% | 75% | 90% | Testar instalação e sincronização no destino |
| Contas, campanhas e permissões | 75% | 90% | 90% | Configurar e testar o envio real de e-mail; ensaiar os papéis com contas reais; confirmar a regra de mestres |
| Fichas modulares e cálculos | 75% | 90% | 90% | Validar persistência e histórico no destino |
| Criação guiada de Vampiro V5 | 75% | 85% | 85% | Conferir no livro o catálogo de Vantagens e Defeitos e as regras de geração; ativar modelos por campanha |
| Criação guiada de Caçador | 75% | 85% | 85% | Conferir no livro o número de pares de Convicção e Pedra de Toque; aprovar o modelo v3 nas campanhas |
| Criação guiada de Vampiro V3 | 75% | 90% | 90% | Conferir o fluxo com modelo aprovado no banco remoto |
| Ficha de O Um Anel | 50% | 75% | 75% | Conferir no livro todos os números (`docs/UM_ANEL_FICHA.md`); aprovar o modelo v2 |
| Probabilidades e rolagens V5 | 75% | 85% | 90% | Validar o fluxo autenticado |
| Condições e modificadores | 75% | 90% | 90% | Conferir efeitos e dano persistidos entre sessões reais |
| Painel do narrador | 75% | 90% | 90% | Testar tempo real, presença e chat com participantes distintos |
| Segunda Inquisição e diagnóstico dramático | 75% | 85% | 90% | Validar registros remotos |
| Geração e edição de mapas | 75% | 90% | 90% | Testar imagens, permissões, névoa e visão do jogador no destino |
| Geradores de NPCs, inimigos e itens | 75% | 90% | 90% | Conferir no livro os números dos blocos de combate; validar no destino |
| Diário, mundo e combate | 75% | 85% | 90% | Testar sincronização, chat e dano no alvo com contas reais |
| Inventário e equipamentos | 75% | 90% | 90% | Testar concorrência real no PostgreSQL de destino |
| Compêndio com busca e filtros | 75% | 85% | 85% | Cadastrar o acervo autorizado e validar com conteúdo real |
| Marketplace de modelos | 75% | 85% | 90% | Cadastrar um administrador em `marketplace_admins`; validar publicação, cópia e moderação com contas reais |

## Pendências de código (rodada de 27/10)

- [x] P1: painel de ações V5 com rolagem guardada, rerrolagem de Vontade e ataque recalculado após a rerrolagem
- [x] P2: telas de Caçador, O Um Anel, SotDL, V5 e rolador por soma enviam o contexto da crônica, com indicador "registrado na crônica"
- [x] P1: narrador aplica o dano do ataque na ficha do alvo, com armadura e sem repetição
- [x] P3: interface de moderação direta do marketplace (denúncias, sistemas, histórico), só para administradores
- [x] P4: envio de e-mail do convite por SMTP ou Resend, até 5 envios com 5 min de intervalo
- [x] P5: tipo de dano das armas na sincronização mobile, no backup e no cofre local
- [x] P5: formulário mobile de Caçador v3 com limites, pares e listas fechadas
- [x] P6: V5 com coerência entre clã e geração, especializações gratuitas e catálogo fechado de Vantagens e Defeitos
- [x] P7: chat da campanha com mensagens públicas, privadas e sussurros, ao vivo

## Limites conhecidos (não bloqueiam)

- [ ] Rolagens com parada manual (rolador por soma e parada manual V5) não entram na crônica, porque não indicam os traços usados
- [ ] Rolagens dos campos da ficha usam `/api/v1/dice/roll`, que não aceita o contexto da crônica
- [ ] Dano de ataque sempre vai para Saúde; não há opção de Vontade
- [ ] Histórico do painel de ações mostra só a sessão do navegador, embora as rolagens fiquem salvas
- [ ] Chat sem tela de edição de mensagem (o banco permite)
- [ ] Ficha para impressão não mostra o tipo de dano das armas
- [ ] Uma falha do provedor de e-mail também conta no limite de 5 envios
- [ ] A consulta antiga `marketplace_list_reports` continua existindo e devolve quem denunciou; nada no app a usa
- [ ] Modelos V5 já aprovados no banco não recebem as regras novas; vale para o starter novo ou modelo atualizado

## Conferência de regras no livro

- [ ] O Um Anel: bases por cultura, TN, soma de atributos, perícias favorecidas, eventos de jornada, teste de Sombra (`docs/UM_ANEL_FICHA.md`)
- [ ] Caçador: quantidade de pares de Convicção e Pedra de Toque
- [ ] V5: nomes e custos do catálogo de Vantagens e Defeitos (tradução própria); Sangue-Ralo com Sanguessuga; gerações iniciais 10ª a 13ª; Méritos e Defeitos de Sangue-Ralo na conta de 7 e 2
- [ ] Blocos de combate gerados (marcados "conferir no livro")
- [ ] Tipos de Predador marcados para conferir no suplemento

## Decisão sua

- [ ] Confirmar a regra nova: só o dono promove, rebaixa ou remove mestres

## Ambiente real

- [ ] Aplicar as 17 migrations novas (`20261026100000` a `20261027160000`) no Supabase de destino, junto com a API (a `20261027140000` é obrigatória para o inventário do mobile)
- [ ] Configurar `INVITE_EMAIL_PROVIDER`, `INVITE_EMAIL_FROM`, `APP_BASE_URL` e as credenciais SMTP ou Resend no backend
- [ ] Cadastrar ao menos um administrador em `marketplace_admins`
- [ ] Abrir as telas novas no navegador com sessão autenticada
- [ ] Ensaiar dono, mestre, jogador e outra campanha com contas reais
- [ ] Testar tempo real, presença, chat e combate com participantes distintos
- [ ] Aprovar os modelos Caçador v3, O Um Anel v2 e o starter V5 atualizado nas campanhas
- [ ] Instalar o app mobile e testar a sincronização
- [ ] Conferir o site em aparelhos reais

## Verificação local (27/10/2026, tudo junto)

| Comando | Resultado |
| --- | --- |
| `npm run test:api` | 721 aprovados |
| `npm run test:db` (pgTAP no PGlite) | 49 migrations, 40 arquivos, 835 asserções, nenhuma falha |
| `npm run test:web` | 169/169 |
| `npm run test:mobile` | 44 aprovados, 2 ignorados, nenhuma falha |
| `npm run test:mobile:ui` | 77/77 em 22 arquivos |
| `npm --prefix frontend run lint` | sem erros |
| `npm run build` | concluído |

## Entregas das frentes (25 e 26/10)

- **A, contas:** convites por e-mail ou código, aceite, troca de papel, remoção; edição e exclusão da campanha; perfil em `/app/perfil`.
- **B, fichas:** excluir no editor; histórico das últimas 50 versões com restauração; testes das fórmulas.
- **C, V5:** rerrolagem de Vontade com estratégia ótima; curva comparativa; rolagem guardada com dados gerados no banco e rerrolagem única com gasto de Vontade.
- **D, tempo real:** combate sincronizado com controle de versão; presença; diário ligado a entidades do mundo.
- **E, inventário:** arma e armadura no combate; excesso de dano superficial vira agravado; favoritos e listas de compras.
- **F, geradores:** blocos de combate para 5 sistemas e 4 dificuldades; inserção no combate; respostas da SI aplicadas; rolagens registradas na crônica pelo servidor.
- **G, mapas:** geração configurável; névoa por jogador; linha de visão; importação JSON e exportação PNG e Universal VTT.
- **H, compêndio e marketplace:** verbetes por campanha com revisão do narrador; 4 defeitos do marketplace corrigidos.
- **I, criação V5 e V3:** efeitos encadeados do Tipo de Predador; Potência por geração; pontos de Vantagens e Defeitos; fluxo V3 testado.
- **J, Caçador e O Um Anel:** traços estruturados de Caçador v3; células; ficha de O Um Anel v2; Miserável, Sombra e eventos de jornada.
