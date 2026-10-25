---
name: adicionando-sistema-rpg
description: Use when adding a new tabletop RPG system to RPG-Atlas or upgrading an existing one (new starter, creation rules, ancestry/clan grants, dice roller, map kit), or when asked which files a new system touches.
---

# Adicionando um sistema de RPG ao RPG-Atlas

## Visão geral
Um sistema é um **starter em TypeScript** espelhado no mobile. API e banco validam qualquer modelo pelos próprios `min`/`max`, `options` e `creation_rules`; não existe lista de sistemas no backend. A maior parte do risco está em **esquecer um espelho ou um registro de teste**, não no código.

Exemplo completo: Shadow of the Demon Lord (`shadow-demon-lord`), em `docs/CHECKLIST_SOTDL.md`.

## Antes de começar
- Prefira as regras existentes: `group_distribution`, `group_sum`, `points_budget`, `select_grants` (aceita `add` negativo, −100..100), `power_picks`, `priority_points`.
- Regra **nova** exige as três camadas: `frontend/lib/sheet-template.ts` + lógica, `backend/app/services/creation_rules.py` e uma migração nova (copie a última versão da função, nunca edite migração antiga) + teste pgTAP. Nunca mude o comportamento de uma regra existente: modelos aprovados dependem dela.
- `identity_kind` novo: `sheet-template.ts` (web e mobile), `Literal` em `backend/app/models.py` e validadores SQL.
- Trilhas (estresse, dano, Força de Vontade) são campos `number` com limites; gasto controlado vai em `meta_currencies` (`pool` ou `track`). Não precisam de regra nova.
- Wizards: `frontend/components/sheet-creation-wizard.tsx` e `mobile/src/routes/fichas.nova.tsx`. A ajuda é por etapa; ajuda por opção (por classe/playbook) ainda não existe: crie-a genérica em `step-help.ts`, nunca por `system_key` no wizard.
- Números sem fonte conferida ficam marcados "conferir no livro" no doc. Só nomes e números, nunca texto do livro.

## Checklist (copie para `docs/CHECKLIST_<SIS>.md` e marque só o verificado)

| Arquivo | O que mudar |
|---|---|
| `frontend/lib/<sis>-creation-data.ts` | Nomes, números, `GrantCase[]`, `<SIS>_STEP_HELP` |
| `mobile/src/lib/<sis>-creation-data.ts` | Cópia byte a byte |
| `frontend/lib/system-starters.ts` | Id na união, `makeStarter`, limites, `creation_rules`, `SYSTEM_STARTERS`, `starterMetadata` (+ tipo de `identities`) |
| `mobile/src/lib/system-starters.ts` | Mesmo bloco, sem `experiencia` e meta moedas |
| `frontend/lib/step-help.ts` + `mobile/src/lib/step-help.ts` | Entrada em `STEP_HELP_BY_SYSTEM` (nunca outro `system_key === "x"` no wizard) |
| `scripts/package-mobile-source.mjs` | Novo arquivo de dados na lista |
| `frontend/components/sheet-creation-wizard-fixture.tsx` | Id no filtro de `/dev/sheet-wizard` |
| `backend/app/services/system_rolls.py` + `routes/system_rolls.py` | Request `extra="forbid"`, `roll_<sis>`, rota |
| `frontend/components/system-roll-panel.tsx` | Detecte por `values.sistema === "<rótulo>"` antes da heurística por campos |
| `mobile/src/lib/dice.ts` + `components/nexus/DicePanel.tsx` | Função local + aba |
| `map-kits.ts`, `saved-maps-panel.tsx`, `map-editor.tsx` | Kit e opção do dropdown |
| `mobile/src/routes/fichas.nova.tsx` | Descrição da página |
| `docs/<SIS>_CRIACAO_GUIADA.md`, `README.md`, `STATUS_FUNCIONALIDADES.md` | Fonte, tabelas, limites, versão do modelo |

## Testes obrigatórios
- `backend/tests/fixtures/<sis>_starter.json` gerado do starter (`JSON.stringify(template, null, 2)`) e `deepEqual` no teste web.
- `frontend/tests/<sis>-creation.test.mjs` **registrado à mão** em `test:domain` de `frontend/package.json`; compare regras e ids com o mobile e o arquivo de dados byte a byte.
- `backend/tests/test_<sis>_creation.py` (cada caso passa em `prepare_sheet_creation`, fórmulas batem, violação recusada).
- `test_system_rolls.py` com `force_rolls`; **`test_api.py`**: rota nova na lista de 401.
- `supabase/tests/rpg_<sis>_*.test.sql` quando a regra usar algo novo (negativos, escolhas).
- Rode `npm run test:web`, `test:api`, `test:db`, `test:mobile`, `test:mobile:ui` e `npx tsc --noEmit -p .` em `frontend` e `mobile`; depois o wizard em `/dev/sheet-wizard` (desktop e 390 px).

## Erros comuns
| Erro | Correção |
|---|---|
| "São só 3-4 arquivos" | São ~15 com testes; use a tabela |
| Arquivo `.test.mjs` novo não roda | Faltou registrar em `test:domain` |
| Mobile divergiu do web | Teste de igualdade no `.test.mjs` |
| Mudou o starter e a campanha não vê | Modelo aprovado no Supabase não muda; gestor aprova nova versão |
