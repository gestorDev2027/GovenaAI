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
2. **Secretaria** — o prédio em 3D pelo organograma, com o CCO no centro: setores nas salas, agentes
   trabalhando nas mesas (a refazer; ver §10).
3. **Painel** — tabelas, aprovações, relatórios: onde o servidor trabalha no dia a dia.

Mais o **conversacional** presente em todas as visões: o chat com o agente do setor (ou com a recepção, numa
equipe). E a **Central de comando** (`/painel/comando`): o mapa da cidade em tela inteira, com janelas flutuantes
arrastáveis (unidades, setores, agentes, alertas), painéis laterais de detalhe, paleta de comandos (Ctrl+K) e
modo foco (F).

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
- Tela de implantação: chat e quadro em listas; o mapa e o prédio 3D entram nela (ver §10).

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
gestao_api.py                 /painel/api/gestao/* (panorama, municípios, catálogo)
painel_api.py                 painel: acesso, login, implantação, chat, conversas, base, limpeza
fabrica_api.py                Fábrica de agentes e equipes (skills, ferramentas HTTP, chaves, casos de teste)
prefeitura_api.py             a prefeitura de quem está logado: cargos, permissões, equipe e convites
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
  `conhecimento_*`, `guardrail_frases`, `painel_usuarios`, `painel_contas`...). Não crie essas à mão. Num banco que
  já rodou o NexaAgents podem sobrar `unnichat_*`, `avaliacoes_humanas`, `qualidade_supervisor` e `alertas_baixas`:
  não são mais usadas.
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

- Meio-termo entre o institucional e o moderno (referências enviadas em 07/11/2026): menu lateral azul-marinho
  com o item ativo em pílula azul, barra do topo com a prefeitura e o usuário, cartões brancos com cantos médios
  (6–16 px), indicadores com ícone em círculo, botões de destaque em pílula amarela. Sem degradês fortes.
- Telas de acesso (entrar, cadastrar, convite): sem cabeçalho; formulário à esquerda, que rola, e painel fixo da
  marca à direita.
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
- **Prefeitura** (agente/acessos.py, rotas em prefeitura_api.py): quem cadastra a prefeitura é o **dono** dela
  (`membros.papel = 'dono'`), entra sem aprovação da plataforma e pode tudo nela. Ele monta o organograma
  (cargos do catálogo ou criados à mão), define as **permissões de cada cargo** (`cargos.permissoes`: ver o painel,
  aprovar e devolver entregas, gerenciar os fluxos dos agentes, criar agentes, definir metas, registrar dados,
  gerenciar cargos, gerenciar a equipe, ver a auditoria) e convida a equipe por link (`convites`, 7 dias, a pessoa
  cria a senha). O membro pode o que o cargo dele pode; o dono não pode ser bloqueado; ninguém altera o próprio acesso.
- Toda rota da prefeitura usa o município de quem está logado: nunca um id vindo da tela.
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

### Demonstração (Itatiaia-RJ)

Com `GESTORGOV_DEMO=itatiaia` (já no `render.yaml`), o servidor monta ao subir a Secretaria de Saúde de Itatiaia
(agente/demo.py): as unidades do CNES, os 16 setores com as atividades, o organograma de 38 cargos, pessoas
fictícias (@itatiaia.exemplo.gov.br, sem login) como responsáveis, um agente de IA por setor (`itatiaia-<setor>`,
publicados, marcados com o município) e a implantação concluída. Com `GESTORGOV_COMPANYOS=sim`, as 20 atividades
de rotina viram os fluxos do Agno (Routines do CompanyOS). Cada passo só acrescenta o que falta: pode subir de novo.
O dono é `PAINEL_DONO`. Atenção ao custo: as rotinas chamam o Gemini nos horários delas (uma a cada hora).

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
- [ ] 4. Unidades: equipe, estoque, produção e o agente da unidade reportando à superintendência
- [ ] 5. Secretaria 3D pelo organograma, com o CCO no centro, montada durante a implantação

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
