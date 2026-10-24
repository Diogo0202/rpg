# RPG-Atlas Mobile no Lovable

## Atualização solicitada em 22/10/2026

O Lovable aceitou uma nova execução em modo normal para atualizar esta prévia, com prioridade para a criação de mapas. Mensagem `umsg_01m5hxrs07e3qr63jzedtn3crw`, thread `main`. A aceitação não confirma a conclusão do build.

O pacote enviado contém 88 arquivos de código, testes e referências do editor SVG. Ele exclui arquivos de ambiente e credenciais. O pedido cobre identidade RPG-Atlas, melhorias nas fichas e dados V5, tema escuro e biblioteca/editor de mapas na área Mundo. O editor de referência inclui muros, casas, portas, sombras, objetos e pins; a adaptação precisa manter a distinção entre dados locais e sincronização confirmada.

O agente concluiu a edição no commit interno `a6adf6f919e532af9dec26f919960b60a2e65b30`, com biblioteca e editor de mapas adaptados para IndexedDB local. Ele confirmou apenas typecheck. A rodada seguinte, solicitando testes e build, foi rejeitada por falta de créditos.

Na conferência de 22/10, a prévia hospedada ainda entregou a versão antiga após recarga e navegação. Portanto, a atualização do site servido continua pendente. Uma cópia isolada do código recuperado passou em 62 testes, typecheck e build local; nela foram conferidos criação de casa/NPC, persistência após recarga, exportação e prévia do jogador. Isso não comprova deploy no Lovable. Veja `ATUALIZACAO_SITE_2026-10-22.md`.

Esta execução não autoriza publicação pública nem aplicação de migrations remotas.

## Histórico anterior

Projeto Lovable criado em 19/10/2026. Em 20/10/2026, o workspace estava sem créditos para novas mudanças ou publicação.

- Projeto: `41495b5b-e95b-4184-b10a-e653025f812c`.
- Workspace: `Diogo's Lovable`.
- Editor: https://lovable.dev/projects/41495b5b-e95b-4184-b10a-e653025f812c
- Prévia: https://id-preview--41495b5b-e95b-4184-b10a-e653025f812c.lovable.app
- Commit importado como fonte local: `dce7685898f1a1fca310b4b899dbc81881c311a5`.

O checkout em `D:\rpg-github\mobile` contém correções posteriores ao commit importado e está adiante da prévia Lovable. Não trate o link da prévia como imagem atual do código local. Nenhuma publicação dessas mudanças locais foi verificada.

## Estado local observado

O app local está ligado ao SDK Supabase e ao adaptador da API. A fixture de navegador validou login de teste, leitura de campanha e modelo aprovados, criação de ficha com Vida 6 e Vigor 3 e item dependente. O envio terminou com duas operações aceitas e zero pendentes.

A fixture usa Auth de teste, API FastAPI local e PGlite local. Ela não acessa Supabase hospedado. Migrations remotas, login com contas reais, instalação em telefone e teste final de build/offline seguem pendentes. O build e a validação de abertura sem rede serão executados pelo coordenador.

## Evidências anteriores

Antes desta atualização documental, foram reportados 21 testes do núcleo, 27 testes da API/adaptador e 50 assertions pgTAP da migration em PGlite. As contagens são evidência local de rodadas anteriores, não uma repetição feita neste registro.

Consulte `CHECKLIST_MOBILE.md` para o estado consolidado e `MOBILE_STAGING_RUNBOOK.md` antes de conectar a um projeto de staging.
