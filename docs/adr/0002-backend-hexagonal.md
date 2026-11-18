# 0002. Arquitetura hexagonal e Clean Code no código do RPG-Atlas

Estado: pedida pelo usuário em 18/11/2026; fase 1 (backend) em andamento na branch `refactor/hexagonal`.

## Decisão

O backend FastAPI passa a ter três camadas com dependência num único sentido, de fora para dentro:

| Camada | Pasta | Conteúdo | Pode importar |
| --- | --- | --- | --- |
| Domínio | `backend/app/domain/` | regras de negócio e erros (`DomainError` e subclasses) | apenas a biblioteca padrão e Pydantic |
| Aplicação | `backend/app/application/<contexto>/` | casos de uso (`SheetService`) e portas (`Protocol`) | domínio |
| Adaptadores | `backend/app/adapters/inbound/http/` e `backend/app/adapters/outbound/<serviço>/` | rotas FastAPI, cliente Supabase, repositórios, provedores externos | aplicação e domínio |

Um caso de uso nunca levanta `HTTPException` nem chama `httpx`. Ele levanta erros de domínio, e a rota os converte em status HTTP por meio de `DomainErrorRoute`. A composição de cada requisição fica em `adapters/inbound/http/dependencies.py`, que liga as portas aos adaptadores concretos.

Os testes de rota substituem o adaptador `supabase_session` por `tests/support/fake_supabase.py`, em vez de remendar funções privadas dos módulos com `monkeypatch`.

## Contexto

Antes da fase 1, 17 dos 19 módulos de rota em `backend/app/routes/` falavam diretamente com o Supabase ou com outro serviço HTTP. O módulo `routes/sheets.py` repetia três vezes a leitura de `SUPABASE_URL`, a checagem do token e o tratamento de erros do PostgREST. `routes/chronicle.py` e `services/supabase_rpc.py` mantinham clientes próprios, e a tabela de SQLSTATE de `supabase_rpc.py` traduz os mesmos códigos com mensagens diferentes das usadas pelas fichas. Os testes dependiam desses detalhes: havia cerca de 200 chamadas `monkeypatch.setattr` apontando para funções privadas como `_request`, `_rpc` e `_current_user_id`.

A alternativa de mover arquivos sem mudar as dependências deixaria a regra de negócio presa ao FastAPI e manteria os testes acoplados aos nomes internos. Reescrever todo o backend numa única entrega impediria conferir o comportamento módulo a módulo.

## Estratégia de migração

Cada contexto migra numa etapa própria, e a suíte do backend precisa continuar verde ao fim de cada uma. A linha de base é de 1814 testes aprovados.

1. Fichas (`sheets`): concluída. `SheetService`, `SheetRepository`, `SupabaseRestClient` e `SupabaseSheetRepository` substituem o antigo `routes/sheets.py`.
2. Rotas que ainda importam `_request`, `_rpc`, `_current_user_id` ou `_get_template` de `app.routes.sheets`: `experience`, `v5`, `v5_actions`, `v5_sanguine` e `ai_assistance`. O módulo `app/routes/sheets.py` mantém essas funções apenas até a última delas migrar.
3. Crônica, convites, marketplace e sincronização mobile, que hoje têm clientes Supabase próprios.
4. Provedores externos (IA, Spotify, Discord, e-mail) como adaptadores de saída atrás de portas.
5. Mover para `domain/` os módulos de `services/` que já são regras puras (`creation_rules`, `sheet_values`, `sheet_calculations`, `dice`, `v5_*`, `one_ring*`, `sotdl_progression` e similares) e unificar as tabelas de SQLSTATE num único adaptador.

Frontend (`frontend/lib`, `frontend/components`), mobile (`mobile/src`) e `shared/` formam as fases seguintes. O desenho dessas fases depende de um levantamento ainda não feito: [falta detalhe real].

## Regras de Clean Code adotadas

- Nomes descrevem a intenção no vocabulário de `CONTEXT.md` (ficha, modelo, narrador, campanha).
- Funções de rota só convertem o formato da requisição e chamam um caso de uso.
- Constantes nomeadas substituem números e listas de colunas repetidos (`SHEET_COLUMNS`, `MAX_VALUES_BYTES`).
- Uma única implementação para cada integração externa; cópias divergentes são removidas na etapa do contexto correspondente.
- Comentários explicam o motivo de uma regra, não o que a linha faz.

## Consequências

Testes de contrato com o PostgREST continuam possíveis, porque o Supabase falso grava método, caminho, parâmetros e corpo de cada chamada. Testes de caso de uso podem montar `SheetService` com repositórios em memória, sem FastAPI.

Durante a migração convivem dois estilos: rotas antigas em `app/routes/` e rotas novas em `app/adapters/inbound/http/`. O módulo de compatibilidade deixa isso explícito e deve sumir ao fim da etapa 2.

## Critérios de verificação

A suíte completa do backend passa após cada etapa. Nenhum arquivo em `domain/` ou `application/` importa `fastapi`, `httpx` ou `os.getenv`. Cada rota migrada recebe seus colaboradores por `Depends` e não por variáveis de módulo.
