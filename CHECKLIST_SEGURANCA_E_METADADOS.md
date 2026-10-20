# Checklist de segurança e metadados

Atualizado em 18/10/2026. Projeto: RPG-Atlas, repositório `Diogo0202/rpg`. O escopo de alunos e professores foi retirado a pedido do usuário. O teto confirmado é de dez requisições simultâneas no total da API.

Cada marca abaixo corresponde a código e verificação local. As etapas de ativação externa permanecem abertas. Este checklist não mede a conclusão do aplicativo inteiro.

## Código e verificação local

- [x] Limitar a execução local a dez chamadas, sem fila ilimitada, e liberar vagas em erro, cancelamento ou desconexão. Responsável: coordenador. Evidência: `backend/tests/test_concurrency.py`.
- [x] Preparar admissão compartilhada no Supabase para manter o mesmo teto entre instâncias e falhar com 503 se o coordenador estiver indisponível. Responsável: agente de backend e coordenador. Evidência: `backend/tests/test_shared_concurrency.py`, teste com duas instâncias e ligação ao app real.
- [x] Registrar acessos à API e verificações de sessão web sem corpos, credenciais ou query strings. Responsável: agente de auditoria e coordenador. Evidência: `backend/tests/test_access_audit.py`, `backend/tests/test_api.py`, `frontend/tests/server-access-audit.test.mjs`.
- [x] Acrescentar migration de auditoria para gravações diretas e grants restritos. Responsável: agente de auditoria. Evidência: migration `20261018120000_access_audit.sql` e pgTAP preparado, ainda sem execução no banco.
- [x] Validar tamanho e formato do conteúdo recuperado e remover propriedades RPC fora do contrato. Manter extração como rascunho sujeito à revisão. Responsável: agente de backend e coordenador. Evidência: `backend/tests/test_prompt_security.py` e erro 422 no endpoint real de extração. Isso não constitui avaliação de resistência de uma LLM a prompt injection, pois não há modelo conectado.
- [x] Configurar metadados, schema, imagens OG/Twitter, sitemap, robots e llms.txt com base nas informações do projeto. Responsável: agente de frontend e coordenador. Evidência: testes de metadados, build e navegação Chromium; as duas imagens responderam PNG de 1200 × 630 pixels.
- [x] Preparar Clarity com consentimento, revogação e máscara, restrito à página pública. Responsável: agente de frontend e coordenador. Evidência: testes de configuração e Chromium com SDK interceptado, sem envio externo de telemetria.
- [x] Conferir o fluxo público em 390 × 844 e 1440 × 1000, validar tipos e gerar build de produção. Responsável: coordenador. Evidência: navegação sem erros JavaScript ou rolagem horizontal, login sem SDK Clarity, revogação preservada após recarregar.

## Ativação e dependências externas

- [ ] Aplicar as migrations de auditoria e concorrência em banco de teste e executar os novos testes pgTAP. Não há PostgreSQL/CLI configurado neste ambiente.
- [ ] Configurar o modo compartilhado e as credenciais privadas do backend no destino. Conferir duas instâncias contra o mesmo banco, sem ultrapassar dez vagas.
- [ ] Configurar `SITE_URL` e fornecer o ID real do Microsoft Clarity antes do build de publicação. O ID de teste do smoke test não foi salvo nos arquivos do projeto; o build final mantém Clarity desligado.
- [ ] Habilitar a retenção dos logs do provedor para leituras REST diretas ao Supabase e verificar a persistência dos logs HTTP no banco.

Conclusão deste checklist: 8 de 12 etapas (67%). O código descrito foi verificado localmente; a ativação externa ainda está pendente. Não houve commit, push, deploy nem execução de migrations remotas nesta etapa.

## Conferência realizada

Backend: 209 testes Python aprovados e exercício do app real em modo serverless sem configuração, com 503 e health disponível. Frontend: 45 testes Node, TypeScript e build de produção. O teste Chromium interceptou o script do Clarity e confirmou ausência de carregamento antes da escolha, publicidade negada, saída por documento para login e revogação após recarregar. PostgreSQL e os 44 testes pgTAP novos não foram executados.

As chamadas de IA continuam sem provedor conectado. A revisão de prompt injection terá de cobrir os prompts, ferramentas e fontes do modelo quando essa integração existir. As limitações atuais estão em `docs/PROMPT_SECURITY.md`; os logs diretos do banco estão descritos em `docs/ACCESS_AUDIT.md`.
