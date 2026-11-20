# Criação guiada de Caçador: A Revanche

Revisão de 25/10/2026. O usuário confirmou a distribuição dos nove atributos: `4/3/3/3/2/2/2/2/1`.

## Fonte conferida

A pasta `D:\megabrain\Atlas_RPG\historias\Vampiro\Referencias_e_Suplementos\Outras_Linhas` contém registros de catálogo. O registro de Caçador aponta para o [PDF de referência fornecido](https://drive.google.com/file/d/1aGFrQxTxi3oG3eQZIST9B8es_fQlX3fw/view). A cópia foi lida localmente, sem inserir o livro ou suas imagens no repositório.

- Página 54: resumo da criação e fórmulas dos recursos.
- Página 57: distribuição dos atributos, credos e Ímpetos.
- Página 61: modos de habilidades e especialidades.
- Página 282: ficha com os nove atributos e as 27 habilidades.

O contrato contém nomes curtos e números. Descrições de regras não foram copiadas. As anotações manuscritas da cópia não substituem as regras impressas.

## Atributos

O jogador escolhe qual atributo recebe cada valor final. O assistente não acrescenta esses números ao ponto inicial.

| Valor final | Quantidade de atributos |
| --- | --- |
| 4 | 1 |
| 3 | 3 |
| 2 | 4 |
| 1 | 1 |

O grupo precisa corresponder exatamente à distribuição. Ter a mesma soma com outra divisão não basta. A contagem mostra faltas e excessos e bloqueia o avanço. Vitalidade continua calculada como `vigor + 3`; Força de Vontade, como `autocontrole + resolucao`.

## Habilidades

O modelo anterior tinha nove habilidades. A versão 2 inclui as 27 da ficha, com escolhas de distribuição antes do preenchimento.

| Modo | Distribuição | Habilidades em zero |
| --- | --- | --- |
| Especialista | 1 em 4, 3 em 3, 3 em 2, 3 em 1 | 17 |
| Pau para toda obra | 1 em 3, 8 em 2, 10 em 1 | 8 |
| Equilibrado | 3 em 3, 5 em 2, 7 em 1 | 12 |

Mudar o modo conserva os valores já preenchidos e recalcula a contagem. O jogador precisa ajustar a ficha para o modo escolhido antes de avançar.

IDs anteriores permanecem estáveis. `empatia` passa a ter o rótulo Sagacidade; `academicos` corresponde a Erudição, e `trato_com_animais`, a Empatia com Animais. Política entra como habilidade própria.

## Outras escolhas

Credo, conceito, célula e arquétipos continuam no fluxo. Ímpeto passa a ser uma seleção entre os sete nomes apresentados na página 57. Credo e Ímpeto são obrigatórios no novo modelo.

Desejo, Pilares e Redenção foram acrescentados. A etapa de traços passa a oferecer campos de Defeitos, Triunfos e Distinções, preservando Vantagens e Especialidades. A orientação informa uma especialidade livre e as especialidades das quatro habilidades indicadas no livro quando tiverem pontos.

Os registros textuais de vantagens, especialidades e triunfos exigem revisão do narrador. Não existe nesta entrega validação automática das suas descrições, dos pontos por vantagem/defeito ou das combinações de Triunfos e Distinções. A orientação numérica aparece no formulário, sem alegar que esses campos já têm um catálogo estruturado completo.

## Aplicação por campanha

O novo starter tem versão 2. Não houve atualização automática de `system_templates`, migração remota ou alteração das fichas existentes. Para oferecer as regras em uma campanha, seu gestor deve criar uma nova versão do modelo de Caçador e aprová-la. Alterar o starter no código não muda o modelo já aprovado no Supabase.

As distribuições acompanham `creation_rules`, conferidas no assistente, no backend e na validação PostgreSQL já existente. O mobile conectado recebe essas regras do modelo aprovado; o modo local usa o starter novo. Não foi criado um caminho de gravação que dispense as permissões atuais.

## Verificação local

Os testes cobrem cada distribuição aceita, falta e excesso de pontos, seleção de modo, validade do credo/Ímpeto e cálculo dos recursos no servidor. O teste de navegador do assistente web passa em 390 e 1440 pixels com o componente real e a rede externa bloqueada. O teste de componente mobile verifica o seletor e a contagem, incluindo a rejeição de uma distribuição que pertence a outro modo.

Esses testes não confirmam aplicação do modelo no Supabase hospedado. A revisão dos registros textuais continua com o narrador.

## Versão 3: traços estruturados (Frente J, 26/10/2026)

- Credo e Ímpeto continuam listas fechadas e obrigatórias.
- Pilares (lista livre) virou até três pares `conviccao_N` (160 caracteres) e `pedra_toque_N` (120), preenchidos juntos (`paired_with`). O primeiro par é obrigatório. **Conferir no livro** a quantidade de pares.
- Redenção tem limite de 240 caracteres, Célula de 120. Desespero da ficha vai de 0 a 5 e `em_desespero` marca o estado.
- Os limites (`max_length`, `min_items`, `max_items`, `item_options`, `paired_with`) valem na API, no assistente web e mobile e no banco (trigger `character_sheets_validate_text_constraints`, migration `20261026190000`).
- Compatibilidade: fichas v1/v2 continuam ligadas ao modelo já aprovado. `migrate_hunter_traits` / `migrateHunterTraits` (endpoint `/api/v1/system-rolls/hunter/traits` com `migrate: true`) separam cada pilar em Pedra de Toque e Convicção (`Pedra: Convicção` ou `Convicção (Pedra)`), corrigem Credo/Ímpeto por nome sem acento e levam excedentes e textos cortados para Notas, com avisos.
- Células (ATL-04) ficam em `hunter_cells`, `hunter_cell_members`, `hunter_cell_targets` e `hunter_cell_bonds`, com RLS: membros leem, dono e mestres editam. O painel fica na área Sistemas.

## Versão 4: Caçador completo (Frente F4, migration `20261029130000`)

- **Desesperação e Perigo** vivem só na célula. A ficha guarda só o estado Despair (`em_desespero`). A migração move o campo antigo `desespero` para a célula vinculada; a célula fica com o maior valor. Fichas sem célula perdem o valor, com registro em `hunter_desperation_migration_reports`, que os mestres podem ler. Antes disso, fichas cujo texto `celula` bate com o nome de uma célula são vinculadas a ela.
- **Vínculo:** a ficha aponta para a célula por `hunter_cell_members`, uma célula por ficha (trigger). O texto `celula` continua, só para leitura.
- **Rolador** (`POST /api/v1/hunter/sheets/{id}/rolls`, RPC `record_hunter_roll`): os dados são gerados no banco e a Desesperação vem da célula. Rerrolagem de Vontade de até 3 dados comuns, uma vez, com gasto atômico (`reroll_hunter_roll`). Um 1 na Desesperação pede a escolha da mesa (`resolve_hunter_desperation`, idempotente): Overreach mantém o sucesso e soma 1 ao Perigo; Despair transforma o teste em falha e marca a ficha. Em Despair, a ficha não soma Desesperação e não usa Triunfos.
- **Redenção:** o jogador registra como cumpriu o Ímpeto (`request_hunter_redemption`); o narrador aprova ou recusa (`decide_hunter_redemption`). Aprovar encerra o Despair.
- **Célula:** o narrador ajusta Perigo e Desesperação em passos (`adjust_hunter_cell`, idempotente). Tudo fica em `hunter_events`.
- **Criação v4:** Triunfos (Edges) e Distinções (Perks, no formato `Triunfo: Distinção`) vêm de listas fechadas. Especializações seguem `specialty_picks` (Ciência, Erudição, Ofícios e Performance com pontos, mais 1 livre). Vantagens somam 7 e Defeitos 2, por `collection_points` com catálogo. Há o campo `equipamento`. `POST /campaigns/{id}/sheets` roda `template_creation_problems`.

### Para conferir no livro

1. Nomes em português dos 14 Triunfos e as 4 Distinções de cada um, que são provisórias.
2. Na criação: 2 Triunfos e 1 Distinção, ou 1 Triunfo e 2 Distinções.
3. Catálogo de Vantagens e Defeitos e os custos de cada item.
4. Desesperação: num sucesso, a mesa escolhe Overreach ou Despair; numa falha, é Despair. Overreach soma +1 ao Perigo, com teto de 5.
5. Em Despair, a ficha não soma dados de Desesperação e os Triunfos ficam bloqueados.
6. A Vontade rerrola até 3 dados comuns, nunca os de Desesperação, uma vez por teste.
7. A Redenção cumprindo o Ímpeto encerra o Despair.
