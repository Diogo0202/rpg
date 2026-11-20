# Documentação de domínio

## Estrutura

O projeto segue single-context: `CONTEXT.md` na raiz e decisões em `docs/adr/`. Preservar o glossário e a ADR de sincronização offline existentes.

## Leitura

Antes de investigar uma área, ler `CONTEXT.md` e as ADRs relacionadas. Se surgir `CONTEXT-MAP.md`, seguir suas referências aos contextos pertinentes. Para arquivos ausentes, prosseguir sem criar documentação vazia.

Seguir o vocabulário do glossário em especificações e nomes de domínio. Sinalizar conflitos com uma ADR antes de alterar o comportamento que ela define. Registrar decisões novas quando estiverem aprovadas.

A ADR `docs/adr/0001-mobile-offline-sync.md` rege a fila persistente por conta, aparelho e campanha, a confirmação pelo servidor e o tratamento explícito de conflitos.
