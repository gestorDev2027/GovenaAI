"""Ficha do aluno para a tela Conversas: o que o Unnichat e o cadastro sabem do contato da conversa.

Só leitura. Cada fonte falha sozinha: a tela mostra o erro daquela parte e o resto. A ficha fica em
memória por alguns minutos, porque a busca de negócios do Unnichat aceita 1 chamada a cada 2 s.
"""

import threading
import time
from datetime import datetime

from agno.utils.log import log_warning

from agente import cadastro, unnichat

VALIDADE_S = 120
MAX_MENSAGENS = 80

_cache: dict[tuple, tuple[float, dict]] = {}
_trava = threading.Lock()
# Nomes de funis e colunas do Unnichat (id -> nome): o negócio do contato traz só os ids, e a busca do
# funil, que traz os nomes, é limitada. Os nomes quase não mudam; um reinício do servidor os renova.
_nomes: dict[str, str] = {}


def _texto(mensagem: dict) -> str:
    """O texto da mensagem; num template, o corpo dele."""
    if mensagem.get("message"):
        return str(mensagem["message"])
    for parte in mensagem.get("templateComponents") or []:
        if isinstance(parte, dict) and parte.get("type") == "BODY" and parte.get("text"):
            return str(parte["text"])
    return ""


def _autor(mensagem: dict) -> str:
    """Quem escreveu: aluno, agente (pela API), automação, equipe (pessoa no Live Chat), nota ou sistema."""
    tipo = mensagem.get("type") or "message"
    if tipo == "note":
        return "nota"
    if mensagem.get("senderBy") == "platform" or tipo == "info":
        return "sistema"
    if mensagem.get("senderBy") == "contact":
        return "aluno"
    origem = mensagem.get("origin")
    if origem == "unniApi":
        return "agente"
    if origem:
        return "automacao"
    return "equipe"


def _com_retentativa(funcao, *args):
    """A busca do funil é limitada a 1 chamada a cada 2 s: no limite, espera e tenta mais uma vez."""
    try:
        return funcao(*args)
    except RuntimeError as erro:
        if "HTTP 429" not in str(erro):
            raise
        time.sleep(2.2)
        return funcao(*args)


def _buscar_no_funil(funil: str, telefone: str) -> list[dict]:
    corpo = {"search": telefone}
    return unnichat._api("POST", f"/crm/pipelines/{funil}/deals/search?perPage=20", corpo).get("data") or []


def _negocios(contato_id: str, telefone: str) -> list[dict]:
    todos = [n for n in unnichat._api("GET", f"/contact/{contato_id}/deals?perPage=100").get("data") or [] if isinstance(n, dict)]
    faltam = {n.get("pipelineId") for n in todos
              if n.get("pipelineId") and (n["pipelineId"] not in _nomes or (n.get("columnId") and n["columnId"] not in _nomes))}
    for funil in faltam:
        try:
            for achado in _com_retentativa(_buscar_no_funil, funil, telefone):
                if achado.get("pipelineId") and achado.get("pipelineName"):
                    _nomes[achado["pipelineId"]] = achado["pipelineName"]
                if achado.get("columnId") and achado.get("columnName"):
                    _nomes[achado["columnId"]] = achado["columnName"]
        except Exception as erro:  # sem os nomes, a ficha mostra os ids
            log_warning(f"Ficha do aluno: nomes do funil {funil} indisponíveis: {erro}")
    return sorted(
        (
            {
                "id": n.get("id"),
                "funil": _nomes.get(n.get("pipelineId") or "", n.get("pipelineId")),
                "coluna": _nomes.get(n.get("columnId") or "", n.get("columnId")) if n.get("columnId") else None,
                "status": n.get("status"),
                "criado_em": n.get("createdAt"),
                "produtos": [p.get("name") for p in n.get("products") or [] if isinstance(p, dict) and p.get("name")],
            }
            for n in todos
        ),
        key=lambda n: str(n["criado_em"] or ""),
        reverse=True,
    )


def _unnichat(contato_id: str) -> dict:
    contato = unnichat._api("GET", f"/contact/{contato_id}").get("data") or {}
    telefone = contato.get("phone") or ""
    mensagens = [m for m in unnichat._api("GET", f"/contact/{contato_id}/messages?limit={MAX_MENSAGENS}").get("data") or []
                 if isinstance(m, dict)]
    historico = [
        {"autor": _autor(m), "tipo": m.get("type") or "message", "texto": _texto(m), "quando": m.get("date")}
        # A API devolve as mais recentes, da mais antiga para a mais nova; a ordenação só garante.
        for m in sorted(mensagens, key=lambda m: str(m.get("date") or ""))
    ]
    try:
        atendente = unnichat.atendente_do_contato(contato_id)
    except Exception as erro:
        log_warning(f"Ficha do aluno: atendente de {contato_id} indisponível: {erro}")
        atendente = None
    return {
        "contato_id": contato_id,
        "nome": contato.get("name"),
        "email": contato.get("email"),
        "telefone": telefone,
        "criado_em": contato.get("createdAt"),
        "campos": contato.get("fields") or {},
        "tags": sorted(str(t.get("name")) for t in contato.get("tags") or [] if isinstance(t, dict) and t.get("name")),
        "atendente": {"id": atendente.get("id"), "nome": atendente.get("name"), "email": atendente.get("email")} if atendente else None,
        "negocios": _negocios(contato_id, telefone) if telefone else [],
        "mensagens": historico,
    }


def montar(contato_id: str | None, telefone: str | None, atualizar: bool = False) -> dict:
    """A ficha da conversa: {"unnichat": ..., "cadastro": ...}. Cada parte vem None quando a fonte não se
    aplica (conversa do painel não tem contato no Unnichat) ou {"erro": "..."} quando a consulta falhou."""
    chave = (contato_id or "", telefone or "")
    agora = time.time()
    with _trava:
        guardada = _cache.get(chave)
    if guardada and not atualizar and agora - guardada[0] < VALIDADE_S:
        return guardada[1]

    ficha: dict = {"unnichat": None, "cadastro": None, "consultado_em": datetime.now().astimezone().isoformat(timespec="seconds")}
    if contato_id and unnichat.disponivel():
        try:
            ficha["unnichat"] = _unnichat(contato_id)
        except Exception as erro:
            log_warning(f"Ficha do aluno: Unnichat de {contato_id} indisponível: {erro}")
            ficha["unnichat"] = {"erro": "Não foi possível consultar o Unnichat agora."}
    telefone = telefone or ((ficha["unnichat"] or {}).get("telefone"))
    if telefone and cadastro.disponivel():
        try:
            ficha["cadastro"] = cadastro.consultar(telefone=telefone)
        except Exception as erro:
            log_warning(f"Ficha do aluno: cadastro de {telefone[-4:]} indisponível: {erro}")
            ficha["cadastro"] = {"erro": "Não foi possível consultar o cadastro agora."}
    with _trava:
        _cache[chave] = (agora, ficha)
        for velha in [c for c, (quando, _) in _cache.items() if agora - quando > VALIDADE_S]:
            _cache.pop(velha, None)
    return ficha
