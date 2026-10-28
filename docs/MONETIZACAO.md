# Monetização: AdSense, afiliados e IA de uso justo

## AdSense (frontend)

Código: `frontend/lib/ads.ts` (regras puras), `frontend/components/ad-slot.tsx` (`InlineAd`, `StickyBottomAd`), testes em `frontend/tests/monetization.test.mjs`.

Ativação (todas obrigatórias; sem elas nada é renderizado e nenhum script é carregado):

| Variável | Formato |
| --- | --- |
| `NEXT_PUBLIC_ADSENSE_ENABLED` | `true` |
| `NEXT_PUBLIC_ADSENSE_CLIENT_ID` | `ca-pub-` + 10 a 20 dígitos |
| `NEXT_PUBLIC_ADSENSE_SLOT_INLINE` / `NEXT_PUBLIC_ADSENSE_SLOT_STICKY` | ID numérico do bloco (ao menos um) |

Onde aparece:

| Rota | Formatos |
| --- | --- |
| `/` (página inicial) | inline abaixo do conteúdo + sticky inferior fechável |
| `/marketplace` | inline após o catálogo |
| `/app/**`, `/login`, `/auth/**`, `/dev/**` | nunca (área autenticada de jogo: fichas, rolagens, combate, mapas) |

Os componentes também aceitam `activeCombat`/`rolling`; com qualquer um ativo nada é exibido.

Regras de formato e experiência:

- Somente blocos manuais `inline` e `sticky-bottom`. Pop-up, vinheta/tela cheia, intersticial, âncora automática, side rail e vídeo com reprodução automática não existem no código e são recusados pela regra de domínio.
- O script `adsbygoogle.js` é carregado sem configuração de página (`enable_page_level_ads`/`overlays` não são enviados). **No painel do AdSense mantenha Auto ads DESLIGADO para o site** (incluindo âncora, vinheta, side rail e "intenções de anúncio") e, em *Controles de bloqueio*, bloqueie formatos de vídeo/rich media com áudio ou autoplay.
- Anúncios são pedidos como não personalizados (`requestNonPersonalizedAds = 1`).
- Espaço reservado com altura fixa (inline 280px mobile / 120px desktop; sticky 62px / 100px) evita layout shift.
- O sticky tem botão "Fechar anúncio" (vale para a sessão), adiciona `padding-bottom` ao `body` e sobe os controles fixos (tema, preferências do Clarity) para não cobri-los.

Consentimento: segue o padrão do Clarity (`localStorage`, leitura protegida por `try/catch`), com chave própria `rpg-nexus-ads-consent`. O pedido aparece dentro do espaço reservado do bloco inline (não é pop-up). Nada é carregado antes de "Permitir anúncios"; "Desativar anúncios" revoga e recarrega a página.

CSP: o projeto ainda não envia cabeçalho CSP, então nada foi alterado. Se um CSP for adicionado, use `adSenseCspSources()` de `lib/ads.ts`, que retorna as origens somente quando o AdSense está habilitado (e `{}` caso contrário).

## Links de afiliado

Código: `frontend/lib/affiliate-links.ts`, `frontend/components/affiliate-links.tsx` (`<AffiliateLinks systemId? title? compact? />`).

| Variável | Formato |
| --- | --- |
| `NEXT_PUBLIC_AMAZON_AFFILIATE_TAG` | tag de associado (ex.: `meusite-20`) |
| `NEXT_PUBLIC_AMAZON_STORE_DOMAIN` | `amazon.com.br` (padrão) ou `amazon.com` |
| `NEXT_PUBLIC_DRIVETHRURPG_AFFILIATE_ID` | ID numérico de afiliado |

- Links de busca na loja oficial por sistema (`vampire-v5`, `vampire-v3`, `hunter`, `one-ring`, `shadow-demon-lord`, `demon-the-fallen`), apenas com o parâmetro de afiliado da própria loja (`tag` / `affiliate_id`). Sem redirecionadores, sem handlers de clique, sem parâmetros extras.
- `rel="sponsored noopener noreferrer"`, `target="_blank"` e aviso de afiliado visível.
- Exibido na página inicial (todos os sistemas) e no painel *Biblioteca* da campanha (variante compacta).
- Marketplace: `marketplace-panel.tsx` pertence a outra frente; para encaixar, renderize `<AffiliateLinks systemId={item.system_key} compact />` no rodapé de cada cartão de modelo (o componente não renderiza nada sem IDs ou para sistema desconhecido).
- Os `*_BOOKS_URL` antigos de `SupportLinks` continuam funcionando independentemente.

## IA de uso justo (backend)

`backend/app/services/tutor_policy.py` aplica três camadas ao tutor (`POST /api/v1/campaigns/{id}/ai/tutor`):

1. Instrução de sistema: só regras mecânicas, de 1 a 8 tópicos iniciados por `- `, proibido lore/narrativa literária/trechos de livros.
2. Verificação do pedido: expressão, nomes de variáveis e o campo opcional `question` (até 280 caracteres) são recusados com 422 se pedirem lore, história, narrativa, poema, backstory etc., antes de qualquer chamada paga.
3. Pós-checagem: a saída do modelo precisa estar em tópicos curtos e sem marcadores narrativos; caso contrário é descartada (`invalid_output` no provedor, 502 na rota). A resposta inclui `bullets` (lista) e `explanation` (tópicos unidos por quebra de linha).

Testes: `backend/tests/test_tutor_fair_use.py`.
