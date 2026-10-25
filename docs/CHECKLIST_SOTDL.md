# Checklist — Shadow of the Demon Lord (SotDL) no RPG-Atlas

Sistema `shadow-demon-lord`. Fonte: resumo de regras da campanha Trench Crusade
(`D:\megabrain\Atlas_RPG\historias\Trench_Crusade\manual_de_regras_shadow_of_the_demon_lord_*.md`).
Só nomes e números; nada de texto do livro. Itens marcados **conferir no livro** dependem de validação do mestre.

Marque `[x]` só depois de verificado (teste passando ou conferência no app).

## 0. Preparação
- [x] Trabalho pendente (Caçador v2, V3, grants) commitado em `feat/atlas-mapas-fichas-seguranca`
- [x] Branch `feat/sotdl` criada
- [x] Baseline da skill (RED) disparado com 3 subagentes
- [x] `select_grants` aceita ajustes negativos (TS, Pydantic `AddMap` −100..100, SQL numeric) — sem migração nova

## 1. Especificação (S)
- [x] Campos: identidade, 4 atributos + modificadores, características, recursos, história
- [x] Ancestralidades Humano, Transmorfo, Autômato, Anão, Goblin, Orc como `GrantCase` (**conferir no livro**)
- [x] Humano (+1) e Autômato (+2) com escolha de atributo
- [x] Homebrew Trench Crusade: Fervor (pool), Fé (Cristão/Herege), Último Alento

## 2. Dados e starter (A)
- [x] `frontend/lib/sotdl-creation-data.ts`
- [x] `mobile/src/lib/sotdl-creation-data.ts` idêntico ao web (teste de igualdade)
- [x] `frontend/lib/system-starters.ts`: id na união, bloco `makeStarter`, `SYSTEM_STARTERS`, `starterMetadata` (`race`)
- [x] `mobile/src/lib/system-starters.ts`: espelho (sem experiência e meta moedas, como os demais)
- [x] Ajuda por passo genérica (`lib/step-help.ts`) no wizard web e no mobile, no lugar do ramo fixo do Caçador
- [x] `scripts/package-mobile-source.mjs` leva os arquivos de dados importados por `system-starters`

## 3. Rolador d20 (P → A)
- [x] `backend/app/services/system_rolls.py`: `roll_sotdl` e `roll_sotdl_fate`
- [x] Rotas `/api/v1/system-rolls/shadow-demon-lord` e `/shadow-demon-lord/fate`
- [x] `frontend/components/system-roll-panel.tsx`: modo SotDL (dádivas, perdições, alvo, teste de destino)
- [x] `mobile/src/lib/dice.ts`: `rollSotdl` + aba "d20 Demon Lord" no `DicePanel`

## 4. Integrações
- [x] Dropdowns de mapa (`saved-maps-panel.tsx`, `map-editor.tsx`) e kit medieval em `map-kits.ts`
- [x] `docs/SOTDL_CRIACAO_GUIADA.md`
- [x] `STATUS_FUNCIONALIDADES.md` e `README.md` atualizados

## 5. Testes (R)
- [x] Fixture `backend/tests/fixtures/sotdl_starter.json` + teste de drift web
- [x] `frontend/tests/sotdl-creation.test.mjs` registrado em `frontend/package.json` (`test:domain`)
- [x] `backend/tests/test_sotdl_creation.py` (cada ancestralidade passa em `prepare_sheet_creation`)
- [x] `backend/tests/test_system_rolls.py` e `test_api.py` cobrem SotDL
- [x] `supabase/tests/rpg_sotdl_ancestry.test.sql` (ajustes negativos e escolha do Humano no banco)
- [x] Teste mobile do `rollSotdl` (`mobile/src/lib/dice.test.ts`)
- [x] `npm run test:web` (96) · `test:api` (417) · `test:db` (432) · `test:mobile` (37, 2 pulados já existentes) · `test:mobile:ui` (68) · `tsc` web e mobile

## 6. Conclusão (C)
- [x] Wizard em `/dev/sheet-wizard` com SotDL: Goblin (For 8, Agi 12) e Humano com Vontade +1, em desktop e 390 px, sem erros no console
- [ ] Rolagem pelo painel da sessão conferida com login real (coberta só por testes de API)
- [ ] Mestre conferiu números marcados **conferir no livro**
- [ ] Gestor carregou o starter no editor de modelos e aprovou na campanha

## 7. Skill `adicionando-sistema-rpg`
- [x] RED: sem a skill, os planos esqueceram o registro em `test:domain`, `package-mobile-source.mjs`, a lista de 401 em `test_api.py` e a fixture de `/dev/sheet-wizard`, e propuseram mais um `system_key === "x"` no wizard (um dos três baselines leu este checklist e não conta)
- [x] GREEN: `.claude/skills/adicionando-sistema-rpg/SKILL.md`; sob a mesma pressão ("só 3-4 arquivos") o plano cobriu todos os itens
- [x] REFACTOR: acrescentados trilhas como `number`/`meta_currencies`, arquivos dos wizards e ajuda por opção como recurso genérico pendente
- [ ] Commit final
