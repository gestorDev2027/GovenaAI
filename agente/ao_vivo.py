"""Acontecimentos dos atendimentos em tempo real, para a Central ao vivo do painel.

Cada etapa de uma resposta vira um evento no momento em que acontece: mensagem do contato, agente
pensando, ferramenta (consultar o cadastro, transferir...), resposta enviada, transferência,
encerramento, bloqueio do guardrail e falha. O painel recebe os eventos por /painel/api/central/eventos
(uma linha JSON por evento) e os últimos ficam em memória para o feed (/painel/api/central/feed).

Os eventos ficam no processo do servidor: um reinício esvazia o feed, e com mais de uma cópia do
servidor cada uma veria só os próprios. Hoje o deploy é de um processo só.
"""

import asyncio
import itertools
import threading
from collections import deque
from datetime import datetime, timezone

from agno.utils.log import log_warning

MAX_RECENTES = 300
MAX_FILA = 500  # por conexão do painel: quem não lê a tempo perde eventos, não trava o atendimento
TRECHO = 140

_recentes: deque = deque(maxlen=MAX_RECENTES)
_assinantes: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = set()
_trava = threading.Lock()
_sequencia = itertools.count(1)


def _origem(session_id: str) -> str:
    for prefixo, rotulo in (("unnichat-", "whatsapp"), ("painel-", "painel"), ("aval-", "avaliacao")):
        if session_id.startswith(prefixo):
            return rotulo
    return "outro"


def _trecho(texto: str | None) -> str:
    from agente.guardrails import mascarar_texto  # CPF e cartão nunca vão ao painel

    texto = " ".join(mascarar_texto(texto or "").split())
    return texto if len(texto) <= TRECHO else texto[: TRECHO - 1] + "…"


def publicar(tipo: str, agente: str, session_id: str, contato: str = "", **dados) -> None:
    """Registra e entrega um evento a todos os painéis conectados. Pode ser chamado de qualquer thread
    e nunca derruba o atendimento."""
    try:
        if session_id.startswith("aval-"):
            return  # as avaliações automáticas não aparecem na Central
        if "texto" in dados:
            dados["texto"] = _trecho(dados["texto"])
        evento = {
            "id": next(_sequencia),
            "tipo": tipo,
            "agente": agente,
            "session_id": session_id,
            "origem": _origem(session_id),
            "contato": contato or "",
            "quando": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            **dados,
        }
        with _trava:
            _recentes.append(evento)
            destinos = list(_assinantes)
        for laco, fila in destinos:
            laco.call_soon_threadsafe(_entregar, fila, evento)
    except Exception as erro:
        log_warning(f"Central ao vivo: evento {tipo} não publicado: {type(erro).__name__}: {erro}")


def _entregar(fila: asyncio.Queue, evento: dict) -> None:
    if not fila.full():
        fila.put_nowait(evento)


def recentes(limite: int = 50, depois_de: int = 0, agente: str | None = None) -> list[dict]:
    """Os últimos eventos (o mais novo por último), para o feed abrir já preenchido."""
    with _trava:
        lista = [e for e in _recentes if e["id"] > depois_de and (not agente or e["agente"] == agente)]
    return lista[-limite:]


def inscrever() -> tuple[asyncio.AbstractEventLoop, asyncio.Queue]:
    """Uma fila que passa a receber os eventos a partir de agora. Chamar dentro do laço do servidor e
    devolver com cancelar() quando o painel desconectar."""
    chave = (asyncio.get_running_loop(), asyncio.Queue(maxsize=MAX_FILA))
    with _trava:
        _assinantes.add(chave)
    return chave


def cancelar(chave: tuple[asyncio.AbstractEventLoop, asyncio.Queue]) -> None:
    with _trava:
        _assinantes.discard(chave)


def avisar_ferramenta(agent, run_context, function_name: str, function_call, arguments: dict):
    """Gancho de ferramenta do Agno (tool_hooks): avisa a Central quando o agente usa uma ferramenta."""
    estado = getattr(run_context, "session_state", None) or {}
    session_id = getattr(run_context, "session_id", "") or ""
    publicar("ferramenta", getattr(agent, "id", ""), session_id, estado.get("nome_aluno", ""), ferramenta=function_name)
    return function_call(**arguments)
