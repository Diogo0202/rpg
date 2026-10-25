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
