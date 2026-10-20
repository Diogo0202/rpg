# RPG-Atlas Mobile

Plano aprovado: PWA no Lovable, backend Nexus compartilhado, edição completa offline com sincronização.

- [x] Confirmar o escopo offline com o usuário.
- [x] Registrar o contrato inicial em docs/MOBILE_SYNC_CONTRACT.md.
- [x] Implementar estruturas SQL, revisões e recebimento idempotente de operações. Agente SQL, 50 verificações pgTAP locais; migration `20261018200000_mobile_sync.sql`.
- [x] Implementar rotas autenticadas de snapshot, mudanças e envio. Agente API, 27 testes do adapter; `backend/app/routes/mobile_sync.py`.
- [x] Implementar IndexedDB, projeção local e fila persistente. Agente cliente, 20 testes, incluindo IndexedDB no Chromium; `frontend/lib/mobile-sync/`.
- [x] Verificar duas réplicas, replay, conflito e acesso revogado. Coordenador e agentes, integração TypeScript/FastAPI/PostgreSQL local passou em `npm run test:mobile:integration`.
- [ ] Criar a PWA no Lovable com o contrato compartilhado. Em andamento, projeto `41495b5b-e95b-4184-b10a-e653025f812c`; geração ainda sem conclusão verificada.
- [ ] Entregar fichas guiadas, cálculos e backups compatíveis.
- [ ] Integrar inventário, diário, mapas e ferramentas do narrador.
- [ ] Configurar o ambiente remoto e conferir RLS com contas distintas.
- [ ] Verificar instalação e abertura sem rede em celular e computador.

Uma tarefa iniciada permanece desmarcada até haver evidência registrada. Credenciais, migrations remotas, commit e publicação exigem estado comprovado; código local não comprova ativação.

## Evidências e limites em 19/10/2026

Os três agentes trabalham com `gpt-6-luna`, em arquivos separados. O coordenador fecha os contratos, executa integração e acompanha a interface no Lovable.

A integração local faz chamadas reais do transporte TypeScript ao FastAPI, que chama os RPCs PostgreSQL no PGlite com fixtures Auth/Storage. Ela comprova criação única de ficha e inventário, mescla de campos independentes, conflito com decisão explícita, isolamento e revogação de participação. O teste não autentica contas no Supabase hospedado. A transferência de proprietário produz tombstones privados para remover fichas e inventário do cache anterior, coberta no pgTAP e na integração completa. A integração confirma que rascunhos do dono anterior seguem em conflito, que o novo dono recebe os registros e que o narrador não recebe os tombstones de revogação do antigo dono.

O sincronizador cobre doze entidades: campanhas, modelos em revisão, fichas, inventário, entidades e relações de mundo, mapas e marcadores, sessões, facções, eventos e cenas de combate. Música, Segunda Inquisição e dados dramáticos ainda não entram nessa lista. Perfis de regras completos continuam dependentes do material autorizado; perfis não suportados são recusados.

A prévia do Lovable abriu no navegador. Teste manual criou `Teste Mobile V5` pelo assistente, selecionou Brujah e Gato de Beco e confirmou Vitalidade máxima 6 para Vigor 3. Após recarga, a ficha permaneceu no IndexedDB, marcada como pendente local. A primeira geração deixou telas incompletas e erros de tipos; a segunda está corrigindo compilação, editor, backups e shell offline. Essa verificação parcial não confirma instalação PWA, conexão com o servidor ou o restante das telas.

Comandos reproduzíveis: `npm run test:mobile`, `npm run test:mobile:integration`, `npm run test:db`; API: `.venv\\Scripts\\python.exe -m pytest tests -q` na pasta `backend`.
