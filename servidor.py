"""Ponto de entrada do servidor em produção: abre a porta NA HORA e carrega o sistema (app.py) em segundo plano.

Por quê: o app.py monta tudo antes de existir (agentes, equipes, AgentOS, Scheduler). Numa máquina fraca (o plano
Free do Render tem 0,1 de CPU) isso leva minutos, e o Render, que espera a porta abrir para considerar o serviço no
ar, desiste ao acordar o serviço que dormiu. Aqui a porta abre em segundos:

- enquanto o sistema carrega, as páginas mostram "O GestorGov está iniciando" (recarrega sozinha) e a API responde
  503 com o mesmo aviso;
- quando o app.py termina, o ciclo de vida dele (lifespan: o Scheduler, as rotinas) é ligado e toda requisição passa
  a ir para ele, sem reiniciar;
- se o carregamento falhar, a página e GET /saude dizem o motivo (sem segredos: só o tipo e a mensagem do erro).

Uso: `uvicorn servidor:app` (Dockerfile). Localmente, `python app.py` continua igual.
"""

import asyncio
import importlib
import logging
import os
import threading
import time
import traceback

ALVO = os.getenv("GESTORGOV_APP", "app:app")
log = logging.getLogger("gestorgov.servidor")

_estado: dict = {"inicio": time.time(), "app": None, "ativo": None, "erro": None, "carregando": False, "lifespan": None}


def _carregar() -> None:
    try:
        modulo, nome = ALVO.split(":")
        _estado["app"] = getattr(importlib.import_module(modulo), nome)
        log.warning("GestorGov carregado em %.1f s", time.time() - _estado["inicio"])
    except BaseException as erro:  # noqa: BLE001 — mostrar o motivo em vez de derrubar a porta
        _estado["erro"] = f"{type(erro).__name__}: {str(erro).splitlines()[0][:300] if str(erro) else ''}"
        log.error("O GestorGov não carregou:\n%s", traceback.format_exc())


async def _ativar(estado_uvicorn: dict) -> None:
    """Espera o app.py carregar e liga o ciclo de vida dele (lifespan) antes de passar as requisições."""
    while _estado["app"] is None and _estado["erro"] is None:
        await asyncio.sleep(0.5)
    if _estado["erro"]:
        return
    real = _estado["app"]
    entrada: asyncio.Queue = asyncio.Queue()
    saida: asyncio.Queue = asyncio.Queue()

    async def receber():
        return await entrada.get()

    async def enviar(mensagem):
        await saida.put(mensagem)

    # O mesmo "state" do uvicorn: o que o lifespan do app guardar ali chega às requisições.
    tarefa = asyncio.get_running_loop().create_task(
        real({"type": "lifespan", "asgi": {"version": "3.0", "spec_version": "2.0"}, "state": estado_uvicorn}, receber, enviar))
    await entrada.put({"type": "lifespan.startup"})
    resposta = await saida.get()
    if resposta.get("type") == "lifespan.startup.failed":
        _estado["erro"] = f"Falha ao ligar o sistema: {resposta.get('message', '')[:300]}"
        log.error(_estado["erro"])
        return
    _estado["lifespan"] = (tarefa, entrada, saida)
    _estado["ativo"] = real
    log.warning("GestorGov no ar em %.1f s", time.time() - _estado["inicio"])


async def _desligar() -> None:
    if not _estado["lifespan"]:
        return
    tarefa, entrada, saida = _estado["lifespan"]
    await entrada.put({"type": "lifespan.shutdown"})
    try:
        await asyncio.wait_for(saida.get(), timeout=20)
    except asyncio.TimeoutError:
        tarefa.cancel()


def _situacao() -> dict:
    segundos = round(time.time() - _estado["inicio"])
    if _estado["ativo"]:
        return {"situacao": "pronto", "segundos": segundos}
    if _estado["erro"]:
        return {"situacao": "erro", "segundos": segundos, "erro": _estado["erro"]}
    return {"situacao": "carregando", "segundos": segundos}


PAGINA = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5"><title>GestorGov · iniciando</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#0D1B38;color:#fff;font-family:system-ui,sans-serif}
main{text-align:center;padding:24px;max-width:420px}b{color:#52A2FF}p{color:#ffffffb3;line-height:1.5}
.ponto{display:inline-block;width:10px;height:10px;border-radius:50%;background:#F4B800;margin-right:8px;animation:p 1s infinite alternate}
@keyframes p{from{opacity:.3}to{opacity:1}}</style></head><body><main>
<h1>Gestor<b>Gov</b></h1><p><span class="ponto"></span>{mensagem}</p></main></body></html>"""


async def _responder(send, status: int, corpo: bytes, tipo: str) -> None:
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", tipo.encode()), (b"cache-control", b"no-store"), (b"retry-after", b"5")]})
    await send({"type": "http.response.body", "body": corpo})


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            mensagem = await receive()
            if mensagem["type"] == "lifespan.startup":
                if not _estado["carregando"]:
                    _estado["carregando"] = True
                    threading.Thread(target=_carregar, daemon=True, name="carregar-gestorgov").start()
                    asyncio.get_running_loop().create_task(_ativar(scope.setdefault("state", {})))
                await send({"type": "lifespan.startup.complete"})
            elif mensagem["type"] == "lifespan.shutdown":
                await _desligar()
                await send({"type": "lifespan.shutdown.complete"})
                return

    if scope["type"] == "http" and scope.get("path") in ("/saude", "/painel/api/saude"):
        import json

        situacao = _situacao()
        # 200 só com o sistema pronto: no deploy, o Render (healthCheckPath) mantém a versão antiga no ar até lá.
        status = 200 if situacao.get("situacao") == "pronto" else 503
        return await _responder(send, status, json.dumps(situacao, ensure_ascii=False).encode(), "application/json")

    if _estado["ativo"] is not None:
        return await _estado["ativo"](scope, receive, send)

    if scope["type"] != "http":  # websocket enquanto carrega: recusa (o painel tenta de novo)
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1013})
        return

    import json

    situacao = _situacao()
    caminho = scope.get("path", "")
    if situacao["situacao"] == "erro":
        texto, status = "O GestorGov não conseguiu iniciar. A equipe técnica já pode ver o motivo em /saude.", 503
    else:
        texto, status = f"O GestorGov está iniciando ({situacao['segundos']} s). A página abre sozinha em instantes.", 503
    if caminho.startswith("/painel/api/") or "application/json" in dict(scope.get("headers") or []).get(b"accept", b"").decode():
        corpo = json.dumps({"detail": texto, **situacao}, ensure_ascii=False).encode()
        return await _responder(send, status, corpo, "application/json")
    if scope.get("method") == "HEAD":
        return await _responder(send, 200, b"", "text/html; charset=utf-8")
    return await _responder(send, status, PAGINA.replace("{mensagem}", texto).encode(), "text/html; charset=utf-8")
