# Plano para mapas e objetos interativos

Proposta para revisão em 15/11/2026. Ainda não aplicada ao checkout `D:\rpg-github`, branch `feat/sotdl`. A aprovação deste plano autoriza a gravação da configuração e o início da implementação local.

## Decisões confirmadas

- A primeira entrega atende exploração com objetos interativos.
- Criação e interação completas devem funcionar no computador e no celular.
- Portas, recipientes com conteúdo, pistas examináveis e passagens entre mapas entram no escopo.
- Toda ação do jogador depende de aprovação do narrador. Isso inclui abrir uma porta destrancada ou examinar uma pista.
- O jogador só pede ações para objetos revelados. Seu personagem precisa estar no alcance automático.
- O alcance inicial é uma célula, incluindo diagonais. O narrador pode ajustar o alcance por objeto.
- Paredes e portas fechadas impedem interagir com objetos do outro lado. O jogador pode pedir abertura da própria porta pelos dois lados.
- Uma retirada aprovada entrega a quantidade aprovada ao inventário da ficha solicitante.
- Passagens levam apenas o personagem que fez o pedido, para um ponto de chegada configurado.
- A prioridade do editor é desenho e montagem de salas. A biblioteca de objetos reutilizáveis fica fora desta entrega.
- As novas ferramentas incluem editar cantos e dimensões de salas já desenhadas, seleção múltipla para mover/duplicar salas e ligação de salas por corredores.

## Estado encontrado

O editor web já desenha muros e salas retangulares/poligonais, posiciona portas e oferece snap e desfazer/refazer. Portas já têm estado aberta/fechada/trancada. Os objetos decorativos ainda não têm contrato de ações. O jogador só arrasta o próprio marcador.

O mobile mostra um aviso de exclusividade dos mapas na versão web para computador. Será necessário acrescentar o editor e a visualização com ações, compartilhando os contratos de mapa e permissões.

O mapa tem células, mas não tem escala física em metros. As barreiras da linha de visão já consideram paredes e portas fechadas. A nova regra de alcance será em células.

O inventário atual pertence às fichas e não possui operação de retirada de um recipiente. As aprovações existentes são específicas, como XP; falta uma fila de pedidos de mapa.

Referências conferidas nesta entrevista:

- `frontend/lib/map-document.ts:16`: estado das portas; `:18`: objetos decorativos; `:23`: marcadores; `:55`: documento e grade.
- `frontend/components/player-map-view.tsx:72`: marcadores próprios; `:104`: movimento pela RPC.
- `frontend/components/map-editor/map-editor.tsx:257`: snap; `:314`: porta; `:328`: objeto decorativo; `:600`: ferramentas de sala existentes.
- `frontend/lib/map-visibility.ts:127`: barreiras e vãos de portas abertas.
- `mobile/src/components/nexus/WorldPanel.tsx:277`: ausência do mapa funcional mobile.
- `supabase/migrations/20261014151000_character_inventory.sql:51`: vínculo fixo do item à ficha.
- `supabase/migrations/20261112110000_reserve_pending_advance_xp.sql:122`: padrão existente de aprovação com bloqueio de linhas.

O executável graft não foi encontrado. O contexto veio dos cartões de `graft/` e dos trechos atuais de código apontados por eles. Os cartões datam de 28/10/2026; o código foi conferido nos pontos listados.

## Comportamento proposto para implementação

### Pedidos e aprovação

Cada pedido registra campanha, mapa, objeto, ação e ficha solicitante. O servidor verifica a participação na campanha, a propriedade da ficha, a revelação do objeto, a posição do personagem e os obstáculos.

O narrador recebe pedidos pendentes da campanha, vê o personagem e decide aprovar ou recusar. A aprovação revalida o estado atual antes de aplicar o efeito. Se o personagem saiu do alcance ou o objeto mudou, o sistema explica por que o pedido não pode ser executado. A decisão e seu efeito ficam registrados juntos.

Examinar uma pista só entrega seu conteúdo autorizado depois da aprovação. Pedidos e respostas de um jogador não expõem pistas secretas ou dados de outro personagem. Estados compartilhados, como uma porta aberta, seguem a visibilidade do mapa.

Para retirar itens, o estoque só muda na aprovação. Duas aprovações concorrentes não podem entregar mais unidades do que existem. Repetir uma resposta após falha de conexão não duplica a entrega.

Passagens apontam para outro mapa da mesma campanha e para um ponto de chegada. Após aprovação, só o marcador da ficha solicitante muda de mapa. O jogador recebe o destino autorizado sem receber os dados ocultos do narrador.

### Alcance

O teste de proximidade considera o marcador do personagem e a área interativa do objeto. Uma célula com diagonal permitida corresponde à maior separação entre os eixos, dividida pelo tamanho da célula. Objetos extensos devem ser acessíveis por sua borda próxima, sem exigir proximidade ao centro.

A barreira considera o trajeto entre o personagem e o ponto de interação. Paredes e portas fechadas bloqueiam o acesso a outros objetos. Ao interagir com uma porta, a própria porta não bloqueia o pedido dirigido a ela; outras barreiras continuam válidas.

Essas verificações são obrigatórias no servidor. A interface antecipa a explicação de falta de alcance, mas não decide sozinha a permissão.

### Editor no computador e no celular

As ferramentas novas devem editar vértices e dimensões sem destruir o piso, as paredes e os vãos associados à sala. A seleção múltipla move ou duplica o conjunto escolhido. Duplicações recebem IDs novos e não copiam pedidos pendentes ou histórico de decisões.

A ferramenta de corredores conecta salas com largura configurável e mantém as paredes e os acessos coerentes. As alterações entram no histórico de desfazer/refazer.

No celular, a seleção abre controles adequados ao toque. Mover a tela e editar um objeto exigem modos distinguíveis para evitar deslocamentos acidentais. O narrador consegue criar uma sala, editar sua geometria, configurar um recipiente e revisar um pedido sem depender de mouse.

### Sincronização e mapas existentes

Seguir a ADR 0001: manter rascunhos e edições offline na fila persistente, separados por conta/aparelho/campanha. Pedidos offline podem ficar na fila, com aviso de que ainda não foram recebidos. Aprovações e efeitos com estoque ou mudança de mapa dependem de confirmação do servidor.

Mapas existentes devem continuar abrindo. Objetos decorativos antigos permanecem decorativos até o narrador configurar suas ações. Uma atualização não concede ações novas aos jogadores por conta própria.

## Critérios de aceite

- Um narrador cria e edita uma sala no computador e no celular, incluindo cantos, dimensões e corredor.
- Mover/duplicar um conjunto preserva a relação entre piso, paredes e portas; desfazer/refazer restaura os elementos esperados.
- O jogador enxerga os objetos revelados e pede uma ação usando uma ficha própria com marcador naquele mapa.
- Um objeto adjacente na diagonal permite pedido; um objeto fora do alcance configurado é recusado.
- Uma parede bloqueia a interação através dela. Uma porta fechada permite pedir abertura da própria porta e impede alcançar objetos atrás dela.
- Abrir porta, examinar pista, retirar item e atravessar passagem só produzem efeito após aprovação do narrador.
- Uma retirada aprovada reduz o estoque e acrescenta o item à ficha uma vez. Concorrência e repetição de operação não duplicam itens.
- Uma passagem aprovada move apenas o personagem solicitante, preservando os demais marcadores.
- Conta de outra campanha não lê pedidos nem aprova ações. Jogador não aprova o próprio pedido.
- Perda de conexão mantém as edições pendentes e informa quais pedidos ainda aguardam envio ou confirmação.
- Os testes pertinentes, as verificações de tipos e os builds passam; os resultados distinguem banco local de ambiente hospedado e dispositivo físico.

## Configuração das skills proposta

GitHub Issues em `Diogo0202/rpg`, cinco rótulos padrão e documentação single-context. O `CONTEXT.md` e a ADR existentes permanecem como referências. Criar `AGENTS.md` na raiz e `docs/agents/` conforme os textos abaixo, após aprovação.

### AGENTS.md

```markdown
# Regras de escrita

Siga as regras de escrita fornecidas pelo usuário nesta conversa:

- Evite os vocábulos e as fórmulas proibidos pelo usuário. Prefira palavras comuns e voz ativa.
- Comece pelo fato principal. Intercale frases curtas com períodos mais longos; evite três frases seguidas com extensão similar.
- Não intercale explicações com travessões. Prefira vírgulas, pontos ou parênteses.
- Evite enumerações automáticas de três itens e explicações vagas. Apoie afirmações em fatos do projeto.
- Quando um dado necessário não estiver disponível, registre [falta detalhe real] em vez de inventar.
- Entregue o resultado sem prefácios nem justificativas editoriais.

Termos proibidos em textos redigidos: "aprofundar", "alavancar", "mosaico", "testemunho", "crucial", "intricado", "sob medida", "potencializar", "transformar", "desvendar", "holístico", "fomentar", "utilizar".

Não abra textos com "No mundo de hoje...", "No cenário digital atual...", "Em um mundo em rápida evolução...", "Na era da..." ou "Sem mais delongas...".

Evite paralelismo negativo, a fórmula de abrangência "Desde X até Y", preâmbulos de aviso e as transições "Além disso", "Outrossim", "Consequentemente", "Em suma" e "Em conclusão".

## Agent skills

### Issue tracker

As tarefas e especificações ficam no GitHub Issues de `Diogo0202/rpg`. Consulte `docs/agents/issue-tracker.md`.

### Triage labels

A triagem segue os cinco rótulos padrão. Consulte `docs/agents/triage-labels.md`.

### Domain docs

O projeto segue single-context: `CONTEXT.md` na raiz e decisões em `docs/adr/`. Consulte `docs/agents/domain.md`.
```

### docs/agents/issue-tracker.md

```markdown
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
```

### docs/agents/triage-labels.md

```markdown
# Rótulos de triagem

| Papel | Rótulo no GitHub | Significado |
| --- | --- | --- |
| needs-triage | needs-triage | Aguarda avaliação. |
| needs-info | needs-info | Aguarda informações. |
| ready-for-agent | ready-for-agent | Especificada para execução pelo agente. |
| ready-for-human | ready-for-human | Requer trabalho humano. |
| wontfix | wontfix | Não será executada. |

Esses são os nomes padrão aprovados pelo usuário. Esta configuração registra a correspondência; criar rótulos no GitHub pertence ao fluxo que precisar deles.
```

### docs/agents/domain.md

```markdown
# Documentação de domínio

## Estrutura

O projeto segue single-context: `CONTEXT.md` na raiz e decisões em `docs/adr/`. Preservar o glossário e a ADR de sincronização offline existentes.

## Leitura

Antes de investigar uma área, ler `CONTEXT.md` e as ADRs relacionadas. Se surgir `CONTEXT-MAP.md`, seguir suas referências aos contextos pertinentes. Para arquivos ausentes, prosseguir sem criar documentação vazia.

Seguir o vocabulário do glossário em especificações e nomes de domínio. Sinalizar conflitos com uma ADR antes de alterar o comportamento que ela define. Registrar decisões novas quando estiverem aprovadas.

A ADR `docs/adr/0001-mobile-offline-sync.md` rege a fila persistente por conta, aparelho e campanha, a confirmação pelo servidor e o tratamento explícito de conflitos.
```
