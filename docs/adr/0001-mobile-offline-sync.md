# 0001. Edição offline com confirmação no backend Nexus

Estado: aprovado pelo usuário em 18/10/2026; implementação em andamento.

## Decisão

A PWA mobile criada no Lovable compartilhará o backend Nexus. IndexedDB manterá a base confirmada e uma fila persistente de operações por conta, dispositivo e campanha. A interface exibirá uma projeção local dessas operações, preservando a edição durante a sincronização.

O servidor aplicará autorização e restrições existentes. A revisão de sincronização ficará separada da versão de regras do modelo. Operações terão IDs estáveis e recibos para impedir repetição após perda de resposta. Objetos com alterações independentes poderão ser mesclados; conflitos no mesmo campo exigirão decisão explícita.

## Contexto e alternativas

O usuário escolheu edição completa offline, em vez de consulta offline ou rascunhos limitados. Gravar apenas o último JSON de cada ficha substituiria mudanças concorrentes de outro aparelho. Criar um banco independente para o mobile separaria permissões e personagens da aplicação web.

Um CRDT genérico resolveria parte da edição de texto, mas não decidiria se duas compras podem consumir o mesmo saldo ou se duas armaduras podem permanecer equipadas. Essas decisões continuam nas regras de negócio e nas transações do servidor. O protocolo usa operações explícitas e controle de conflitos, permitindo acrescentar edição colaborativa de texto futuramente sem mudar a autorização da campanha.

## Consequências

A fila e a base precisam ser gravadas juntas para sobreviver ao fechamento do aplicativo. Remover uma operação confirmada não pode remover edições posteriores do mesmo registro. O cursor de pull só avança após processar os eventos recebidos; o cursor retornado por um push não comprova que mudanças de outros dispositivos foram recebidas.

A sincronização depende de migrations, endpoints e testes entre réplicas. Sem configuração remota, o aplicativo mantém estado local e mostra que a conexão ainda não foi estabelecida. O cache já baixado não pode ser apagado em um aparelho desconectado; a revogação impede novas operações no servidor e produz limpeza na reconexão.

## Critérios de verificação

Repetir uma operação após interrupção não cria outra ficha nem outro item. Duas alterações em campos distintos chegam a ambos os aparelhos. Mudanças no mesmo campo permanecem visíveis como conflito. Excluir um objeto em um aparelho não apaga silenciosamente a edição pendente no outro. Um participante removido não consegue sincronizar, nem acessar dados de outra campanha.
