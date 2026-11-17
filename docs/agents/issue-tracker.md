# Issue tracker: GitHub

As tarefas e especificações deste repositório ficam no GitHub Issues de `Diogo0202/rpg`. Os fluxos de engenharia devem consultar esse destino pelo `gh` CLI.

## Convenções

- Conferir o remoto do checkout antes de operar no repositório.
- Ler uma tarefa com `gh issue view <numero> --comments` e consultar seus rótulos.
- Listar tarefas com `gh issue list --state open --json number,title,body,labels`.
- Ao publicar uma tarefa solicitada, gravar o conteúdo em arquivo UTF-8 e passar `--body-file` a `gh issue create`.
- Para comentários solicitados, seguir a mesma convenção de `--body-file`.
- Aplicar os nomes definidos em `docs/agents/triage-labels.md` quando o fluxo pedir uma mudança de triagem.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Correspondência dos fluxos

Quando uma skill pedir publicação no rastreador, o destino é uma issue neste repositório. Quando pedir a leitura de um ticket, ler a issue e seus comentários.
