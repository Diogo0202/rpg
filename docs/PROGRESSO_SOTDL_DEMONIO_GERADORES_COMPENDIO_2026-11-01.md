# Revisão das quatro frentes em 01/11/2026

## Shadow of the Demon Lord

A criação aceita nível 0. O backend confere avanços de um nível por vez, até 10, e exige a trilha de novato no nível 1, especialista no 3 e mestre no 7. A checagem vale para a API de criação e edição. O cliente envia o objeto completo de valores ao editar a ficha.

Faltam os benefícios numéricos e as escolhas de cada nível: [falta detalhe real]. O resumo local da campanha só cita os marcos das trilhas. Também falta uma regra no banco para impedir que uma gravação direta no Supabase contorne a checagem da API. Portanto, a progressão ainda não é autoritativa em todos os caminhos.

## Demônio: A Queda

A migration `20261101110000_demon_evocation_activation.sql` cria um catálogo por campanha. Somente o narrador pode registrar nome, Doutrina, nível exigido, custo em Fé, fonte, página e nota de conferência, desde que a campanha tenha um modelo de Demônio aprovado. Não há poderes oficiais cadastrados nesta entrega.

A ativação confere dono da ficha ou narrador, Doutrina, versão da ficha e Fé disponível. O banco gasta Fé e grava a ativação na mesma transação. A chave de operação evita novo gasto ao repetir a chamada. O resultado fica como `awaiting_narrator`; efeitos narrativos e rolagens ainda não são resolvidos automaticamente.

O PDF do Módulo Básico está catalogado no Drive, mas não forneceu texto legível na leitura desta execução. Custos, testes, duração, alcance, efeitos de Tormento e poderes inatos seguem sem conferência: [falta detalhe real]. O narrador deve registrar cada entrada após conferir o exemplar autorizado. Nenhum texto do livro foi incluído no repositório.

## Geradores

Os blocos atuais de V5, V3, Caçador, O Um Anel e SotDL têm números originais para a mesa, seed reproduzível e `needs_book_check=true`. Os testes verificam formato, limites e ordenação entre dificuldades. Não confirmam valores oficiais. Faltam exemplares e páginas legíveis para comparar cada bloco: [falta detalhe real]. Até essa conferência, a interface mantém o aviso antes do uso.

## Compêndio

A busca encontra também o título da fonte. Há filtro por origem declarada. Uma proposta marcada como licenciada precisa informar página; para aprová-la, o narrador precisa registrar uma nota de autorização. A migration `20261101100000_compendium_licensed_review.sql` impõe a regra no banco. Entradas anteriores com origem licenciada e sem nota continuam identificadas como declaração, sem certificado automático.

O acervo incluído no aplicativo contém quatro exemplos homebrew. Nenhum verbete oficial foi incluído sem comprovação de direito de uso. O cadastro do acervo autorizado depende da lista de obras, permissão e páginas correspondentes: [falta detalhe real].

## Validação executada

- API: 12 testes de ativação e progressão passaram; a suíte anterior de criação SotDL totalizou 18 testes aprovados.
- Banco: 9 assertivas de ativação de Demônio, 4 de revisão licenciada e 24 de regressão do compêndio passaram em PGlite local.
- Frontend: 7 testes do compêndio e `tsc --noEmit` passaram.

Esses resultados não provam aplicação das migrations nem RLS no Supabase hospedado. Falta testar narrador, jogador, outra campanha e repetição da ativação em staging.
