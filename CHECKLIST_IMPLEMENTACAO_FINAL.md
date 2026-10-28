# Checklist: status das implementações

Atualizado em 27/10/2026, depois de concluir as 10 frentes (A a J), as 7 pendências de código (P1 a P7), o alinhamento à v5.0 e a rodada de Vampiro V5, V3 e Caçador. Nada foi commitado, nenhuma migration foi aplicada no Supabase remoto e nenhuma tela nova foi aberta no navegador.

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
| Vampiro V5 (criação e jogo, web e mobile) | 75% | 85% | 85% | Código completo desde 27/10. Conferir no livro a tabela de Potência, Frenesi, Compulsões, Perdições, Ressonâncias, Vínculo e catálogos; aprovar o starter novo nas campanhas |
| Caçador (criação e jogo, web e mobile) | 75% | 85% | 85% | Código completo desde 27/10 (modelo v4). Conferir no livro Triunfos e Distinções, Overreach/Despair e pares de Convicção; aprovar o modelo v4 nas campanhas |
| Vampiro V3 (criação e jogo, web e mobile) | 75% | 90% | 85% | Código completo desde 27/10 (modelo v2); antes só a criação existia. Conferir no livro Trilhas, Qualidades e Defeitos, fraquezas, sangue por geração, Vitalidade e especialização; aprovar o modelo v2 nas campanhas |
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

## Vampiro V5, V3 e Caçador (rodada de 27/10)

Plano: frentes F1 a F5 no backend e na web, F6 no mobile. Migrations `20261029100000` a `20261029140100`.

- [x] F1, ciclo do Sangue V5: Rouse com rerrolagem pela Potência, Despertar, Remorso, Frenesi, Compulsões, Torpor; derivados da Potência; superficial físico pela metade; dano de ataque em Vontade; histórico remoto no painel de ações; metadados dos poderes
- [x] F2, ficha V5 e SAN: Convicções e Pedras de Toque, Princípios, Perdição com Severidade, Ressonância e Discrasia; caçada (SAN-01), Vínculo de Sangue (SAN-02), ações contra o Regente com decisão do narrador (SAN-03)
- [x] F3, V3 completo: Senhor, Refúgio, Fraqueza, Dementação e Malkaviano corrigido; Qualidades e Defeitos com teto de 7; 18 Trilhas; sangue por geração; rolador (dificuldade, 1 anula, falha crítica, especialização, Vontade); Vitalidade de 7 níveis; sangue, cura, Frenesi, Rötschreck e degeneração
- [x] F4, Caçador v4: Desesperação e Perigo na célula, ficha ligada à célula; rolador com Overreach ou Despair aplicados no banco; rerrolagem de Vontade; Redenção pelo Ímpeto; 14 Triunfos com Distinções; especializações, Vantagens e Defeitos, equipamento
- [x] F5, XP: compra de avanço atômica com custo recalculado no banco para V5, V3 e Caçador; histórico remoto; aprovação, recusa e estorno pelo narrador
- [x] F6, mobile: libs idênticas às da web (com teste byte a byte); formulário com as regras novas; telas de Mesa com rolador V3 e de Caçador, Sangue, caçada e vínculos V5, rolagem guardada e XP, com fila offline própria; XP só leitura no editor conectado

Limites conhecidos:

- [ ] Remendar e Surto de Sangue sem ação própria; excesso de Manchas (degeneração V5) não implementado
- [ ] V3: alimentação feita pelo narrador; Torpor e Morte Final ficam com a mesa; dano além dos 7 níveis é descartado
- [ ] Assistente web de Caçador não mostra a contagem de Triunfos antes de salvar (o servidor recusa com mensagem)
- [ ] Vínculo no mobile só aceita ficha como doador (sem NPC)
- [ ] Fila de ações de Mesa do mobile não aparece no resumo da tela Sincronização
- [ ] Pedidos de XP pendentes não reservam o XP
- [ ] Modelos já aprovados nas campanhas não recebem os campos novos (`torpor`, Perdição etc.) até o narrador aprovar a versão nova
- [ ] Decidir se a versão do starter V5 sobe, para não colidir com modelos aprovados
- [ ] Nenhuma tela nova foi aberta no navegador nem testada com backend real

## Pendências de código (rodada de 27/10)

- [x] Marketplace: revisão dos modelos copiados dentro da campanha, confirmação explícita e aprovação do snapshot pelo narrador, com retorno ao editor de fichas. Evidências e limites em [MARKETPLACE_MODELOS.md](docs/MARKETPLACE_MODELOS.md).

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

## Alinhamento à arquitetura v5.0 (28/10/2026)

Implementado (migrations `20261028110000` e `20261028120000`):

- [x] Rolador 2D no mobile com Framer Motion 14.6.0: resultado calculado antes da animação, toque para pular, `prefers-reduced-motion`, V5 com Fome, crítico, crítico sujo e falha bestial
- [x] Dados 3D (three + cannon-es, carregados sob demanda) para Shadow of the Demon Lord no site e no mobile; a animação 2D continua como alternativa sem WebGL
- [x] Voz no Discord pela API REST v10, sem bot: o narrador cria a sala, o convite chega pelo canal privado da campanha
- [x] `usage_count` assíncrono: eventos de uso somados em lote em segundo plano, sem `COUNT()` na leitura; ordenação por popularidade na API
- [x] "Reportar Copyright" em cada sistema do marketplace, com boa-fé obrigatória e limite de 10 denúncias por dia
- [x] Marketplace recusa anexos e PDF embutido
- [x] AdSense só inline e fixo no rodapé, com consentimento, nunca na área de jogo; desligado por padrão
- [x] Links de afiliado (Amazon, DriveThruRPG) na página inicial e na Biblioteca; desligados por padrão
- [x] Tutor de IA só com regras mecânicas, em tópicos, recusando lore no pedido e na resposta

Descartado por conflitar com a stack atual:

- Mobile em Next.js (o mobile continua em TanStack Start com Vite)
- Tailwind no site (o site continua com CSS modules)
- Celery e Redis (a reconciliação continua no FastAPI com RPC; tarefas leves usam BackgroundTasks)

Limites e configuração:

- [ ] Configurar `DISCORD_BOT_TOKEN` e `DISCORD_GUILD_ID` (bot com Manage Channels e Create Instant Invite)
- [ ] Ter `pg_cron` no banco ou agendar a manutenção externa; configurar `MARKETPLACE_MAINTENANCE_TOKEN`
- [ ] Configurar as variáveis `NEXT_PUBLIC_ADSENSE_*` e de afiliados; desligar Auto ads e vídeo no painel do AdSense (`docs/MONETIZACAO.md`)
- [ ] Decisão sua: em 23/10 a monetização tinha ficado desativada (`docs/NEXUS_LOCAL_FIRST_COMPARISON.md`); o código novo só liga com as variáveis
- [ ] Conferir o formato do link de afiliado da DriveThruRPG no site real
- [ ] Canais de voz criados no Discord não são apagados depois
- [ ] Sem seletor de popularidade na tela do marketplace
- [ ] Foco do teclado se perde ao pular a animação do rolador
- [ ] Ver o rolador num celular fraco e as telas novas no navegador

## Verificação local (28/10/2026, tudo junto)

| Comando | Resultado |
| --- | --- |
| `npm run test:api` | 782 aprovados |
| `npm run test:db` (pgTAP no PGlite) | 51 migrations, 42 arquivos, 885 asserções, nenhuma falha |
| `npm run test:web` | 183/183 |
| `npm run test:mobile` | 44 aprovados, 2 ignorados, nenhuma falha |
| `npm run test:mobile:ui` | 94/94 em 24 arquivos |
| `npm --prefix frontend run lint` e typecheck do mobile | sem erros |
| `npm run build` e `npm run build:mobile` | concluídos |

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
