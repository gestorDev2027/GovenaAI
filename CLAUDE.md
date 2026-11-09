# CLAUDE.md — GestorGov (GovenaAI)

Guia do projeto para quem desenvolve (pessoas e agentes de código). Leia antes de mudar qualquer coisa.
Idioma do projeto: **português do Brasil** — código, comentários, mensagens de commit, textos de tela e prompts.

## 1. O que é

**GestorGov — Gestão Pública Inteligente** é um ecossistema de agentes de IA para a gestão das **Secretarias
Municipais de Saúde**. O foco é o **setor público** (decisão de 12/11/2026): o segmento Empresa, criado em 11/11/2026,
saiu desta versão; a estrutura de segmentos ficou no código e no banco para o futuro (§2b).
Cada setor da secretaria ganha um agente que trabalha com os servidores: faz as rotinas do
setor sozinho, prepara documentos sob demanda e aponta o que precisa de atenção. Tudo o que um agente propõe ou
entrega passa pela aprovação de um servidor responsável.

A ambição de longo prazo é **substituir, módulo por módulo, os ERPs de saúde** que as prefeituras usam hoje. O
caminho até lá: os agentes começam por cima dos dados que a prefeitura já tem (exportações, planilhas,
documentos) e, aos poucos, o GestorGov passa a ser o lugar onde o dado nasce.

- **Cliente:** Secretarias Municipais de Saúde (segmento `saude_publica`, o único desta versão). Um segmento novo,
  no futuro = uma entrada em `agente/segmentos.py` e o catálogo dele numa migration.
- **Usuários:** servidores internos (secretário, coordenadores de setor, técnicos). **Não é atendimento ao
  cidadão** — ainda (ver §11).
- **Repositório:** github.com/gestorDev2027/GovenaAI.

### De onde veio

O código nasceu do **NexaAgents**, plataforma de agentes de atendimento por WhatsApp feita para o Contabilidade
Facilitada. O GestorGov reaproveita o motor (Agno, Fábrica de agentes, Conhecimento vetorizado, usuários e
permissões, observabilidade) e troca a camada de cima (marca, agentes, telas, onboarding).

A reestruturação de 07/11/2026 tirou o que era de atendimento por WhatsApp: Unnichat, canal, ficha do contato,
alertas e indicadores de atendimento, Visão geral, Conversas, Calibração (👍/👎, lacunas, curadoria), régua de
qualidade, sugestões de roteiro e as rotinas de inatividade e de avaliação diária. O agente do cidadão (Fase 4)
será escrito do zero quando chegar a vez dele; o código antigo está no histórico do Git (antes do commit da
reestruturação). Ficaram das primitivas 3D da Central antiga (`painel/src/components/central/`: móveis, robô,
exterior) para a visão Secretaria.

A limpeza de 06/11/2026 tirou as integrações da Nexa (compras, área do aluno, busca de aulas, apostilas, Data
Gateway) e o vocabulário de aluno: na tela, quem conversa é o **servidor**; no código, o **contato**
(`nome_contato`, `mensagem_contato`). Ainda há nomes herdados em
comentários (ex.: "Luna", "Vera", "SDR"): renomeie quando passar por eles.

## 2. O conceito

```
Organização → Áreas → Atividades → Agente da área → Pessoa que aprova
            → Unidades (UBS, UPA, CAPS...)
```

### 2b. Segmentos (estrutura para o futuro; nesta versão, só a saúde pública)

O motor é um só; o segmento muda os nomes de tela, os campos obrigatórios do cadastro, os modelos (tipos de área e
de unidade, atividades, cargos, indicadores) e as fontes externas. Tudo em `agente/segmentos.py`; os modelos ficam
nas migrations com `segmento_id`. Em 11/11/2026 entrou o segmento Empresa; em 13/11/2026 ele saiu (foco no setor
público: `20261113_gestorgov_sem_empresa.sql` apaga o catálogo dele de um banco já rodado). A estrutura ficou
(tabela `segmentos`, `segmento_id`, `organizacoes.dados_segmento`): um segmento novo volta sem refazer nada.

| | Saúde pública (`saude_publica`) |
|---|---|
| Organização | a Secretaria Municipal de Saúde (a prefeitura, o Fundo e o prefeito ficam em `dados_segmento`) |
| Área | setor |
| Pessoa | servidor |
| Responsável | secretário(a) de saúde |
| Unidades | unidades de saúde, importadas do CNES |
| Prédio | Secretaria virtual (CCO no centro) |
| Uma por município | sim (código IBGE) |

No banco: `organizacoes` (antes `municipios` + `secretarias`), `areas` (antes `setores`), `pessoas` (antes
`servidores`), `agentes_area`, `atividades_area`, `tipos_area`; tudo por `organizacao_id`. O texto das instruções dos
agentes da saúde continua falando de setor e secretaria (está certo para a saúde); o modelo da Fábrica
(`INSTRUCOES_MODELO`) recebe os nomes do segmento na criação (`fabrica.instrucoes_iniciais`).

### Áreas (setores)

Cada área (os setores da secretaria: Compras e Licitações, Atenção Primária, Regulação, Assistência Farmacêutica,
Vigilância, Gestão de Pessoas, Financeiro, Faturamento, Ouvidoria, Gabinete...) é uma sala do prédio e tem um agente
e um responsável.

### Atividades — dois tipos

| Tipo | Quem inicia | Vira no Agno | Exemplo |
|---|---|---|---|
| **Rotina** | o agente, num horário (a cada hora, diária, semanal, mensal) | Routine do CompanyOS | Regulação, a cada hora: "14 pacientes há mais de 90 dias esperando cardiologia" |
| **Sob demanda** | um servidor pede pelo chat do setor | Task (ou conversa) | Compras: "elabora o termo de referência de 2.000 seringas" |

O catálogo está em `supabase/gestorgov/20261111_gestorgov_2_saude.sql` (`modelos_atividade`). A implantação
sugere o catálogo; o responsável confirma, tira ou acrescenta.

### Aprovação (regra inegociável)

- O agente **nunca** aprova o próprio trabalho. `auto_accept=False` em toda Routine.
- Quem aprova é o responsável da área (`pessoas.aprova_tarefas`).
- Toda ação de pessoa ou de agente vai para `auditoria` (quem, quando, antes/depois, quem aprovou).

### As três visões da interface (o core)

1. **Cidade** (`/painel/comando`, abre em outra aba) — mapa real do município, plano (satélite visto de cima, com
   zoom), com um pino por unidade de saúde (UBS, UPA, CAPS, hospital, farmácia, SAMU...). O mapa não é 3D. Só
   unidades: setores e agentes ficam na Secretaria. No painel (`/painel/cidade`, "Unidades de saúde") não há mapa:
   é a lista, com a ficha num painel lateral.
   **Cada unidade em 3D** (`/painel/unidade/<id>`, abre pela ficha em outra aba; `pages/unidade.tsx`): o prédio da
   unidade em Three.js, como a Secretaria, com as salas do tipo (UPA: classificação de risco, consultórios, sala
   vermelha, observação, farmácia; UBS: consultórios, vacina, curativos, farmácia...), a recepção no centro (abre a
   ficha) e o agente da unidade na gerência.
2. **Secretaria virtual** (`/painel/secretaria`, abre em outra aba; `components/central/predio-secretaria.tsx`) — o
   prédio pelo cadastro: cada SETOR é uma sala de vidro com o agente do setor na mesa e a placa (setor, agente,
   responsável); no centro, o CCO (Centro de Comando e Operações). Quando um agente trabalha, o rosto dele muda
   (`agente/ao_vivo.py` → `/secretaria/eventos`). Um botão leva à Cidade e outro volta.
3. **Painel** — tabelas, aprovações, relatórios: onde o servidor trabalha no dia a dia.

Mais o **conversacional** presente em todas as visões: o chat com o agente do setor (ou com a recepção, numa
equipe). A **Central de comando** tem janelas flutuantes arrastáveis (unidades, alertas), painéis laterais de
detalhe, paleta de comandos (Ctrl+K) e modo foco (F).

### Ficha da unidade (`painel/src/components/unidades/`)

A mesma na Central de comando, na Cidade e na implantação: a foto principal ou, sem ela, a vista de satélite do
Mapbox (Static Images, pelo ponto no mapa; nada é guardado), os dados, a conferência ("a conferir" → conferida
por quem e quando) e as fotos (fachada, interior; enviadas do computador ou do celular, reduzidas para JPEG de até
1600 px, sem os metadados, no bucket privado `prefeituras`; sem Supabase, em `dados/arquivos/`). O cadastro e a
edição usam o CEP: o ViaCEP traz a rua e o bairro, e o Nominatim põe o ponto pela rua e número (ou pelo CEP).
Unidade importada do CNES chega "a conferir". Quem cadastra e confere precisa da permissão de cargo
`gerenciar_unidades`. Rotas em `organizacao_api.py` (`/organizacao/cep`, `/organizacao/unidades`, `/organizacao/fotos`), bucket `organizacoes`.

## 3. O onboarding conversacional (a primeira experiência do cliente)

Caminho de quem chega: **landing page** (`/painel/inicio`) → **Cadastrar** (`/painel/cadastro`: nome, e-mail e
senha) → **Implantação** (`/painel/implantacao`). Quem já tem conta usa **Entrar** (`/painel/entrar`: e-mail e senha, ou
Google). A conta nasce pendente para o Painel (o dono aprova), mas já implanta a própria prefeitura: as rotas
`/implantacao*` exigem só estar logado. Quem cadastra a organização entra em `membros` como dono, e o
assistente dessa conversa só mexe na organização dela (`conta_email` no estado da sessão). A primeira pergunta do
assistente é o CEP (ou a cidade) da prefeitura. Cadastro e login
precisam da `OS_SECURITY_KEY` (é ela que assina a sessão); sem ela, o painel fica aberto e sem login.

O secretário de saúde implanta a prefeitura **conversando** com o Assistente de Implantação. A tela é dividida:
chat à esquerda e, à direita, o quadro que se monta ao vivo — o mapa da cidade ganhando pinos, o prédio ganhando
andares, os robôs sentando nas mesas. No fim, a câmera sai do prédio e mostra a cidade inteira funcionando.
Referência visual: o estúdio de páginas "Forminho" (chat + canvas, montagem seção por seção).

### Fases (obrigatórias, nesta ordem) — pedido de 08/11/2026

Cada fase só termina com tudo gravado; as ferramentas da fase seguinte recusam enquanto faltar algo e dizem o quê
(`gestao.pendencias`, `gestao.bloqueio`). A fase atual é a primeira incompleta (`gestao.fase_atual`, gravada em
`onboardings.etapa`). Uma fase por resposta: o servidor manda `fase_da_vez` no estado da sessão e as ferramentas das
fases seguintes esperam a próxima mensagem do secretário (o modelo não encadeia fases sozinho).

| # | Fase | O que precisa ficar completo | Ferramentas |
|---|---|---|---|
| 1 | `organizacao` | Os campos obrigatórios (`segmentos.py`, `Campo.obrigatorio`; CNPJ com dígitos conferidos): prefeitura (CNPJ, endereço, telefone, prefeito) e secretaria (nome, CNPJ do Fundo, endereço, telefone, e-mail, secretário) | `buscar_municipio`, `registrar_organizacao`, `salvar_dados_prefeitura`, `salvar_dados_secretaria`, `buscar_endereco` (Mapbox + ViaCEP), `pesquisar_na_web` (Google, `agente/pesquisa.py`) |
| 2 | `areas` | Pelo menos uma área (cada uma vira uma sala do prédio) | `listar_tipos_area`, `salvar_areas` |
| 3 | `atividades` | Toda sala com pelo menos uma atividade | `sugerir_atividades`, `salvar_atividades`, `nova_atividade` |
| 4 | `cargos` | Toda área com pelo menos um cargo (organograma). O catálogo é só sugestão: grava o que for confirmado | `sugerir_cargos`, `salvar_cargos`, `criar_cargo` |
| 5 | `responsaveis` | Todo setor com responsável (quem aprova) | `cadastrar_responsavel` |
| 6 | `agentes` | Todo setor com o seu agente (criado para a prefeitura) | `montar_agentes` |
| 7 | `equipe` | Os responsáveis com acesso; os acessos cadastrados pelo assistente aprovados pelo dono no painel | `dar_acesso` |
| 8 | `unidades` | A lista confirmada pelo responsável, ou "fica para depois" (o CNES só na saúde) (o assistente cadastra unidades a qualquer momento, mesmo depois da implantação) | `importar_unidades_cnes`, `acompanhar_importacao`, `cadastrar_unidade`, `situacao_implantacao(ir_para_revisao)` |
| 9 | `revisao` | Resumo e "pode concluir": o município fica ativo | `situacao_implantacao`, `concluir_implantacao` |

Dado achado na web é proposta: só grava depois do "sim". Nada de copiar um campo para outro (o e-mail da conta não é o
da secretaria).

**Acessos com aprovação:** o que o assistente cadastra (`dar_acesso`) vira convite com `origem = 'assistente'`, que só
vale depois que o dono aprova em "Equipe e acessos" (`POST /prefeitura/convites/{id}/aprovar` gera o link de entrada).
Os convites feitos no painel nascem aprovados.

**Implantação compartilhada:** "Compartilhar" (no cabeçalho da implantação) gera um link (`/painel/colaborar/<token>`,
7 dias) e um código de segurança de 6 dígitos, mostrados uma vez (no banco, só os hashes; tabela `implantacao_links`).
Quem entra com os dois cria a conta (ou usa a dele), vira membro da prefeitura e continua a implantação; cinco códigos
errados cancelam o link. A conversa é de cada pessoa; a situação da implantação é a mesma.

**O Assistente de Implantação não é agente da secretaria:** fica fora da lista de agentes (`/agentes`), do prédio e
das equipes (a Fábrica recusa pô-lo numa equipe); ele tem a tela dele, `/painel/implantacao`.

Regras do assistente: uma etapa por vez; propõe em vez de perguntar do zero; grava só o que foi confirmado; nunca
inventa unidades, nomes ou e-mails; preço/contrato vão para a equipe (`transferir_para_humano`). Retomada:
`situacao_implantacao` diz onde parou. Instruções completas: `agente/perfis/onboarding.py`.

### Como o quadro se atualiza

- Cada ferramenta grava no banco (`agente/gestao.py`), na hora.
- A tela pede `GET /painel/api/gestao/panorama?municipio=<id>` a cada resposta do assistente e redesenha:
  município (centro e zoom), secretaria (andares), setores (com atividades, responsável e agentes), unidades (com
  coordenadas).
- `GET /painel/api/gestao/catalogo` traz cores e ícones dos tipos de unidade e de setor.

### Status

- Backend pronto (ferramentas, rotas, banco).
- Tela de implantação: chat à esquerda; à direita, o prédio (até a etapa dos agentes) ou a cidade (das unidades em
  diante), com um seletor para trocar, e as listas embaixo. O quadro só aparece em tela larga (lg).

## 4. Agentes

Todos usam **Gemini** (`AGENTE_MODELO`, padrão `gemini-3.6-flash`) — agentes, onboarding, Fábrica e embeddings.

| id | Agente | Ferramentas | Arquivo |
|---|---|---|---|
| `onboarding` | Assistente de Implantação (padrão do servidor; fora das equipes) | implantação (com Google e Mapbox) | `agente/perfis/onboarding.py` |
| `processos` | Assistente de Processos (fora da lista de agentes e das equipes) | atividades e processos (`agente/ferramentas_processos.py`) | `agente/perfis/processos.py` |
| `compras` | Agente de Compras e Licitações | consulta | `agente/perfis/compras.py` |
| `atencao_primaria` | Agente da Atenção Primária | consulta | `agente/perfis/atencao_primaria.py` |
| `regulacao` | Agente de Regulação | consulta | `agente/perfis/regulacao.py` |
| `unidade` | Agente das Unidades de Saúde | consulta | `agente/perfis/unidade.py` |

Os de setor e o das unidades são **modelos da saúde**: cada Secretaria ganha a sua cópia na implantação (§3). As
demais áreas ganham um agente da Fábrica com o modelo de instruções nos nomes do
segmento (`agente/agentes_organizacao.py`).

- Agentes de setor seguem um molde único: `agente/perfis/setor.py` (`perfil_de_setor`). Novo setor no código =
  um arquivo de 20 linhas + registrar em `agente/perfis/__init__.py` + `agente/base_conhecimento_<id>.md` +
  incluir em `MODELO_DA_AREA` (`agente/agentes_organizacao.py`).
- Os demais setores ganham agente pela **Fábrica de agentes** no painel (sem código), com o modelo
  `INSTRUCOES_MODELO` de `agente/fabrica.py`.
- Nas instruções, `{nome_contato}` é o nome de quem conversa; nos roteiros, `[NOME DO CONTATO]` é trocado pelo
  primeiro nome.
- Base de conhecimento de cada agente: Markdown editável pelo painel; seções fixas obrigatórias:
  `## Boas-vindas`, `## Transferência para a equipe`, `## Encerramento por inatividade`,
  `## Pedido fora do atendimento`.
- Documentos (PDF, Word, planilhas) vão no **Conhecimento** do painel e chegam ao agente como trechos
  vetorizados.
- Casos de teste de cada agente na Fábrica (`fabrica_casos`), com juiz e nota mínima em `agente/datasets.py`
  (que guarda também as frases do guardrail de manipulação).

## 5. Arquitetura

| Camada | Tecnologia |
|---|---|
| Agentes | Agno 3.1.12 (`agno[os]`): Agent, Team (equipes), Memory, Evaluation, Traces, Scheduler, CompanyOS |
| Modelo | Google Gemini (`google-genai`) |
| Servidor | FastAPI (AgentOS) + Uvicorn; painel servido em `/painel` |
| Banco | Supabase (Postgres + pgvector + Storage + Vault), schema `gestorgov` |
| Painel | React 19 + TypeScript + TanStack Router/Query + Tailwind 4 + Three.js (React Three Fiber) |
| Deploy | Render (Docker, Blueprint `render.yaml`) |

### Mapa do código

```
app.py                        AgentOS + rotas + rotinas de manutenção + CompanyOS
gestao_api.py                 /painel/api/gestao/* (panorama, organizações, catálogo com os segmentos)
painel_api.py                 painel: acesso, login, implantação, chat, conversas, base, limpeza
fabrica_api.py                Fábrica de agentes e equipes (skills, ferramentas HTTP, chaves, casos de teste)
organizacao_api.py            a organização de quem está logado: unidades, fotos, agentes (ficha), cargos, equipe e convites
conhecimento_api.py           documentos vetorizados
banco_api.py                  Observabilidade (leitura do banco)
agente/segmentos.py           os segmentos: nomes de tela, campos do cadastro, CNES, um por município
agente/gestao.py              cadastro da organização (tabelas, leitura, gravação, fases) + ViaCEP/IBGE/OSM/CNES
agente/agentes_organizacao.py os agentes de cada organização (um por área e o das unidades)
agente/dados_agente.py        a ficha de cada agente e o que ele lê dos dados
agente/ferramentas_gestao.py  ferramentas dos agentes (implantação e consulta)
agente/companyos.py           áreas → Products; atividades de rotina → Routines
agente/segundo_plano.py       tarefas demoradas: dispara (thread ou Render Workflows) e guarda o andamento
tarefas/                      as tarefas demoradas (documentos, CNES, testes da Fábrica); main.py = Render Workflows
agente/perfis/                os agentes do código
agente/agente.py              monta cada Agent a partir do perfil (modelo, memória, guardrails)
supabase/gestorgov/           migrations (rodar à mão no SQL Editor)
painel/src/                   frontend
```

### Banco

- Schema `gestorgov`, papel `gestorgov_app` (só enxerga o próprio schema). RLS ligado nas tabelas do cadastro,
  com política só para o papel do servidor. O schema **não** é exposto na API REST do Supabase.
- Migrations (`supabase/gestorgov/`, rodar em ordem): `20261111_gestorgov_1_base.sql` (schema, papel, pgvector,
  buckets `agentes` e `organizacoes`, Vault, todas as tabelas, RLS), `..._2_saude.sql` (catálogo da saúde: 16 setores,
  14 tipos de unidade com os códigos do CNES, atividades, 38 cargos e 125 indicadores do documento da Secretaria de
  Saúde Virtual), `20261112_gestorgov_processos.sql` (os processos das
  atividades e o vínculo com o CompanyOS; tira as tabelas `entregas` e `pendencias`). Em banco que já rodou o antigo `..._3_empresa.sql`, rode `20261113_gestorgov_sem_empresa.sql` (tira o segmento Empresa). Elas substituíram as de 06 a 10/11/2026, que nunca
  rodaram em produção. No SQLite local, os catálogos são carregados das migrations a cada início.
- Tabelas do cadastro: `segmentos`, `tipos_area`, `tipos_unidade`, `modelos_atividade`, `modelos_cargo`,
  `modelos_indicador`, `organizacoes`, `pessoas`, `areas`, `unidades`, `unidade_fotos`, `agentes_area`,
  `fichas_agente`, `atividades_area`, `cargos`, `indicadores_cargo`, `medicoes`, `entregas`, `pendencias`,
  `status_cargo`, `alertas_cargo`, `membros`, `convites`, `implantacao_links`, `onboardings`, `auditoria` (só
  inserção). Tudo separado por `organizacao_id`.
- Tabelas que o servidor cria ao subir: as do Agno (`agno_*`, CompanyOS) e as do painel (`fabrica_*`,
  `conhecimento_*`, `guardrail_frases`, `painel_usuarios`, `painel_contas`, `tarefas_execucoes`...). Não crie essas à mão. Num banco que
  já rodou o NexaAgents podem sobrar `unnichat_*`, `avaliacoes_humanas`, `qualidade_supervisor` e `alertas_baixas`:
  não são mais usadas.
  `create_all` não altera tabela que já existe: coluna renomeada no código precisa de `alter table` à mão.
- Sem `DATABASE_URL`: SQLite local em `dados/`, com o cadastro e os catálogos carregados das migrations.

## 5b. Arquitetura dos agentes (decidida em 08 e 11/11/2026)

O sistema gira em torno dos agentes. Os gestores definem o trabalho, os agentes executam, e as pessoas aceitam, aprovam
e revisam, conforme a permissão do cargo. Nada que muda dados vale sem uma pessoa.

**O trabalho no CompanyOS do Agno (construído em 11/11/2026; `agente/trabalho.py`):**

| GestorGov | CompanyOS | Como |
|---|---|---|
| Área | Product (`area-<area_id>`) | criado na implantação (montar_agentes e concluir) e quando surge atividade nova |
| Atividade | Project (`atividades_area.projeto_id`) | um por atividade |
| Cada execução | Task | proposta (backlog) → aceita (ready) → em execução → em revisão → concluída |
| Agente da área | executor | o CompanyOS acha o agente no `registro.agentes` (os do ar, inclusive os criados sem reiniciar) |

- **Processo** de cada atividade (tabela `processos`, versionada): passos `agente`, `aceite` (uma pessoa aceita a
  tarefa; obrigatório), `aprovacao` (uma pessoa aprova a ação sensível do passo seguinte do agente; recusada, a ação é
  pulada) e `revisao` (último passo: aprova, ou ajusta e devolve para o agente refazer, sem limite). Cada passo de
  pessoa pode nomear cargos; sem cargos, decide quem tem "aprovar entregas" num cargo da área, a direção e o dono
  (`trabalho.pode_decidir`).
- **Proposta:** na rotina ou num pedido do chat, o agente usa `propor_tarefa`; a tarefa espera o aceite.
- **Execução:** aceita, o processo vira um Workflow do Agno (cada passo do agente é um Step; a aprovação é
  `HumanReview(requires_confirmation)`), que pausa e retoma pelo `run_id`. O andamento fica em `tarefas_execucao`
  (criada pelo servidor): rodando, aguardando_aprovacao, entregue ou erro.
- **Rotinas:** o nosso agendador (`agente/rotinas.py`, uma thread que acorda a cada minuto) roda as atividades de
  rotina das organizações ativas no cron delas, só com `GESTORGOV_ROTINAS=sim` (cada uma chama o Gemini). Sem isso,
  pelo botão "Rodar agora". A Routine do CompanyOS não é usada: a declarada no código recebe 403 com o login ligado.
  `GESTORGOV_COMPANYOS` (o CompanyOS montado no AgentOS) continua desligado; o nosso uso não depende dele.
- **Assistente de Processos** (`processos`): o gestor desenha em conversa as atividades e os processos (painel em
  "Atividades e processos"; permissão `gerenciar_fluxos`). Ele propõe e grava só depois do "sim".
- **Telas:** Aprovações (aceitar, aprovar ações, revisar com "ajustar e devolver"), Atividades e processos (os passos,
  "Rodar agora" e o chat do assistente) e os selos nas salas do prédio (`/organizacao/atencao`).
- As tabelas `entregas` e `pendencias` saíram: as Tasks são a fonte única das tarefas e das entregas.

**Ficha do agente** (montada na implantação, como um personagem, no estilo do criador do Meshy: uma pergunta por
tela, prévia ao lado; depois editável no painel por quem tem "criar agentes"):
- características: aparência (avatar, cor) e comportamento (tom, autonomia);
- skills: o que ele sabe fazer;
- memória: do agente, da área (compartilhada entre os agentes da área) e da organização (geral, todos leem);
- dados: o que ele enxerga do cadastro (por tipo de dado; `agente/dados_agente.py`);
- integrações externas liberadas para ele (da Central de integrações).

**Memória: a nativa do Agno é a base; o Mem0 é uma ferramenta a mais** (decidido em 12/11/2026). Cada agente já usa
o `MemoryManager` do Agno (`agente/agente.py`: `update_memory_on_run`, `add_memories_to_context`), com as instruções
de memória do perfil (nunca dado de paciente ou de cliente). O Mem0 auto-hospedado (`mem0ai`, `Mem0Tools(config=...)`,
vetores no pgvector do nosso Supabase, modelo e embeddings no Gemini, nada na nuvem do Mem0) entra depois, como
ferramenta opcional liberada pela ficha do agente, para o que o nativo não cobre (memória compartilhada da área ou da
organização). Separação obrigatória por organização em toda busca; `enable_delete_all_memories=False` sempre.

**Central de integrações = MCP Toolbox for Databases** (pedido de 11/11/2026: o Toolbox não é só para o nosso banco
nem para a memória; é o centro de integrações externas do sistema). O Toolbox serve ferramentas de muitas fontes:
o nosso banco, bancos de outros sistemas (Postgres, MySQL, SQL Server, BigQuery...) e APIs REST (fonte `http`, com
cabeçalhos e chaves). Cada fonte é cadastrada na Central; as ferramentas são agrupadas em toolsets; cada agente
recebe só os toolsets da ficha dele (`agno.tools.mcp_toolbox.MCPToolbox`, `bound_params` com o `organizacao_id`
para separar as organizações). Servidores MCP externos (`agno.tools.mcp`) e webhooks de entrada (Edge Functions)
também entram pela Central. O Mem0 (memória) fica fora do Toolbox. Credenciais no Vault do Supabase: no banco, só a referência; o servidor monta a configuração do Toolbox lendo o
Vault, e o valor nunca chega ao modelo. Por prefeitura e por agente (cada agente usa só as integrações da ficha dele), com hosts
liberados, limite de chamadas, teste de conexão e cada chamada na auditoria. O `.env` do Render fica só com o mínimo
para subir (banco, Supabase, Gemini). Extensões do Supabase previstas: Vault, pgvector, pg_net, pg_cron, Wrappers,
pgmq; e Realtime para o painel ao vivo.

**Ordem de construção:** 0) generalização em organizações e segmentos (feito em 11/11/2026); 1) o CompanyOS com os
processos, as aprovações e o Assistente de Processos (feito em 11/11/2026); 2) Central de integrações com o Toolbox e o Vault; 3) rotinas
como workflows, com a fila de aprovação por setor; 4) o Mem0 como ferramenta a mais (a memória nativa do Agno já funciona); 5) o criador de agente na implantação.

## 6. Identidade visual

Da logo GestorGov (símbolo "G" em arco + três barras + ponto amarelo; "Gestor" + "GOV"; "Gestão pública
inteligente").

| Uso | Cor |
|---|---|
| Base escura / texto | azul-marinho `#0D1B38` |
| Primária | azul `#1A63D8` |
| Apoio / gráficos / primária no escuro | azul-claro `#52A2FF` |
| Destaque e alerta (com moderação) | amarelo `#F4B800` |
| Texto secundário | cinza-azulado `#424E6B` |

- Meio-termo entre o institucional e o moderno (referências enviadas em 07/11/2026): menu lateral azul-marinho
  com o item ativo em pílula azul, barra do topo com a prefeitura e o usuário, cartões brancos com cantos médios
  (6–16 px), indicadores com ícone em círculo, botões de destaque em pílula amarela. Sem degradês fortes.
- Telas de acesso (entrar, cadastrar, convite): sem cabeçalho; formulário à esquerda, que rola, e painel fixo da
  marca à direita.
- Logo (`components/layout/logo.tsx`): o símbolo e "GestorGov" numa linha ("Gov" em azul); o subtítulo "Gestão pública
  inteligente" só nas telas de acesso (`subtitulo`). O amarelo fica no ponto do símbolo.
- Implantação no estilo do Replit (a referência de interface preferida): chat fino à esquerda (assistente em texto
  limpo, servidor em balão azul-claro, "Trabalhou por N s", respostas rápidas quando o assistente pergunta) e o
  canvas grande à direita, com a barra fina (Secretaria · Cidade · Resumo e o progresso das etapas).
- Claro e escuro obrigatórios. Tokens em `painel/src/styles.css`; logo em
  `painel/src/components/layout/logo.tsx` (SVG, o texto acompanha o tema). O símbolo da Central 3D e dos avatares
  está em `painel/public/espaco/gestorgov-branco.png` e `gestorgov-cor.png`.
- Acessibilidade: seguir o eMAG (contraste, teclado, leitor de tela). Amarelo sobre branco não passa como texto.
- **3D nunca é obrigatório**: toda informação das visões Cidade e Secretaria precisa existir no Painel
  (computadores de prefeitura são fracos).

## 7. Acessos: plataforma e prefeituras

Dois níveis, separados:

- **Plataforma** (equipe GestorGov): `painel_usuarios` (agente/usuarios.py), com o dono em `PAINEL_DONO`. Vê as telas
  de configuração (Fábrica, Conhecimento, Observabilidade, Usuários), a Cidade, a Central de comando e o chat.
- **Organização** (agente/acessos.py, rotas em organizacao_api.py): quem cadastra a organização é o **dono** dela
  (`membros.papel = 'dono'`), entra sem aprovação da plataforma e pode tudo nela. Ele monta o organograma
  (cargos do catálogo ou criados à mão), define as **permissões de cada cargo** (`cargos.permissoes`: ver o painel,
  aprovar e devolver entregas, gerenciar os fluxos dos agentes, criar agentes, definir metas, registrar dados,
  gerenciar cargos, gerenciar a equipe, ver a auditoria) e convida a equipe por link (`convites`, 7 dias, a pessoa
  cria a senha). O membro pode o que o cargo dele pode; o dono não pode ser bloqueado; ninguém altera o próprio acesso.
- Toda rota da organização usa a organização de quem está logado: nunca um id vindo da tela.
- Separação por agente: cada agente da Fábrica guarda o município dono (`fabrica_agentes.municipio_id`); quem é de
  uma prefeitura vê só os agentes dela (`escopo_painel` em painel_api.py): lista de agentes (`/agentes`), chat e
  conversas. As conversas de servidor começam com `servidor-` e levam o e-mail de quem conversou. Fábrica,
  Conhecimento, Observabilidade e Usuários continuam só da
  plataforma (a prefeitura ainda não cria nem edita os próprios agentes).

## 8. Segurança, LGPD e regras dos agentes

- Dados de saúde são **sensíveis** (LGPD). Agentes trabalham com números agregados e códigos; **nunca** pedem nem
  repetem nome completo, CPF ou Cartão SUS de paciente. Memória dos agentes nunca guarda dados de pacientes.
- Decisão clínica (ex.: prioridade na regulação) é sempre do profissional: o agente aponta, a pessoa decide.
- Normas e leis: o agente só cita o que está na base de conhecimento ou nos documentos.
- Login do painel: Google; qualquer e-mail verificado entra como **pendente** até o dono aprovar. Defina sempre
  `PAINEL_DONO` (sem ele e sem `PAINEL_DOMINIOS`/`PAINEL_EMAILS`, ninguém vira dono automaticamente).
- Segredos só em variáveis de ambiente (Render) — nunca no repositório. Chaves da Fábrica ficam no Vault.

## 9. Deploy e operação

### Render

- `render.yaml` (Blueprint) + `Dockerfile` (etapa Node constrói o painel; etapa Python roda o servidor).
- O `render.yaml` está com `plan: starter`. O plano free dorme após 15 min sem acesso (acorda em ~1 min) e as
  rotinas não rodam enquanto dorme: serve só para demonstração. Cliente real: `starter` ou acima.
- Região Virginia (o Render não tem Brasil).
- Variáveis secretas: `GOOGLE_API_KEY`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `PAINEL_DONO`, `PAINEL_GOOGLE_CLIENT_ID`, `PAINEL_DOMINIOS` (opcional). `OS_SECURITY_KEY` é gerada pelo Render.

### Tarefas demoradas (agente/segundo_plano.py, tarefas/)

Documentos do Conhecimento (texto e embeddings), importação do CNES e casos de teste da Fábrica não rodam dentro da
requisição nem do turno do agente: `segundo_plano.disparar` grava a linha em `tarefas_execucoes` (o andamento) e
roda a tarefa. **Padrão: numa thread do servidor web** (serve no plano grátis; ao reiniciar, `limpar_presas` marca
as que morreram). Com `GESTORGOV_WORKFLOWS=sim` e `RENDER_API_KEY`, vão para o **Render Workflows** (serviço
`gestorgov-tarefas`, `python -m tarefas.main`, modelo comentado no `render.yaml`): cada execução numa máquina
própria, com novas tentativas e tempo limite; os casos da Fábrica, 5 por vez. Se o Render recusar, roda na thread.

- **A entrada da tarefa só leva ids e números** (`_conferir_entrada` recusa o resto): o Render guarda os argumentos
  e o retorno de cada execução. O que a tarefa precisa além disso (sessão, quem pediu) vai em `contexto`, no nosso
  banco; a resposta de cada caso da Fábrica fica em `tarefas_execucoes`, não no Render.
- Toda tarefa pode ser repetida sem duplicar (unidade pelo código CNES, trechos do documento trocados).
- Nas conversas de teste da Fábrica (`aval-...`), as ferramentas que gravam só fingem (`ferramentas_gestao._simulado`).
- Local com o servidor de tarefas do Render (Render CLI 2.12+): `render workflows dev -- .venv\Scripts\python -m
  tarefas.main` e, no `.env`, `GESTORGOV_WORKFLOWS=sim` e `RENDER_USE_LOCAL_DEV=true`.

### Demonstração

Saiu em 11/11/2026 (pedido: nada de dados de mentira; tudo nasce na implantação). O código antigo
(`agente/demo.py`) está no histórico do Git.

### Supabase

- Projeto na região **São Paulo** (dados de saúde no Brasil).
- `DATABASE_URL` = **Session pooler**, porta 5432, usuário `gestorgov_app.<id-do-projeto>`. O Render não alcança a
  conexão direta do Supabase (só IPv6).
- Senha do papel definida à mão: `alter role gestorgov_app with login password '...';`
- Plano Free no MVP (pausa após 7 dias sem uso); **Pro** antes do primeiro piloto (backup, sem pausa).

### Comandos

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env                 # GOOGLE_API_KEY
.venv\Scripts\python app.py            # http://localhost:7778/painel
.venv\Scripts\python chat.py           # assistente de implantação no terminal
.venv\Scripts\python chat.py regulacao # outro agente
cd painel; npm install; npm run dev    # http://localhost:5178/painel
cd painel; npm run build               # confere os tipos (tsc) e gera o painel
```

### Git

- Toda mudança vai num **branch com PR para a `main`** (desde 12/11/2026); o dono revisa e faz o merge no GitHub. Não
  commitar direto na `main`. O Render publica a cada mudança na `main`, ou seja, no merge do PR. Com mais de uma sessão
  trabalhando, sincronize o branch com a `main` antes de abrir o PR.
- Mensagens de commit em português, no imperativo e curtas ("Onboarding: tela com mapa e chat").
- Nunca commitar `.env`, `dados/`, `node_modules/`, `painel/dist/`, `Claude outputs/`, `*.zip` (estão no
  `.gitignore`).

## 10. Roadmap

### Fase 0 — Base (feito)

- [x] Cópia do NexaAgents sem WhatsApp, com a marca GestorGov
- [x] Limpeza dos restos da Nexa (integrações, régua de qualidade, vocabulário de aluno)
- [x] Reestruturação, etapa 1: fora o atendimento por WhatsApp (backend, telas, rotas e rotinas)
- [x] Banco: schema, papel, cadastro da prefeitura, catálogo de atividades, auditoria
- [x] Assistente de Implantação e 3 agentes de setor
- [x] CompanyOS (setores → Products, rotinas → Routines), atrás de `GESTORGOV_COMPANYOS`
- [x] Render (Docker + Blueprint) e Supabase

### Fase 1 — MVP demonstrável (agora)

Reestruturação aprovada em 07/11/2026 (uma etapa por vez, cada uma com commit e teste no navegador):

- [x] 1. Limpeza: fora o NexaAgents (backend, telas, rotas e rotinas de atendimento)
- [ ] 2. Banco novo: CompanyOS como fonte única das tarefas; rotinas dos setores pelo Scheduler do Agno (as
      Routines do CompanyOS declaradas no código recebem 403 com a OS_SECURITY_KEY ligada); tabelas da operação da
      unidade (estoque, movimentos, produção, ocorrências); migrations consolidadas num esquema limpo
- [ ] 3. Central de comando completa: Fluxos, Aprovações e Execuções ligados ao Agno; alertas dos cargos
- [ ] 4. Unidades: equipe, estoque, produção e o agente da unidade reportando à superintendência (feito: cadastro
      por CEP, conferência, fotos e a vista de satélite na ficha)
- [ ] 5. Secretaria pelo organograma (feito: uma sala por setor com o agente e o CCO no centro, montada na
      implantação; falta: os cargos dentro das salas)
- [x] 6. Implantação na ordem nova: prefeitura, setores, atividades, responsáveis e agentes, com a Secretaria
      virtual se montando ao lado; por último as unidades no mapa real, cada uma com o seu prédio e o agente
- [ ] 7. Visão 3D de cada unidade com o agente dela (feito: o prédio com as salas do tipo e o agente na gerência);
      falta: um agente próprio por unidade (hoje é um por prefeitura) e as salas com a equipe, o estoque e a produção

- [ ] Primeiro deploy validado no Render (build do painel, CompanyOS agendando de verdade)
- [ ] **Tela de onboarding**: chat à esquerda; à direita, mapa (MapLibre + OpenStreetMap, sem custo por uso) e
      prédio 3D montando a partir de `/gestao/panorama`; animação final da cidade
- [ ] Conferir a API de dados abertos do CNES (endereço e nomes dos campos em `gestao.unidades_cnes`) e os
      códigos de tipo em `tipos_unidade.codigos_cnes`
- [ ] Revisão do catálogo de atividades por alguém de secretaria
- [ ] Casos de teste do assistente de implantação (`testes/avaliacoes.py`, `CASOS`)

### Fase 2 — Primeiro piloto

- [ ] Visão Cidade (mapa com unidades e alertas) e visão Secretaria ligada ao cadastro (andares = setores)
- [ ] Fila de aprovação das Tasks do CompanyOS por setor, para o responsável
- [ ] Login por e-mail institucional / gov.br e perfis por papel (secretário, coordenador, servidor)
- [ ] Agentes para Farmácia, Vigilância, RH, Financeiro, Faturamento, Ouvidoria e Gabinete
- [ ] Importação de planilhas/exportações dos sistemas da prefeitura como fontes dos setores
- [ ] Render Starter e Supabase Pro

### Fase 3 — Substituir módulos de ERP

- [ ] Módulos onde o dado nasce no GestorGov (ex.: estoque da farmácia, contratos e atas, fila da regulação)
- [ ] Integrações oficiais (e-SUS APS, CNES, sistemas de regulação) quando houver acesso

### Fase 4 — Agente do cidadão (futuro)

Um agente de saúde por cidadão no WhatsApp (um Agent, uma sessão e memória por pessoa), com uma integração nova
(a da Unnichat herdada saiu na reestruturação; está no histórico do Git). Começa pelo administrativo: lembretes de consulta/vacina, situação na fila, medicamento
disponível, exame pronto, ouvidoria. Exige identidade validada (CPF/Cartão SUS/gov.br), consentimento LGPD e,
para qualquer orientação clínica, respaldo jurídico e médico; emergência → SAMU 192.

## 11. Fora de escopo agora

- WhatsApp e qualquer atendimento ao cidadão (Fase 4).
- Diagnóstico, triagem ou orientação clínica.
- Escrever em sistemas oficiais do SUS.
- Cobrança e contratos dentro do sistema.

## 12. Pontos em aberto / riscos conhecidos

- **Ainda não houve deploy.** Em 06/11/2026 o código foi conferido localmente (Python 3.14, porque a 3.13 do
  projeto não estava instalada): o backend importa inteiro, os quatro agentes montam e o painel compila
  (`npm run build`). Nenhuma conversa real com o Gemini nem com o Supabase foi feita.
- **CompanyOS:** a API foi escrita a partir dos exemplos do blog do Agno e conferida no Agno 3.1.12 instalado:
  `agno.company.Product`/`Routine`, `agno.os.CompanyConfig` e `agno.job_queue.QueueConfig` existem, os argumentos
  usados batem com as assinaturas e o AgentOS monta com `company=` e `queue=`. Falta ver as rotinas agendando de
  verdade. Se falhar, o servidor sobe sem CompanyOS e loga o motivo.
- `fastapi>=0.149.0` foi liberado para acompanhar o Agno 3.1.12; fixar a versão depois do primeiro deploy bom.
- Products do CompanyOS são montados ao subir o servidor: município novo entra no próximo deploy/reinício.
- Plano gratuito (Render e Supabase) não serve para uso real: rotinas param e o banco pausa.
