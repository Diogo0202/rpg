# Checklist de entrega do RPG-Atlas

Atualizado em 15/10/2026. Legenda: `[x]` implementado e validado localmente; `[~]` fluxo parcial ou aguardando validação remota; `[ ]` pendente. A [lista com percentuais](STATUS_FUNCIONALIDADES.md) contém o escopo detalhado.

## Fundação beta

- [x] Monorepo com Next.js, FastAPI, dependências travadas e CI.
- [x] Estrutura Supabase local: tabelas de campanha, biblioteca, fichas, mundo, mapas, combate e auditoria.
- [x] RLS, bucket privado e migration de endurecimento descritos localmente; nenhuma migration foi aplicada remotamente.
- [~] Auth Supabase, convites e checagem de JWT na API (modelagem existe; integração remota depende do projeto Supabase).
- [~] Importação de PDFs/Drive: consentimento e fila de rascunho existem; conector Drive, OCR e hash de arquivo ainda precisam de credenciais e worker.
- [x] Template versionado, DSL restrita de fórmulas e rolagem de dados segura no backend.

## Produto

- [~] Painéis conectados de campanha, fichas modulares, inventário, relações de mundo e cena com gravação por versão. Migrations ainda não aplicadas remotamente.
- [~] Cofre local com backup JSON validado e restauração atômica usando modelo aprovado idêntico.
- [~] Diário com sessões, eventos, facções e tensão; cues musicais por sessão e playlists Spotify por link.
- [~] SI e diagnóstico conectados a registros autorizados da campanha, com painéis exclusivos do narrador e migrations locais.
- [~] Roladores de Caçador e O Um Anel. O recorte de O Um Anel aguarda revisão completa da fonte de regras; consequências narrativas e jornadas não são automatizadas.
- [~] Mapa PixiJS: grade, salas, tokens arrastáveis e névoa demonstráveis; o documento completo ficou restrito ao mestre até existir uma visão redigida para jogadores.
- [~] Persistência do terreno e marcadores, exportação PNG/JSON; aguardam teste remoto. Camadas/grupos, luz por célula, WebP/PDF/UVTT pendentes.
- [ ] Presença Realtime, chat/pings, visão por jogador e sincronização de combate.
- [ ] Conectores Roll20/Foundry e galeria pública moderada.

## Qualidade e liberação

- [x] 124 testes da API, 15 testes de domínio frontend, TypeScript e build Next.js aprovados localmente em 15/10/2026.
- [~] Testes pgTAP de RLS escritos; PostgreSQL/Supabase local e Docker não estão disponíveis nesta máquina.
- [x] Revisão estática dos fluxos e correções locais de ficha, extração e relações entre campanhas. Isso não equivale a um scan gerenciado de segurança nem a teste remoto de RLS.
- [ ] Configurar `SITE_URL`, Supabase/Auth/Storage e executar migration em ambiente de staging.
- [ ] Fazer E2E mestre → jogador → sessão tática com dados reais de staging.
