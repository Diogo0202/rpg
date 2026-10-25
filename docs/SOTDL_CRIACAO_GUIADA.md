# Criação guiada de Shadow of the Demon Lord

Revisão de 25/10/2026. Sistema `shadow-demon-lord`, usado na campanha Trench Crusade.

## Fonte conferida

O núcleo vem do resumo de regras da campanha em `D:\megabrain\Atlas_RPG\historias\Trench_Crusade\manual_de_regras_shadow_of_the_demon_lord_md_dj6vfgkl9fvr.md` (cópia do Drive `Demon Lord/trench crusade/`). O acervo não tem o livro base extraído; o PDF `dd-5e-shadow-of-the-demon-lord.pdf` está apenas catalogado.

O contrato contém nomes curtos e números. Nenhuma descrição de regra do livro foi copiada. Os números marcados **conferir no livro** não constam do resumo e precisam da confirmação do mestre antes de uso em mesa.

## Núcleo (do resumo)

- Teste: d20 + (atributo − 10). Desafios contra 10; ataques contra a Defesa ou um atributo do alvo.
- Dádivas e perdições se anulam 1 a 1. As que sobram rolam d6 e só o maior vale, somado (dádivas) ou subtraído (perdições).
- Atributos de 1 a 20: Força, Agilidade, Intelecto e Vontade. Os modificadores são fórmulas `atributo - 10`.
- Defesa = Agilidade, Saúde = Força, Percepção = Intelecto, cada uma mais o bônus da ancestralidade. Taxa de cura = `saude // 4` (**conferir no livro**).
- Teste de destino do incapacitado (1d6): 1 morrendo, 2 a 5 estável, 6 recupera 1 de dano.
- Aflições: Assustado, Debilitado, Lento e Atordoado, registradas na coleção `aflicoes`.

## Ancestralidades (conferir no livro)

A ancestralidade fixa, no nível 0, os quatro atributos, o deslocamento e os bônus. Uma regra `select_grants` com base 10 em cada atributo e 10 de deslocamento exige o valor exato; o assistente preenche os campos sozinho.

| Ancestralidade | For | Agi | Int | Von | Outros |
| --- | --- | --- | --- | --- | --- |
| Humano | 10 | 10 | 10 | 10 | +1 em um atributo à escolha |
| Transmorfo | 9 | 10 | 10 | 10 | Percepção +1 |
| Autômato | 9 | 8 | 9 | 9 | +2 em um atributo à escolha; Defesa +5; deslocamento 8 |
| Anão | 10 | 9 | 10 | 10 | Saúde +4; Percepção +1; deslocamento 8 |
| Goblin | 8 | 12 | 10 | 9 | Percepção +1 |
| Orc | 11 | 10 | 9 | 9 | Percepção +1; Corrupção 1; deslocamento 12 |

Tamanho fica como texto livre. Trilhas de novato, especialista e mestre são textos nesta versão; os ganhos por nível não são calculados.

## Regras da campanha Trench Crusade

- **Pontos de Fervor** (`fervor`, máximo em `fervor_max`): recurso do tipo `pool`, gasto pelo RPC de meta moedas.
- **Fé** (Cristão ou Herege): define a consequência da Crise de Convicção ao chegar a 0 PF.
- **Último Alento** (`ultimo_alento_usado`): marca para heróis de nível 9+ com 0 PF.

A ajuda da etapa de recursos apresenta essas regras como opcionais da campanha. O app não aplica automaticamente os efeitos da Crise de Convicção.

## Rolagens

- API: `POST /api/v1/system-rolls/shadow-demon-lord` (`attribute`, `boons`, `banes`, `target`) e `POST /api/v1/system-rolls/shadow-demon-lord/fate`.
- Crítico: total 20 ou mais e pelo menos 5 acima do alvo (**conferir no livro**).
- Web: painel de rolagens da sessão, detectado pelo campo `sistema` da ficha.
- Mobile: aba "d20 Demon Lord" no rolador local, sem envio à mesa.

## Aplicação por campanha

O starter nasce na versão 1. Para usar na campanha, o gestor carrega "Shadow of the Demon Lord" no editor de modelos, salva e aprova. Mudanças futuras no starter não alteram modelos já aprovados no Supabase; publique uma nova versão.

Não houve migração: `select_grants` já aceita ajustes negativos no TypeScript, no Pydantic (−100 a 100) e no PostgreSQL.

## Verificação local

Veja `docs/CHECKLIST_SOTDL.md`.
