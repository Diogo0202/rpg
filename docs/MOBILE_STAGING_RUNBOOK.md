# Runbook de staging para sincronização móvel

Este roteiro liga o frontend gerado pelo Lovable à API FastAPI e ao projeto Supabase de staging. Não cole tokens ou chaves em prompts, tickets, commits ou logs. O navegador recebe somente URL do projeto e chave publicável.

## Estado verificado neste checkout

O teste local `npm.cmd run test:mobile:integration` passou com TypeScript, FastAPI e PostgreSQL PGlite. Ele cobriu criação e replay, mesclagem de edições independentes, conflito no mesmo campo e remoção de acesso. O SQL agent também informou 50 assertions PGlite para a migration de sync. Isso comprova o fixture local. Não comprova migration, Auth, RLS ou CORS no projeto Supabase remoto.

Nenhuma migration remota foi aplicada neste trabalho. O staging continua pendente de backup, aplicação ordenada, configuração de ambiente e teste com contas reais.

## 1. Preparar o projeto de staging

Use um projeto Supabase separado de produção e confirme o ref do projeto na equipe antes de ligar a CLI. Crie quatro contas de teste distintas: owner, master, player e outsider. O outsider não deve ser membro da campanha. Não use dados de jogadores reais.

Faça um backup verificável antes da mudança. Registre o horário, projeto e versão, confirme que o arquivo ou ponto de restauração existe e que a equipe sabe como restaurá-lo. Se o plano oferece PITR, confirme sua janela e teste a restauração em um projeto isolado. Não conte uma cópia local sem teste como backup recuperável.

No checkout, execute:

```powershell
npm.cmd run test:db
npm.cmd run test:mobile:integration
```

Os testes usam PostgreSQL local em PGlite. Não apontam para Supabase hospedado.

## 2. Aplicar migrations em ordem

Confira a lista de migrations locais e remotas antes de aplicar. O CLI deve aplicar todas as migrations pendentes em ordem de timestamp. Não aplique somente a migration de sync em um banco novo.

O fluxo depende do núcleo e das políticas de campanha, dos modelos e fichas modulares, efeitos de ficha, diário, inventário, versões de mapas e entidades, limites e dependências dos valores de ficha, auditoria de acesso e controle global de concorrência. A migration de sync é `20261018200000_mobile_sync.sql`; `20261019090000_ai_assistance.sql` vem depois na sequência atual. Preserve também todas as outras migrations anteriores presentes no repositório.

Depois de conferir o destino e o backup, vincule a CLI apenas ao projeto de staging, inspecione `migration list` e aplique as pendentes com `supabase db push`. Pare se a lista mostrar projeto inesperado, migration remota divergente ou alteração fora da sequência. Não rode esse comando contra produção neste ensaio.

Valide no staging que as três RPCs existem e são executáveis por `authenticated`: `mobile_sync_push`, `mobile_sync_snapshot` e `mobile_sync_changes`. Confirme também as funções de admission compartilhado `api_concurrency_acquire` e `api_concurrency_release` antes de subir a API em múltiplas instâncias.

## 3. Configurar API, Lovable e CORS

Configure os nomes abaixo nos ambientes correspondentes, sem compartilhar os valores:

| Ambiente | Nomes de configuração | Observação |
| --- | --- | --- |
| Lovable (Vite/TanStack) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_NEXUS_API_URL` | Nomes presentes em `src/lib/nexus/config.ts` do projeto gerado. A API deve usar HTTPS. Essas variáveis entram no build; gere outra prévia após alterá-las. O adaptador conectado ainda precisa ser concluído, preencher as variáveis não estabelece conexão por si só. |
| Frontend Next.js existente | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL` | São configurações do frontend em `frontend/`, distintas dos nomes do mobile Lovable. |
| FastAPI | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CORS_ORIGINS` | A chave publicável acompanha o JWT do usuário nas chamadas REST e RPC. A API não usa service role para sync. |
| FastAPI em runtime distribuído | `API_CONCURRENCY_BACKEND=supabase`, `SUPABASE_SERVICE_ROLE_KEY` | A service role fica somente no segredo do backend. Ela autoriza o admission compartilhado, nunca o navegador nem as RPCs de sync. |

Em execução com um único processo, o backend local mantém a admissão em processo. Em serverless ou com mais de um worker/instância, selecione o backend `supabase`; sem URL e service role, a API recusa chamadas protegidas. A migration mantém dez leases globais, sem fila. `API_MAX_CONCURRENT_REQUESTS` aceita de 1 a 10 e limita cada processo; não aumenta os dez slots compartilhados.

Defina `CORS_ORIGINS` com as origens exatas do frontend, separadas por vírgula, por exemplo domínio principal de staging e URL fixa do preview. Informe apenas `scheme://host[:port]`, sem caminho. O middleware aceita credenciais e recusa `*`. Não libere padrões para previews dinâmicos. Para cada novo domínio de preview, atualize a lista no backend e confira o deploy da API.

Cadastre os URLs de staging e preview permitidos também na configuração de URL/redirect do Supabase Auth. Teste login e callback em cada domínio. Não configure domínio de produção antes da aprovação do staging.

Deixe IA desativada durante o teste de sync. A configuração atual usa `AI_ENABLED=false`; não configure chave de provedor para este ensaio.

## 4. Testar papéis e dois aparelhos

1. Entre como owner, crie uma campanha de teste e convide master e player. Mantenha outsider fora. Confirme que a lista de campanhas retorna somente campanhas visíveis por RLS e que capabilities apresenta o role esperado.
2. Em dois aparelhos ou dois perfis de navegador, entre como player e carregue a mesma ficha. Desligue a rede nos dois. Altere `vigor` para valores diferentes no mesmo campo. Reconecte primeiro o aparelho A e depois B. O segundo deve receber conflito, manter a edição local e permitir resolução explícita. Nenhuma escrita deve sobrescrever silenciosamente o valor remoto.
3. Repita com campos independentes, como nome e um atributo diferente. A API deve mesclar as alterações sem perder o estado de nenhum aparelho. Reinicie um perfil enquanto houver alterações pendentes e confirme que a outbox local persiste.
4. Simule perda da resposta depois de uma operação aceita e repita o mesmo `operation_id` e `device_id`. Confirme resultado duplicado e uma única linha de inventário ou entidade no banco.
5. Como player, confirme leitura e edição somente da ficha/inventário permitido; mapas e marcadores privados devem ficar ocultos. Como master, confirme acesso às entidades de gestão autorizadas. Como outsider, tente capabilities, snapshot, changes e push. As chamadas devem ser recusadas sem revelar IDs ou conteúdo da campanha.
6. Remova o player da campanha sem encerrar sua sessão. Na reconexão, pull e push devem ser negados. O cliente deve limpar os registros confirmados da campanha revogada e preservar a pendência local para resolução explícita. Confirme que outro usuário e outra campanha continuam isolados.

Guarde IDs de request, horário, status e resultado observado. Remova JWTs, cookies, cabeçalhos `Authorization` e valores de campos pessoais dos registros anexados ao relatório.

## 5. Critério de liberação e rollback

Libere staging somente com backup conferido, migrations na ordem esperada, health da API, login via Auth, CORS nos domínios exatos, teste de dez slots em runtime distribuído e todos os casos de papéis, replay, merge, conflito e revogação aprovados. Marque produção como pendente até repetir os mesmos passos com aprovação e janela próprias.

Se uma etapa falhar, remova o domínio de preview do CORS ou reverta o frontend para a versão anterior e desative o acesso às rotas de sync na API. A migration adiciona colunas, triggers, RPCs e tabelas de recibo; não tente rollback manual com `DROP` nem reaplique mutações depois de restaurar dados sem reconciliar o outbox. Preserve as estruturas aditivas enquanto a API antiga estiver no ar. Se o banco precisar de restauração, restaure primeiro em projeto isolado, compare dados e só então escolha recuperação do staging. Registre qualquer perda de writes ocorridos após o backup.
