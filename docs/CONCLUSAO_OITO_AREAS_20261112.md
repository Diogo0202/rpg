# Conclusão das oito áreas

Registro de trabalho de 12/11/2026 em `D:\rpg-github`. A entrega continua aberta. As verificações abaixo são locais, com banco descartável e serviços simulados quando indicado.

## Critério de aceite

O aceite exige código integrado e testes aprovados, seguido de validação em staging separado e Android físico. Produção e iPhone ficam para outra entrega. A conferência abrange os livros básicos e os suplementos já previstos pelos catálogos; uma regra sem fonte permanece pendente.

As alterações anteriores sem commit foram preservadas. Nenhuma migration remota foi aplicada nesta rodada.

## Estado por área

| Área | Mudança ou evidência desta rodada | Trabalho ainda exigido |
| --- | --- | --- |
| Mobile e sincronização | Fila da Mesa no resumo, partição por conta/campanha/aparelho, limpeza no logout, bloqueio por revogação, migração de recibos identificados e transações entre abas. | Fechar a rodada final de testes e ensaiar instalação e reconexão no Android físico. Recibos antigos sem campanha ficam preservados para exportação, sem envio automático. |
| Contas e permissões | Dono e mestres administram outros mestres. RPCs e proteção de gravação direta preservam o dono e impedem troca de identidade de membros. | E-mail real e matriz de papéis com JWTs em staging. |
| Fichas e cálculos | Testes de histórico e restauração conferidos. Pedidos de XP reservam saldo; atualizações genéricas também respeitam a reserva. | Persistência e concorrência com sessões reais no destino. |
| Vampiro V5 | Remendar e Surto em desenvolvimento, conferência de excesso de Manchas e integração das ações ao painel. | Revisão completa da integração e dos catálogos nas fontes. |
| Caçador | Validação prévia de Triunfos/Distinções acrescentada. A leitura do livro identificou divergências nos Pilares e no catálogo. | Corrigir os dados em perfil novo, preservar modelos anteriores e concluir a conferência. |
| Vampiro V3 | Estado persistente de Torpor/Morte Final, alimentação confirmada pelo narrador, recibos de operação e bloqueio de ações incompatíveis. Especialização passou a rerrolar resultados 10 recursivamente. | Conferência dos demais catálogos e ensaio hospedado. O narrador registra o repouso e o resultado do teste antes de confirmar Despertar. |
| O Um Anel v3 | 735 casos de paridade e gravação, 15 cenários de navegador e integração local passaram. | Conferência final das fontes do escopo e teste autenticado hospedado da criação e Companhia. |
| Probabilidades e rolagens V5 | Mobile passou a comparar todas as escolhas de dados comuns, com 243 casos contra Python. A previsão web de ficha salva lê Fome, dano e efeitos pelo endpoint autorizado do servidor. | Repetição hospedada e revisão final de Surto, dano e histórico. |

## Evidências reproduzíveis

Resultados intermediários, anteriores às últimas alterações dos agentes:

| Comando | Resultado observado |
| --- | --- |
| `npm run test:db` | 74 migrations locais, 58 arquivos e 1.250 asserções aprovadas. |
| `npm run test:web` | 313 testes aprovados. |
| `.venv/Scripts/python.exe -m pytest -q` em `backend` | 1.797 testes aprovados. |
| `npm run test:one-ring:db` | 735 casos aprovados no PostgreSQL descartável. |
| `npm run test:one-ring:ui` | 15 cenários aprovados, sem erro de página. |
| `npm run test:mobile:integration` | Oito verificações aprovadas no percurso TypeScript, FastAPI e PostgreSQL local. |
| `npm run test:table:ui` | Quatro cenários Chromium aprovados com componentes reais e API simulada. |
| Builds web e mobile | Aprovados antes das últimas alterações; repetir no fechamento. |

O teste mobile de paridade identificou diferença entre as bibliotecas V5 web e mobile durante a integração. A rodada completa também apresentou timeout do teste de revisão do shell PWA sob carga. Esses resultados exigem correção ou verificação adicional; não contam como suíte mobile aprovada.

## Fontes conferidas nesta rodada

- V3, livro básico Revisado fornecido no Drive, ID `1MTZJkyzQNQV-AMCiZtzVF_F_hxLi-cGN`: especialização na página 117; estados de existência e dano nas páginas 216 a 218. O texto integral permanece fora do repositório.
- V5: a [tabela corrigida de Potência do Sangue da editora](https://renegadegamestudios.com/content/File%20Storage%20for%20site/VTM/BloodPotencyTable.pdf) corresponde aos números da tabela em código. As demais mecânicas exigem seu próprio registro de conferência.
- Caçador: PDF fornecido no Drive, ID `1aGFrQxTxi3oG3eQZIST9B8es_fQlX3fw`. A auditoria em andamento deve registrar as páginas e as correções específicas, sem tratar a leitura parcial como aprovação de todo o catálogo.

## Ambiente hospedado

As consultas conectadas encontraram o projeto Supabase `rpg`, com apenas a branch `main` identificada e estado de branch `MIGRATIONS_FAILED`. Duas consultas ao histórico de migrations terminaram por timeout. Isso não comprova a quantidade atual de migrations aplicadas.

Na retomada, a leitura SQL e a consulta de migrations expiraram novamente. O endpoint PostgREST respondeu HTTP 401 com as duas chaves públicas retornadas pelo conector, moderna e legada. Nenhuma chave foi gravada no repositório ou incluída neste relatório.

O projeto Vercel `rpg-teste` existe. Sua última implantação consultada apresentou `ERROR`, e o projeto informou `live: false`. A conexão Railway pediu reautenticação. Os diretórios locais examinados contêm arquivos de exemplo de configuração, sem ambiente de staging pronto.

O usuário informou que dispõe do projeto Supabase `rpg` e ainda não conseguiu um celular para auditar a aplicação. Um ambiente separado não foi identificado. O ensaio hospedado depende de restabelecer acesso ao destino e conferir seu schema antes de qualquer atualização. A auditoria em Android físico permanece pendente por indisponibilidade do aparelho. Nenhum percentual foi elevado para 100% com base nos testes locais.
