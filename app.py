"""Servidor do GestorGov: AgentOS + painel (em /painel).

Uso (na pasta do projeto):
  .venv\\Scripts\\python app.py

- Painel: http://localhost:7778/painel
- AgentOS: em https://os.agno.com, Add OS → Local → http://localhost:7778
A porta pode ser alterada pela variável AGENTOS_PORTA no .env (em produção vale PORT).

Recursos do AgentOS ligados aqui: Tracing (tela Traces), Scheduler (rotinas de manutenção), CompanyOS
(GESTORGOV_COMPANYOS=sim: as atividades de rotina dos setores, ver agente/companyos.py) e o banco
compartilhado, que alimenta Sessions, Memory e Evaluation.
"""

import os
import secrets
import sys
from pathlib import Path

# Console do Windows (cp1252): o AgentOS imprime emojis (ex.: o cadeado da OS_SECURITY_KEY) e o print derrubaria
# o servidor. Com errors="replace", o caractere que o console não tem vira "?".
for _saida in (sys.stdout, sys.stderr):
    if hasattr(_saida, "reconfigure"):
        _saida.reconfigure(errors="replace")

from agno.os import AgentOS
from agno.os.config import AuthorizationConfig
from agno.scheduler import ScheduleManager
from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from agente import companyos, perfis
from agente.equipes import EQUIPES
from agente.agente import _modelo, criar_agentes
from banco_api import criar_rotas_banco
from calibracao_api import criar_rotas_calibracao
from conhecimento_api import criar_rotas_conhecimento
from fabrica_api import criar_rotas_fabrica
from gestao_api import criar_rotas_gestao
from painel_api import criar_rotas
from qualidade_api import criar_rotas_qualidade

PASTA_PAINEL = Path(__file__).parent / "painel" / "dist"
PORTA = int(os.getenv("PORT") or os.getenv("AGENTOS_PORTA") or "7778")

# Token que o Scheduler usa para chamar as rotas do próprio servidor. Gerado a cada início;
# as rotas do painel o aceitam além da OS_SECURITY_KEY (ver exigir_chave em painel_api.py).
TOKEN_INTERNO = os.getenv("AGENTOS_TOKEN_INTERNO") or secrets.token_urlsafe(32)
os.environ["AGENTOS_TOKEN_INTERNO"] = TOKEN_INTERNO

# Todos os agentes do ecossistema (agente/perfis/), no mesmo banco. O painel mostra o padrão.
agentes = criar_agentes()
agente = agentes[perfis.PADRAO]

# Sem a telemetria por requisição do FastAPI: ela gravava um trace a cada chamada (a rotina de
# inatividade, a cada minuto, era 98% dos traces) e herdava o `traceparent` de quem chama. Os traces
# que importam são os das respostas do agente, gravados pelo Agno (ver atendimento._trace_proprio).
base_app = FastAPI(
    title="GestorGov — Gestão Pública Inteligente",
    telemetry={"tracing": False, "operation_spans": False, "metrics": False, "logs": False},
)
base_app.include_router(criar_rotas(agente, agentes))
base_app.include_router(criar_rotas_gestao())
base_app.include_router(criar_rotas_calibracao(agentes))
base_app.include_router(criar_rotas_conhecimento(agentes))
base_app.include_router(criar_rotas_banco(agentes))
base_app.include_router(criar_rotas_qualidade(agentes))


def _trocar_no_agentos(novo) -> None:
    """A fábrica de agentes remontou um agente (ou criou um): o AgentOS passa a usar o novo, sem reiniciar."""
    lista = agent_os.agents
    for posicao, atual in enumerate(lista):
        if getattr(atual, "id", None) == novo.id:
            lista[posicao] = novo
            return
    lista.append(novo)


def _trocar_equipe_no_agentos(nova) -> None:
    if agent_os.teams is None:
        agent_os.teams = []
    lista = agent_os.teams
    for posicao, atual in enumerate(lista):
        if getattr(atual, "id", None) == nova.id:
            lista[posicao] = nova
            return
    lista.append(nova)


base_app.include_router(criar_rotas_fabrica(agentes, ao_mudar=_trocar_no_agentos, ao_mudar_equipe=_trocar_equipe_no_agentos))

# Cache do painel. O build pode gravar os arquivos com data de 1980; sem Cache-Control, o
# navegador calcula a validade pela idade do arquivo (anos) e continua mostrando um painel antigo
# depois do deploy. O index.html é conferido a cada acesso; os arquivos com hash no nome (assets/)
# mudam de nome a cada build e podem ficar guardados por um ano.
SEM_CACHE = {"Cache-Control": "no-cache"}


class ArquivosComHash(StaticFiles):
    async def get_response(self, path, scope):
        resposta = await super().get_response(path, scope)
        if resposta.status_code == 200:
            resposta.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resposta


@base_app.middleware("http")
async def raiz_abre_o_painel(pedido, seguir):
    """Quem abre o endereço do servidor no navegador vai para o painel (que pede o login). O "/" do
    AgentOS (JSON com nome e links) continua para quem não pede HTML, como o os.agno.com."""
    if pedido.url.path == "/" and pedido.method == "GET" and "text/html" in pedido.headers.get("accept", ""):
        return RedirectResponse("/painel", status_code=307)
    return await seguir(pedido)


if PASTA_PAINEL.exists():
    base_app.mount("/painel/assets", ArquivosComHash(directory=PASTA_PAINEL / "assets"), name="painel-assets")

    # Sem redirecionar /painel → /painel/: o AgentOS tira a barra final e o redirecionamento
    # virava laço. Os arquivos do painel usam caminho absoluto (/painel/assets/...).
    @base_app.get("/painel", include_in_schema=False)
    def painel_raiz():
        return FileResponse(PASTA_PAINEL / "index.html", headers=SEM_CACHE)

    @base_app.get("/painel/{caminho:path}", include_in_schema=False)
    def painel(caminho: str):
        # Arquivo público (favicon etc.) ou rota da aplicação (devolve o index.html).
        arquivo = (PASTA_PAINEL / caminho).resolve()
        if caminho and arquivo.is_file() and PASTA_PAINEL.resolve() in arquivo.parents:
            return FileResponse(arquivo, headers=SEM_CACHE)
        return FileResponse(PASTA_PAINEL / "index.html", headers=SEM_CACHE)

# Rotinas de manutenção (idempotentes a cada reinício). As rotinas dos SETORES são do CompanyOS.
ScheduleManager(agente.db).create(
    name="encerrar-conversas-inativas",
    description="Encerra as conversas paradas há mais que o prazo de cada agente (padrão: 8 h).",
    cron="*/10 * * * *",
    endpoint="/painel/api/manutencao/inatividade",
    method="POST",
    timeout_seconds=120,
    if_exists="update",
)
# Avaliações automáticas todo dia (resultados na tela Evaluation). AVALIACOES_DIARIAS=nao desliga.
ScheduleManager(agente.db).create(
    name="avaliacoes-diarias",
    description="Roda as avaliações dos agentes (casos de teste da fábrica + aprovados na Calibração) num processo separado.",
    cron=os.getenv("AVALIACOES_CRON", "0 6 * * *"),
    timezone="America/Sao_Paulo",
    endpoint="/painel/api/manutencao/avaliacoes",
    method="POST",
    timeout_seconds=60,
    if_exists="update",
)
# Limpeza diária dos traces e execuções antigas de rotinas.
ScheduleManager(agente.db).create(
    name="limpeza",
    description="Apaga traces e execuções de rotinas antigas.",
    cron="0 3 * * *",
    timezone="America/Sao_Paulo",
    endpoint="/painel/api/manutencao/limpeza",
    method="POST",
    timeout_seconds=300,
    if_exists="update",
)
agent_os = AgentOS(
    id="gestorgov",
    name="GestorGov",
    description="Ecossistema de agentes de IA para a gestão das Secretarias Municipais de Saúde.",
    agents=list(agentes.values()),
    teams=list(EQUIPES.values()),  # equipes da fábrica (agente/equipes.py)
    base_app=base_app,
    db=agente.db,
    # Com OS_SECURITY_KEY definida, o AgentOS exige a chave em TODAS as rotas, inclusive nas
    # páginas do painel, que nem chegavam a abrir a tela da chave. O /painel sai da proteção do
    # Agno; os dados (/painel/api/*) continuam exigindo a chave em exigir_chave (painel_api.py).
    # (authorization_config está marcado como obsoleto, mas a alternativa nova liga RBAC/JWT.)
    authorization_config=AuthorizationConfig(excluded_route_paths=["/painel", "/painel/*"]),
    tracing=True,
    scheduler=True,
    scheduler_poll_interval=30,
    scheduler_base_url=f"http://127.0.0.1:{PORTA}",
    internal_service_token=TOKEN_INTERNO,
    # CompanyOS (GESTORGOV_COMPANYOS=sim): setores como Products e atividades de rotina como Routines.
    **companyos.configurar(_modelo(), agente.db),
)

app = agent_os.get_app()

if __name__ == "__main__":
    agent_os.serve(app="app:app", port=PORTA)
