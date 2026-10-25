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
- [x] Concluir build e validação no Lovable. A tentativa de 22/10 ficou sem créditos; a nova execução de 24/10 concluiu testes, typecheck e build padrão.
- [x] Confirmar a prévia hospedada atualizada. Em 24/10 ela carregou RPG-Atlas, o atalho Criar mapa e as abas Entidades/Mapas.

## Resultado e limites

A primeira rodada, em 22/10, salvou código sem atualizar a prévia validada. A continuação de 24/10 concluiu o build e a conferência real do site. Em 25/10, a consulta ao projeto confirmou o commit final `11ee2994ef434d4b2f383dbdfd2d15c30dc5cc93`, estado `ready`, sem publicação pública. Prévia: https://id-preview--41495b5b-e95b-4184-b10a-e653025f812c.lovable.app/mundo?aba=mapas.

A cópia isolada usa os arquivos enviados e doze arquivos recuperados do commit do Lovable. Antes das correções finais de mapas, passaram 62 testes em 18 arquivos, `tsc --noEmit` e build local Vite com `RPG_MOBILE_LOCAL_BUILD=1`. Isso não equivale ao build Nitro/Cloudflare do Lovable. A interface foi conferida em http://127.0.0.1:4187.

A revisão encontrou uma corrida entre leitura de versão e gravação do mapa, e uma lista que podia receber uma resposta da campanha anterior. Ambas receberam correções enviadas ao Lovable na rodada de 24/10. Nenhum dado da origem hospedada foi apagado para contornar cache.

## Escopo solicitado

A atualização inclui identidade RPG-Atlas, fichas guiadas e backups, dados V5 com previsão de risco, tema escuro e criação de mapas. O editor de referência oferece grade, muros, casas, portas, sombras, objetos, pins e histórico de desfazer/refazer. O computador recebe a edição completa; a interface móvel precisa manter biblioteca e visualização acessíveis.

A migração do novo editor está no checkout, mas não há evidência de aplicação no Supabase hospedado. A prévia deve identificar gravações locais sem anunciar sincronização, compartilhamento ou permissões remotas que não foram confirmados. A prévia do jogador no mesmo navegador é uma ferramenta de visualização e não substitui autorização no servidor.

Esta entrega não inclui publicação pública, aplicação de migrations remotas, compra de créditos ou ativação de integrações pagas.

## Continuação em 24/10/2026

- [x] Corrigir a comparação de versão e gravação na mesma transação IndexedDB, recusando a segunda gravação de uma versão já superada.
- [x] Validar nome na atualização, vincular listas à partição e limpar estados de diálogo/renomeação na troca de conta ou campanha.
- [x] Corrigir contraste dos botões Biblioteca e Exportar JSON na cópia isolada.
- [x] Repetir a suíte da cópia corrigida: 65 testes em 20 arquivos, typecheck e build local passaram.
- [x] Guardar pacote revisável com 93 arquivos em `outputs/atualizacao-site-2026-10-22/rpg-atlas-atualizacao-verificada-local.json` na pasta desta conversa. Ele não contém credenciais nem dependências instaladas.
- [x] Enviar ao Lovable os cinco arquivos de correções, testes e fixture. A execução `umsg_01m5qcesctfbqbrjaw6hbmjrkt` foi aceita em modo normal em 24/10.
- [x] Confirmar o resultado dessa execução e conferir a prévia hospedada.

Os testes novos usam uma simulação mínima de IndexedDB para concorrência e partições, e um JSON obtido pela exportação real no navegador. Não foi executado teste React específico da troca de conta; essa proteção recebeu revisão estática. Os testes não comprovam RLS hospedado ou sincronização dos mapas.

## Entrega confirmada

O Lovable informou 65 testes em `bunx vitest run`, `tsc --noEmit` com saída zero e build padrão concluído após corrigir a escolha do diretório do service worker em `pwa-build.ts`. O destino Cloudflare desta prévia grava em `dist/client`; outros presets Nitro podem gravar em `.output/public`. A cópia local anterior já passava no build local, mas ainda não continha esse ajuste do build padrão.

A conferência direta na origem hospedada criou `Refúgio Atlas (verificação)`, com estilo Vampiro V5 moderno. Casa poligonal, piso e NPC foram salvos e permaneceram após recarga: duas estruturas e um pin. A exportação real `Refúgio-Atlas-verificação-.json` foi lida e validada como JSON, formato `rpg-nexus-map`, documento versão 2 e sistema `vampire-v5`. O nome legado do formato foi preservado.

Depois de marcar o NPC como reservado ao narrador, a prévia do jogador deixou o SVG sem o rótulo do pin e sem a nota privada no DOM renderizado. A ficha anterior `Teste Mobile V5` e as sete operações pendentes continuaram presentes. Isso confirma preservação observada nesta origem, não uma auditoria de todos os dados do navegador.

A conferência móvel hospedada em 390×844 foi reportada pelo agente Lovable. O coordenador conferiu diretamente a interface desktop hospedada e a versão móvel local. A ferramenta de navegador deixou de estar disponível antes da captura final hospedada e da repetição móvel pelo coordenador. A imagem local salva em `rpg-atlas-mapas-local-20261024.png` não deve ser apresentada como captura da origem hospedada.

Os mapas são locais ao aparelho. Compartilhamento entre contas, sincronização de mapas e RLS de mapas hospedados permanecem fora desta entrega. Nenhuma migration remota foi aplicada.
