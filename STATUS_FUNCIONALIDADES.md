# Funcionalidades do RPG Nexus

Atualizado em **15/10/2026**, com base no código de `D:\rpg-github`, na [comparação com o RPG Atlas](COMPARACAO_RPG_ATLAS.md) e nas verificações locais desta sessão.

**Nota de 17/10/2026:** o [patch de segurança](SEGURANCA.md) acrescenta limites de valores, autenticação e cotas da API por processo, sinais mínimos de Realtime e CSP na impressão. As suítes locais passaram, sem aplicação de migrations remotas. A criação guiada e suas evidências estão no [checklist da entrega](CHECKLIST_CRIACAO_GUIADA.md). Apenas GUI-01 foi reavaliado neste ciclo; os demais percentuais mantêm a avaliação anterior e não certificam operação em produção.

## Critério dos percentuais

- **100% | Implementada:** entrega delimitada presente e validada localmente. Esse percentual não comprova operação em produção.
- **75% | Em processo:** código e interface ou rota conectados; falta validar o fluxo real, aplicar a migration ou concluir uma parte da entrega.
- **50% | Em processo:** implementação parcial, como um motor isolado, um modelo inicial ou uma interface sem integração completa.
- **25% | Em processo:** estrutura de banco, configuração ou demonstração inicial; o fluxo funcional ainda precisa ser desenvolvido.
- **0% | Não implementada:** nenhum fluxo funcional encontrado no repositório.

Os percentuais são estimativas de conclusão do escopo descrito em cada item. Eles não medem horas trabalhadas, cobertura de testes ou prazo de entrega. “Em processo” significa parcialmente implementada, sem afirmar que há um agente trabalhando nela neste momento.

## Resumo

- **142 funcionalidades avaliadas.**
- **8 implementadas:** 5,6% dos itens.
- **97 em processo:** 68,3% dos itens.
- **37 não implementadas:** 26,1% dos itens.
- **52,6% de avanço médio neste checklist**, atribuindo o mesmo peso a cada item. Esse número depende desta divisão de funcionalidades e não mede o esforço necessário para lançar o produto.
- A contagem inclui os IDs com números, como `V5`, e as novas entregas do inventário Atlas. A divisão do escopo mudou; a média não deve ser comparada diretamente à versão anterior.

## Aplicação web e acesso em diferentes dispositivos

- **WEB-01 | 75% | Em processo:** interface responsiva para celular e computador. A página inicial foi conferida em tela larga e com largura de 390 px; os fluxos autenticados ainda precisam de teste em dispositivos reais.
- **WEB-02 | 75% | Em processo:** aplicação acessível pelo navegador, com Next.js e API FastAPI. A execução local funciona; falta publicar e validar o endereço final.
- **WEB-03 | 50% | Em processo:** base PWA com manifest, ícone e abertura em janela própria. Falta testar instalação e comportamento em Android, iOS e computador.
- **WEB-04 | 0% | Não implementada:** acesso offline às campanhas e fichas.
- **WEB-05 | 0% | Não implementada:** sincronização de alterações feitas offline e resolução de conflitos ao reconectar.
- **WEB-06 | 75% | Em processo:** dados compartilhados entre celular e computador pelo Supabase. Campanhas, fichas e playlists têm código de persistência; falta aplicar as migrations e testar duas sessões reais.

Evidências: [manifest](frontend/app/manifest.ts), [estilos responsivos](frontend/app/globals.css) e [painel da campanha](frontend/components/campaign-workbench.tsx).

## Contas, campanhas e permissões

- **CAM-01 | 75% | Em processo:** login por link enviado ao e-mail de uma conta já cadastrada. O formulário impede cadastro automático; falta validar envio e entrada no Supabase de destino.
- **CAM-02 | 75% | Em processo:** callback de autenticação e manutenção da sessão nas rotas privadas. Falta teste com conta real.
- **CAM-03 | 75% | Em processo:** saída da conta. A rota existe; falta conferir o fluxo autenticado completo.
- **CAM-04 | 75% | Em processo:** criação de campanha com nome e descrição, vinculada ao dono autenticado. Falta validar a gravação no banco de destino.
- **CAM-05 | 75% | Em processo:** listagem das campanhas acessíveis ao usuário. A consulta depende das políticas RLS ainda não aplicadas remotamente.
- **CAM-06 | 75% | Em processo:** página própria de cada campanha com validação do identificador e consulta autorizada.
- **CAM-07 | 75% | Em processo:** papéis de dono, mestre, jogador e convidado, com restrições previstas nas migrations e na interface. Falta testar cada papel contra o banco.
- **CAM-08 | 25% | Em processo:** inclusão e remoção de participantes por convite. Existem tabela e políticas de membros; falta a interface e o fluxo de convite.
- **CAM-09 | 25% | Em processo:** edição de dados e exclusão de campanha. O banco prevê operações do dono; falta a interface funcional.
- **CAM-10 | 25% | Em processo:** perfil do usuário. A tabela existe; falta a tela de edição.

Evidências: [criação de campanha](frontend/app/app/actions.ts), [login](frontend/components/login-form.tsx), [rota da campanha](frontend/app/app/campaign/[id]/page.tsx) e [migration base](supabase/migrations/20260930002251_rpg_core.sql).

## Fichas modulares e cálculos

- **FIC-01 | 75% | Em processo:** editor para criar campos e alterar identificador, rótulo, obrigatoriedade e tipo. Falta teste do fluxo completo com mestre autenticado.
- **FIC-02 | 75% | Em processo:** campos de texto, número, seleção, checkbox e coleção, com opções configuráveis.
- **FIC-03 | 100% | Implementada:** validação de templates no backend, com rejeição de campos e expressões inválidos. Há testes em `test_templates.py`.
- **FIC-04 | 75% | Em processo:** avaliação restrita de fórmulas, sem execução livre de código, incluindo dependências entre campos. Falta uma verificação dedicada dos resultados e dos casos de erro do cálculo.
- **FIC-05 | 75% | Em processo:** recálculo automático de valores derivados após alteração da ficha, com espera de 400 ms antes da consulta. Falta validar o uso real na interface autenticada.
- **FIC-06 | 100% | Implementada:** rolagem comum de dados no backend, com validação da expressão e retorno dos dados, modificador e total.
- **FIC-07 | 75% | Em processo:** campos de rolagem nas fichas e exibição do resultado na interface.
- **FIC-08 | 75% | Em processo:** salvamento de modelos aprovados por campanha, reservado ao mestre ou dono. Depende da migration e do teste remoto.
- **FIC-09 | 75% | Em processo:** seleção de modelos aprovados e criação de fichas vinculadas ao modelo da mesma campanha.
- **FIC-10 | 75% | Em processo:** criação, leitura e atualização de fichas persistidas. Interface e rotas existem; falta validar a gravação real.
- **FIC-11 | 75% | Em processo:** exclusão de ficha pela API, respeitando as políticas do banco. A ação ainda não aparece no editor.
- **FIC-12 | 75% | Em processo:** controle de acesso às fichas por dono e mestre, com convidado em leitura. Falta teste com identidades e papéis diferentes.
- **FIC-13 | 75% | Em processo:** controle de versão para evitar sobrescrever uma ficha alterada em outra sessão.
- **FIC-14 | 75% | Em processo:** proteção de modelos aprovados que já tenham fichas, exigindo nova versão para mudar o schema. O trigger ainda precisa ser executado e testado no banco.
- **FIC-15 | 75% | Em processo:** modelo V5 com 9 atributos e 27 habilidades, Fome, Humanidade, Manchas, campos dramáticos e coleções; calcula Saúde e Vontade máximas. Benefícios de criação e regras completas ainda faltam.
- **FIC-16 | 50% | Em processo:** modelos iniciais V5, Caçador e O Um Anel, editáveis e sujeitos à aprovação do mestre, com roladores específicos iniciais. As fichas completas e todas as regras de criação ainda não estão entregues.
- **FIC-17 | 75% | Em processo:** importar/exportar JSON Nexus com modelo, valores, efeitos e inventário; restauração cria ficha nova com modelo idêntico aprovado. Compatibilidade direta Atlas e formato universal pendentes.
- **FIC-18 | 0% | Não implementada:** histórico navegável de alterações e restauração de versões anteriores da ficha.

Evidências: [editor de fichas](frontend/components/sheet-builder.tsx), [cálculos](backend/app/services/sheet_calculations.py), [rotas de fichas](backend/app/routes/sheets.py), [migration de fichas](supabase/migrations/20261014100000_modular_character_sheets.sql) e [testes](backend/tests/test_sheets.py).

## Música e Spotify

- **MUS-01 | 75% | Em processo:** cadastro de links de playlists do Spotify na campanha, com validação do domínio e do identificador.
- **MUS-02 | 75% | Em processo:** listagem e abertura das playlists compartilhadas. Os links são gravados no Supabase; falta testar em duas contas ou dispositivos.
- **MUS-03 | 75% | Em processo:** inclusão e remoção de playlists pelo mestre ou dono, com leitura permitida aos membros. As políticas aguardam validação no banco.
- **MUS-04 | 0% | Não implementada:** conexão da conta Spotify pelo fluxo OAuth.
- **MUS-05 | 0% | Não implementada:** controle de reprodução pelo aplicativo, incluindo play, pausa, volume e seleção de dispositivo.
- **MUS-06 | 0% | Não implementada:** sincronização da música entre os participantes da mesa.
- **MUS-07 | 0% | Não implementada:** criação e edição de playlists pela API do Spotify, fila de faixas e trilhas associadas a cenas.

Evidências: [painel de playlists](frontend/components/spotify-playlist-panel.tsx) e [migration de playlists](supabase/migrations/20261014031622_campaign_playlist_links.sql).

## Probabilidade preditiva V5

- **V5-01 | 100% | Implementada:** motor de probabilidade exata conforme parada, Fome e dificuldade; testes com enumeração de faces para paradas pequenas e casos analíticos de rerrolagem aprovados. A interface e a API remota têm validação própria ainda pendente.
- **V5-02 | 100% | Implementada:** cálculo de crítico sujo e falha bestial com Dados de Fome, conferido por enumeração independente de faces e limites de entrada.
- **V5-03 | 75% | Em processo:** comparação com rerrolagem de até três dados comuns que falharam, preservando os Dados de Fome. A estratégia atual não cobre todas as escolhas possíveis de Vontade.
- **V5-04 | 75% | Em processo:** painel com percentuais e barras, atualizado após mudanças nos parâmetros, com espera de 250 ms antes da consulta.
- **V5-05 | 0% | Não implementada:** curva interativa completa para comparar várias paradas e dificuldades ao mesmo tempo.
- **V5-06 | 75% | Em processo:** Fome, efeitos e dano da ficha entram na previsão. O painel de ações combina atributo e habilidade; a previsão conserva parada manual e tags de contexto.
- **V5-07 | 75% | Em processo:** rolagem autenticada V5 com dados individuais comuns e de Fome, sucessos, crítico sujo e falha bestial; histórico transitório por personagem. Falta o fluxo de rerrolagem efetiva de Vontade e histórico remoto.

Evidências: [motor de probabilidade](backend/app/services/v5_probability.py), [testes por enumeração](backend/tests/test_v5_probability.py), [rota V5](backend/app/routes/v5.py) e [painel V5](frontend/components/v5-probability-panel.tsx).

## Mapas

- **MAP-01 | 75% | Em processo:** geração procedural de mapas táticos com salas, corredores e paredes, disponível por rota autenticada.
- **MAP-02 | 75% | Em processo:** repetição de mapas por seed e configuração de dimensões e quantidade de salas pela API. A interface ainda usa dimensões e quantidade fixas.
- **MAP-03 | 75% | Em processo:** prévia do mapa gerado, salvamento e edição de marcadores no painel Mapas. A demonstração PixiJS permanece separada.
- **MAP-04 | 50% | Em processo:** componente PixiJS isolado com grade, salas de demonstração e token arrastável. O painel Mapas opera documentos salvos com Canvas, sem integrar esse componente.
- **MAP-05 | 50% | Em processo:** componente isolado permite ocultar/revelar névoa geral; essa ação ainda não está ligada aos documentos salvos. Revelação por área ou jogador pendente.
- **MAP-06 | 75% | Em processo:** mapas e até 100 marcadores normalizados salvos por campanha, com nome, grade, cor e descrição, controle de versão e acesso do narrador. Falta testar a gravação e o isolamento no banco.
- **MAP-07 | 0% | Não implementada:** edição persistida de paredes, camadas, grupos e luz por célula.
- **MAP-08 | 0% | Não implementada:** visão individual do jogador e linha de visão com bloqueio por paredes.
- **MAP-09 | 0% | Não implementada:** sincronização ao vivo de tokens e alterações do mapa entre participantes.
- **MAP-10 | 50% | Em processo:** exportação PNG do terreno com marcadores e JSON do documento. Importação, WebP, PDF e UVTT pendentes.

Evidências: [gerador de mapas](backend/app/services/tactical_maps.py), [painel de geração](frontend/components/generation-panel.tsx) e [mapa PixiJS](frontend/components/tactical-map.tsx).

## Geração de NPCs, inimigos e itens

- **GER-01 | 75% | Em processo:** geração de NPCs com nome, resumo e detalhes originais, disponível no painel e na API.
- **GER-02 | 75% | Em processo:** geração de inimigos com descrição e dados genéricos para a cena.
- **GER-03 | 75% | Em processo:** geração de itens com descrição e características.
- **GER-04 | 75% | Em processo:** repetição do conteúdo gerado por seed e possibilidade de receber campos de sistema na API. A interface ainda não oferece editor desses campos.
- **GER-05 | 0% | Não implementada:** fichas de combate completas e validadas para cada sistema, com balanceamento por nível ou dificuldade.
- **GER-06 | 75% | Em processo:** salvar geração de mapas e conteúdo original na campanha e editar entidades no painel Mundo. Inserção automática no combate e teste remoto pendentes.

Evidências: [gerador de conteúdo](backend/app/services/content_generator.py), [rotas de geração](backend/app/routes/generators.py) e [painel](frontend/components/generation-panel.tsx).

## Segunda Inquisição

- **SI-01 | 75% | Em processo:** motor conectado à campanha por API autenticada, com eventos de disciplina em público, violação da Máscara e vestígio digital confirmados pelo narrador. Falta validar o banco de destino.
- **SI-02 | 50% | Em processo:** pesos e limiares configuráveis para calcular pontuação e nível de alerta.
- **SI-03 | 50% | Em processo:** geração de respostas de contenção, monitoramento de comunicações e bloqueio financeiro, com estatísticas genéricas. Falta validar as fichas completas de combate V5.
- **SI-04 | 75% | Em processo:** painel exclusivo do narrador para registrar, consultar e retirar confirmações da SI, com pontuação, nível, respostas e JSON. Falta teste autenticado remoto.
- **SI-05 | 75% | Em processo:** eventos imutáveis com autor e data de confirmação carimbados pelo banco; API reconstrói o estado de todos os eventos e recusa exceder 1000. Falta aplicar e testar a migration.
- **SI-06 | 0% | Não implementada:** aplicação automática das respostas geradas ao combate ou às entidades da campanha.

Evidências: [motor da SI](backend/app/services/second_inquisition.py), [API](backend/app/routes/second_inquisition.py), [painel](frontend/components/second-inquisition-panel.tsx), [migration](supabase/migrations/20261015120000_second_inquisition.sql) e [testes da API](backend/tests/test_second_inquisition_api.py).

## Diagnóstico dramático da crônica

- **DRA-01 | 75% | Em processo:** painel identifica Apoiadores estruturados sem ameaça recente, com evidências da atividade registrada. A ausência de histórico é explicitada, sem afirmar que nada ocorreu na narrativa.
- **DRA-02 | 75% | Em processo:** conflitos entre Ambições e Desejos com alvo e polaridades estruturados pelo narrador. Texto livre da ficha não é interpretado automaticamente; falta teste remoto.
- **DRA-03 | 75% | Em processo:** atributos e habilidades reconhecidos do modelo são comparados ao histórico; o relatório exige amostra mínima e informa insuficiência de dados.
- **DRA-04 | 75% | Em processo:** relatório conectado com referências de atividade, metas e complicações, com testes de API e motor. Falta fluxo autenticado remoto.
- **DRA-05 | 75% | Em processo:** API lê fichas/modelos aprovados e atividade estruturada da campanha; o narrador registra a atividade. Captura automática de todas as rolagens e eventos da sessão ainda pendente.
- **DRA-06 | 75% | Em processo:** painel privado do narrador com relatório e registro de uso de atributos, metas e complicações, além de ameaças a Apoiadores. Limites de 20 fichas e 500 atividades explícitos; migration ainda não aplicada.

Evidências: [motor](backend/app/services/chronicle_gaps.py), [API](backend/app/routes/chronicle.py), [painel](frontend/components/chronicle-diagnostic-panel.tsx), [migration](supabase/migrations/20261015121000_chronicle_activity.sql) e [testes da API](backend/tests/test_chronicle_api.py).

## Biblioteca, PDFs e assistente de regras

- **RAG-01 | 25% | Em processo:** biblioteca privada com fontes, concessões de acesso por campanha e confirmação de direitos. O schema existe; falta o fluxo de cadastro na interface.
- **RAG-02 | 25% | Em processo:** fila de extração e rascunho para revisão. O endpoint atual devolve um template genérico; ainda não lê nem extrai o conteúdo de um PDF.
- **RAG-03 | 75% | Em processo:** busca textual autenticada em fontes autorizadas, concedidas à campanha e associadas a modelo aprovado.
- **RAG-04 | 75% | Em processo:** resultado com título da fonte, trecho e número da página. Falta validar a indexação e a consulta com documentos reais.
- **RAG-05 | 75% | Em processo:** consulta de página pela API, com controle de acesso à campanha e limite de conteúdo. Falta a ação de abrir a página na interface.
- **RAG-06 | 25% | Em processo:** estrutura vetorial com coluna de embeddings no banco. A geração dos vetores e a busca semântica ainda não existem.
- **RAG-07 | 0% | Não implementada:** assistente conectado a uma LLM leve para responder perguntas de regras e lore com referências verificáveis.
- **RAG-08 | 0% | Não implementada:** envio de PDF com validação de extensão, MIME e conteúdo, quarentena e inspeção de arquivos.
- **RAG-09 | 0% | Não implementada:** leitura de PDF, OCR e divisão do conteúdo em trechos com páginas rastreáveis.
- **RAG-10 | 0% | Não implementada:** conector do Google Drive para importar material autorizado.
- **RAG-11 | 0% | Não implementada:** acervo V5 autorizado, indexado e validado para responder com a página correta do livro.

Evidências: [rotas de regras](backend/app/routes/rules.py), [painel de busca](frontend/components/rules-search-panel.tsx), [migration de busca](supabase/migrations/20261014120000_campaign_rule_search.sql) e [rascunho de extração](backend/app/services/extraction.py).

## Mundo, combate e colaboração

- **MES-01 | 75% | Em processo:** CRUD conectado de entidades e relações do mundo, com filtros, edição por versão e exportação. Falta teste remoto com papéis diferentes.
- **MES-02 | 75% | Em processo:** diário conectado com sessões, eventos, facções, filtros e exportações JSON/Markdown. Falta validar a gravação no banco.
- **MES-03 | 75% | Em processo:** modo de cena conectado a combate persistido, participantes, iniciativa, rodada, turno, pausa e eventos. Falta validar a gravação; atualização entre clientes é manual.
- **MES-04 | 0% | Não implementada:** consequências ligadas automaticamente a NPCs, itens, missões e locais do mundo.
- **MES-05 | 0% | Não implementada:** presença ao vivo, chat e pings entre participantes.
- **MES-06 | 0% | Não implementada:** sincronização do combate entre dispositivos e participantes.
- **MES-07 | 0% | Não implementada:** conectores Roll20 e Foundry.
- **MES-08 | 0% | Não implementada:** galeria pública moderada para conteúdo autorizado.

Evidências: [painel da campanha](frontend/components/campaign-workbench.tsx) e [schema do banco](supabase/migrations/20260930002251_rpg_core.sql).

## Painel do narrador em tempo real

- **GRU-01 | 75% | Em processo:** painel exclusivo de dono ou mestre com cards das fichas da campanha e filtro de personagens ativos na sessão. Falta testar com contas e dados reais.
- **GRU-02 | 75% | Em processo:** Fome com alerta a partir de 4, Vontade disponível, Humanidade e Manchas. Campos ausentes ou inválidos são identificados na interface.
- **GRU-03 | 75% | Em processo:** assinatura Supabase Realtime para recarregar fichas alteradas, indicador de conexão e atualização manual. A migration da publicação ainda precisa ser aplicada e testada.

Evidências: [painel do grupo](frontend/components/party-status-panel.tsx) e [migration Realtime](supabase/migrations/20261014140000_party_realtime.sql).

## Condições e modificadores

- **MOD-01 | 100% | Implementada:** motor de soma de bônus e penalidades por tags, com exceções e rejeição de IDs repetidos, valores fora dos limites e campos extras. Há testes de cálculo e de endpoints.
- **MOD-02 | 75% | Em processo:** cadastro, ativação, desativação e remoção de condições na ficha selecionada, com origem da regra. O banco ainda precisa receber a migration de efeitos.
- **MOD-03 | 100% | Implementada:** cálculo considera apenas os efeitos habilitados, dentro do escopo da ação e com duração válida; o retorno explica cada aplicação ou descarte.
- **MOD-04 | 75% | Em processo:** comando de encerrar cena reduz a duração dos efeitos ativos e ignora os que chegam a zero. Falta validar a persistência em duas sessões reais.
- **MOD-05 | 75% | Em processo:** estado de personagem compartilhado com Zustand por campanha, ligado ao rolador, aos campos de rolagem da ficha e à previsão V5.
- **MOD-06 | 75% | Em processo:** explicação dos bônus e penalidades na interface, com limites recalculados no servidor antes da rolagem.
- **MOD-07 | 75% | Em processo:** trilhas visuais de dano superficial/agravado com ajustes persistidos e penalidades automáticas no contexto físico ou mental. Rolagem e previsão compartilham o cálculo. Conversão automática do excesso de dano e teste remoto pendentes.

Evidências: [motor de modificadores](backend/app/services/modifiers.py), [rotas](backend/app/routes/modifiers.py), [painel](frontend/components/character-effects-panel.tsx), [estado da sessão](frontend/lib/character-session.tsx) e [migration de efeitos](supabase/migrations/20261014141000_character_effects.sql).

## Compêndio por tags

- **COM-01 | 75% | Em processo:** busca fuzzy com Fuse.js sobre nomes, descrições e tags. Falta validar o uso com o volume de conteúdo autorizado da campanha.
- **COM-02 | 75% | Em processo:** filtros por tipo, nível e tag manual de preservação da Máscara. Essa tag depende do cadastro do verbete, sem inferência automática sobre regras oficiais.
- **COM-03 | 75% | Em processo:** modal com custo, parada, duração e origem do verbete, aberto pelo compêndio ou pelo botão de Disciplina ou Vantagem na ficha.
- **COM-04 | 75% | Em processo:** inclusão de verbetes nas coleções de Disciplinas e Vantagens da ficha. O acervo inicial tem quatro exemplos originais de homebrew.
- **COM-05 | 0% | Não implementada:** catálogo oficial V5 autorizado, com revisão do narrador e conteúdo segregado por campanha.

Evidências: [compêndio](frontend/components/compendium-panel.tsx), [índice de busca](frontend/lib/compendium.ts) e [exemplos originais](frontend/data/compendium-homebrew.json).

## Criação guiada e rastreadores de sangue

- **GUI-01 | 75% | Em processo:** assistente por etapas para modelos aprovados, validação por campo, identidade em destaque, nome único, fórmulas, revisão e criação autenticada com seleção na sessão. Testes locais e Chromium em 390/1440 px passaram com serviços simulados. Regras completas dos sistemas, persistência real e execução da migração de compatibilidade ainda pendentes.
- **GUI-02 | 0% | Não implementada:** efeitos encadeados das escolhas de criação, como Tipo de Predador alterando especializações, Disciplinas, Vantagens e Defeitos.
- **SAN-01 | 50% | Em processo:** Ressonância pode ser cadastrada como efeito, com bônus, tags de Disciplinas, origem e duração em cenas definidos pela mesa. O cadastro específico de caçadas e intensidades ainda não existe.
- **SAN-02 | 0% | Não implementada:** registro de ingestões por doador e data, cálculo do grau e evolução do Vínculo de Sangue.
- **SAN-03 | 0% | Não implementada:** tratamento de ações contra o Regente, com verificação da regra e decisão autorizada do narrador.

## Cofre, portabilidade e apresentação da ficha

- **COF-01 | 75% | Em processo:** cópias locais por conta, busca por nome/modelo, ordenação, renomeação, duplicação e exclusão independente da ficha remota. Falta testar a interface autenticada no navegador.
- **COF-02 | 100% | Implementada:** validação de backup Nexus, rejeição de campos extras, chaves perigosas, tipos incompatíveis e equipamento inválido; testes de domínio aprovados. Limite de 1 MiB por ficha e 50 documentos por cofre.
- **COF-03 | 75% | Em processo:** cópia da ficha remota inclui efeitos e inventário; RPC restaura nova ficha atomicamente com modelo aprovado idêntico. Migration e rollback ainda precisam de teste PostgreSQL.
- **COF-04 | 50% | Em processo:** página de impressão com escaping dos valores, efeitos e inventário; salvar PDF depende da impressão do navegador. Não há temas PDF por sistema nem recálculo dos campos derivados nessa página.
- **COF-05 | 0% | Não implementada:** adaptador direto de JSON e cofre Atlas para Nexus com preservação e relatório de incompatibilidades.
- **COF-06 | 75% | Em processo:** nível opcional, conceito e tags locais, filtros por nível/tag, busca e ordenação por criação/atualização/nome/sistema; até 20 filtros nomeados por conta. Validação tem testes. Metadados não entram no backup JSON v1; falta teste da interface autenticada.
- **COF-07 | 0% | Não implementada:** edição e recorte de retrato, zoom e variantes de resolução.
- **COF-08 | 0% | Não implementada:** compartilhamento por token de leitura, validade, JSON comprimido e QR code.

Evidências: [validador](frontend/lib/sheet-backup.ts), [cofre](frontend/components/local-vault-panel.tsx), [RPC](supabase/migrations/20261015100000_restore_character_backup.sql) e [testes de domínio](frontend/tests/domain.test.mjs).

## Inventário, arsenal e experiência

- **INV-01 | 75% | Em processo:** inventário relacional por ficha, CRUD, busca, categoria, quantidade e ordenação manual. Não há arrastar para reordenar; falta teste remoto.
- **INV-02 | 75% | Em processo:** aquisição pendente/concluída e aviso de custo maior que Recursos. Sem dedução monetária automática ou lista de compras independente.
- **INV-03 | 75% | Em processo:** RPC de equipamento exclusivo, arma ou armadura adquirida, com versão e restrições no banco. Falta testar concorrência no PostgreSQL.
- **INV-04 | 75% | Em processo:** catálogo de 65 registros Atlas com busca, categoria, era, Recursos e tipo de dano; comparação de até dois itens e preparação de aquisição.
- **INV-05 | 50% | Em processo:** animais, montarias e veículos disponíveis no catálogo/inventário; perfil animal consultável e preservado em notas. Sem painel tipado do companheiro ou PDF próprio.
- **INV-06 | 0% | Não implementada:** arma equipada ligada ao cálculo de ataque, dano automático e aplicação da proteção no combate.
- **INV-07 | 0% | Não implementada:** favoritos persistidos, listas de compras com totalizadores e compartilhamento com o narrador.
- **EXP-01 | 100% | Implementada:** cálculo de custo acumulado por graduação de atributo, habilidade, disciplina, disciplina fora do clã e Potência de Sangue, com validação e testes.
- **EXP-02 | 50% | Em processo:** histórico local de até 200 estimativas por conta/personagem. Não debita XP nem muda os valores da ficha; falta histórico remoto e progressão validada.

Evidências: [inventário](frontend/components/character-inventory-panel.tsx), [catálogo](frontend/data/atlas-equipment.json), [migration](supabase/migrations/20261014151000_character_inventory.sql) e [experiência](frontend/components/experience-panel.tsx).

## Sessões, facções e extensões Atlas

- **ATL-01 | 75% | Em processo:** sessões com sequência, título, data, resumo e estado; eventos ligados a sessão/facção e exibidos cronologicamente.
- **ATL-02 | 75% | Em processo:** facções com objetivo, relógio configurável, tensão e consequência de ruptura. Falta teste autenticado e preferências de alerta.
- **ATL-03 | 75% | Em processo:** cues musicais por sessão, tipo de cena, duração, brief, notas, URL HTTPS e player sem autoplay. Falta executar a migration e conferir o fluxo real.
- **ATL-04 | 0% | Não implementada:** células de Caçador com membros, antagonistas e vínculos persistidos.
- **ATL-05 | 75% | Em processo:** rolador autenticado de Caçador com parada base, dificuldade, Desespero adicional opcional e dados separados; informa necessidade de decisão sobre Overreach/Despair. Sem gasto de recursos, controle completo da célula ou aplicação automática de consequências.
- **ATL-06 | 50% | Em processo:** rolador autenticado inicial de O Um Anel com d12/d6, escolha favorecida/desfavorecida e Cansado por Vigor/Carga. Referência completa de regras ainda em revisão; Miserável, Sombra e eventos de jornada pendentes.
- **ATL-07 | 0% | Não implementada:** mapas narrativos Shadowlords com regiões, rotas, encontros e bênçãos.
- **ATL-08 | 0% | Não implementada:** favoritos de NPCs, edição pessoal, exportação e dossiê do narrador com seções ordenáveis.
- **ATL-09 | 0% | Não implementada:** catálogo de ritos de O Um Anel com favoritos e referências autorizadas.
- **ATL-10 | 0% | Não implementada:** envio de imagens para storage e geração de mapas/imagens por provedor externo com procedência e prompt preservados.

Evidências: [diário](frontend/components/campaign-journal-panel.tsx), [música](frontend/components/music-cues-panel.tsx), [roladores](frontend/components/system-roll-panel.tsx), [motores](backend/app/services/system_rolls.py) e [comparação completa](COMPARACAO_RPG_ATLAS.md).

## Verificação e entrega

- **124 testes da API aprovados**, incluindo rolagens específicas, autenticação de rotas, diagnóstico, SI e probabilidade por enumeração. **15 testes de domínio do frontend aprovados**, incluindo backup, metadados, filtros, modelos iniciais e XP. TypeScript e build Next.js aprovados em 15/10/2026. Testes locais não comprovam execução das migrations ou integrações externas.
- Os testes pgTAP estão escritos, mas não foram executados em PostgreSQL ou Supabase nesta sessão.
- As migrations não foram aplicadas ao Supabase de destino; persistência, Auth, Storage e isolamento remoto seguem sem validação de ponta a ponta.
- Há workflow de CI no repositório. A execução no GitHub ainda não foi comprovada.
- Há Dockerfile da interface e Compose para esse serviço; falta a configuração completa de operação com API e banco.
- O servidor local foi iniciado em `http://127.0.0.1:3000` e a página inicial respondeu HTTP 200. `/app` mostra a tela de configuração porque o Supabase não está configurado neste ambiente. Não houve inspeção visual dos novos painéis autenticados; o controle de navegador não expôs uma sessão disponível.
- Teste de ponta a ponta com mestre e jogador em campanhas diferentes ainda não foi executado.
- Este levantamento descreve o estado local do código. Não registra commit, push ou deploy.

## Próximos passos para concluir os fluxos

1. Aplicar as migrations em um ambiente de teste e verificar acesso com mestre, jogador e convidado em campanhas diferentes.
2. Validar o caminho completo de login, criação de campanha, modelo aprovado, ficha salva e playlists compartilhadas em dois dispositivos.
3. Conectar os motores da SI e do diagnóstico dramático aos registros autorizados da campanha.
4. Conferir no banco o salvamento de mapas, inventário e conteúdo gerado, a restauração de backup e os turnos de cena.
5. Preparar o envio e a leitura segura de PDFs autorizados, antes da busca semântica e das respostas por IA.
6. Concluir as fichas de cada sistema e o controle de música conforme o escopo aprovado para as integrações.
