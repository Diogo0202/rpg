# Marketplace de modelos: revisão na campanha

Entrega local em 27/10/2026. A tela **Modelos importados**, na navegação da campanha, fecha a etapa entre copiar um modelo da comunidade e criar fichas com ele.

## Fluxo

1. No Marketplace, o narrador publica um modelo aprovado de uma campanha que gerencia. A prévia contém o conteúdo que será publicado; o servidor confere seu digest antes da publicação. O modo de publicação manual continua disponível.
2. Outro narrador escolhe uma campanha que gerencia e copia o modelo. A cópia nasce com estado `needs_review`, sem liberar fichas automaticamente.
3. Na campanha de destino, o narrador abre **Modelos importados**, expande a revisão e confere os campos. A tela apresenta escolhas e expressões de cálculo, com o JSON completo disponível para conferir limites, regras de criação e demais propriedades.
4. Depois de marcar a confirmação da revisão, o narrador aprova o modelo. A RPC confere permissão, origem publicada e igualdade do conteúdo com o snapshot revisado. Se o modelo mudou, a aprovação é recusada e a tela exige uma nova consulta.
5. **Ir para fichas** abre o editor da mesma campanha, que carrega os modelos aprovados. A criação guiada já existente segue as regras do modelo escolhido.

## Comportamento

- A revisão aparece para quem gerencia modelos. A autorização é repetida no banco; o botão não concede permissão.
- A cópia conserva o conteúdo completo, inclusive regras de criação e propriedades adicionais. A interface não refaz fórmulas nem executa conteúdo do modelo durante a prévia.
- Publicações retiradas continuam identificadas como indisponíveis e não podem ser aprovadas.
- O cliente impede envios simultâneos pelo botão. A RPC mantém a aprovação idempotente quando a mesma solicitação é repetida.
- Se a resposta de aprovação for incerta, a tela pede atualização antes de tentar novamente. Respostas de outra campanha ou de uma revisão encerrada não alteram a tela atual, mesmo após sair e voltar à campanha.
- Falhas de leitura deixam uma mensagem e um botão de atualização. A interface não apresenta uma lista vazia como confirmação de leitura bem-sucedida.

## Arquivos

- `frontend/components/marketplace-imports-panel.tsx`: lista, prévia e aprovação.
- `frontend/lib/marketplace-imports.ts`: contrato das respostas e preservação do snapshot.
- `frontend/components/campaign-workbench.tsx`: navegação e abertura do editor após a aprovação.
- `supabase/migrations/20261029160000_marketplace_template_publication.sql`: RPCs de exportação, revisão e aprovação já presentes no checkout.
- `scripts/test-marketplace-imports-ui.cjs`: testes em navegador com RPCs fictícias locais, sem credenciais reais.

## Verificação de 27/10/2026

| Verificação | Resultado local |
| --- | --- |
| `python -m pytest tests/test_marketplace.py -q`, em `backend` | 27 aprovados; um aviso de depreciação do Starlette |
| `npm run test:web` | 231 aprovados, incluindo 5 testes do contrato de revisão |
| `npm run test:db` | 59 migrations, 49 arquivos e 1.106 asserções sem falha no PGlite |
| `rpg_marketplace_template_publication.test.sql` | 21 asserções, incluindo snapshot diferente, jogador sem permissão e gestor de outra campanha |
| Navegador da revisão | 12 cenários em 1440 px e 390 px; sem erro de JavaScript nem rolagem horizontal |
| Navegador da página pública | Publicação manual e por modelo aprovado, prévia por digest, cópia e moderação em 1440 px e 390 px; sem erro de JavaScript nem rolagem horizontal |
| TypeScript e build de produção | Concluídos; build informa `metadataBase` ainda sem URL de produção |

PGlite e os testes de navegador usam dados fictícios. O projeto Supabase de destino ainda precisa receber as migrations e ser conferido com contas distintas. A validação de contratos não confirma autorização para distribuir livros ou conteúdo de terceiros.

Os scripts de navegador exigem uma instalação de Playwright disponível no ambiente. A variável `RPG_PLAYWRIGHT_MODULE` pode apontar para esse pacote quando ele estiver fora das dependências do projeto.

O Graft foi instalado em um diretório temporário de ferramentas, fora das dependências do aplicativo, e gerou um índice local ignorado pelo Git. A orientação da [skill Ruflo](https://github.com/ruvnet/ruflo/blob/main/SKILL.md) foi aplicada à divisão entre implementação e revisão dos testes da página pública. O runtime e os hooks do Ruflo não foram instalados.
