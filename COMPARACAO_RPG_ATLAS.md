# Comparação do RPG-Atlas com o inventário do projeto de referência Atlas

Revisão de 15/10/2026. O documento fornecido descreve o RPG Atlas no snapshot `1206601`, datado de 14/10/2026. O código de referência foi conferido em `D:\rpg-atlas-reference`, commit `fb34a5bb6d4d1177c45f2cf64d63533fc8b21b5c`, que contém o snapshot citado em seu histórico. As alterações desta entrega estão em `D:\rpg-github`, repositório `Diogo0202/rpg`.

O inventário serve como requisito funcional. Seus comandos `pnpm`, contratos tRPC, Manus OAuth e tabelas Drizzle pertencem ao Atlas. O Nexus mantém Next.js, FastAPI e Supabase com acesso privado por campanha. A existência de um catálogo no Atlas não comprova integração no Nexus.

Os percentuais por funcionalidade estão em [STATUS_FUNCIONALIDADES.md](STATUS_FUNCIONALIDADES.md). Aqui, **parcial** significa código local com uma parte do escopo ainda ausente; **pendente** significa que não existe fluxo funcional correspondente. Nenhuma migration desta entrega foi aplicada ao banco de destino. Os fluxos que gravam dados aguardam teste autenticado com mestre e jogador.

## Comparação por seção do documento recebido

| Seção Atlas | Código Nexus conferido ou entregue | Diferenças restantes |
|---|---|---|
| 1. Visão geral | Painel privado da campanha, módulos de mesa e cofre local | Compartilhamento público e equivalência completa com Atlas pendentes |
| 2. Sistemas | Modelos iniciais V5, Caçador e O Um Anel; rolador e previsão V5; roladores iniciais dos outros sistemas | Jornada completa, estados e criação por regras pendentes; o rolador de O Um Anel ainda passa por revisão documental |
| 3. Rotas | Áreas dentro de `/app/campaign/[id]`, com seleção compartilhada de personagem | Sem reproduzir URLs Atlas, páginas públicas de compartilhamento ou mapa Shadowlords |
| 4. Painel e cofre | Seleção da ficha, cópias por conta, renomear, duplicar, excluir, buscar, ordenar, nível/tags, filtros nomeados, JSON e restauração | QR e payload comprimido pendentes; metadados e filtros ficam apenas no navegador, fora do backup JSON v1 |
| 5. Ficha V5 | 9 atributos, 27 habilidades, recursos, coleções, fórmulas, ações rápidas, combinação atributo + habilidade, trilhas de dano e efeitos | Wizard, benefícios automáticos de clã/predador, catálogo completo de poderes, rerrolagem efetiva de Vontade, retrato e PDF temático pendentes |
| 6. Caçador | Modelo com credo, impulso, célula, ambição e Desespero; backup Nexus; rolador com Desespero adicional opcional, dificuldade e dados separados | Arquétipos pessoais completos, consequências automáticas, células relacionais e PDF específico pendentes |
| 7. O Um Anel | Modelo com atributos, seis habilidades e recursos do recorte Atlas; rolador inicial d12/d6 com favorecimento e Cansado | Revisão completa das regras, Miserável, Sombra, eventos de jornada, catálogo/favoritos de ritos e PDF próprio pendentes |
| 8. Antagonistas | Entidades persistidas do mundo com criatura, sistema, ameaça, descrição e gancho; busca e relações | Busca semântica, vínculo especializado a sessões/células, visibilidade por entidade e uso automático em encontros pendentes |
| 9. Acervo | Busca textual de fontes autorizadas com página; compêndio fuzzy de quatro exemplos originais | Ingestão real, catálogo documental editável, fontes externas e NPCs privados de Veyr não foram importados |
| 10. Campanhas | Login Supabase por convite, campanhas e fichas com RLS e papéis por campanha | Interface de convites, capa, sistema/status da campanha e preferências recentes pendentes; Manus OAuth não foi portado |
| 11. Diário | CRUD de sessões, eventos e facções, filtros, cronologia, tensão e ruptura, exportação JSON/Markdown | PDF do diário, ligações especializadas com antagonistas e execução remota ainda pendentes |
| 12. Modo de Cena | Sessões de combate salvas, participantes, iniciativa, turnos, rodadas, pausa, eventos e JSON | Efeitos/recursos e rolador contextual ainda ficam nos painéis da ficha; sem automação completa por sistema nem Realtime do combate |
| 13. Shadowlords | Geração tática e marcadores não equivalem a mapa narrativo | Regiões, rotas, encontros, bênçãos, tensão do mapa e dados Shadowlords pendentes |
| 14. Arsenal | 65 registros Atlas com procedência, categorias, busca, era, tipo de dano, teto de Recursos, comparação de dois itens e aquisição na ficha | Favoritos persistidos, listas de compras separadas e públicas, totalizadores e arma ligada ao ataque pendentes |
| 15. Animais e veículos | Categorias próprias, perfil do animal no catálogo, aquisição no inventário; especificações preservadas em notas | Painel tipado de companheiro, vínculo especializado e PDF animal pendentes |
| 16. Compartilhamento | Arquivos JSON exportáveis para envio manual; impressão pelo navegador | Token de leitura, validade, payload comprimido, QR e visibilidade pública pendentes |
| 17. Exportações | JSON de ficha/cofre, inventário incluso; JSON/Markdown do diário; JSON da cena/mundo/mapa; PNG do mapa; ficha imprimível | PDFs temáticos, PDF de diário/animal, favoritos e dossiês específicos pendentes |
| 18. Narrador | Painel do grupo com assinatura Realtime, diário e tensão de facções | Favoritos de NPCs, preferências de alertas, som e montagem arrastável de dossiê pendentes |
| 19. Música | Playlists Spotify por link; cues de campanha/sessão com tipo, duração, brief, notas e áudio HTTPS opcional | OAuth/player Spotify, fila sincronizada e geração musical por provedor pendentes |
| 20. Mapas e mídia | Salvar geração tática, editar nome/grade, até 100 marcadores normalizados, CAS, exportar PNG/JSON | Upload de imagem, storage de mídia, geração OpenAI/Gemini, tamanho de grade e visão redigida para jogadores pendentes |
| 21. Backend | Supabase Auth/RLS, tabelas e migrations para fichas, inventário, diário, mapas, mundo, cenas e música; API FastAPI | Tabelas Atlas de favoritos, compras, células, compartilhamento, bênçãos e mapa narrativo não têm equivalência completa |
| 22. Interface | Navegação responsiva, estados vazios, mensagens e labels nos novos painéis | Temas especializados por sistema, revisão completa por teclado/leitor de tela e testes dos painéis privados em celular pendentes |
| 23. Qualidade | Suítes API e domínio frontend, TypeScript e build; scripts próprios Nexus | Suíte Vitest Atlas não foi executada nem contada como validação Nexus; falta E2E remoto e pgTAP executado |
| 24. Limites | Catálogo de referência separado de regra integrada; cofre local separado de banco | Sem ficha completa de Lobisomem/Mago; sem acervo oficial automaticamente publicado |
| 25. Resumo | Vários módulos foram incorporados com as diferenças acima | Não há equivalência total entre os produtos; o avanço considera cada entrega delimitada no checklist |

## Arquivos que sustentam as entregas

- **Modelos e ficha:** [system-starters.ts](frontend/lib/system-starters.ts), [sheet-builder.tsx](frontend/components/sheet-builder.tsx), [sheets.py](backend/app/routes/sheets.py) e [sheet_calculations.py](backend/app/services/sheet_calculations.py).
- **Rolagem e risco:** [v5_actions.py](backend/app/services/v5_actions.py), [v5.py](backend/app/routes/v5.py), [v5-action-panel.tsx](frontend/components/v5-action-panel.tsx) e [v5-probability-panel.tsx](frontend/components/v5-probability-panel.tsx). A previsão e a rolagem compartilham a aplicação de dano e efeitos. A estratégia preditiva de Vontade não executa a rerrolagem na ficha.
- **Backup:** [sheet-backup.ts](frontend/lib/sheet-backup.ts), [local-vault-panel.tsx](frontend/components/local-vault-panel.tsx) e [restore_character_backup](supabase/migrations/20261015100000_restore_character_backup.sql). O RPC cria outra ficha; não altera a original nem aprova modelos.
- **Inventário e arsenal:** [character-inventory-panel.tsx](frontend/components/character-inventory-panel.tsx), [atlas-equipment.json](frontend/data/atlas-equipment.json) e [migration](supabase/migrations/20261014151000_character_inventory.sql). Recursos representa uma classificação; a interface avisa sobre custo maior sem tratá-lo como dinheiro subtraído.
- **Experiência:** [experience-math.ts](frontend/lib/experience-math.ts) e [experience-panel.tsx](frontend/components/experience-panel.tsx). O histórico fica neste navegador e nesta conta/personagem. Não há gasto persistido de XP.
- **Diário:** [campaign-journal-panel.tsx](frontend/components/campaign-journal-panel.tsx) e [migration](supabase/migrations/20261014150000_campaign_journal.sql).
- **Mundo e mapas:** [world-library-panel.tsx](frontend/components/world-library-panel.tsx), [saved-maps-panel.tsx](frontend/components/saved-maps-panel.tsx), [generation-panel.tsx](frontend/components/generation-panel.tsx) e [controle de versão](supabase/migrations/20261014152000_world_map_versions.sql). Mapas completos permanecem exclusivos do narrador, inclusive seus marcadores de segredo.
- **Cena:** [scene-mode-panel.tsx](frontend/components/scene-mode-panel.tsx). A atualização entre sessões é manual; a assinatura Realtime existente pertence ao painel do grupo.
- **Música:** [music-cues-panel.tsx](frontend/components/music-cues-panel.tsx), [migration](supabase/migrations/20261015110000_campaign_music_cues.sql) e [spotify-playlist-panel.tsx](frontend/components/spotify-playlist-panel.tsx). O navegador carrega o áudio somente após interação.
- **Segunda Inquisição:** [API](backend/app/routes/second_inquisition.py), [painel](frontend/components/second-inquisition-panel.tsx) e [migration](supabase/migrations/20261015120000_second_inquisition.sql). O narrador confirma cada evento; a API reconstrói o alerta com os eventos salvos e limita a avaliação a 1000 registros, sem truncagem silenciosa.
- **Diagnóstico:** [API](backend/app/routes/chronicle.py), [painel](frontend/components/chronicle-diagnostic-panel.tsx) e [migration](supabase/migrations/20261015121000_chronicle_activity.sql). Lê fichas/modelos aprovados e atividade estruturada registrada pelo narrador. Conflitos exigem alvo e polaridade explícitos; texto livre não é interpretado como oposição. Amostra curta de uso de habilidades aparece como insuficiente.
- **Outros roladores:** [serviço](backend/app/services/system_rolls.py), [API](backend/app/routes/system_rolls.py), [painel](frontend/components/system-roll-panel.tsx) e [testes](backend/tests/test_system_rolls.py). Caçador segue o recorte de mecânicas básicas do [infográfico oficial da Paradox](https://www.paradoxinteractive.com/games/world-of-darkness/news/hunter-the-reckoning-basic-mechanics). O Um Anel segue como implementação parcial em revisão; a [errata da editora](https://freeleaguepublishing.com/wp-content/uploads/2023/09/TOR_Core_Rules_Errata_2204.pdf) confirma a Runa no resultado 12, sem validar sozinha as demais regras.

## Compatibilidade de arquivos e conteúdo

O cofre Nexus aceita `rpg-nexus-sheet` e `rpg-nexus-vault`, versão 1. O Atlas usa `rpg-atlas-character-v1` e `rpg-atlas-vault-v1`; esses arquivos **ainda não podem ser importados diretamente**. A comparação dos contratos encontrou diferenças que exigem adaptação explícita:

- V5 usa rótulos com acentos nas chaves Atlas; Nexus usa IDs estáveis. `Determinação` corresponde a `resolucao`.
- Caçador armazena trilhas atuais de Saúde/Vontade no Atlas, enquanto o modelo Nexus separa máximos e dano. A importação não pode adivinhar essa conversão.
- O Um Anel mapeia `strength/heart/wits` para `forca/coracao/espirito` e `endurance` para `vigor_marcha`. Magias favoritas e modificadores temporários têm contratos diferentes.
- Retratos em data URL, equipamentos vinculados por IDs e metadados de catálogo precisam ser preservados ou recusados com erro visível. Não há descarte silencioso implementado como migração.

O limite Nexus é de 1 MiB por ficha e 50 documentos por cofre, sujeito à quota menor do navegador. O JSON exportado omite usuário, campanha e permissões. Restaurar exige um modelo aprovado com os mesmos campos na campanha de destino; o banco grava ficha, efeitos e inventário na mesma transação.

Os 65 registros do arsenal são dados editoriais do Atlas, com origem indicada no arquivo. Descrições de poderes, livros, NPCs de Veyr e URLs privadas do acervo não foram copiados. O compêndio inicial continua com exemplos originais identificados.

## Pendências para equivalência funcional

1. Executar as migrations em banco de teste e conferir cada papel com duas campanhas. Exercitar conflito de versão, equipamento exclusivo e rollback da restauração.
2. Concluir os motores e interfaces próprios de Caçador/O Um Anel, bem como criação guiada com escolhas de regras revisadas.
3. Criar adaptador Atlas com relatório de incompatibilidades e testes de importação sem perda. Implementar retrato e exportações PDF específicas.
4. Entregar favoritos, listas de compras, companheiros estruturados e arma equipada no cálculo de ataque.
5. Construir mapas narrativos e células de Caçador com suas relações, preservando o isolamento da campanha.
6. Concluir biblioteca documental, PDF validado/quarentenado e recuperação semântica antes de respostas de IA com páginas.
7. Entregar as integrações Spotify/mídia e o fluxo de leitura compartilhada dentro das permissões definidas para o produto.

O clone Atlas permanece como referência. Esta revisão não registra commit, push, deploy, migração remota ou validação completa de autenticação e armazenamento.

## Validação desta entrega

Em 15/10/2026, passaram `npm run test:api` (124 testes), `npm run test:web` (15 testes), `npm run lint` e `npm run build`. O servidor em `http://127.0.0.1:3000` respondeu HTTP 200 na página inicial. Sem configuração Supabase, a rota `/app` exibe a tela de configuração, sem apresentar dados de campanha.

As migrations e os testes pgTAP não foram executados em banco local ou remoto. O controle de navegador não apresentou uma sessão disponível; os novos painéis privados não foram conferidos visualmente. O checklist contém 142 itens e média estimada de 52,1%, com peso igual por item; esse percentual não mede prontidão de produção.
