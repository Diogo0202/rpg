# RPG-Atlas Mobile

PWA em React/TypeScript. A base veio do projeto Lovable `41495b5b-e95b-4184-b10a-e653025f812c`, commit `dce7685898f1a1fca310b4b899dbc81881c311a5`. As correções posteriores são locais neste diretório: o workspace Lovable esgotou seus créditos antes da etapa de verificação.

Não confunda a prévia Lovable com esta cópia. O código local poderá divergir até a próxima importação no Lovable. Nenhuma publicação ou alteração do banco remoto foi feita.

## Executar

```powershell
cd D:\rpg-github\mobile
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1 --port 4173
```

Os dados de demonstração ficam no IndexedDB desta origem e são marcados como locais. Trocar domínio ou porta abre outro armazenamento. Operações locais não recebem confirmação de um servidor fictício. Exportar JSON permite levar as fichas para outra origem.

O núcleo de sincronização está em `src/lib/mobile-sync/`; ele é compartilhado com `frontend/lib/mobile-sync/` do RPG-Atlas. Fórmulas locais usam parser limitado; o servidor continua responsável pelas regras e permissões após a conexão.

## Verificações

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

O roteiro de configuração remota fica em `../docs/MOBILE_STAGING_RUNBOOK.md`. Configuração, Auth e políticas no Supabase hospedado ainda exigem validação com contas distintas.
