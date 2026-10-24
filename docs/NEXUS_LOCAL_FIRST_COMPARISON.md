# Comparação da proposta local-first

Este registro compara `gemini-code-1792758636392.md` com o checkout de `D:\rpg-github`. Os fatos de código abaixo descrevem a implementação local. Migrations locais ainda precisam de execução em Supabase de staging.

## Proposta e código

| Tema | Proposta | Estado no checkout |
| --- | --- | --- |
| Aplicativo móvel | Next.js, TypeScript, Zustand e TailwindCSS | O app móvel é React e TypeScript, com TanStack Start/Router, Vite, React Context e TailwindCSS. Não houve troca de framework. |
| Cache offline | IndexedDB ou RxDB | O cliente guarda partições e fila de operações em IndexedDB. As chaves separam conta, campanha e aparelho. O app também mantém um modo local de demonstração. |
| Identidade offline | Guardar JWT no IndexedDB para modo avião | A fila IndexedDB não recebe JWT. O SDK Supabase mantém a sessão segundo sua configuração. Cada chamada remota pede um token à sessão atual, e a API valida o Bearer no Supabase Auth. Uma cópia de campanha em cache não concede acesso ao servidor. |
| Escrita da ficha | Enviar eventos atômicos, sem gravar o JSON inteiro | Edições comuns usam caminhos de campo e mantêm `base_version`, valores `before/after` e conflito explícito quando a mesma base mudou. Ajustes inteiros de campos numéricos de modelos conectados entram em uma fila de intenções locais e seguem para o endpoint atômico. |
| Reenvio após falha | Repetir o lote offline ao reconectar | Cada ajuste tem `operation_id` persistente. A migration `20261025110000_sheet_adjust_idempotency.sql` registra o identificador junto ao evento; a mesma solicitação pode ser repetida após perda da resposta sem somar o delta duas vezes. Usar o identificador com outro conteúdo resulta em conflito HTTP 409. |
| Edição simultânea | Jogador offline e mestre online podem alterar a ficha sem perder deltas | Deltas do mesmo campo são serializados pelo bloqueio da linha na RPC. Campos independentes editados pelo fluxo comum continuam sujeitos à versão-base; divergências permanecem como conflito para revisão. Nenhuma mesclagem automática de valores absolutos é declarada. |
| Fórmulas | Avaliar fórmulas de schemas com AST seguro | O mobile já tem parser aritmético limitado em `mobile/src/lib/formula.ts`, sem `eval`, e deriva fórmulas aprovadas em `mobile/src/lib/nexus/sheets.ts`. Há limite de tamanho, tokens, profundidade, expoente e valor numérico. Campos calculados não são enviados como entrada da ficha. |
| Tempo real | Espelhar a mesa por Supabase Realtime e views públicas | O mobile assina INSERT/UPDATE de `character_sheet_notifications`, filtrado pela campanha. A tabela contém somente `campaign_id`, `owner_id`, `revision` e `updated_at`; cada aviso agenda push/pull FastAPI com debounce. O cliente não assina as linhas de fichas. A entrega remota deste fluxo depende das migrations e das permissões em staging. |
| Mapas | Excluir editor tático no mobile | O mobile não oferece edição de mapas táticos. Registros de mapa suportados pela API seguem o cliente de sync geral. |
| Schemas de sistema | Partições `primitives`, `computed_stats` e `inventory_schema` | O backend aceita as partições e as compila para o contrato canônico. Rejeita campos desconhecidos, referências inválidas, ciclos e sintaxe fora da AST aritmética. O formato existente `fields` continua aceito. |
| Inventário genérico | Atributos definidos por sistema | `inventory_schema` declara campos simples de item. Web e mobile exibem seus controles; o banco valida tipos, limites e opções. Backups e sincronização preservam `custom_values`. |
| Marketplace | Busca comunitária, votação, cópia e moderação | `/marketplace` mostra cartões públicos renderizados no servidor. Busca PostgreSQL com índice GIN por nome/tags, votos por conta e contador de cópias armazenado. Publicar exige sessão e confirmação de direitos; copiar exige gestão da campanha e gera modelo para revisão. |
| Direitos autorais | Retirada e análise privada | Denunciar oculta o modelo imediatamente. Administradores revisam a fila privada e decidem restaurar ou remover, com nota. Nenhum upload público de PDF foi adicionado. O fluxo não representa certificação jurídica. |
| Tutor de IA | Somente explicações matemáticas | O servidor calcula por AST. A explicação paga recebe só expressão, números e resultado. Novas chamadas narrativas ficam bloqueadas; propostas históricas continuam revisáveis. `AI_ENABLED=false` permanece como padrão. |
| Monetização | Anúncios limitados, doação e afiliados | Por decisão do usuário em 23/10/2026, permanece desativada. Links opcionais só aparecem com URLs HTTPS configuradas; links comerciais recebem `sponsored nofollow`. Nenhum script AdSense foi instalado. |
| SEO e performance | Descoberta pública e primeira carga abaixo de 1 s | Sitemap e canonical dependem do domínio configurado; a página comunitária usa renderização dinâmica para não reter modelos ocultados em cache estático. Não há medição de tráfego ou carga em dispositivo real. O mobile preserva sua arquitetura atual, sem prometer a meta de 1 s. |

## Alterações deste trabalho

- A fila persistida recebeu intenções de ajuste numérico por conta/campanha/aparelho, projeção local do resultado e envio pelo transporte FastAPI.
- O endpoint de ajuste exige UUID estável por operação. A nova migration acrescenta esse UUID ao evento e cria uma RPC que bloqueia a ficha, confere o recibo anterior e reaplica o delta somente na primeira chamada.
- O editor conectado separa campos de `values` em caminhos individuais. Campos numéricos inteiros declarados no schema usam delta; XP e moedas declaradas no schema seguem fora desse caminho. As demais diferenças preservam a base e a resolução de conflito existente.
- A sessão offline não muda a autorização do servidor. Mudança de conta continua usando partição separada; chamadas remotas continuam vinculadas ao usuário autenticado e às políticas do banco.
- A atualização automática escuta apenas a tabela de avisos com metadados mínimos e encerra o canal quando a conta ou campanha ativa muda.
- O parser e o cálculo de fórmulas já existiam no mobile e foram verificados como a rota local para fórmulas genéricas. Nenhum avaliador de código foi adicionado.

## Limites da evidência

Na revisão encerrada em 24/10/2026, a suíte local passou 352 testes de backend, 69 testes de domínio do frontend e 64 testes Vitest mobile. Outros 26 testes verificaram sincronização e IndexedDB, sem casos ignorados. O banco descartável PGlite aplicou 31 migrations e passou 393 verificações. Builds de produção do site e do mobile passaram, assim como os typechecks. Os testes de navegador confirmaram marketplace, tutor e inventário em 390 e 1440 pixels, sem erro de console nem rolagem horizontal, com APIs simuladas e rede externa bloqueada.

O teste integrado também passou oito cenários com cliente TypeScript, FastAPI real e PostgreSQL descartável: criação, recibos duplicados, atributos de item, edições concorrentes, transferência de propriedade, repetição do ajuste numérico e revogação de acesso. O cenário agora aplica todas as migrations. Os DTOs do banco listam os campos permitidos explicitamente, para que novas colunas não alterem a resposta móvel nem enviem dados extras por acidente.

O bundle mobile de produção registrou o service worker e abriu a tela Mesa após recarga sem rede em Chromium, com janela de 390 pixels e sem erros de execução. Esse ensaio verifica o shell e o modo local; não comprova sincronização com Supabase hospedado nem instalação em um telefone físico.

Esses resultados não testam RLS hospedado nem substituem ensaio com jogador, mestre e conta de outra campanha. Não houve deploy, chamada paga OpenAI ou configuração de anúncio. Os caminhos comuns de edição continuam em conflito quando duas pessoas alteram o mesmo campo com a mesma versão-base. A troca da arquitetura móvel por Next.js/Zustand e as animações propostas ficam fora desta entrega.

## Schema de exemplo

Este documento é uma DSL limitada do Nexus, não um interpretador de qualquer JSON Schema. O campo calculado fica separado das entradas editáveis; atributos de item têm escopo próprio.

```json
{
  "name": "Sistema de exemplo",
  "version": 1,
  "primitives": [
    {"id": "vigor", "label": "Vigor", "kind": "number", "min": 0, "max": 5}
  ],
  "computed_stats": [
    {"id": "vida", "label": "Vida", "kind": "formula", "expression": "vigor + 3"}
  ],
  "inventory_schema": [
    {"id": "peso", "label": "Peso", "kind": "number", "min": 0, "max": 1000},
    {"id": "material", "label": "Material", "kind": "select", "options": ["Ferro", "Madeira"]}
  ]
}
```

## Ativação em staging

1. Aplicar a sequência completa de migrations em banco descartável antes do Supabase de destino. As novas migrations comunitárias são `20261025101000_system_marketplace.sql`, `20261025110000_sheet_adjust_idempotency.sql` e `20261025120000_inventory_schema.sql`. Não selecionar somente a última, pois existem dependências anteriores.
2. Publicar o backend e os clientes compatíveis juntos. O cliente envia `operation_id` UUID no ajuste numérico; o servidor persiste o recibo antes de confirmar. Testar perda de resposta e repetição do mesmo identificador, incluindo conflito por conteúdo diferente.
3. Conferir o canal `character_sheet_notifications` com proprietário, narrador, jogador e uma conta de outra campanha. Os avisos carregam metadados; a leitura do conteúdo continua autenticada.
4. Provisionar administradores em `marketplace_admins` somente por operação privilegiada do responsável pelo banco. A aplicação não concede esse papel por cadastro. Testar ocultação imediata, fila privada, restauração e remoção com contas distintas.
5. Configurar o domínio público real para SEO. Manter URLs de monetização vazias e `AI_ENABLED=false` até decisão específica de ativação. Uma futura ativação da IA exige credencial privada e coordenador de orçamento funcionando; não enviar segredos ao navegador.

O Next.js foi atualizado para 16.4.3 após o build apontar a versão anterior como vulnerável. A [correção oficial de outubro de 2026](https://nextjs.org/blog/nextjs-security-update-october-14-2026) descreve as versões corrigidas. A auditoria local de dependências do frontend não apontou vulnerabilidades após a atualização.
