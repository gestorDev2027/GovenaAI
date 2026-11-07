# GestorGov — Gestão Pública Inteligente

Ecossistema de agentes de IA para a gestão das **Secretarias Municipais de Saúde**. Cada setor da secretaria
(compras, atenção primária, regulação, farmácia...) ganha um agente que faz as rotinas do setor e prepara
documentos sob demanda. Tudo o que o agente propõe ou entrega passa pela aprovação do responsável do setor.

Construído sobre a base do NexaAgents (Agno + Gemini + React), sem o canal de WhatsApp: quem conversa com os
agentes são os servidores, pelo painel.

## Estrutura

```
Prefeitura → Secretaria de Saúde → Setores → Atividades → Agente do setor → Servidor que aprova
```

- **Atividade de rotina:** o agente procura o trabalho sozinho, num horário (CompanyOS do Agno).
  Ex.: Regulação, a cada hora, aponta quem espera há mais de 90 dias.
- **Atividade sob demanda:** um servidor pede pelo chat e o agente produz. Ex.: Compras elabora o termo de referência.

### Agentes (`agente/perfis/`)

| id | Agente | O que faz |
|---|---|---|
| `onboarding` | Assistente de Implantação (padrão) | Conversa com o secretário e monta a secretaria: município, unidades (CNES), setores, atividades, responsáveis e agentes |
| `compras` | Agente de Compras e Licitações | Pedidos de compra, termos de referência, editais; contratos vencendo e saldo das atas |
| `atencao_primaria` | Agente da Atenção Primária | Indicadores das equipes de Saúde da Família, visitas dos ACS, gestantes |
| `regulacao` | Agente de Regulação | Fila de espera acima do prazo, vagas sem uso |

Os agentes de setor seguem o mesmo molde (`agente/perfis/setor.py`). Os demais setores ganham agente pela
**Fábrica de agentes** no painel.

### Código

- `agente/gestao.py`: o cadastro da prefeitura (município, secretaria, setores, unidades, servidores, atividades,
  auditoria) e as fontes públicas do onboarding (ViaCEP, IBGE, OpenStreetMap, CNES).
- `agente/ferramentas_gestao.py`: as ferramentas dos agentes sobre o cadastro (implantação e consulta).
- `agente/companyos.py`: setores como Products e atividades de rotina como Routines do CompanyOS.
- `gestao_api.py`: rotas do cadastro para o painel (`/painel/api/gestao/...`): o panorama que desenha a cidade e o prédio.
- `app.py`: AgentOS + painel. `painel/`: React + TanStack Router/Query + Tailwind 4.
- Herdados do NexaAgents: Fábrica de agentes, equipes, Conhecimento (documentos vetorizados), Calibração,
  Central ao vivo (prédio 3D), Observabilidade, usuários e permissões.
- Reservados para o futuro agente do cidadão (WhatsApp), hoje sem uso: `agente/unnichat.py`, `agente/canal.py`,
  `agente/ficha.py` e `agente/alertas.py`. Sem as variáveis da Unnichat, ficam desligados.
- Qualidade: `agente/qualidade.py` avalia as conversas concluídas com a régua de `agente/regua_qualidade.json`.

## Banco (Supabase)

Rode no SQL Editor do projeto, nesta ordem:

1. `supabase/gestorgov/20261106_gestorgov_inicial.sql`: schema `gestorgov`, papel `gestorgov_app`, pgvector,
   bucket privado `agentes`, cofre das chaves (Vault) e as tabelas do cadastro da prefeitura.
2. `supabase/gestorgov/20261106_gestorgov_atividades.sql`: o catálogo de atividades por setor e as atividades de cada município.
3. `supabase/gestorgov/20261107_gestorgov_organograma.sql`: membros de cada prefeitura, o catálogo de cargos e indicadores
   (organograma da Secretaria de Saúde) e o acompanhamento: cargos, metas, medições, entregas, pendências, status e alertas.
4. À mão: `alter role gestorgov_app with login password '<senha forte>';`

As demais tabelas (Agno, CompanyOS, Fábrica, Conhecimento, Calibração, usuários) o servidor cria ao subir, no schema `gestorgov`.

## Deploy (Render)

1. Suba este projeto para um repositório no GitHub.
2. No Render: **New → Blueprint** e escolha o repositório. O `render.yaml` cria o serviço (Docker, plano Starter, Virginia).
3. Preencha as variáveis marcadas como segredo: `GOOGLE_API_KEY`, `DATABASE_URL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `PAINEL_GOOGLE_CLIENT_ID`, `PAINEL_DONO` (o seu e-mail) e, se quiser, `PAINEL_DOMINIOS`.
4. Cada push no GitHub publica sozinho. O `Dockerfile` constrói o painel (Node) e o servidor (Python).

Cuidados:
- `DATABASE_URL` é a do **Session pooler** (porta 5432) com o usuário `gestorgov_app.<id-do-projeto>`: o Render não alcança a conexão direta do Supabase (só IPv6).
- O plano gratuito do Render dorme sem acesso e para as rotinas: use no mínimo o Starter.
- O Supabase em produção deve estar no plano Pro (backup automático, sem pausa).
- Login do Google: crie o Client ID "Aplicativo da Web" com a origem do endereço do Render.

## Rodar localmente (Windows)

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env   # preencha GOOGLE_API_KEY
.venv\Scripts\python app.py                      # painel: http://localhost:7778/painel
.venv\Scripts\python chat.py                     # assistente de implantação no terminal
.venv\Scripts\python chat.py regulacao           # outro agente
```

Sem `DATABASE_URL`, usa um SQLite local em `dados/` (as tabelas do cadastro são criadas sozinhas).
Painel em desenvolvimento: `cd painel && npm install && npm run dev` (http://localhost:5178/painel).

## Próximos passos

- Tela de onboarding: chat à esquerda e, à direita, o mapa da cidade (MapLibre) e o prédio 3D se montando a
  partir de `/painel/api/gestao/panorama`.
- Visão "Cidade" com as unidades e os alertas; visão "Secretaria" (a Central ao vivo, já em 3D).
- Fila de aprovação das Tasks do CompanyOS no painel, para o responsável de cada setor.
- Agente do cidadão no WhatsApp (lembretes, fila, medicamentos), reaproveitando a integração Unnichat.
