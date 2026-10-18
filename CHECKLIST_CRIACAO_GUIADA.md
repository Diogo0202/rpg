# Checklist de criação guiada

Estados: pendente, em andamento, concluído, aguardando material. Uma tarefa recebe `[x]` somente após implementação e verificação. As evidências locais não confirmam aplicação de migração remota ou publicação.

## Base existente

- [x] Modelos aprovados por campanha. Evidência: consulta em `SheetBuilder`.
- [x] Fórmulas pela API. Evidência: `/api/v1/sheets/calculate`.
- [x] Seleção de ficha para a sessão. Evidência: `selectCharacter` após salvar.

## Melhorias deste ciclo

| Item | Responsável | Estado | Evidência |
| --- | --- | --- | --- |
| Contratos opcionais e modelos antigos | Coordenador + backend | Concluído localmente | Tipos compartilhados, Pydantic e testes de criação |
| Assistente por etapas e identidades | Interface | Concluído localmente | Componente `SheetCreationWizard`, modelos-base e testes de domínio |
| Nome único e validação por etapa | Interface + coordenador | Concluído localmente | Testes de domínio, backend e foco conferido no Chromium |
| Prévia automática e criação autenticada | Backend + coordenador | Concluído localmente | POST usa modelo aprovado do banco; cálculo antes do insert; entradas sem derivados |
| Salvar, selecionar e recuperar falhas | Coordenador | Concluído com serviços simulados | Construtor real no Chromium: falha 503 preservou ficha, nova tentativa selecionou personagem; zero inserts diretos e zero rolagens |
| Compatibilidade de backup e migração SQL | Compatibilidade | Código concluído; execução SQL pendente | 4 testes de domínio; nova migração e teste pgTAP preparados |
| Verificação em celular e computador | Coordenador | Concluído com dados de teste | Chromium 1440×1000 e 390×844: sem overflow horizontal ou erros JS; listas com múltiplas linhas |
| Execução da migração e teste pgTAP | Compatibilidade | Pendente de PostgreSQL/Supabase | Nenhum runtime local disponível; nenhum banco remoto alterado |
| Perfis completos V5, Caçador e O Um Anel | Backend | Aguardando material | Material autorizado ainda não fornecido |

- [x] Contratos opcionais verificados.
- [x] Assistente e identidades verificados.
- [x] Nome único e validação por etapa verificados.
- [x] Prévia e criação pela API verificadas com serviços simulados.
- [x] Salvamento, seleção e recuperação de falhas verificados com serviços simulados.
- [x] Compatibilidade de backups verificada; migração e teste SQL escritos.
- [x] Fluxo conferido em telas pequenas e grandes com dados de teste.
- [ ] Migração e teste pgTAP executados em PostgreSQL/Supabase.
- [ ] Perfis completos implementados a partir de material autorizado.

## Coordenação

Três agentes `gpt-6-luna` trabalharam em paralelo, em arquivos exclusivos. O coordenador integrou os contratos e o construtor. Os agentes também revisaram contratos e integração de outras frentes. As mudanças de segurança anteriores foram preservadas. Não houve commit, publicação ou aplicação de migração remota.

## Evidências de 17/10/2026

- `npm run test:api`: 171 testes passaram. Aviso de depreciação AnyIO/Starlette, sem falhas.
- `npm run test:web`: 36 testes passaram. Aviso do Node sobre detecção de módulos TypeScript, sem falhas.
- `npm run lint`: TypeScript passou.
- `npm run build`: compilação de produção passou, sem rotas de verificação.
- Chromium: componente real conferido nos dois tamanhos de tela; nomes e escolhas preservados ao voltar, campos obrigatórios com foco, resultados calculados na revisão, texto HTML tratado como texto e listas com quebra de linha.
- Chromium: `SheetBuilder` real com autenticação, Supabase e API simulados; POST autenticado, sem derivados em `values`, sem gravação direta no Supabase, falha 503 recuperável e seleção do personagem após sucesso.
- Capturas e resultados locais: `%TEMP%\rpg-guided-verification`. As rotas temporárias de teste foram removidas.
- A suíte Python simula o acesso ao Supabase. Esses resultados não comprovam RLS nem persistência num banco real.

## Dependências restantes

As regras completas de criação de V5, Caçador e O Um Anel aguardam o material autorizado. Nenhum perfil oficial foi presumido; modelos sem perfil continuam com validação genérica e fórmulas. Um perfil versionado ainda sem suporte é recusado pela criação autenticada, em vez de ser aplicado parcialmente.

A nova migração `20261017100000_sheet_creation_backup_metadata.sql` deve ser executada em banco de teste com a sequência anterior, junto de `supabase/tests/rpg_creation_backup_metadata.test.sql`. Ela ignora somente os três metadados de apresentação ao comparar campos. A criação direta e a restauração continuam sujeitas à validação estrutural/RLS do banco; regras semânticas completas de criação não são uma garantia global desses caminhos.
