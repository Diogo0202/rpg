# Revisão dos quatro pontos de segurança

Revisão de código em 17/10/2026. As alterações abaixo estão no checkout local e ainda precisam de execução em ambiente isolado. Este documento não certifica a configuração remota do Supabase nem substitui uma auditoria completa.

## A. Fichas e cofre local

O importador local já valida os backups. A restauração cria uma nova ficha e exige um modelo aprovado, com os mesmos campos, na campanha de destino. Ela não sobrescreve uma ficha existente. O RLS permite ao jogador editar sua própria ficha, conforme as regras de participação da campanha.

Foi confirmada uma diferença entre os limites do importador e a validação de gravação. A nova validação em `backend/app/services/sheet_values.py`, chamada pelas rotas de fichas, e o trigger em `20261017090000_sheet_value_limits.sql` passam a impor:

- Objeto de até 200 campos e 32 KiB de JSON serializado. PostgreSQL e Python serializam JSON de formas diferentes; uma entrada próxima do teto pode ser recusada em uma das camadas.
- Texto de até 10.000 caracteres e números finitos entre -1.000.000 e 1.000.000. Booleanos não contam como números.
- Coleções de até 200 textos, cada um com no máximo 500 caracteres.
- Campos obrigatórios preenchidos, opções do modelo respeitadas e valores de fórmula ou rolagem ausentes ou nulos.

O trigger também cobre gravações diretas via PostgREST e a restauração por RPC. Ele mantém os controles existentes de versão e autorização. Dados já gravados não são corrigidos automaticamente.

Esses controles validam a estrutura. Eles não comprovam que um jogador gastou Fome ou Vontade conforme a sessão. Um modo que reserve essas mudanças ao narrador exige regras de autorização próprias ou um histórico de ações aceitas pelo servidor. Um HMAC com segredo no navegador não comprova essa origem.

## B. Realtime da mesa

A implementação anterior usava `postgres_changes`, com leitura de fichas restrita pelo RLS ao dono participante ou ao gestor. A inspeção não confirmou leitura geral das fichas por todos os jogadores. Eventos DELETE têm restrições próprias, descritas na [documentação do Supabase](https://supabase.com/docs/guides/realtime/postgres-changes).

A migration `20261017091000_sheet_realtime_notifications.sql` retira `character_sheets` da publicação e adiciona `character_sheet_notifications`. Os sinais contêm somente `campaign_id`, `owner_id`, `revision` e `updated_at`. A tabela tem RLS de leitura e não permite escrita pelo cliente.

Os painéis escutam INSERT e UPDATE desses sinais e buscam as fichas novamente com o JWT do usuário. A remoção de uma ficha incrementa o sinal persistente de seu dono. Nenhum campo da ficha entra no sinal. A publicação precisa existir para haver entrega em tempo real; a migration não cria o serviço Realtime.

Se a publicação incluir todas as tabelas ou todo o schema, a migration deve interromper a aplicação em vez de prometer a retirada isolada de uma tabela. Essa configuração exige ajuste administrativo antes da migração. A interface e a migration devem ser lançadas juntas; o botão de atualização manual continua disponível.

## C. Autenticação e limites da API

O middleware `backend/app/security.py` protege `/api/v1` e suas subrotas. O token Bearer é conferido pelo Supabase Auth, sem aceitar um UID enviado pelo cliente como identidade. `/health` continua público. O CORS permanece externo ao middleware, inclusive para respostas de erro.

A extração em `POST /api/v1/extractions/draft` exige somente a credencial separada `EXTRACTION_WORKER_TOKEN`, que deve ficar no worker. O JWT de um jogador não concede esse acesso. Demais rotas não aceitam essa credencial como substituto da sessão.

| Categoria | Por IP, a cada 60 segundos | Por UID, a cada 60 segundos |
| --- | ---: | ---: |
| Geração de mapas ou conteúdo | 20 | 8 |
| Extração pelo worker | 10 | Não se aplica |
| Probabilidades, cálculos, rolagens e demais rotas | 180 por categoria | 120 por categoria |

O IP é verificado antes da consulta ao Auth; o UID, após a identidade ser validada. A resposta 429 inclui `Retry-After`. O middleware limita o corpo a 1 MiB, rejeita cabeçalhos de autenticação duplicados e mantém no máximo 20.000 contadores em memória. Ao atingir essa capacidade, recusa novas chaves até haver expiração, sem descartar cotas ativas.

Os contadores são por processo e reiniciam com ele. Vários workers ou réplicas exigem armazenamento compartilhado para cotas globais. Configure o servidor para confiar apenas nos proxies conhecidos; o middleware não lê `X-Forwarded-For` diretamente. Os geradores atuais são locais e a extração ainda é um rascunho, sem chamada paga de IA. Cotas financeiras por campanha e limites do provedor devem acompanhar uma futura integração paga.

## D. Notas e impressão

Diário, biblioteca e compêndio exibem textos por JSX, sem convertê-los em HTML. Não foi confirmado XSS armazenado nesses componentes. Essa distinção segue a [documentação do React sobre HTML direto](https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html).

O HTML de impressão já escapava os textos. O helper `frontend/lib/printable-sheet.ts` preserva esse escape e acrescenta CSP com scripts, formulários e frames bloqueados. A validação de áudio em `frontend/lib/audio-url.ts` agora também é aplicada às URLs lidas do banco antes de criar o elemento de reprodução. Só aceita HTTPS sem credenciais, com até 2.048 caracteres.

Não foi adicionada uma biblioteca de sanitização onde o aplicativo não interpreta HTML. Se houver um editor de HTML ou Markdown com HTML habilitado no futuro, ele precisará de sanitização na saída apropriada.

## Verificação pendente

Foram escritos testes Python para limites e autenticação, testes de regressão de conteúdo no frontend e fixtures pgTAP para validação de valores e isolamento dos sinais Realtime. Os testes existentes de rotas foram adaptados sem abrir exceções de autenticação no aplicativo de produção.

Testes, build e migrations não foram executados nesta revisão. A skill local `security-audit` exige sandbox do sistema operacional sem rede externa, ambiente por lista permitida, fonte somente para leitura e limites de recursos. O ambiente atual não fornece esse conjunto de controles. As verificações locais de 15/10/2026 não validam este patch.

Para validar a entrega, execute as suítes em um runner isolado com dependências já instaladas e credenciais fictícias. Aplique as migrations em PostgreSQL/Supabase descartável, execute os arquivos `supabase/tests/rpg_sheet_value_limits.test.sql` e `supabase/tests/rpg_sheet_notifications.test.sql` e confira dono, outro jogador, mestre e participante de outra campanha. Em seguida, faça um teste de integração com duas sessões de teste, incluindo exclusão de ficha e reconexão. Nenhuma migration foi aplicada ao projeto remoto nesta revisão.
