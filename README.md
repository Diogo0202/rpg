# RPG ATLAS

RPG Nexus é uma aplicação web responsiva para organizar mesas de RPG em celular e computador. O projeto reúne uma interface Next.js, uma API FastAPI e migrações Supabase para campanhas privadas.

Consulte a [lista de funcionalidades e percentuais de conclusão](STATUS_FUNCIONALIDADES.md) para acompanhar as entregas implementadas, parciais e pendentes.

O [checklist de criação guiada](CHECKLIST_CRIACAO_GUIADA.md) registra as entregas deste ciclo, os testes locais e as dependências restantes. O assistente funciona com os modelos aprovados da campanha e salva novos personagens pela API autenticada.

A [comparação com o inventário do RPG Atlas](COMPARACAO_RPG_ATLAS.md) registra o que foi incorporado e as diferenças que ainda faltam. O código de referência foi clonado em `D:\rpg-atlas-reference`, no commit `fb34a5b`; o inventário descreve `1206601`. O aplicativo em desenvolvimento permanece neste repositório, com Next.js, FastAPI e Supabase.

## O que já existe

- Acesso por link de e-mail para contas convidadas no Supabase.
- Lista e criação de campanhas privadas após o login. Cada mesa tem uma rota própria, protegida pelas políticas RLS.
- Rolagem de dados e cálculo seguro de fórmulas de ficha.
- Probabilidades de sucesso, crítico sujo e falha bestial para Vampire: The Masquerade 5ª edição, com comparação de rerrolagem de Vontade.
- Geração procedural de mapas táticos e conteúdo original para personagens, inimigos e itens.
- Painel da Segunda Inquisição com eventos confirmados pelo narrador, alerta reconstruído e respostas por nível. O diagnóstico da crônica lê fichas aprovadas e atividade estruturada, com acesso reservado ao narrador.
- Editor de fichas modulares com base V5, fórmulas automáticas, modelos aprovados e fichas gravadas por campanha com controle de versão. A criação guiada acrescenta etapas, identidades em destaque, revisão e seleção do personagem após salvar.
- Modelos iniciais editáveis de Vampiro V5, Caçador e O Um Anel. O V5 reúne 9 atributos e 27 habilidades; os demais seguem os recortes de campos do Atlas.
- Rolador de Caçador com Desespero adicional opcional, dificuldade e resultados separados. O Um Anel tem um rolador inicial de d12/d6 e cansaço, ainda em revisão; Miserável, Sombra e eventos de jornada não são automatizados. Esses modelos e roladores não cobrem todas as regras dos sistemas.
- Rolador V5 com atributos e habilidades, dados individuais de Fome e classificação do resultado. Trilhas de dano superficial e agravado aplicam penalidades ao contexto físico ou mental, também na previsão de risco.
- Cofre local por conta, com cópias, busca, renomeação e duplicação. Importa e exporta JSON Nexus validado, inclui inventário e efeitos, oferece impressão pelo navegador e restaura uma nova ficha usando modelo idêntico já aprovado.
- Inventário por personagem, aquisições pendentes e equipamento exclusivo de arma ou armadura. O arsenal reúne 65 registros do Atlas, com filtros, comparação e preenchimento de aquisição.
- Calculadora de XP e histórico local de estimativas. O cálculo não altera automaticamente os atributos nem o saldo da ficha.
- Diário com sessões, eventos cronológicos e facções, incluindo relógio de tensão e exportação JSON ou Markdown.
- Biblioteca do mundo com edição de entidades e relações. O conteúdo original gerado pode ser salvo nela.
- Mapas gerados podem ser salvos, receber marcadores e ser exportados em JSON ou PNG. Os documentos completos ficam restritos ao narrador.
- Modo de cena com participantes, iniciativa, rodada e turno, pausa e registro de eventos. Inclui salvamento por versão e atualização manual.
- Links de playlists do Spotify compartilhados na campanha. Mestre e dono administram os links; participantes podem abri-los no Spotify.
- Referências musicais por sessão, com tipo de cena, duração, brief e URL HTTPS de áudio opcional. O player começa somente por ação do usuário.
- Busca textual de regras em fontes autorizadas, com trecho e página de origem, restrita aos membros da campanha.
- Painel do narrador com fichas ativas, Fome em alerta a partir de 4, Vontade disponível, Humanidade e Manchas. Inclui assinatura Supabase Realtime e atualização manual.
- Motor de modificadores com condições ativáveis, tags de aplicação e exceção, duração em cenas e motivo visível. Os efeitos acompanham o personagem selecionado nas rolagens da ficha e na previsão V5.
- Compêndio com Fuse.js, filtros por tipo, nível e tags, detalhes em modal e referências clicáveis na ficha. O acervo inicial contém quatro exemplos originais de homebrew.
- Interface PWA instalável, com acesso online. O modo offline ainda não está implementado.

O estado atual é um protótipo em desenvolvimento. Os fluxos de gravação têm código e migrations locais; as migrations desta entrega ainda não foram aplicadas ao Supabase de destino. A persistência e o isolamento precisam de testes com contas reais. Os links do Spotify abrem playlists; não há OAuth, controle de reprodução nem sincronização do player. A busca de regras ainda não gera resposta por IA e não há fluxo público de envio de PDFs.

Os efeitos dependem da migration `20261014141000_character_effects.sql`; o painel do grupo depende da publicação Realtime definida em `20261014140000_party_realtime.sql`. Aplique a sequência completa de migrations em um banco de teste antes de conferir os painéis novos. A compatibilidade dos backups com os metadados do assistente depende de `20261017100000_sheet_creation_backup_metadata.sql`, ainda sem execução em banco. O compêndio contém quatro exemplos originais, sem poderes oficiais V5. As regras completas de criação aguardam material autorizado; o rastreador específico de Vínculo de Sangue também segue pendente. Ressonância pode ser registrada como efeito configurável, com origem e duração definidas pela mesa. JSON Atlas bruto ainda exige um adaptador; o cofre aceita o contrato Nexus, sem importar permissões.

## Tecnologias

- Interface: Next.js 16, React 19 e TypeScript.
- API: FastAPI e Pydantic.
- Autenticação e persistência das campanhas: Supabase com RLS e controle de versão nas alterações concorrentes.
- Editor de mapa: PixiJS.

## Requisitos

- Node.js compatível com Next.js 16.
- Python 3.14, como indicado pela configuração local do projeto.
- Um projeto Supabase para autenticação. Sem ele, a tela de acesso e os endpoints protegidos não funcionam.

## Rodar localmente no Windows

Na raiz do repositório, instale as dependências:

```powershell
npm --prefix frontend ci
py -3.14 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Crie a configuração da interface:

```powershell
Copy-Item frontend\.env.example frontend\.env.local
```

Preencha `frontend/.env.local` com a URL do projeto Supabase, a chave publicável e a URL da API:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SUA_CHAVE_PUBLICAVEL
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Configure o backend em uma sessão PowerShell. Use a mesma URL e chave publicável do Supabase. A chave publicável pode aparecer no cliente; chaves secretas ou de serviço nunca devem ser colocadas em variáveis `NEXT_PUBLIC_`.

```powershell
$env:SUPABASE_URL = "https://SEU-PROJETO.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY = "SUA_CHAVE_PUBLICAVEL"
$env:CORS_ORIGINS = "http://localhost:3000"
```

Abra dois terminais na raiz do projeto. No primeiro, rode a interface:

```powershell
npm run dev
```

No segundo, com as variáveis do backend definidas, inicie a API:

```powershell
npm run dev:api
```

A interface abre em `http://localhost:3000`. A API e sua documentação ficam em `http://localhost:8000` e `http://localhost:8000/docs`.

## Comandos disponíveis

```powershell
npm run lint       # Verifica os tipos TypeScript
npm run build      # Gera a versão de produção da interface
npm run test:api   # Executa os testes da API
npm run test:web   # Valida backup, modelos iniciais e cálculo de XP
```

Também é possível iniciar cada parte diretamente:

```powershell
npm --prefix frontend run dev
backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

## Supabase

A [revisão de segurança de 17/10/2026](SEGURANCA.md) descreve os limites das fichas, a autenticação e as cotas da API, os sinais mínimos de Realtime e a proteção da impressão. As alterações têm testes preparados, ainda sem execução; as novas migrations também estão pendentes. O frontend e a migration de notificações Realtime devem ser lançados juntos.

As migrações estão em `supabase/migrations/`. Elas ainda precisam ser avaliadas e aplicadas ao projeto Supabase de destino. O acesso privado deve continuar protegido por convites e políticas RLS. O bucket da biblioteca deve ser privado antes de receber arquivos.

O endpoint de extração de material exige `EXTRACTION_WORKER_TOKEN` no ambiente do backend. Não envie esse valor ao navegador. PDFs e regras de terceiros só devem entrar na biblioteca quando a campanha tiver autorização para armazená-los.

## Docker

O Dockerfile em `frontend/` cria a versão de produção da interface. O Compose atual só inicia esse serviço; a API e o Supabase precisam de configuração própria. As variáveis `NEXT_PUBLIC_*` são incorporadas durante o build do Next.js.

## Próximas entregas

1. Aplicar as migrações em um projeto Supabase de teste e verificar as políticas com contas de papéis diferentes; concluir convites.
2. Conferir criação de modelo, ficha, inventário, restauração de backup, mapas e cenas no banco de teste.
3. Concluir mecânicas específicas de Caçador e O Um Anel e regras de criação a partir de material autorizado, com revisão do narrador.
4. Preparar a ingestão segura de PDFs autorizados e testar a busca com fontes reais. Adicionar resposta por IA apenas com referências verificáveis.
5. Solicitar acesso à API do Spotify se a mesa precisar de controle de reprodução, respeitando as condições atuais da plataforma.

## Desenvolvimento e contribuições

Mantenha segredos fora do Git e descreva mudanças funcionais junto com os passos usados para verificá-las. Antes de abrir uma alteração, rode `npm run lint`, `npm run build`, `npm run test:web` e `npm run test:api` quando o ambiente estiver configurado. Build local não comprova migrations aplicadas, integração externa, commit, push ou deploy.
