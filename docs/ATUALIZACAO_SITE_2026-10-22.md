# Atualização da prévia RPG-Atlas em 22/10/2026

Projeto Lovable: `41495b5b-e95b-4184-b10a-e653025f812c`.
Execução: `umsg_01m5hxrs07e3qr63jzedtn3crw`, thread `main`, modo normal.

## Checklist desta entrega

- [x] Conferir as novidades do checkout e as dependências do editor de mapas. Os nove testes locais de `frontend/tests/map-editor.test.mjs` passaram.
- [x] Enviar o pacote com 88 arquivos de código e referências, sem arquivos de ambiente ou credenciais.
- [x] Confirmar o término da execução de código no Lovable. Commit interno `a6adf6f919e532af9dec26f919960b60a2e65b30`; o agente relatou apenas typecheck. Testes, build e navegador não foram executados no sandbox.
- [x] Recuperar os arquivos desse commit e montar uma cópia isolada local, sem substituir o checkout compartilhado.
- [x] Conferir biblioteca e criação de mapas na área Mundo, com atalho na Mesa, na cópia local.
- [x] Criar `Refúgio Atlas (teste local)`, incluir casa poligonal (piso e muro) e NPC, salvar e recarregar. Permaneceram duas estruturas e um pin.
- [x] Exportar JSON pela interface. O documento contém versão 2, duas estruturas e um NPC. A exportação completa guarda notas do narrador e deve ser tratada como backup privado.
- [x] Marcar o NPC como reservado ao narrador e ativar a prévia do jogador. O texto do pin desapareceu do SVG e a nota privada não apareceu no DOM renderizado.
- [x] Conferir biblioteca e visualização na largura de 390 px. Sem rolagem horizontal: `clientWidth` e `scrollWidth` de 375 px, descontada a barra vertical.
- [ ] Concluir build e validação no Lovable. A tentativa seguinte foi rejeitada por falta de créditos do workspace.
- [ ] Confirmar a prévia hospedada atualizada. Após recarga e navegação em 22/10, ela ainda mostrou a marca RPG Nexus e a página antiga de Mundo.

## Resultado e limites

A rodada salvou código novo no Lovable, mas não entregou uma prévia hospedada validada. O estado `ready` do projeto e o commit interno não comprovam atualização do site servido. O link continua https://id-preview--41495b5b-e95b-4184-b10a-e653025f812c.lovable.app.

A cópia isolada usa os arquivos enviados e doze arquivos recuperados do commit do Lovable. Antes das correções finais de mapas, passaram 62 testes em 18 arquivos, `tsc --noEmit` e build local Vite com `RPG_MOBILE_LOCAL_BUILD=1`. Isso não equivale ao build Nitro/Cloudflare do Lovable. A interface foi conferida em http://127.0.0.1:4187.

A revisão encontrou uma corrida entre leitura de versão e gravação do mapa, e uma lista que podia receber uma resposta da campanha anterior. As correções serão registradas como locais até que possam ser enviadas ao Lovable. Nenhum dado da origem hospedada foi apagado para contornar cache.

## Escopo solicitado

A atualização inclui identidade RPG-Atlas, fichas guiadas e backups, dados V5 com previsão de risco, tema escuro e criação de mapas. O editor de referência oferece grade, muros, casas, portas, sombras, objetos, pins e histórico de desfazer/refazer. O computador recebe a edição completa; a interface móvel precisa manter biblioteca e visualização acessíveis.

A migração do novo editor está no checkout, mas não há evidência de aplicação no Supabase hospedado. A prévia deve identificar gravações locais sem anunciar sincronização, compartilhamento ou permissões remotas que não foram confirmados. A prévia do jogador no mesmo navegador é uma ferramenta de visualização e não substitui autorização no servidor.

Esta entrega não inclui publicação pública, aplicação de migrations remotas, compra de créditos ou ativação de integrações pagas.
