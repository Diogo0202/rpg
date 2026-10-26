# O Um Anel 2ª edição: ficha v2 e rolador

Revisão de 26/10/2026 (Frente J). O contrato guarda nomes curtos e números. Nenhum texto do livro foi copiado. **Todos os números abaixo precisam ser conferidos no Core Rules** antes de aprovar o modelo numa campanha.

Código: [regras web](../frontend/lib/one-ring-rules.ts) (cópia em `mobile/src/lib`), [serviço](../backend/app/services/one_ring.py) e [rolador](../backend/app/services/system_rolls.py).

## Ficha (starter `one-ring`, versão 2)

| Item | Regra aplicada | Conferir |
| --- | --- | --- |
| Atributos | Corpo, Coração e Astúcia, de 2 a 7, somando 14 na criação (`group_sum`) | soma e faixa |
| TN | `20 - atributo` em `tn_corpo`, `tn_coracao`, `tn_astucia` | base 20 |
| Cultura | concede `base_vigor`, `base_esperanca`, `base_aparar` (`select_grants`) | tabela abaixo |
| Vigor máximo | `corpo + base_vigor` | |
| Esperança máxima | `coracao + base_esperanca` | |
| Aparar | `astucia + base_aparar + bonus_escudo` | |
| Carga com Cansaço | `carga + cansaco` | |
| Sombra total | `sombra + cicatrizes` | |
| Perícias | 18, de 0 a 6, em três grupos de seis | grupos |
| Favorecidas | até 3, lista fechada das 18 perícias | quantidade |
| Proficiências | Machados, Arcos, Lanças, Espadas, de 0 a 6 | |
| Valor e Sabedoria | de 1 a 6 | valor inicial |
| Virtudes, Recompensas | listas de até 12 itens de 120 caracteres | |
| Traços distintivos, Defeitos da Sombra | até 4 itens de 80 caracteres | |

| Cultura | Vigor | Esperança | Aparar |
| --- | --- | --- | --- |
| Anões do Povo de Durin | 22 | 8 | 10 |
| Bardeses | 20 | 8 | 12 |
| Elfos de Lindon | 20 | 8 | 12 |
| Hobbits do Condado | 18 | 10 | 12 |
| Homens de Bri | 20 | 10 | 10 |
| Patrulheiros do Norte | 20 | 6 | 14 |

A ficha v1 (Força, Espírito e seis perícias) continua válida no modelo já aprovado. `migrate_one_ring` / `migrateOneRing` convertem Força em Corpo e Espírito em Astúcia e aplicam as bases da cultura.

## Estados e rolador

- **Cansado:** Vigor atual ≤ Carga + Cansaço. Dados de Sucesso de 1 a 3 valem 0.
- **Miserável:** Sombra + Cicatrizes ≥ Esperança atual, ou marcado pela mesa. O Olho de Sauron no dado de Feito vira falha automática, mesmo com total suficiente. Fora desse estado o Olho só vale 0. A Runa de Gandalf continua sendo sucesso automático.
- **Ferido:** marca e dias de ferimento. Não muda os dados; a resposta avisa que outro ferimento deixa o herói morrendo.
- **Surto:** Sombra + Cicatrizes alcançam a Esperança máxima.
- **Teste de Sombra** (`/one-ring/shadow-test`): Pavor usa Valor; Ganância e Feitiçaria usam Sabedoria. TN informado pela mesa. Sucesso evita os pontos; falha soma todos.
- **Evento de jornada** (`/one-ring/journey-event`): Fronteira rola Feito favorecido, Selvagem normal, Sombria desfavorecido. Olho: Infortúnio terrível (Cansaço 3); 1: Desespero (2); 2–3: Más escolhas (2); 4–7: Contratempo (2); 8–9: Atalho (1); 10: Encontro casual (1); Runa: Visão alegre (0). Um d6 escolhe o papel: 1–2 Guia (Viagem), 3 Batedor (Exploração), 4 Caçador (Caçada), 5–6 Vigia (Percepção). Consequências resumidas com palavras próprias; subtabelas do livro não foram reproduzidas.
- **Ficha** (`/one-ring/sheet`): devolve derivados, estados e problemas; `migrate: true` converte a v1.
