# Plano: temas de cor do Vampiro (V5 e V3)

## Decisões
- **Inspiração:** Vampiro, com duas paletas: V5 (noite fria, moderna) e V3 (gótica, quente).
- **Aplicação:** duas opções novas no seletor de tema, ao lado de Padrão e Caçador. A escolha fica salva no navegador.
- **Escopo:** site e celular, com a mesma paleta.

## Situação de hoje
- O tema é trocado por `data-theme` no `<html>` ([theme.ts](../frontend/lib/theme.ts), [theme-switcher.tsx](../frontend/components/theme-switcher.tsx)). Hoje existem `standard` e `hunter`. O Caçador é só um bloco de valores para as mesmas sete variáveis.
- As variáveis de base são `--ink`, `--paper`, `--panel`, `--line`, `--accent`, `--moss` e `--muted`, definidas no `:root` de [globals.css](../frontend/app/globals.css).
- **Limitação:** muitas cores estão escritas direto no CSS, sem variável (cerca de 150 em `globals.css`, 130 no assistente de criação e mais de 40 em cada painel de rolagem, mapas, compêndio e afins). O tema Caçador só funciona bem porque é claro, como o padrão. Um tema escuro sobre cores fixas claras deixaria texto ilegível. Por isso a limpeza vem antes das paletas.

## Paletas propostas
Todos os pares abaixo foram medidos (script em `scratchpad/contrast.mjs`). O texto corrido passa de 4,5:1 em todos, e as bordas, de 1,5:1.

| Papel | V5 · Noite fria | V3 · Gótico |
|---|---|---|
| Fundo (`--paper`) | `#0f1114` | `#150a0c` |
| Painel (`--panel`) | `#171a1f` | `#201114` |
| Painel elevado (novo, `--panel-2`) | `#1e2228` | `#2a181c` |
| Borda (`--line`) | `#3a404a` | `#5a3338` |
| Texto (`--ink`) | `#e8e4dc` (14,9:1) | `#f0e4cf` (15,5:1) |
| Texto secundário (`--muted`) | `#a8a39a` (7,5:1) | `#b9a58d` (8,2:1) |
| Ação (`--accent`) | `#b3132b` (branco: 6,9:1) | `#8c1c24` (branco: 9,1:1) |
| Destaque em texto (novo, `--accent-ink`) | `#ff6b78` (6,9:1) | `#f08a7e` (8,0:1) |
| Calculado / só leitura (`--moss`) | `#5fb3aa` (7,1:1) | `#a3b36b` (8,0:1) |
| Alerta (novo, `--warn`) | `#e0b04a` (8,7:1) | `#d4a94e` (8,3:1) |
| Perigo e Fome (novo, `--danger`) | `#ff5c6c` (5,8:1) | `#ff6a5c` (6,5:1) |

Carácter de cada uma:
- **V5:** grafite azulado, carmesim seco e um verde-água frio para o que é calculado. Moderno, quase de cidade à noite.
- **V3:** preto avermelhado, vinho, pergaminho e ouro velho. Gótico, mais quente.

Para o Vampiro, "Fome" e "perigo" usam sempre `--danger`, e o carmesim da ação (`--accent`) não é reutilizado para alertas, para a leitura da ficha não confundir os dois.

## Etapas
1. **Variáveis semânticas (sem mudar o visual).**
   - Acrescentar `--panel-2`, `--accent-ink`, `--on-accent`, `--warn`, `--danger`, `--ok`, `--focus` e `--shadow`.
   - Trocar cada cor fixa por variável, começando por `globals.css` e pelo CSS do assistente de criação, depois os painéis por tamanho.
   - Sem tema novo ainda: a captura de tela do tema Padrão tem de ficar igual à de antes. Isso prova que a limpeza não quebrou nada.
2. **Blocos dos temas.** Dois blocos novos: `data-theme="vampire-v5"` e `data-theme="vampire-v3"`, com os valores da tabela. Ajustes que só fazem sentido no escuro (sombras sem efeito, fundo do mapa, desfoque do "fog", imagens e retratos) ficam dentro desses blocos.
3. **Seletor e barra do navegador.** Estender `ThemeMode` para quatro valores, a cor da barra (`theme-color`) por tema e o nome das opções. O tema salvo é aplicado antes da primeira pintura, para não piscar em claro.
4. **Celular.** Levar as mesmas variáveis para [`mobile/src/lib/theme.ts`](../mobile/src/lib/theme.ts) e para o CSS do app, com a mesma lista de cores fixas a limpar.
5. **Verificação:** ver abaixo.

## Verificação
- **Contraste:** o script mede todos os pares da tabela, e vai para os testes para as paletas não regredirem.
- **Cores fixas:** um teste que acusa novas cores `#hex` escritas direto em CSS fora do bloco de tokens.
- **Visual:** capturas de tela, nos três temas e em 1440 e 390 px, de login, campanha, assistente de criação (V5 e V3), ficha, mapas, painel de rolagem e compêndio.
- **Sem flash:** recarregar com cada tema salvo e conferir que não aparece o claro antes.

## Riscos
- Como não há `prefers-color-scheme` hoje, as áreas pintadas por canvas (mapas) e as imagens de retrato têm cores próprias; elas precisam de revisão à parte em cada tema.
- O celular está sendo mexido por outra sessão (`mobile/`). Se ela ainda estiver trabalhando, o passo 4 deve esperar.
- Dois temas novos dobram o que revisar em cada tela. Se for demais, a alternativa é entregar só o V5 primeiro e o V3 depois, já que as variáveis ficam prontas.
