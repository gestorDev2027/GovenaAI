"""Cliente da API da Unnichat (https://unnichat.com.br/api/api-docs): o que o agente faz no canal.

Envia as respostas ao cidadão, deixa notas internas para a equipe (o cidadão não vê), marca o
contato com tags, que disparam as automações da Unnichat (mover no pipeline), e atribui o contato
ao usuário do agente e, na transferência, a um atendente da equipe (ver "Atendentes" abaixo).
"""

import os
from datetime import datetime
from functools import lru_cache

import httpx
from agno.utils.log import log_warning

# Tags que o agente coloca no contato. A automação de passagem para o atendente usa a primeira.
TAG_TRANSFERIU = "agente-transferiu"
TAG_ENCERROU = "agente-encerrou"
PREFIXO_TAG_CATEGORIA = "agente-cat-"


def _env(nome: str) -> str:
    return os.getenv(nome, "").strip()


def disponivel() -> bool:
    return bool(_env("UNNICHAT_API_KEY"))


def _api(metodo: str, caminho: str, corpo: dict | None = None) -> dict:
    resposta = httpx.request(
        metodo,
        f"{(_env('UNNICHAT_API_URL') or 'https://unnichat.com.br/api').rstrip('/')}{caminho}",
        json=corpo,
        headers={"Authorization": f"Bearer {_env('UNNICHAT_API_KEY')}"},
        timeout=20,
    )
    if resposta.status_code >= 400:
        # 400 no envio costuma ser janela de 24 h fechada: só um template aprovado pode abrir a conversa.
        raise RuntimeError(f"Unnichat {metodo} {caminho}: HTTP {resposta.status_code} {resposta.text[:300]}")
    return resposta.json() if resposta.content else {}


def enviar_texto(telefone: str, texto: str) -> dict:
    return _api("POST", "/meta/messages", {"phone": telefone, "messageText": texto})


def enviar_boas_vindas(telefone: str, texto: str, template: str | None = None) -> dict:
    """Texto livre só passa com a janela de 24 h aberta (o cidadão escreveu há pouco). Fechada, vai o
    template aprovado (`template`; cada agente tem o seu, ver unnichat_api._template_boas_vindas); com
    UNNICHAT_TEMPLATE_USA_NOME=1, o primeiro parâmetro do corpo ({{1}}) recebe o nome do contato."""
    try:
        return enviar_texto(telefone, texto)
    except RuntimeError as erro:
        if not template or "window" not in str(erro).lower():
            raise
    corpo: dict = {"phone": telefone, "templateId": template}
    if _env("UNNICHAT_TEMPLATE_USA_NOME") in ("1", "sim", "true"):
        corpo["bodyParameters"] = [{"type": "contactName", "text": "cidadão(ã)"}]
    return _api("POST", "/meta/templates", corpo)


# Anexos que o agente lê (os mesmos do chat de teste do painel). Outros tipos viram só um aviso.
TIPOS_ANEXO = ("image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf",
               "audio/ogg", "audio/opus", "audio/mpeg", "audio/mp4", "audio/m4a", "audio/wav", "audio/webm", "audio/aac")
MAX_BYTES_ANEXO = 10 * 1024 * 1024


def baixar_anexo(mensagem_id: str) -> tuple[str, str, bytes] | None:
    """O arquivo de uma mensagem de imagem, áudio ou documento: (nome, tipo MIME, conteúdo).

    A Unnichat não manda o arquivo no aviso da mensagem; GET /meta/messages/{id} devolve, no campo do
    próprio tipo (image, audio, document), o link e o tipo MIME. None se não der para usar o arquivo.
    """
    dados = _api("GET", f"/meta/messages/{mensagem_id}").get("data") or {}
    midia = dados.get(dados.get("type") or "") or {}
    url, tipo = midia.get("url"), (midia.get("contentType") or "").split(";")[0].strip().lower()
    if not url or tipo not in TIPOS_ANEXO:
        return None
    resposta = httpx.get(url, timeout=30, follow_redirects=True)
    resposta.raise_for_status()
    if len(resposta.content) > MAX_BYTES_ANEXO:
        return None
    nome = midia.get("name") or midia.get("filename") or f"{dados.get('type')}{midia.get('extension') or ''}"
    return nome, tipo, resposta.content


def adicionar_nota(contato_id: str, texto: str) -> dict:
    return _api("POST", f"/contact/{contato_id}/notes", {"message": texto[:4000]})


@lru_cache(maxsize=64)
def _id_da_tag(nome: str) -> str:
    """Id da tag de contato pelo nome; cria a tag se ainda não existir."""
    achadas = (_api("POST", "/tags/search", {"type": "contact", "name": nome}).get("data") or [])
    if isinstance(achadas, dict):
        achadas = [achadas]
    for tag in achadas:
        if (tag.get("name") or "").strip().lower() == nome.lower():
            return tag["id"]
    criada = _api("POST", "/tags", {"name": nome, "type": "contact"}).get("data") or {}
    if isinstance(criada, list):
        criada = criada[0] if criada else {}
    if not criada.get("id"):
        raise RuntimeError(f"Unnichat não devolveu o id da tag '{nome}'.")
    return criada["id"]


def adicionar_tag(contato_id: str, nome: str) -> dict:
    return _api("POST", f"/contact/{contato_id}/tags", {"tag_id": _id_da_tag(nome)})


def remover_tag(contato_id: str, nome: str) -> bool:
    """Tira a tag do contato, pelo id que ela tem nele (sem diferença de maiúsculas; não cria tag nenhuma).
    False quando o contato não tinha a tag."""
    dados = _api("GET", f"/contact/{contato_id}").get("data") or {}
    for tag in dados.get("tags") or []:
        if isinstance(tag, dict) and tag.get("id") and str(tag.get("name") or "").strip().lower() == nome.lower():
            _api("DELETE", f"/contact/{contato_id}/tags/{tag['id']}")
            return True
    return False


def _negocios_abertos(contato_id: str) -> list[dict]:
    abertos = _api("GET", f"/contact/{contato_id}/deals?status=open&perPage=100").get("data") or []
    return [negocio for negocio in abertos if isinstance(negocio, dict)]


def tem_negocio_no_pipeline(contato_id: str, pipeline_id: str) -> bool:
    """O contato tem negócio aberto (em qualquer etapa) nesse pipeline."""
    return any(n.get("pipelineId") == pipeline_id for n in _negocios_abertos(contato_id))


def esta_na_etapa(contato_id: str, pipeline_id: str, etapa_id: str) -> bool:
    """O contato tem negócio aberto nessa etapa do pipeline."""
    return any(n.get("pipelineId") == pipeline_id and n.get("columnId") == etapa_id for n in _negocios_abertos(contato_id))


def colocar_na_etapa(contato_id: str, pipeline_id: str, etapa_id: str) -> bool:
    """Cria o negócio do contato na etapa do pipeline, se ele ainda não tem um aberto nesse pipeline
    (em qualquer etapa: quem já avançou não volta). True quando criou."""
    if any(n.get("pipelineId") == pipeline_id for n in _negocios_abertos(contato_id)):
        return False
    _api("POST", f"/contact/{contato_id}/crm", {"crm_id": pipeline_id, "column_id": etapa_id, "assignContactAttendant": True})
    return True


# ───────── Atendentes ─────────
# A Unnichat atribui cada contato a um atendente (Live Chat). O agente tem um usuário próprio
# (UNNICHAT_ATENDENTE_AGENTE, ex.: "Luna"): as conversas que ele atende ficam com ele; se alguém da
# equipe assumir o contato, ele para de responder. Na transferência, o contato vai para um atendente
# de UNNICHAT_ATENDENTES_TRANSFERENCIA, em rodízio, preferindo quem está online.

_rodizio = {"proximo": 0}


def atendente_do_agente() -> str:
    return _env("UNNICHAT_ATENDENTE_AGENTE")


def atribuir_ao_agente_ligado() -> bool:
    """Atribuir ao usuário do agente as conversas que ele abre (UNNICHAT_ATRIBUIR_AGENTE=1). Desligado
    por padrão; o id do agente continua servindo para saber se alguém da equipe assumiu o contato."""
    return _env("UNNICHAT_ATRIBUIR_AGENTE").lower() in ("1", "sim", "true")


def atendentes_da_transferencia() -> list[str]:
    """Quem pode receber a transferência. O usuário do agente nunca entra, mesmo se estiver na lista:
    transferir para ele deixaria o cidadão sem ninguém."""
    do_agente = atendente_do_agente()
    return [i.strip() for i in _env("UNNICHAT_ATENDENTES_TRANSFERENCIA").split(",") if i.strip() and i.strip() != do_agente]


def atendente_do_contato(contato_id: str) -> dict | None:
    """Quem atende o contato agora ({id, name}); None se ninguém."""
    dados = _api("GET", f"/contact/{contato_id}/assign").get("data") or {}
    return dados if isinstance(dados, dict) and dados.get("id") else None


def tags_do_contato(contato_id: str) -> set[str]:
    """As tags do contato agora (GET /contact/{id}), em minúsculas."""
    dados = _api("GET", f"/contact/{contato_id}").get("data") or {}
    return {str(t.get("name") or "").strip().lower() for t in dados.get("tags") or [] if isinstance(t, dict) and t.get("name")}


# O que conta como conversa de alguém da equipe com o contato. Fora: nota interna ("note", inclusive a
# da transferência que o próprio agente deixa) e aviso do sistema ("info"), que também vêm sem origin.
TIPOS_DE_CONVERSA = ("message", "audio", "image", "video", "document", "sticker")


def pessoa_escreveu_desde(contato_id: str, desde: float) -> bool:
    """Alguém da equipe escreveu ao contato pelo Live Chat depois de `desde` (epoch)? Nas mensagens do
    contato (GET /contact/{id}/messages), a de pessoa vem com senderBy "user" e sem origin; a do agente
    traz origin "unniApi" e a das automações e templates, "automation" (visto em 28/10/2026). Nota interna
    não conta: em 28/10, a nota da transferência calou a Luna na conversa seguinte do mesmo contato."""
    for mensagem in _api("GET", f"/contact/{contato_id}/messages?limit=30").get("data") or []:
        if not isinstance(mensagem, dict) or mensagem.get("senderBy") != "user" or mensagem.get("origin"):
            continue
        if (mensagem.get("type") or "message") not in TIPOS_DE_CONVERSA:
            continue
        try:
            quando = datetime.fromisoformat(str(mensagem.get("date")).replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        if quando >= desde:
            return True
    return False


def atribuir(contato_id: str, atendente_id: str) -> dict:
    return _api("POST", f"/contact/{contato_id}/assign", {"attendantId": atendente_id})


def atendentes() -> list[dict]:
    dados = _api("GET", "/attendants?perPage=100").get("data") or []
    return [a for a in dados if isinstance(a, dict) and a.get("id")]


def escolher_atendente(ids: list[str]) -> dict | None:
    """O próximo da lista em rodízio, preferindo quem está online; sem ninguém online, o próximo
    da lista mesmo assim (a conversa fica na fila dele)."""
    if not ids:
        return None
    por_id = {a["id"]: a for a in atendentes()}
    candidatos = [por_id.get(i) or {"id": i, "name": ""} for i in ids]
    inicio = _rodizio["proximo"] % len(candidatos)
    ordem = candidatos[inicio:] + candidatos[:inicio]
    escolhido = next((a for a in ordem if a.get("status") == "online"), ordem[0])
    _rodizio["proximo"] = candidatos.index(escolhido) + 1
    return escolhido


def nota_de_transferencia(acao: dict, rotulo_categoria: str, atendente: str | None = None) -> str:
    linhas = [
        "🤖 Transferido pelo agente de onboarding" + (f" para {atendente}" if atendente else ""),
        f"Assunto: {rotulo_categoria}",
        f"Motivo: {acao.get('motivo') or '-'}",
        f"O que o cidadão relatou: {acao.get('dificuldade_relatada') or '-'}",
        f"Orientações já enviadas: {acao.get('orientacoes_prestadas') or '-'}",
    ]
    if acao.get("resumo"):
        linhas.append(f"Resumo: {acao['resumo']}")
    return "\n".join(linhas)


def tentar(descricao: str, funcao, *args) -> bool:
    """Executa uma chamada à Unnichat sem derrubar o atendimento; registra a falha no log."""
    try:
        funcao(*args)
        return True
    except Exception as erro:  # rede, 4xx/5xx: o atendimento segue, a falha fica no log
        log_warning(f"Unnichat: falhou {descricao}: {erro}")
        return False
