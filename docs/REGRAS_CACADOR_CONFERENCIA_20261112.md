# Conferência de regras de Caçador, 12/11/2026

## Fonte e escopo

Conferência visual do livro básico *Caçador: A Revanche*, PDF local `hunter.pdf`, cotejado com a extração `hunter.txt`. As páginas abaixo são as impressas no livro. A extração textual está incompleta nas páginas iniciais, então os trechos citados foram lidos na imagem do PDF. Nenhum texto extenso da obra foi copiado.

## Divergências corrigidas no catálogo novo

- **Criação, p. 90:** a escolha é 2 Triunfos ou 1 Triunfo e 2 Distinções. A validação dizia 2 Triunfos e 1 Distinção ou 1 Triunfo e 2 Distinções.
- **Catálogo, pp. 89–100:** o livro básico lista 12 Triunfos: Acesso Global, Equipamento Improvisado, Encantador de Feras, Jóquei de Drones, Arsenal, Artilharia, Biblioteca, Frota, Artefato, Frustrar o Sobrenatural, Repelir o Sobrenatural e Sentir o Sobrenatural. Os nomes e Distinções por Triunfo foram atualizados nos catálogos web e servidor.
- `Vira-Casaca` e `Purificar o Sobrenatural` não aparecem no livro básico conferido. O Drive tinha um documento chamado *Suplemento: Aliados Animais - Caçadores*, com autoria declarada “Manus AI” e data 29/07/2026; ele não contém esses nomes nem amplia o catálogo de Triunfos. Não o tratei como fonte oficial. As opções antigas ficam aceitas em validação de perfis v4, mas não aparecem nas escolhas novas.
- **Aflição, p. 90:** Distinções não precisam de dados de Desesperação. Portanto, a Aflição não bloqueia o uso delas. A restrição a dados adicionais de Desesperação permanece.
- **Desesperação, pp. 127–128:** se houver sucesso e um ou mais resultados 1 nos dados de Desesperação, o jogador escolhe conservar o sucesso e aumentar Perigo em 1 por cada 1 (`Forçar a Barra`), ou falhar e entrar em Aflição. Em falha com 1, há Aflição.
- **Pilares, pp. 56 e 282:** são pessoas com vínculo significativo, até três na criação. A ficha traz Pilares; o texto conferido não define pares Convicção/Pedra de Toque. Perfis aprovados v4 não foram reescritos nesta alteração.

## Ainda pendente

- A nova ficha v5 representa até três pessoas em Pilares livres. Perfis v4 guardam os campos Convicção/Pedra de Toque e não são migrados automaticamente.
- A migration SQL resolve falha com 1 automaticamente, atribui a escolha de sucesso ao autor da rolagem e soma Perigo por cada 1. Foi verificada no banco descartável pela suíte completa de 13/11/2026, com 79 migrations e 1.296 asserções. A aplicação e a validação no Supabase hospedado permanecem pendentes.
- Vantagens, Defeitos, custos e regra de especializações não foram conferidos nesta auditoria.
- Não foi encontrada fonte de suplemento oficial que valide `Vira-Casaca` ou `Purificar o Sobrenatural`; o suplemento de Aliados Animais não cobre essas opções.

## Arquivos alterados nesta etapa

- `frontend/lib/hunter-traits.ts`
- `backend/app/domain/hunter_traits.py`
- `frontend/lib/hunter-creation-data.ts`
- `frontend/lib/system-starters.ts`
- `mobile/src/lib/hunter-traits.ts`
- `mobile/src/lib/system-starters.ts`
- `frontend/components/hunter-roll-card.tsx`
- `frontend/components/system-roll-panel.tsx`
- `mobile/src/lib/game/table-rules.ts`
- `mobile/src/components/game/HunterTablePanel.tsx`
- `backend/app/domain/hunter_traits.py`
- `supabase/migrations/20261112130000_hunter_rules_source_corrections.sql`
- `docs/REGRAS_CACADOR_CONFERENCIA_20261112.md`
