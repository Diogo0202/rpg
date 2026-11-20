# Demônio: A Queda no RPG Nexus

Estado local em 26/10/2026. A chave do sistema é `demon-the-fallen`; `shadow-demon-lord` continua independente. Nenhuma migration foi aplicada em banco hospedado.

## Fontes conferidas

- Módulo Básico, pp. 123-128: criação, atributos 7/5/3, habilidades 13/9/5, Antecedentes 5, Doutrinas 3, Virtudes 3, Fé 3, Força de Vontade pelas duas maiores Virtudes, 15 pontos bônus e custos.
- Módulo Básico, pp. 170-173: forma apocalíptica, Doutrinas, evocações e poderes inatos. A matriz de poderes ainda não foi transcrita em dados de regra.
- Ficha de quatro páginas: nomes dos nove atributos, 36 habilidades e trilhas de recursos.
- Companheiro do Narrador: capítulos de facções, antagonistas, plano espiritual e monstros identificados, ainda sem dados no aplicativo.
- Trecho de Terrestres de quatro páginas: Antecedentes exclusivos identificados. O material não fecha um caminho de criação de personagem Terrestre.

Os arquivos de referência ficam fora do repositório. Não incluir páginas digitalizadas nem texto integral dos livros no código ou no compêndio distribuído.

## Feito nesta etapa

- Modelo-base de ficha na web e no mobile com Casa, identidade, atributos, habilidades, Antecedentes, Doutrinas, Virtudes, Fé, Tormento, Vontade e campos narrativos.
- Distribuição por prioridades e custo de 15 pontos bônus na API e na interface web. O mobile confere o orçamento antes de salvar e mostra a contagem por etapa.
- Cálculo das duas maiores Virtudes como base da Vontade na API, nas duas interfaces e no banco.
- Tormento inicial e Doutrinas permitidas por Casa conferidos nas pp. 99, 101, 103, 105, 107, 109 e 111. A escolha da Casa preenche o Tormento; a validação bloqueia Doutrinas fora das três da Casa e das duas comuns.
- Migration e teste pgTAP para essa base derivada. Os testes do banco rodaram em PGlite local.
- Escolha obrigatória de uma Doutrina principal da Casa, com pontuação pelo menos igual às demais. A API e o banco rejeitam escolhas indevidas.
- Fé atual e Vontade atual começam iguais aos valores máximos. Web e mobile acompanham alterações desses máximos durante a criação.

## Próximas entregas obrigatórias

1. Catalogar cada evocação com página, nível, teste, custo, duração, alcance e efeitos comum e de alto Tormento. Criar testes por entrada do catálogo.
2. Implementar ativação no servidor com rolagem, gasto atômico de Fé, versão da ficha, idempotência e registro de resultado. Efeitos que dependem do narrador devem pedir sua decisão.
3. Cobrir formas apocalípticas, poderes inatos, rituais e pactos com o mesmo fluxo.
4. Cadastrar antagonistas e Terrestres como NPCs privados do narrador, com os Antecedentes exclusivos sob condição explícita.
5. Conferir em staging com narrador, jogador e outra campanha. Testes locais não comprovam RLS hospedado nem publicação.
