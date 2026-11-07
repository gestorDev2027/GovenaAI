# CLAUDE.md — GestorGov (GovenaAI)

Guia do projeto para quem desenvolve (pessoas e agentes de código). Leia antes de mudar qualquer coisa.
Idioma do projeto: **português do Brasil** — código, comentários, mensagens de commit, textos de tela e prompts.

## 1. O que é

**GestorGov — Gestão Pública Inteligente** é um ecossistema de agentes de IA para a gestão das **Secretarias
Municipais de Saúde**. Cada setor da secretaria ganha um agente que trabalha com os servidores: faz as rotinas do
setor sozinho, prepara documentos sob demanda e aponta o que precisa de atenção. Tudo o que um agente propõe ou
entrega passa pela aprovação de um servidor responsável.

A ambição de longo prazo é **substituir, módulo por módulo, os ERPs de saúde** que as prefeituras usam hoje. O
caminho até lá: os agentes começam por cima dos dados que a prefeitura já tem (exportações, planilhas,
documentos) e, aos poucos, o GestorGov passa a ser o lugar onde o dado nasce.

- **Cliente:** prefeituras (começando pela Secretaria de Saúde; o modelo de dados já prevê Educação, Assistência
  Social e Administração).
- **Usuários:** servidores internos (secretário, coordenadores de setor, técnicos). **Não é atendimento ao
  cidadão** — ainda (ver §10).
- **Repositório:** github.com/gestorDev2027/GovenaAI.

### De onde veio

O código nasceu do **NexaAgents**, plataforma de agentes de atendimento por WhatsApp feita para o Contabilidade
Facilitada. O GestorGov reaproveita o motor (Agno, Fábrica de agentes, Conhecimento vetorizado, Calibração,
Central ao vivo 3D, usuários e permissões, observabilidade) e troca a camada de cima (marca, canal, agentes,
telas, onboarding).

A limpeza de 06/11/2026 tirou as integrações da Nexa (compras, área do aluno, busca de aulas, apostilas, Data
Gateway) e o vocabulário de aluno: na tela, quem conversa é o **servidor**; no código, o **contato**
(`nome_contato`, `mensagem_contato`); no código reservado ao WhatsApp, o **cidadão**. Ainda há nomes herdados em
comentários (ex.: "Luna", "Vera", "SDR"): renomeie quando passar por eles.

## 2. O conceito

```
Prefeitura → Secretaria de Saúde → Setores → Atividades → Agente do setor → Servidor que aprova
```

### Setores

Cada setor da secretaria (Compras e Licitações, Atenção Primária, Regulação, Assistência Farmacêutica,
Vigilância, Gestão de Pessoas, Financeiro, Faturamento, Ouvidoria, Gabinete...) é um andar/sala do prédio da
secretaria e tem um agente e um responsável.

### Atividades — dois tipos

| Tipo | Quem inicia | Vira no Agno | Exemplo |
|---|---|---|---|
| **Rotina** | o agente, num horário (a cada hora, diária, semanal, mensal) | Routine do CompanyOS | Regulação, a cada hora: "14 pacientes há mais de 90 dias esperando cardiologia" |
| **Sob demanda** | um servidor pede pelo chat do setor | Task (ou conversa) | Compras: "elabora o termo de referência de 2.000 seringas" |

O catálogo padrão (27 atividades em 10 setores) está em `supabase/gestorgov/20261106_gestorgov_atividades.sql`
(`modelos_atividade`). O onboarding sugere esse catálogo; o secretário confirma, tira ou acrescenta.

### Aprovação (regra inegociável)

- O agente **nunca** aprova o próprio trabalho. `auto_accept=False` em toda Routine.
- Quem aprova é o responsável do setor (`servidores.aprova_tarefas`).
- Toda ação de pessoa ou de agente vai para `auditoria` (quem, quando, antes/depois, quem aprovou).

### As três visões da interface (o core)

1. **Cidade** — mapa real do município com todas as unidades de saúde (UBS, UPA, CAPS, hospital, farmácia,
   SAMU...) e o estado de cada uma (alertas, estoque, fila).
2. **Secretaria** — o prédio em 3D (a "Central ao vivo" herdada): setores nos andares, agentes trabalhando nas
   mesas.
3. **Painel** — tabelas, aprovações, relatórios: onde o servidor trabalha no dia a dia.

Mais o **conversacional** presente em todas as visões: o chat com o agente do setor (ou com a recepção, numa
equipe).

## 3. O onboarding conversacional (a primeira experiência do cliente)

Caminho de quem chega: **landing page** (`/painel/inicio`) → **Cadastrar prefeitura** (`/painel/cadastro`: nome, e-mail e
senha) → **Implantação** (`/painel/implantacao`). Quem já tem conta usa **Entrar** (`/painel/entrar`: e-mail e senha, ou
Google). A conta nasce pendente para o Painel (o dono aprova), mas já implanta a própria prefeitura: as rotas
`/implantacao*` exigem só estar logado. Quem cadastra a prefeitura entra em `membros` como secretário, e o
assistente dessa conversa só mexe no município dela (`conta_email` no estado da sessão). Cadastro e login
precisam da `OS_SECURITY_KEY` (é ela que assina a sessão); sem ela, o painel fica aberto e sem login.

O secretário de saúde implanta a prefeitura **conversando** com o Assistente de Implantação. A tela é dividida:
chat à esquerda e, à direita, o quadro que se monta ao vivo — o mapa da cidade ganhando pinos, o prédio ganhando
andares, os robôs sentando nas mesas. No fim, a câmera sai do prédio e mostra a cidade inteira funcionando.
Referência visual: o estúdio de páginas "Forminho" (chat + canvas, montagem seção por seção).

### Etapas (estado em `onboardings.etapa`)

| # | Etapa | O que o assistente faz | Ferramentas | O que aparece no quadro |
|---|---|---|---|---|
| 1 | `municipio` | Pede o CEP da prefeitura (ou cidade + UF), mostra o que achou, confirma. Pede nome e e-mail do secretário | `buscar_municipio` (ViaCEP → IBGE → OpenStreetMap), `registrar_municipio` | Mapa centraliza na cidade |
| 2 | `unidades` | Importa as unidades do CNES e mostra o total por tipo ("14 UBS, 1 UPA, 2 CAPS. Confere?"). Corrige e completa à mão | `importar_unidades_cnes`, `cadastrar_unidade` | Pinos caem no mapa, por tipo e cor |
| 3 | `setores` | Propõe os setores padrão; o secretário tira, acrescenta, renomeia | `listar_tipos_setor`, `salvar_setores` | Andares sobem no prédio (3 salas por andar) |
| 4 | `atividades` | Setor por setor: mostra rotinas e pedidos sob demanda sugeridos; confirma, tira, cria novas | `sugerir_atividades`, `salvar_atividades`, `nova_atividade` | Itens aparecem em cada sala |
| 5 | `responsaveis` | Quem coordena e aprova em cada setor (nome + e-mail institucional) | `cadastrar_responsavel` | Placa com o nome na porta da sala |
| 6 | `agentes` | Põe um agente em cada setor; lista os setores que ainda precisam de agente da Fábrica | `montar_agentes` | Robôs sentam nas mesas |
| 7 | `revisao` → `concluido` | Resumo final; com o "pode concluir", ativa o município | `situacao_implantacao`, `concluir_implantacao` | Câmera sai do prédio: a cidade inteira |

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
- **Tela de onboarding: a fazer** (é o próximo passo de frontend — ver §9).

## 4. Agentes

Todos usam **Gemini** (`AGENTE_MODELO`, padrão `gemini-3.6-flash`) — agentes, onboarding, Fábrica e embeddings.

| id | Agente | Ferramentas | Arquivo |
|---|---|---|---|
| `onboarding` | Assistente de Implantação (padrão do servidor) | implantação (13 ferramentas) | `agente/perfis/onboarding.py` |
| `compras` | Agente de Compras e Licitações | consulta | `agente/perfis/compras.py` |
| `atencao_primaria` | Agente da Atenção Primária | consulta | `agente/perfis/atencao_primaria.py` |
| `regulacao` | Agente de Regulação | consulta | `agente/perfis/regulacao.py` |

- Agentes de setor seguem um molde único: `agente/perfis/setor.py` (`perfil_de_setor`). Novo setor no código =
  um arquivo de 20 linhas + registrar em `agente/perfis/__init__.py` + `agente/base_conhecimento_<id>.md` +
  incluir em `AGENTE_DO_SETOR` (`agente/ferramentas_gestao.py`).
- Os demais setores ganham agente pela **Fábrica de agentes** no painel (sem código), com o modelo
  `INSTRUCOES_MODELO` de `agente/fabrica.py`.
- Nas instruções, `{nome_contato}` é o nome de quem conversa; nos roteiros, `[NOME DO CONTATO]` é trocado pelo
  primeiro nome.
- Base de conhecimento de cada agente: Markdown editável pelo painel; seções fixas obrigatórias:
  `## Boas-vindas`, `## Transferência para a equipe`, `## Encerramento por inatividade`,
  `## Pedido fora do atendimento`.
- Documentos (PDF, Word, planilhas) vão no **Conhecimento** do painel e chegam ao agente como trechos
  vetorizados.
- Qualidade: `agente/qualidade.py` avalia as conversas concluídas com a régua de cinco critérios de
  `agente/regua_qualidade.json` (mudou a régua, troque a versão). Ainda não há lado humano para comparar.

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
gestao_api.py                 /painel/api/gestao/* (panorama, municípios, catálogo)
painel_api.py                 painel: chat, conversas, Central, visão geral, base, manutenção
fabrica_api.py                Fábrica de agentes e equipes
calibracao_api.py             Calibração (👍/👎 + curadoria)
qualidade_api.py              qualidade das conversas com a régua (agente/qualidade.py)
conhecimento_api.py           documentos vetorizados
banco_api.py                  Observabilidade (leitura do banco)
agente/gestao.py              cadastro da prefeitura (tabelas, leitura, gravação) + ViaCEP/IBGE/OSM/CNES
agente/ferramentas_gestao.py  ferramentas dos agentes (implantação e consulta)
agente/companyos.py           setores → Products; atividades de rotina → Routines
agente/perfis/                os agentes do código
agente/agente.py              monta cada Agent a partir do perfil (modelo, memória, guardrails)
supabase/gestorgov/           migrations (rodar à mão no SQL Editor)
painel/src/                   frontend
```

Reservados para o futuro agente do cidadão (hoje desligados, sem variáveis): `agente/unnichat.py`,
`agente/canal.py`, `agente/ficha.py` e `agente/alertas.py`.

### Banco

- Schema `gestorgov`, papel `gestorgov_app` (só enxerga o próprio schema). RLS ligado nas tabelas do cadastro,
  com política só para o papel do servidor. O schema **não** é exposto na API REST do Supabase.
- Migrations (`supabase/gestorgov/`, rodar em ordem): `..._inicial.sql` (schema, papel, pgvector, bucket
  `agentes`, Vault, cadastro), `..._atividades.sql` (catálogo e atividades) e `..._organograma.sql` (membros,
  catálogo de 38 cargos e 125 indicadores do documento da Secretaria de Saúde Virtual, cargos, indicadores com meta,
  medições, entregas, pendências, status e alertas). No SQLite local, os catálogos são carregados das migrations a cada início.
- Tabelas do cadastro (migrations): `municipios`, `secretarias`, `setores`, `unidades`, `servidores`,
  `agentes_setor`, `atividades_setor`, `onboardings`, `auditoria` (só inserção), `tipos_setor`, `tipos_unidade`,
  `modelos_atividade`, e as do organograma: `membros`, `modelos_cargo`, `modelos_indicador`, `cargos`,
  `indicadores_cargo`, `medicoes`, `entregas`, `pendencias`, `status_cargo`, `alertas_cargo`. Tudo separado por
  `municipio_id` (multi-prefeitura).
- Tabelas que o servidor cria ao subir: as do Agno (`agno_*`, CompanyOS) e as do painel (`fabrica_*`,
  `conhecimento_*`, `avaliacoes_humanas`, `qualidade_supervisor`, `painel_usuarios`, `painel_contas`...). Não crie essas à mão.
  `create_all` não altera tabela que já existe: coluna renomeada no código precisa de `alter table` à mão.
- Sem `DATABASE_URL`: SQLite local em `dados/`, com o cadastro e os catálogos carregados das migrations.

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

- Cantos quase retos (2–4 px; `rounded-full` só para pontos e avatares). Visual institucional.
- Claro e escuro obrigatórios. Tokens em `painel/src/styles.css`; logo em
  `painel/src/components/layout/logo.tsx` (SVG, o texto acompanha o tema). O símbolo da Central 3D e dos avatares
  está em `painel/public/espaco/gestorgov-branco.png` e `gestorgov-cor.png`.
- Acessibilidade: seguir o eMAG (contraste, teclado, leitor de tela). Amarelo sobre branco não passa como texto.
- **3D nunca é obrigatório**: toda informação das visões Cidade e Secretaria precisa existir no Painel
  (computadores de prefeitura são fracos).

## 7. Segurança, LGPD e regras dos agentes

- Dados de saúde são **sensíveis** (LGPD). Agentes trabalham com números agregados e códigos; **nunca** pedem nem
  repetem nome completo, CPF ou Cartão SUS de paciente. Memória dos agentes nunca guarda dados de pacientes.
- Decisão clínica (ex.: prioridade na regulação) é sempre do profissional: o agente aponta, a pessoa decide.
- Normas e leis: o agente só cita o que está na base de conhecimento ou nos documentos.
- Login do painel: Google; qualquer e-mail verificado entra como **pendente** até o dono aprovar. Defina sempre
  `PAINEL_DONO` (sem ele e sem `PAINEL_DOMINIOS`/`PAINEL_EMAILS`, ninguém vira dono automaticamente).
- Segredos só em variáveis de ambiente (Render) — nunca no repositório. Chaves da Fábrica ficam no Vault.

## 8. Deploy e operação

### Render

- `render.yaml` (Blueprint) + `Dockerfile` (etapa Node constrói o painel; etapa Python roda o servidor).
- O `render.yaml` está com `plan: starter`. O plano free dorme após 15 min sem acesso (acorda em ~1 min) e as
  rotinas não rodam enquanto dorme: serve só para demonstração. Cliente real: `starter` ou acima.
- Região Virginia (o Render não tem Brasil).
- Variáveis secretas: `GOOGLE_API_KEY`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `PAINEL_DONO`, `PAINEL_GOOGLE_CLIENT_ID`, `PAINEL_DOMINIOS` (opcional). `OS_SECURITY_KEY` é gerada pelo Render.

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

- Branch `main`; o Render publica a cada push. Trabalho em branch vai para o `main` por PR.
- Mensagens de commit em português, no imperativo e curtas ("Onboarding: tela com mapa e chat").
- Nunca commitar `.env`, `dados/`, `node_modules/`, `painel/dist/`, `Claude outputs/`, `*.zip` (estão no
  `.gitignore`).

## 9. Roadmap

### Fase 0 — Base (feito)

- [x] Cópia do NexaAgents sem WhatsApp, com a marca GestorGov
- [x] Limpeza dos restos da Nexa (integrações, régua de qualidade, vocabulário de aluno)
- [x] Banco: schema, papel, cadastro da prefeitura, catálogo de atividades, auditoria
- [x] Assistente de Implantação e 3 agentes de setor
- [x] CompanyOS (setores → Products, rotinas → Routines), atrás de `GESTORGOV_COMPANYOS`
- [x] Render (Docker + Blueprint) e Supabase

### Fase 1 — MVP demonstrável (agora)

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

Um agente de saúde por cidadão no WhatsApp (um Agent, uma sessão e memória por pessoa), reaproveitando a
integração Unnichat. Começa pelo administrativo: lembretes de consulta/vacina, situação na fila, medicamento
disponível, exame pronto, ouvidoria. Exige identidade validada (CPF/Cartão SUS/gov.br), consentimento LGPD e,
para qualquer orientação clínica, respaldo jurídico e médico; emergência → SAMU 192.

## 10. Fora de escopo agora

- WhatsApp e qualquer atendimento ao cidadão (Fase 4).
- Diagnóstico, triagem ou orientação clínica.
- Escrever em sistemas oficiais do SUS.
- Cobrança e contratos dentro do sistema.

## 11. Pontos em aberto / riscos conhecidos

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
