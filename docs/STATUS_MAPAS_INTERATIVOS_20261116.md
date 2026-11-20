# Estado dos mapas interativos em 16/11/2026

Registro do trabalho local para o commit solicitado pelo usuário. A implementação está em andamento e ainda não tem aceite final.

## Alterações registradas

A primeira implementação inclui configuração de objetos interativos e pedidos de aprovação, integração web e mobile, helpers de edição de salas e uma migration para objetos e pedidos de mapa. A configuração das skills foi aprovada pelo usuário e consta de AGENTS.md e docs/agents/.

O trabalho inicial foi dividido entre três subagentes Lua 6, em paralelo. A revisão encontrou defeitos e encaminhou a geometria ao Sol 6.1. Os agentes foram interrompidos por limite de uso antes de concluir a revisão e a integração. O código deste commit não representa entrega aprovada.

## Verificações desta rodada

- Frontend: npm run lint (TypeScript), aprovado.
- Mobile: npm run typecheck, aprovado.
- Domínio de mapas: 15 testes aprovados em frontend/tests/map-editor.test.mjs e frontend/tests/map-interactions.test.mjs.
- Banco descartável PGlite: 80 migrations carregadas e 34 asserções aprovadas em rpg_map_editor.test.sql.
- A nova execução confirmou quatro falhas nos componentes de interação por duas instâncias de React entre frontend e mobile. Os seis testes de criação do Caçador passaram nessa mesma execução. A correção de React ainda não foi aplicada.

## Pendências confirmadas pela revisão

- Corrigir os corredores: no cenário de duas salas alinhadas horizontalmente, as portas foram abertas na parede superior e o caminho entre as salas continuou bloqueado. Os testes atuais não detectam esse defeito.
- Corrigir duplicação de seleções que contenham pins: a implementação atual só copia estruturas.
- Concluir a revisão de deslocamento, limites do mapa e edição/redimensionamento de salas, preservando vãos e geometria.
- Eliminar a duplicação de React na integração do editor compartilhado com o mobile e repetir os testes de componentes e o build.
- Concluir a fila persistente dos pedidos e a integração da edição offline com os mapas sincronizados.
- Revisar a migration de interações com testes de permissões, neblina por solicitante, portas em todos os segmentos, repetição de operações e alteração concorrente de estoque.
- Revisar a passagem entre mapas, preservando pins sem sheet_id e movendo apenas o personagem solicitante.
- Executar a revisão integrada, os testes completos pertinentes e os builds. Validar staging autenticado e Android físico em rodada própria.

Nenhuma migration desta tarefa foi aplicada no ambiente hospedado. Nenhum deploy foi realizado. O plano aprovado continua em docs/PLANO_MAPAS_INTERATIVOS_20261115.md.
