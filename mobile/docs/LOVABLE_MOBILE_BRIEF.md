# RPG-Atlas Mobile: entrega no Lovable

Criar uma PWA em português, com o nome RPG-Atlas Mobile, baseada no contrato aprovado em MOBILE_SYNC_CONTRACT.md. A interface compartilha a API FastAPI e o Supabase Auth do Nexus. A configuração remota ainda será informada; a primeira prévia oferece modo local claramente identificado, sem anunciar conexão ou sincronização que não ocorreu.

## Experiência

A navegação inferior tem Mesa, Fichas, Dados, Mundo e Mais. O conteúdo respeita áreas seguras do celular, botões de pelo menos 44px e telas de 360px. Em computador, a mesma navegação pode virar uma coluna lateral. A identidade segue o Nexus: verde escuro, superfícies de pergaminho e detalhes dourados, tipografia legível, contraste e foco visível. Evitar uma landing page como tela principal; a prévia abre o aplicativo funcional.

Mesa mostra a campanha selecionada, sessão atual, personagens e atalhos. Um indicador persistente apresenta local/offline, pendências ou conflitos; tocar nele abre a lista de operações e opções de recuperação. A configuração informa se o backend foi conectado. Dado demonstrativo deve aparecer como demonstrativo, sem simular uma sessão autenticada.

Fichas oferece assistente guiado e editor. Reaproveitar os modelos do arquivo system-starters.ts e os contratos de sheet-template.ts/sheet-creation.ts. As identidades vêm das opções declaradas: Clã e Predador no V5, Credo no Caçador, Linhagem em O Um Anel, Raça/Origem quando o modelo trouxer esses campos. Campos sem classificação ficam em Outros. Nome é único entre registro e campo canônico. Dependências entre campos recalculam opções; dados incompatíveis exigem revisão. Cálculos são somente leitura. Nenhuma rolagem aleatória acontece ao salvar.

Criação completa salva o personagem localmente e o seleciona na sessão. A fila guarda a operação até o servidor confirmar. Edições pendentes sobrevivem ao fechamento. O editor inclui recursos e inventário com adição/edição de itens. Em conflito, mostrar base confirmada e edição local; escolher gera nova operação, sem apagar a pendência silenciosamente.

Dados oferece rolagem local explícita, histórico e modificadores. Rolagens locais não recebem selo de validação do servidor. Prévia V5 remota depende da API; sem conexão, não exibir percentuais inventados. O rolador simples pode resolver NdM com limites e crypto.getRandomValues, sem eval/Function. Fórmulas usam parser aritmético limitado, não JavaScript.

Mundo inclui entidades editáveis de NPCs/locais e mapas com grid, zoom e marcadores. Guardar objetos por ID estável, sem depender de posição em arrays. Mais reúne Diário, Música, Biblioteca, Assistente e Configurações. Diário permite criar sessão e escrever/resgatar notas offline. Links de Spotify são URLs validadas; não anunciar OAuth ou controle de reprodução se essas integrações não estiverem conectadas. A interface de IA mostra seu estado real de configuração.

## Núcleo compartilhado

Copiar os módulos anexados de mobile-sync para src/lib/mobile-sync, preservando sua lógica e contratos. A interface deve chamar IndexedDbSyncStore/SyncEngine; não criar uma fila paralela baseada em localStorage. A base confirmada e a projeção otimista são separadas. Um cursor de push não avança o cursor de pull.

Ao conectar: usar URL da API, URL pública Supabase e chave publicável vindas do ambiente/configuração. A senha e os tokens não entram na outbox, backup ou logs. O token é obtido do SDK Supabase para cada chamada. O endpoint autenticado capabilities fornece role e campos graváveis; o servidor continua responsável por RLS e regras por registro. `service_role` nunca entra no cliente. Sem configuração, manter recursos locais e indicar a conexão pendente.

No modo local, dados de demonstração podem ser semeados na base IndexedDB da conta de demonstração. A fila não deve ser confirmada por transporte simulado fingindo servidor real. A tela de sincronização informa que essas operações são locais. Ao configurar conta real, abrir outra partição e pedir importação explícita; não enviar automaticamente dados de demonstração a uma campanha.

Importar/exportar fichas pelo módulo sheet-backup.ts, mantendo formato rpg-nexus-sheet, format_version 1 e validações. Ações de backup não importam campanha, proprietário ou permissão. Falhas de arquivo deixam o personagem atual intacto.

## PWA e privacidade

Adicionar manifest com ícones próprios, display standalone e service worker. Cachear apenas o shell e assets da aplicação, com fallback de navegação para o shell. Dados privados permanecem no IndexedDB da conta. Não cachear respostas autenticadas da API, tokens ou endpoints de autenticação. Limpar o cache da conta no logout, preservando a decisão explícita de exportar rascunhos pendentes antes de sair.

Não renderizar conteúdo importado como HTML nem executar instruções contidas em notas, livros ou resultados de IA. As regras oficiais completas dependem de fontes autorizadas; os modelos-base são parciais. Ferramentas remotas respeitam o limite de dez chamadas simultâneas imposto pela API, com Retry-After em 429.

## Verificação

Testar criação de ficha dos três modelos, nome consistente, fórmulas atualizadas, JSON de exportação/importação e rejeição de arquivo inválido. Fechar e reabrir a prévia para conferir IndexedDB. Conferir fila, conflitos e status de conexão real. Em 390x844 e 1440x1000, não deve haver rolagem horizontal ou controles inacessíveis. O app deve abrir sem rede depois do primeiro carregamento e o service worker não pode guardar dados privados vindos da API.

Não publicar em produção nem criar outro banco nesta etapa. Entregar link de prévia, arquivos e resultados dos testes; manter pendências de backend real explícitas no checklist.

