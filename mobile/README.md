# RPG-Atlas Mobile

PWA em React e TypeScript. A fonte local partiu do commit Lovable `dce7685898f1a1fca310b4b899dbc81881c311a5`. O código neste diretório tem alterações posteriores e está adiante da prévia do Lovable. Em 20/10/2026, o workspace ficou sem créditos para atualizar a prévia.

O SDK Supabase Auth, a configuração e o adaptador da API estão ligados localmente. Uma fixture de navegador com Auth de teste, API FastAPI local e PGlite local autenticou, carregou campanha e modelo aprovados, criou uma ficha com Vigor 3 e Vida 6 e um item dependente. O resultado observado foi duas operações aceitas e zero pendentes. Esse fluxo não acessou Supabase hospedado.

Migrations remotas, testes com contas Supabase reais e instalação em telefone continuam pendentes. Os builds padrão e local passaram. O shell foi corrigido e Mesa, Fichas e Nova ficha recarregaram com o servidor local desligado no navegador em 21/10/2026; a verificação em telefone permanece aberta.

O painel Dados calcula localmente as chances de sucesso, crítico sujo e falha bestial em V5 antes da rolagem. Ele compara a ação sem Vontade com a rerrolagem de até três dados comuns que falharam. O cálculo não inclui condições da ficha; a API mantém essa responsabilidade quando uma ficha conectada participa da ação.

Em Mais > Configurações, o tema Padrão ou Escuro fica salvo apenas neste aparelho. Os formulários e cartões mudam de cor; fichas e dados da campanha não são alterados.

Em campanha conectada, o jogador pode selecionar uma ficha com Fome. O painel consulta `POST /api/v1/v5/sheets/{sheet_id}/probabilities` e mostra os efeitos aplicados, a parada ajustada e as chances calculadas com a última versão confirmada no servidor. A consulta depende de JWT válido e das políticas de leitura da ficha. Se houver edição pendente, a tela avisa que o cálculo remoto ainda não a inclui. Uma nova versão sincronizada dispara outra consulta. O botão de rolagem permanece local e deixa claro que não aplica os efeitos retornados pela API.

## Executar

```powershell
cd D:\rpg-github\mobile
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1 --port 4173
```

Para conferir a compilação local de produção no Windows:

```powershell
npm.cmd run build:local
npm.cmd run preview:local
```

Abra `http://127.0.0.1:4174`. Esse caminho compila com o preset Node.js e serve somente em loopback. `npm run build` mantém o destino padrão do Lovable. A prévia Vite padrão procura uma saída de servidor diferente da saída Nitro deste projeto; os comandos locais evitam essa divergência.

As variáveis locais usam os nomes declarados em `.env.example`: `VITE_NEXUS_API_URL`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Não grave tokens de acesso nem uma chave de serviço no navegador.

O modo local grava dados de demonstração no IndexedDB desta origem. Trocar domínio ou porta abre outro armazenamento. Operações locais não recebem confirmação de um servidor fictício. Exportar JSON permite levar fichas para outra origem.

O núcleo de sincronização fica em `src/lib/mobile-sync/` e é a única cópia do cliente offline: a aplicação web do RPG-Atlas não tem modo offline. Os testes do núcleo ficam em `tests/` e rodam com `npm run test:mobile` na raiz. Fórmulas no cliente usam parser limitado. O servidor continua responsável por regras de jogo e permissões.

## Verificações

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Em 21/10 passaram 62 testes mobile, 32 testes V5 da API, o typecheck e o build local. O build padrão anterior gerou `_shell.html` e `sw.js` na saída pública. Na raiz do repositório, `test:db` passou com 23 migrations e 263 assertions pgTAP em PGlite, `test:mobile` com 21 testes e `test:mobile:integration` com sete verificações. Os 27 testes da API/adaptador são evidência anterior. Nada disso valida o Supabase remoto. O lint completo ainda exige padronização de formatação no código gerado; os erros de código identificados foram corrigidos e os checks direcionados passaram.

O roteiro de staging está em `../docs/MOBILE_STAGING_RUNBOOK.md`. O estado consolidado fica em `../CHECKLIST_MOBILE.md`. Não considerar sincronização com Supabase hospedado confirmada antes de aplicar migrations e testar com contas distintas.
