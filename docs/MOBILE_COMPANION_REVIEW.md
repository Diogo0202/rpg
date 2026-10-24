# RPG-Atlas Mobile: comparação com a proposta de Companion App

Referência recebida: `gemini-code-1792635160579.md`. O texto apresenta uma proposta de produto. Os estados abaixo descrevem o checkout local em 21/10/2026; não comprovam deploy, Supabase hospedado ou teste em telefone.

| Frente | Estado no código | Próximo passo |
| --- | --- | --- |
| PWA e dados locais | React/TanStack, IndexedDB, fila de operações e service worker presentes. A stack difere da sugestão Next.js/Zustand. | Testar instalação e abertura sem rede em telefone. |
| Fichas modulares | Modelos locais, criação guiada, edição e importação presentes. | Validar modelos e regras completos com material autorizado. |
| Dados V5 | Rolagem local e previsão de risco presentes; a ficha conectada consulta efeitos e dano no servidor. | Testar JWT, RLS e versões da ficha em staging com contas distintas. |
| Sincronização concorrente | Mudanças por caminho e versões estão no protocolo; há tratamento de conflitos. | Definir operações de incremento para XP e outros contadores, com validação matemática de eventos no servidor. |
| Segurança e Realtime | A API autenticada e a publicação de notificações mínimas existem no código. | Confirmar políticas e payloads no Supabase hospedado. |
| Narrador no mobile | A tela Mesa e o diário local existem. O painel de status da mesa e a geração de NPCs não estão ligados ao mobile. | Definir permissões, dados visíveis e fluxo de revisão do narrador. |
| Assistente de regras | A tela mobile informa que está desconectada. Há infraestrutura de assistência revisável no backend e na interface web. | Integrar após validação de fontes autorizadas, custos e permissões. |
| Música e Discord | O mobile guarda links públicos do Spotify. Não há OAuth, controle de reprodução ou ingresso em canais Discord. | Definir credenciais, consentimento e fluxo de conexão. |
| Mapas | O mobile já permite ver um grid e editar mapas e marcadores com formulários. | Decidir se a edição simples continua. A proposta anexada sugere somente visualização no celular; o pedido anterior do projeto inclui mapas. |
| Aparência e toque | Controles base têm altura mínima de 44 px. Tema escuro opcional e salvo no aparelho foi acrescentado. | Conferir contraste e toques em telefone físico. |
| Anúncios e afiliados | Não implementados. | Tratar como decisão de produto antes de inserir publicidade ou links comerciais. |

O modo escuro altera as cores das fichas e dos formulários sem enviar a preferência à campanha. O tema padrão permanece disponível nas configurações.
