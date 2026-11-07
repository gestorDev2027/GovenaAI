"""Rotas do painel (/painel/api): indicadores, conversas, chat de teste e base de conhecimento.

Acesso: com OS_SECURITY_KEY definida (produção), toda rota exige uma destas credenciais:
- sessão do login com Google (cookie assinado), só para e-mails verificados dos domínios em
  PAINEL_DOMINIOS e, se definida, da lista PAINEL_EMAILS. Liga com PAINEL_GOOGLE_CLIENT_ID;
- `Authorization: Bearer <OS_SECURITY_KEY>` (a chave do AgentOS) ou o token interno do Scheduler.
Sem OS_SECURITY_KEY (teste local), o painel fica aberto. Em produção, sempre defina a chave.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import threading
import time
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from agno.agent import Agent
from agno.db.base import SessionType
from agno.utils.log import log_warning
from fastapi import APIRouter, Cookie, Depends, File, Form, Header, HTTPException, Query, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import MetaData, Table, func, select, true
from starlette.concurrency import run_in_threadpool

from agente import alertas as alertas_mod
from agente import ao_vivo, base, conhecimento, datasets, equipes, ficha, gestao, guardrails, lacunas, listas, perfis, usuarios
from agente.atendimento import encerrar_inativas, encerrar_por_inatividade, responder, responder_em_etapas
from agente.ferramentas import STATUS_EM_ATENDIMENTO, STATUS_ENCERRADO, STATUS_TRANSFERIDO

# Horário de Brasília (sem horário de verão desde 2019).
FUSO_BR = timezone(timedelta(hours=-3))
# Boas-vindas enviadas e nenhuma resposta do contato no prazo da inatividade (só nos indicadores: a conversa
# não tem sessão do agente).
STATUS_SEM_RESPOSTA = "sem_resposta"
DIAS_SO_BOAS_VINDAS = 30  # na lista de Conversas, as só de boas-vindas desses últimos dias
# A Unnichat pôs o contato com o agente e o aviso de entrada não chegou ao servidor (agente/conferencia.py).
STATUS_NAO_CHEGOU = "nao_chegou"
PREFIXO_NAO_CHEGOU = "nao-chegou-"

ORIGENS = {
    "painel-": "Painel",
    "teste-": "Terminal",
    "cenario-": "Testes automáticos",
    "unnichat-": "Unnichat (WhatsApp)",
}


def _chave() -> str:
    return os.getenv("OS_SECURITY_KEY", "").strip()


# ───────── Login com Google ─────────

COOKIE_SESSAO = "painel_sessao"
# Vazio: qualquer e-mail verificado do Google pode pedir acesso, e entra como pendente até o dono aprovar
# (agente/usuarios.py). Com PAINEL_DOMINIOS, só os domínios da lista (ex.: gestorgov.com,saude.exemplo.sp.gov.br).
DOMINIOS_PADRAO = ""


def _lista(variavel: str, padrao: str = "") -> set[str]:
    return {v.strip().lower() for v in os.getenv(variavel, padrao).split(",") if v.strip()}


def _google_client_id() -> str:
    return os.getenv("PAINEL_GOOGLE_CLIENT_ID", "").strip()


def _horas_sessao() -> int:
    try:
        return max(1, int(os.getenv("PAINEL_SESSAO_HORAS", "12")))
    except ValueError:
        return 12


def _segredo_sessao() -> bytes:
    # Sem segredo próprio, deriva da OS_SECURITY_KEY: trocar a chave derruba todas as sessões.
    return (os.getenv("PAINEL_SEGREDO_SESSAO") or f"painel-sessao:{_chave()}").encode()


def _b64(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).decode().rstrip("=")


def _criar_sessao(email: str, nome: str) -> str:
    corpo = _b64(json.dumps({"email": email, "nome": nome, "exp": int(time.time()) + _horas_sessao() * 3600}).encode())
    assinatura = _b64(hmac.new(_segredo_sessao(), corpo.encode(), hashlib.sha256).digest())
    return f"{corpo}.{assinatura}"


def _ler_sessao(cookie: str | None) -> dict | None:
    """Dados da sessão, ou None se ausente, adulterada, vencida ou de e-mail que perdeu a permissão."""
    if not cookie or "." not in cookie or not _chave():
        return None
    corpo, assinatura = cookie.rsplit(".", 1)
    esperada = _b64(hmac.new(_segredo_sessao(), corpo.encode(), hashlib.sha256).digest())
    if not secrets.compare_digest(assinatura, esperada):
        return None
    try:
        dados = json.loads(base64.urlsafe_b64decode(corpo + "=" * (-len(corpo) % 4)))
    except ValueError:
        return None
    if dados.get("exp", 0) < time.time() or not _email_permitido(dados.get("email", "")):
        return None
    return dados


def _email_permitido(email: str) -> bool:
    email = email.strip().lower()
    permitidos = _lista("PAINEL_EMAILS")
    if permitidos:
        return email in permitidos
    dominios = _lista("PAINEL_DOMINIOS", DOMINIOS_PADRAO)
    return not dominios or email.rsplit("@", 1)[-1] in dominios


def _validar_google(credencial: str) -> dict:
    """Confere o ID token do botão do Google (assinatura, emissor, validade e destinatário)."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    return id_token.verify_oauth2_token(
        credencial, google_requests.Request(), _google_client_id(), clock_skew_in_seconds=10
    )


class PedidoUsuario(BaseModel):
    papel: str | None = Field(default=None, max_length=20)
    permissoes: list[str] | None = Field(default=None, max_length=30)
    situacao: str | None = Field(default=None, max_length=12)


class PedidoLoginGoogle(BaseModel):
    credencial: str = Field(min_length=20, max_length=5000)


class PedidoCadastro(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    senha: str = Field(min_length=8, max_length=200)


class PedidoLoginSenha(BaseModel):
    email: str = Field(min_length=5, max_length=200)
    senha: str = Field(min_length=1, max_length=200)


class PedidoImplantacao(BaseModel):
    mensagem: str = Field(min_length=1, max_length=2000)


# Tentativas erradas de senha por e-mail: depois de 5 em 10 minutos, espera.
_FALHAS_LOGIN: dict[str, list[float]] = {}
LIMITE_FALHAS, JANELA_FALHAS_S = 5, 600


def _bloqueado_por_falhas(email: str) -> bool:
    agora = time.time()
    recentes = [t for t in _FALHAS_LOGIN.get(email, []) if agora - t < JANELA_FALHAS_S]
    _FALHAS_LOGIN[email] = recentes
    return len(recentes) >= LIMITE_FALHAS


def _gravar_sessao(resposta: Response, email: str, nome: str) -> None:
    resposta.set_cookie(
        COOKIE_SESSAO, _criar_sessao(email, nome), max_age=_horas_sessao() * 3600,
        path="/painel", httponly=True, secure=True, samesite="lax",
    )


def exigir_sessao(painel_sessao: str | None = Cookie(default=None)) -> dict:
    """Pessoa logada (aprovada ou ainda pendente; bloqueada não): a implantação da própria prefeitura não
    depende da aprovação do dono do painel."""
    sessao = _ler_sessao(painel_sessao)
    if not sessao:
        raise HTTPException(status_code=401, detail="Entre com a sua conta para continuar.")
    dele = usuarios.usuario(sessao["email"]) if usuarios.disponivel() else None
    if dele and dele["situacao"] == "bloqueado":
        raise HTTPException(status_code=403, detail="Seu acesso foi bloqueado.")
    return sessao


def exigir_chave(
    authorization: str | None = Header(default=None),
    painel_sessao: str | None = Cookie(default=None),
) -> None:
    """Quem chama o painel: uma pessoa logada com o Google, aprovada e com "ver o painel" (agente/usuarios.py),
    ou a chave de acesso / o token interno (rotinas e AgentOS)."""
    chave = _chave()
    if not chave:
        return
    sessao = _ler_sessao(painel_sessao)
    if sessao:
        _conferir_usuario(sessao["email"])
        return
    recebida = (authorization or "").removeprefix("Bearer ").strip().encode()
    # O Scheduler do Agno chama as rotas com o token interno do AgentOS (definido em app.py).
    token_interno = os.getenv("AGENTOS_TOKEN_INTERNO", "")
    if secrets.compare_digest(recebida, chave.encode()):
        return
    if token_interno and secrets.compare_digest(recebida, token_interno.encode()):
        return
    raise HTTPException(status_code=401, detail="Chave de acesso inválida ou ausente.")


# Link da gestão: a Visão geral só de leitura, sem login, para mandar à gestão de CS. Liga com PAINEL_LINK_GESTAO
# (um código aleatório longo); o link é /painel/gestao/<código>. Trocar o código derruba o link antigo. As rotas
# devolvem só números agregados: sem nome, telefone, id de conversa ou texto escrito pelo agente ou pelo contato.
TAMANHO_MINIMO_CODIGO_GESTAO = 24


def conferir_link_gestao(codigo: str) -> None:
    esperado = os.getenv("PAINEL_LINK_GESTAO", "").strip()
    if len(esperado) < TAMANHO_MINIMO_CODIGO_GESTAO or not secrets.compare_digest(codigo.encode(), esperado.encode()):
        raise HTTPException(status_code=404, detail="Link não encontrado ou desativado.")


# O tema de cada transferência, pelo motivo (o mesmo de painel/src/lib/temas-transferencia.ts, na mesma ordem: o
# primeiro que casa vence, sobre "motivo rótulo"). No link da gestão o motivo não sai do servidor, só o tema.
# Mudou lá, mude aqui.
TEMAS_TRANSFERENCIA: list[tuple[str, re.Pattern]] = [
    (tema, re.compile(padrao, re.IGNORECASE)) for tema, padrao in (
        ("pessoa", r"atendente|humano|falar com (uma )?pessoa|falar com (o|a) (respons|coorden|secret)"),
        ("sistema", r"erro|falha|n[ãa]o abre|n[ãa]o carrega|travou|fora do ar"),
        ("outro_setor", r"outro setor|de outro setor|n[ãa]o [ée] (do|deste) setor|jur[ií]dico|recursos humanos|\bRH\b|tesouraria|contabilidade"),
        ("norma", r"\blei\b|portaria|norma|decreto|resolu[çc][ãa]o|legisla"),
        ("cadastro", r"cadastr|unidade|cnes|setor n[ãa]o|sem respons[áa]vel"),
        ("dados", r"planilha|dados|n[úu]mero|quantidade|saldo|relat[óo]rio|indicador"),
        ("aprovacao", r"aprova|decis|autoriz|assinatura|respons[áa]vel"),
    )
]


def tema_da_transferencia(motivo: str | None) -> str:
    return next((tema for tema, padrao in TEMAS_TRANSFERENCIA if padrao.search(motivo or "")), "outros")


def so_agregados(dados: dict) -> dict:
    """Os indicadores sem nada que identifique contato ou conversa (lista de chaves permitidas, não de proibidas)."""
    return {
        **{chave: dados.get(chave) for chave in ("periodo", "fonte", "totais", "anterior", "qualidade", "serie",
                                                 "categorias", "origens", "por_hora", "agora")},
        "ultimas_transferencias": [],
        "transferencias": [
            {"id": "", "categoria": t.get("categoria"), "rotulo": t.get("rotulo"), "motivo": "",
             "tema": tema_da_transferencia(f"{t.get('motivo') or ''} {t.get('rotulo') or ''}")}
            for t in dados.get("transferencias") or []
        ],
    }


def _conferir_usuario(email: str, permissao: str = "ver_painel") -> None:
    """Pessoa logada: precisa estar aprovada e ter a permissão. 403 com o motivo, para a tela explicar."""
    if not usuarios.disponivel():
        return
    dele = usuarios.usuario(email)
    if dele is None or dele["situacao"] == "pendente":
        raise HTTPException(status_code=403, detail="Seu acesso está aguardando a aprovação do dono do painel.")
    if dele["situacao"] == "bloqueado":
        raise HTTPException(status_code=403, detail="Seu acesso ao painel foi bloqueado.")
    if permissao not in dele["permissoes"]:
        rotulo = usuarios.PERMISSOES.get(permissao, (permissao,))[0]
        raise HTTPException(status_code=403, detail=f"Você não tem a permissão \"{rotulo}\". Peça ao dono do painel.")


def quem_chama(painel_sessao: str | None) -> str:
    """O e-mail de quem está logado, ou "chave de acesso" (rotinas, AgentOS, uso local sem chave)."""
    sessao = _ler_sessao(painel_sessao)
    return sessao["email"] if sessao else usuarios.SISTEMA


def exigir(permissao: str):
    """Dependência de rota: a pessoa logada precisa da permissão (a chave de acesso pode tudo).
    Confere o login antes: sem sessão, "chave de acesso" só vale para quem mandou a chave."""
    def conferir(painel_sessao: str | None = Cookie(default=None), _autenticado: None = Depends(exigir_chave)) -> str:
        quem = quem_chama(painel_sessao)
        if quem != usuarios.SISTEMA:
            _conferir_usuario(quem, permissao)
        return quem
    return conferir


def _origem(session_id: str) -> str:
    for prefixo, nome in ORIGENS.items():
        if session_id.startswith(prefixo):
            return nome
    return "AgentOS"


def _iso(epoch: int | float | None) -> str | None:
    if not epoch:
        return None
    return datetime.fromtimestamp(epoch, tz=FUSO_BR).isoformat()


def _texto_entrada(run) -> str:
    entrada = getattr(run, "input", None)
    conteudo = getattr(entrada, "input_content", entrada)
    return conteudo if isinstance(conteudo, str) else str(conteudo or "")


def _ultima_atividade(sessao) -> int | float | None:
    """Hora da última mensagem: o maior entre a atualização da sessão e o início da última resposta
    (em alguns bancos a sessão não tem a atualização renovada a cada mensagem)."""
    runs = sessao.runs or []
    ultima_run = getattr(runs[-1], "created_at", None) if runs else None
    return max((v for v in (sessao.updated_at, ultima_run) if v), default=None)


def quando_da_acao(acao: dict, sessao=None) -> float | None:
    """Quando a ação (transferência, encerramento) foi registrada, em epoch. registrado_em vem sem fuso, na hora
    do servidor (UTC em produção). Os encerramentos por inatividade antigos não têm registrado_em: valem pela
    última atualização da conversa (o encerramento é a última coisa que acontece nela)."""
    texto = acao.get("registrado_em")
    if texto:
        try:
            momento = datetime.fromisoformat(str(texto))
        except ValueError:
            momento = None
        if momento is not None:
            return (momento if momento.tzinfo else momento.replace(tzinfo=timezone.utc)).timestamp()
    if acao.get("tipo") == "inatividade" and sessao is not None:
        return getattr(sessao, "updated_at", None)
    return None


def _resumo(sessao) -> dict:
    estado = (sessao.session_data or {}).get("session_state") or {}
    runs = sessao.runs or []
    acoes = estado.get("acoes") or []
    transferencia = next((a for a in reversed(acoes) if a.get("tipo") == "transferencia"), None)
    fim = next((a for a in reversed(acoes) if a.get("tipo") in ("encerramento", "inatividade")), None)
    tokens_entrada = sum((getattr(r.metrics, "input_tokens", 0) or 0) for r in runs if r.metrics)
    tokens_saida = sum((getattr(r.metrics, "output_tokens", 0) or 0) for r in runs if r.metrics)
    duracoes = [r.metrics.duration for r in runs if r.metrics and r.metrics.duration]
    ultimo = runs[-1] if runs else None
    categoria = (transferencia or {}).get("categoria")
    return {
        "id": sessao.session_id,
        "agente": getattr(sessao, "agent_id", None) or perfis.PADRAO,  # com quem é a conversa
        "area": perfis.identidade(getattr(sessao, "agent_id", None))["area"],
        "origem": _origem(sessao.session_id),
        "nome": estado.get("nome_contato") or "",
        "status": estado.get("status", STATUS_EM_ATENDIMENTO),
        "fim": (fim or {}).get("tipo"),
        "criada_em": _iso(sessao.created_at),
        "atualizada_em": _iso(_ultima_atividade(sessao)),
        "mensagens": len(runs),
        "ultima_mensagem": _texto_entrada(ultimo)[:160] if ultimo else "",
        "ultima_resposta": (ultimo.content or "")[:200] if ultimo else "",
        "categoria": categoria,
        "categoria_rotulo": perfis.todas_as_categorias().get(categoria) if categoria else None,
        "motivo": (transferencia or {}).get("motivo"),
        "tokens_entrada": tokens_entrada,
        "tokens_saida": tokens_saida,
        "duracao_media_s": round(sum(duracoes) / len(duracoes), 2) if duracoes else None,
        # Quando transferiu e quando encerrou: a Central conta as do período por esses horários.
        "transferida_em": _iso(quando_da_acao(transferencia, sessao)) if transferencia else None,
        "encerrada_em": _iso(quando_da_acao(fim, sessao)) if fim else None,
    }


_SEM_RESULTADO = lacunas.SEM_RESULTADO  # ferramenta que não achou nada (o mesmo critério das lacunas)
# Ferramentas que encerram o atendimento: são desfecho, não consulta (ficam fora do uso de ferramentas).
FERRAMENTAS_DE_DESFECHO = {"transferir_para_humano", "encerrar_atendimento"}
# "Atendendo agora": mensagem nos últimos 15 min. O mesmo limite da mesa no escritório da Central
# (SEGUNDOS_NA_MESA em pages/central.tsx): a Visão geral e a barra da Central mostram o mesmo número.
SEGUNDOS_ATENDENDO_AGORA = 15 * 60


def _canal(session_id: str) -> str:
    """O canal da conversa, para os setores da Central: whatsapp, painel (chat de teste) ou outro."""
    if session_id.startswith("unnichat-"):
        return "whatsapp"
    if session_id.startswith("painel-"):
        return "painel"
    return "outro"


def _sessoes(agente: Agent, desde_epoch: int | None = None, limite: int = 500,
             ate_epoch: int | None = None, por_atividade: bool = False) -> list:
    """As conversas do agente: as dele e as de equipe que estão com ele agora (agente/equipes.py), já no
    formato de conversa de agente. Por padrão, as criadas desde `desde_epoch`; com por_atividade, as que
    tiveram atividade entre `desde_epoch` e `ate_epoch` (a Central, ver listas.sessoes_recentes)."""
    # A mesma busca para todos os agentes (ela não filtra por agente no banco): feita uma vez e guardada por
    # alguns segundos (agente/listas.py), em vez de uma por agente a cada rota.
    sessoes = listas.sessoes_recentes(agente.db, SessionType.AGENT, desde_epoch, limite, ate_epoch, por_atividade)
    proprias = [s for s in sessoes if getattr(s, "agent_id", None) in (None, agente.id)]
    da_equipe = equipes.conversas_do_agente(agente.db, agente.id, desde_epoch, limite, ate_epoch, por_atividade)
    if not da_equipe:
        return proprias
    return sorted(proprias + da_equipe, key=lambda s: _ultima_atividade(s) or 0, reverse=True)[:limite]


def _sessao(db, session_id: str):
    """Uma conversa pelo id: de equipe (no formato de agente) ou de agente."""
    return equipes.conversa(db, session_id) or db.get_session(session_id=session_id, session_type=SessionType.AGENT)


# Anexos do chat de teste: o que um contato manda no WhatsApp (print, PDF, áudio).
TIPOS_ANEXO = ("image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf",
               "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm", "audio/aac")
MAX_ANEXOS = 4
MAX_BYTES_ANEXO = 10 * 1024 * 1024


def _anexos_da_mensagem(run) -> list[dict]:
    entrada = getattr(run, "input", None)
    anexos = []
    for tipo, lista in (("imagem", "images"), ("arquivo", "files"), ("audio", "audios")):
        for item in getattr(entrada, lista, None) or []:
            nome = getattr(item, "filename", None) or getattr(item, "name", None) or getattr(item, "alt_text", None)
            anexos.append({"tipo": tipo, "nome": nome or tipo, "mime": getattr(item, "mime_type", None)})
    return anexos


class PedidoBase(BaseModel):
    conteudo: str = Field(min_length=50, max_length=200_000)
    observacao: str | None = Field(default=None, max_length=300)


def criar_rotas(agente: Agent, agentes: dict[str, Agent] | None = None) -> APIRouter:
    """`agente`: o que o painel mostra e testa (o padrão). `agentes`: todos, para o encerramento por
    inatividade valer para cada um."""
    agentes = agentes or {agente.id: agente}
    rotas = APIRouter(prefix="/painel/api", tags=["Painel"])
    protegido = [Depends(exigir_chave)]

    def so_sistema(painel_sessao: str | None = Cookie(default=None), _autenticado: None = Depends(exigir_chave)) -> None:
        """Rotinas de manutenção: chamadas pelo Scheduler com o token interno, não por pessoas."""
        if quem_chama(painel_sessao) != usuarios.SISTEMA:
            raise HTTPException(status_code=403, detail="Rotina interna: só o próprio servidor a chama.")

    def _do_agente(agente_id: str | None) -> Agent:
        """O agente pedido pelo painel (?agente=<id>); vazio = o padrão (Luna)."""
        if not agente_id:
            return agente
        if agente_id not in agentes:
            raise HTTPException(status_code=404, detail=f"Agente desconhecido: {agente_id}. Existem: {', '.join(agentes)}.")
        return agentes[agente_id]

    def _escolhidos(agente_id: str | None, area: str | None) -> list[Agent]:
        """Os agentes de um filtro do painel: um agente, os de uma área ou, sem filtro, todos."""
        if agente_id:
            return [_do_agente(agente_id)]
        publicados = [um for um in agentes.values() if perfis.publicado(um.id)]
        if area:
            return [um for um in publicados if perfis.identidade(um.id)["area"].lower() == area.lower()]
        return publicados

    def _sessoes_de(escolhidos: list[Agent], desde_epoch: int | None = None, limite: int = 500,
                    ate_epoch: int | None = None, por_atividade: bool = False) -> list:
        """As sessões de vários agentes, sem repetir, das mais recentes para as mais antigas."""
        unicas = {s.session_id: s for um in escolhidos
                  for s in _sessoes(um, desde_epoch, limite, ate_epoch, por_atividade)}
        return sorted(unicas.values(), key=lambda s: _ultima_atividade(s) or 0, reverse=True)[:limite]

    # A Central: até 30 dias (ou um intervalo de datas). As conversas do período são as que tiveram atividade nele.
    HORAS_MAX_CENTRAL = 24 * 30
    LIMITE_CENTRAL = 3000

    def _periodo_central(horas: int, desde: int | None, ate: int | None) -> tuple[int, int | None]:
        """O período da Central em epoch: (início, fim). Fim None = até agora (o período acompanha o relógio).
        Com `desde` (e `ate`), um intervalo de datas; senão, as últimas `horas`."""
        agora = int(time.time())
        if desde is None:
            return agora - horas * 3600, None
        fim = ate if ate is not None and ate < agora else None
        if fim is not None and fim <= desde:
            raise HTTPException(status_code=422, detail="O fim do período precisa ser depois do início.")
        if (fim or agora) - desde > HORAS_MAX_CENTRAL * 3600:
            raise HTTPException(status_code=422, detail="O período da Central vai até 30 dias.")
        return desde, fim

    def _no_periodo(momento: float | None, inicio: int, fim: int | None) -> bool:
        return momento is not None and momento >= inicio and (fim is None or momento <= fim)

    def _da_sessao(session_id: str):
        """Quem atende a conversa: a equipe, se for de equipe; senão o agente que a começou (sessões
        antigas, sem agent_id, são do padrão)."""
        sessao = _sessao(agente.db, session_id)
        if getattr(sessao, "team_id", None) in equipes.EQUIPES:
            return equipes.EQUIPES[sessao.team_id]
        return agentes.get(getattr(sessao, "agent_id", None) or "", agente)

    def _base_iso(atual: dict) -> dict:
        return {**atual, "atualizado_em": atual["atualizado_em"].isoformat() if atual["atualizado_em"] else None}

    @rotas.get("/acesso")
    def acesso(painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Rota aberta: diz ao painel se precisa de login, como entrar e quem já está conectado."""
        sessao = _ler_sessao(painel_sessao)
        dele = usuarios.usuario(sessao["email"]) if sessao and usuarios.disponivel() else None
        google = bool(_google_client_id())
        return {
            "requer_chave": bool(_chave()),
            # Cadastro e login com e-mail e senha: precisam da chave (é ela que assina a sessão).
            "aceita_senha": bool(_chave()) and usuarios.disponivel(),
            "google_client_id": _google_client_id() or None,
            # Com o Google ligado, pessoas entram por ele; a chave fica para rotinas (PAINEL_LOGIN_CHAVE=sim reabre).
            "aceita_chave": not google or os.getenv("PAINEL_LOGIN_CHAVE", "").strip().lower() in ("1", "sim", "true"),
            "usuario": {
                "email": sessao["email"], "nome": sessao.get("nome") or "",
                "papel": (dele or {}).get("papel"), "situacao": (dele or {}).get("situacao", "pendente"),
                "permissoes": (dele or {}).get("permissoes", []),
            } if sessao else None,
        }

    @rotas.post("/login/google")
    async def login_google(pedido: PedidoLoginGoogle, resposta: Response) -> dict:
        if not _google_client_id() or not _chave():
            raise HTTPException(status_code=404, detail="Login com Google não está configurado.")
        try:
            dados = await run_in_threadpool(_validar_google, pedido.credencial)
        except Exception:
            raise HTTPException(status_code=401, detail="Não foi possível confirmar o login com o Google.")
        email = (dados.get("email") or "").strip().lower()
        if not dados.get("email_verified") or not _email_permitido(email):
            raise HTTPException(status_code=403, detail=f"O e-mail {email or 'informado'} não tem acesso ao painel.")
        nome = dados.get("name") or ""
        # Primeiro acesso: entra pendente (ou como dono, ver agente/usuarios.py). Bloqueado não entra.
        dele = await run_in_threadpool(usuarios.registrar_acesso, email, nome) if usuarios.disponivel() else None
        if dele and dele["situacao"] == "bloqueado":
            raise HTTPException(status_code=403, detail="Seu acesso ao painel foi bloqueado.")
        resposta.set_cookie(
            COOKIE_SESSAO,
            _criar_sessao(email, nome),
            max_age=_horas_sessao() * 3600,
            path="/painel",
            httponly=True,
            secure=True,
            samesite="lax",
        )
        return {"email": email, "nome": nome, "situacao": (dele or {}).get("situacao"), "papel": (dele or {}).get("papel")}

    @rotas.post("/cadastro")
    async def cadastro(pedido: PedidoCadastro, resposta: Response) -> dict:
        """Cadastro pela landing page: cria a conta e já entra. A pessoa vai para a implantação da prefeitura."""
        if not _chave() or not usuarios.disponivel():
            raise HTTPException(status_code=503, detail="O cadastro não está ligado neste servidor (falta OS_SECURITY_KEY).")
        email = pedido.email.strip().lower()
        if not _email_permitido(email):
            raise HTTPException(status_code=403, detail=f"O e-mail {email} não pode se cadastrar neste servidor.")
        try:
            dele = await run_in_threadpool(usuarios.criar_conta, email, pedido.nome, pedido.senha)
        except usuarios.ErroUsuario as erro:
            raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro
        _gravar_sessao(resposta, email, pedido.nome.strip())
        return {"email": email, "nome": pedido.nome.strip(), "situacao": dele["situacao"], "papel": dele["papel"]}

    @rotas.post("/login/senha")
    async def login_senha(pedido: PedidoLoginSenha, resposta: Response) -> dict:
        if not _chave() or not usuarios.disponivel():
            raise HTTPException(status_code=503, detail="O login com senha não está ligado neste servidor.")
        email = pedido.email.strip().lower()
        if _bloqueado_por_falhas(email):
            raise HTTPException(status_code=429, detail="Muitas tentativas. Espere alguns minutos e tente de novo.")
        dele = await run_in_threadpool(usuarios.entrar_com_senha, email, pedido.senha)
        if not dele:
            _FALHAS_LOGIN.setdefault(email, []).append(time.time())
            raise HTTPException(status_code=401, detail="E-mail ou senha não conferem.")
        if dele["situacao"] == "bloqueado":
            raise HTTPException(status_code=403, detail="Seu acesso foi bloqueado.")
        _FALHAS_LOGIN.pop(email, None)
        _gravar_sessao(resposta, email, dele["nome"])
        return {"email": email, "nome": dele["nome"], "situacao": dele["situacao"], "papel": dele["papel"]}

    # ───────── Implantação da prefeitura (quem se cadastrou, mesmo antes da aprovação) ─────────

    def _implantacao_da(email: str) -> tuple[str, str | None]:
        """A conversa de implantação da conta (uma por pessoa) e o município dela, se já registrado."""
        sessao = "implantacao-" + hashlib.sha256(email.encode()).hexdigest()[:16]
        dela = gestao.municipios_de(email) if gestao.disponivel() else []
        return sessao, (str(dela[0]["id"]) if dela else None)

    @rotas.get("/implantacao")
    def implantacao(sessao: dict = Depends(exigir_sessao)) -> dict:
        email = sessao["email"]
        session_id, municipio_id = _implantacao_da(email)
        historico = []
        conversa = _sessao(agente.db, session_id)
        for run in (getattr(conversa, "runs", None) or []):
            if getattr(run, "parent_run_id", None):
                continue
            historico.append({"papel": "contato", "texto": _texto_entrada(run)})
            if isinstance(run.content, str) and run.content.strip():
                historico.append({"papel": "agente", "texto": run.content})
        return {
            "conta": {"email": email, "nome": sessao.get("nome") or ""},
            "boas_vindas": perfis.obter(perfis.PADRAO).boas_vindas((sessao.get("nome") or "").split(" ")[0]),
            "historico": historico,
            "municipio_id": municipio_id,
            "panorama": gestao.panorama(municipio_id) if municipio_id else None,
        }

    @rotas.get("/implantacao/catalogo")
    def implantacao_catalogo(sessao: dict = Depends(exigir_sessao)) -> dict:
        """Os tipos de unidade (nome e cor), para o quadro da implantação."""
        return gestao._json({"tipos_unidade": gestao.tipos_unidade()}) if gestao.disponivel() else {"tipos_unidade": []}

    @rotas.post("/implantacao/mensagem")
    async def implantacao_mensagem(pedido: PedidoImplantacao, sessao: dict = Depends(exigir_sessao)) -> dict:
        email = sessao["email"]
        session_id, municipio_id = _implantacao_da(email)
        assistente = agentes.get(perfis.PADRAO) or agente
        nome = (sessao.get("nome") or "").split(" ")[0]
        resultado = await run_in_threadpool(
            responder, assistente, session_id, pedido.mensagem.strip(), nome, email, "", None,
            {"conta_email": email, "conta_nome": sessao.get("nome") or "", "municipio_id": municipio_id},
        )
        _, municipio_id = _implantacao_da(email)
        return {**resultado, "municipio_id": municipio_id,
                "panorama": gestao.panorama(municipio_id) if municipio_id else None}

    # ───────── Usuários e permissões (agente/usuarios.py) ─────────

    @rotas.get("/usuarios/opcoes", dependencies=protegido)
    def usuarios_opcoes() -> dict:
        return usuarios.opcoes()

    @rotas.get("/usuarios", dependencies=protegido)
    def listar_usuarios(quem: str = Depends(exigir("gerenciar_usuarios"))) -> dict:
        return {"usuarios": usuarios.listar(), "voce": quem}

    @rotas.put("/usuarios/{email}", dependencies=protegido)
    def alterar_usuario(email: str, pedido: PedidoUsuario, quem: str = Depends(exigir("gerenciar_usuarios"))) -> dict:
        try:
            return usuarios.alterar(email, pedido.model_dump(exclude_unset=True), quem)
        except usuarios.ErroUsuario as erro:
            raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro

    @rotas.delete("/usuarios/{email}", status_code=204, dependencies=protegido)
    def remover_usuario(email: str, quem: str = Depends(exigir("gerenciar_usuarios"))) -> None:
        try:
            usuarios.remover(email, quem)
        except usuarios.ErroUsuario as erro:
            raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro

    @rotas.post("/logout")
    def logout(resposta: Response) -> dict:
        resposta.delete_cookie(COOKIE_SESSAO, path="/painel", httponly=True, secure=True, samesite="lax")
        return {"ok": True}

    @rotas.get("/config", dependencies=protegido)
    def config(agente_id: str | None = Query(default=None, max_length=60, alias="agente")) -> dict:
        # Equipe: a configuração do agente padrão dela (boas-vindas, modelo), com o id e o nome da equipe.
        equipe = equipes.EQUIPES.get(agente_id or "")
        um = agentes[equipes.padrao(equipe)] if equipe else _do_agente(agente_id)
        dele = perfis.obter(um.id)
        return {
            "id": um.id,
            **perfis.identidade(um.id),  # nome, cargo e área
            "agente": um.name,
            "modelo": um.model.id if um.model else None,
            "raciocinio": getattr(um.model, "thinking_level", None) or "livre",
            "roteiro_modo": conhecimento.modo_roteiro(),
            "boas_vindas": dele.boas_vindas(""),
            "minutos_inatividade": dele.minutos_inatividade,
            "categorias": dele.categorias_transferencia,
            "equipe": {"id": equipe.id, "nome": equipe.name} if equipe else None,
        }

    def _medir(sessoes: list, sem_sessao: list) -> dict:
        """Os números de um período: as conversas com sessão do agente e as só de boas-vindas.

        Terminadas = transferidas + retidas. Retidas (sem passar para a equipe): o agente encerrou, o contato
        parou de responder no meio, ou não respondeu às boas-vindas no prazo da inatividade. As em andamento
        ficam fora das taxas até terminar."""
        resumos = [_resumo(s) for s in sessoes]
        por_status = Counter(r["status"] for r in [*resumos, *sem_sessao])
        transferidas = por_status.get(STATUS_TRANSFERIDO, 0)
        retidas = {
            "encerradas_pelo_agente": sum(r["status"] == STATUS_ENCERRADO and r["fim"] == "encerramento" for r in resumos),
            "inatividade": sum(r["status"] == STATUS_ENCERRADO and r["fim"] == "inatividade" for r in resumos),
            "sem_resposta": por_status.get(STATUS_SEM_RESPOSTA, 0),
        }
        total_retidas = sum(retidas.values())
        terminadas = total_retidas + transferidas
        respostas = sum(r["mensagens"] for r in resumos)
        # Lacuna: a resposta disse que não tinha a informação ou não achou a aula (agente/lacunas.py).
        com_lacuna = sum(
            1 for sessao in sessoes for run in (sessao.runs or [])
            if {"sem_informacao", "aula_nao_encontrada"} & set(lacunas.sinais(run)[0]))
        # Duração das que terminaram com o contato conversando: do início à última mensagem.
        duracoes_conversa = sorted(
            (_ultima_atividade(sessao) - sessao.created_at) / 60 for sessao, r in zip(sessoes, resumos)
            if r["status"] != STATUS_EM_ATENDIMENTO and sessao.created_at and _ultima_atividade(sessao))
        tempos = [r["duracao_media_s"] for r in resumos if r["duracao_media_s"]]
        # Tempo de cada resposta (não a média por conversa), para a média e o p90 da Visão geral.
        duracoes_resposta = sorted(
            run.metrics.duration for sessao in sessoes for run in (sessao.runs or []) if run.metrics and run.metrics.duration)
        ferramentas, consulta, respostas_com_consulta = _uso_de_ferramentas(sessoes, resumos)
        tokens_entrada = sum(r["tokens_entrada"] for r in resumos)
        tokens_saida = sum(r["tokens_saida"] for r in resumos)
        preco_entrada = float(os.getenv("PRECO_ENTRADA_REAIS_MILHAO", "0") or 0)
        preco_saida = float(os.getenv("PRECO_SAIDA_REAIS_MILHAO", "0") or 0)
        custo = (tokens_entrada * preco_entrada + tokens_saida * preco_saida) / 1_000_000 if preco_entrada or preco_saida else None
        def taxa(parte: int, base: int) -> float | None:
            return round(parte / base, 4) if base else None

        return {
            "conversas": len(resumos) + len(sem_sessao),
            "com_resposta": len(resumos),
            "terminadas": terminadas,
            "em_andamento": por_status.get(STATUS_EM_ATENDIMENTO, 0),
            "transferidas": transferidas,
            "retidas": total_retidas,
            "retidas_detalhe": retidas,
            "retencao_pct": taxa(total_retidas, terminadas),
            "transferencia_pct": taxa(transferidas, terminadas),
            "resolucao_confirmada_pct": taxa(retidas["encerradas_pelo_agente"], terminadas),
            "respostas": respostas,
            "mensagens_por_conversa": round(respostas / len(resumos), 2) if resumos else None,
            "respostas_com_lacuna": com_lacuna,
            "lacuna_pct": taxa(com_lacuna, respostas),
            "tempo_modelo_s": round(sum(tempos) / len(tempos), 2) if tempos else None,
            "duracao_mediana_min": round(duracoes_conversa[len(duracoes_conversa) // 2], 1) if duracoes_conversa else None,
            "tokens_entrada": tokens_entrada,
            "tokens_saida": tokens_saida,
            "custo_reais": round(custo, 2) if custo is not None else None,
            "custo_por_conversa": round(custo / len(resumos), 4) if custo is not None and resumos else None,
            "custo_por_retida": round(custo / total_retidas, 4) if custo is not None and total_retidas else None,
            # Em andamento, separado: boas-vindas ainda no prazo (o contato não escreveu) e conversas abertas.
            "aguardando_boas_vindas": sum(r["status"] == STATUS_EM_ATENDIMENTO for r in sem_sessao),
            "abertas": sum(r["status"] == STATUS_EM_ATENDIMENTO for r in resumos),
            "tempo_resposta_p90_s": (
                round(duracoes_resposta[min(len(duracoes_resposta) - 1, int(len(duracoes_resposta) * 0.9))], 2)
                if duracoes_resposta else None),
            "respostas_com_consulta": respostas_com_consulta,
            "ferramentas": ferramentas,
            "consulta": consulta,
            "_resumos": resumos,
        }

    def _desfecho(r: dict) -> str:
        """Como a conversa terminou, nas palavras da Visão geral."""
        if r["status"] == STATUS_TRANSFERIDO:
            return "transferido"
        if r["status"] == STATUS_ENCERRADO:
            return "resolvido" if r["fim"] == "encerramento" else "parou"
        return "aberta"

    def _uso_de_ferramentas(sessoes: list, resumos: list[dict]) -> tuple[list[dict], dict, int]:
        """As consultas que o agente fez (sem transferir e encerrar, que são desfechos): por ferramenta, com
        quantas conversas a usaram e como elas terminaram; e as conversas com e sem alguma consulta."""
        desfechos = ("resolvido", "parou", "transferido", "aberta")
        por_ferramenta: dict[str, dict] = {}
        grupos = {"com": Counter(), "sem": Counter()}
        respostas_com_consulta = 0
        for sessao, r in zip(sessoes, resumos):
            usadas: set[str] = set()
            for run in sessao.runs or []:
                consultas = [f for f in (run.tools or []) if getattr(f, "tool_name", None)
                             and f.tool_name not in FERRAMENTAS_DE_DESFECHO]
                respostas_com_consulta += bool(consultas)
                for f in consultas:
                    item = por_ferramenta.setdefault(f.tool_name, {"ferramenta": f.tool_name, "chamadas": 0, "erros": 0,
                                                                   "_duracoes": [], "conversas": 0, **dict.fromkeys(desfechos, 0)})
                    item["chamadas"] += 1
                    item["erros"] += bool(getattr(f, "tool_call_error", False))
                    duracao = getattr(getattr(f, "metrics", None), "duration", None)
                    if duracao:
                        item["_duracoes"].append(duracao)
                    usadas.add(f.tool_name)
            desfecho = _desfecho(r)
            for nome in usadas:
                por_ferramenta[nome]["conversas"] += 1
                por_ferramenta[nome][desfecho] += 1
            grupo = grupos["com" if usadas else "sem"]
            grupo["conversas"] += 1
            grupo[desfecho] += 1
        lista = []
        for item in sorted(por_ferramenta.values(), key=lambda i: i["chamadas"], reverse=True):
            duracoes = item.pop("_duracoes")
            lista.append({**item, "duracao_media_s": round(sum(duracoes) / len(duracoes), 2) if duracoes else None})
        consulta = {nome: {"conversas": g["conversas"], **{d: g[d] for d in desfechos}} for nome, g in grupos.items()}
        return lista, consulta, respostas_com_consulta

    avisos_views: list[int] = []

    def _das_views(escolhidos: list[Agent], inicio: datetime, inicio_anterior: datetime) -> dict | None:
        """Os números da Visão geral lidos das views do banco (agente_metricas.vw_atendimentos e
        vw_ferramentas_conversa, views de métricas do projeto base, que o GestorGov ainda não tem): a mesma régua que o
        BI lê. None quando não dá para ler (SQLite local, migration ainda não aplicada ou
        sem permissão): quem chama fica com o cálculo do servidor."""
        from sqlalchemy import text

        engine = agente.db.db_engine
        if engine.dialect.name != "postgresql":
            return None
        ids = {um.id for um in escolhidos}
        # Conversa de equipe é do agente padrão dela (o mesmo critério de _so_boas_vindas).
        ids |= {eid for eid, equipe in equipes.EQUIPES.items() if equipes.padrao(equipe) in ids}
        limites = {"ini_ant": inicio_anterior.replace(tzinfo=None), "ini": inicio.replace(tzinfo=None),
                   "fim": datetime.now(FUSO_BR).replace(tzinfo=None), "ids": sorted(ids)}
        try:
            with engine.connect() as conexao:
                linhas = conexao.execute(text("""
                    select atendimento_id, conversou, desfecho, aguardando_boas_vindas, categoria_transferencia,
                           motivo_transferencia, respostas, respostas_com_consulta, dia, hora, iniciada_em >= :ini as atual
                    from agente_metricas.vw_atendimentos
                    where iniciada_em >= :ini_ant and iniciada_em < :fim and agente = any(:ids)"""), limites).mappings().all()
                ferramentas = conexao.execute(text("""
                    select f.session_id, f.ferramenta, f.chamadas, f.erros, f.duracao_media_s
                    from agente_metricas.vw_ferramentas_conversa f
                    join agente_metricas.vw_atendimentos a on a.atendimento_id = f.session_id
                    where a.iniciada_em >= :ini and a.iniciada_em < :fim and a.agente = any(:ids)"""), limites).mappings().all()
                tempos = conexao.execute(text("""
                    select criada_em >= :ini as atual, avg(duracao_s) as media,
                           percentile_cont(0.9) within group (order by duracao_s) as p90
                    from agente_metricas.vw_execucoes
                    where not eh_teste and criada_em >= :ini_ant and criada_em < :fim and agente = any(:ids)
                    group by 1"""), limites).mappings().all()
        except Exception as erro:  # sem a migration, sem permissão ou banco fora do ar: o servidor calcula
            if not avisos_views:  # uma vez por processo: a tela pede de novo a cada minuto
                avisos_views.append(1)
                log_warning(f"Visão geral: views de agente_metricas indisponíveis, usando o cálculo do servidor ({erro})")
            return None

        def medir(rows: list) -> dict:
            conta = Counter(r["desfecho"] for r in rows)
            resolvido, parou, sem_resposta, transferido = (conta[d] for d in ("resolvido", "parou", "sem_resposta", "transferido"))
            retidas = resolvido + parou + sem_resposta
            terminadas = retidas + transferido

            def taxa(parte: int, base: int) -> float | None:
                return round(parte / base, 4) if base else None

            return {
                "conversas": len(rows),
                "com_resposta": sum(bool(r["conversou"]) for r in rows),
                "terminadas": terminadas,
                "em_andamento": conta["em_andamento"],
                "transferidas": transferido,
                "retidas": retidas,
                "retidas_detalhe": {"encerradas_pelo_agente": resolvido, "inatividade": parou, "sem_resposta": sem_resposta},
                "retencao_pct": taxa(retidas, terminadas),
                "transferencia_pct": taxa(transferido, terminadas),
                "resolucao_confirmada_pct": taxa(resolvido, terminadas),
                "aguardando_boas_vindas": sum(bool(r["aguardando_boas_vindas"]) for r in rows),
                "abertas": sum(r["conversou"] and r["desfecho"] == "em_andamento" for r in rows),
                "respostas": sum(int(r["respostas"] or 0) for r in rows),
                "respostas_com_consulta": sum(int(r["respostas_com_consulta"] or 0) for r in rows),
            }

        atuais = [r for r in linhas if r["atual"]]
        atual, anterior = medir(atuais), medir([r for r in linhas if not r["atual"]])
        for t in tempos:
            alvo = atual if t["atual"] else anterior
            alvo["tempo_modelo_s"] = round(float(t["media"]), 2) if t["media"] is not None else None
            alvo["tempo_resposta_p90_s"] = round(float(t["p90"]), 2) if t["p90"] is not None else None

        # Ferramentas: por ferramenta, com o desfecho das conversas que a usaram; e conversas com e sem consulta.
        nomes_desfecho = {"resolvido": "resolvido", "parou": "parou", "transferido": "transferido", "em_andamento": "aberta"}
        desfecho = {r["atendimento_id"]: nomes_desfecho.get(r["desfecho"]) for r in atuais if r["conversou"]}
        por_ferramenta: dict[str, dict] = {}
        com_consulta: set[str] = set()
        for f in ferramentas:
            item = por_ferramenta.setdefault(f["ferramenta"], {"ferramenta": f["ferramenta"], "chamadas": 0, "erros": 0, "conversas": 0,
                                                               "resolvido": 0, "parou": 0, "transferido": 0, "aberta": 0, "_dur": []})
            item["chamadas"] += int(f["chamadas"])
            item["erros"] += int(f["erros"])
            item["conversas"] += 1
            if f["duracao_media_s"] is not None:
                item["_dur"].append((float(f["duracao_media_s"]), int(f["chamadas"])))
            if desfecho.get(f["session_id"]):
                item[desfecho[f["session_id"]]] += 1
            com_consulta.add(f["session_id"])
        lista = []
        for item in sorted(por_ferramenta.values(), key=lambda i: i["chamadas"], reverse=True):
            dur = item.pop("_dur")
            peso = sum(n for _, n in dur)
            lista.append({**item, "duracao_media_s": round(sum(d * n for d, n in dur) / peso, 2) if peso else None})
        grupos = {"com": Counter(), "sem": Counter()}
        for aid, d in desfecho.items():
            g = grupos["com" if aid in com_consulta else "sem"]
            g["conversas"] += 1
            g[d] += 1
        atual["ferramentas"] = lista
        atual["consulta"] = {k: {"conversas": g["conversas"], **{d: g[d] for d in ("resolvido", "parou", "transferido", "aberta")}}
                             for k, g in grupos.items()}

        # Série por dia (todos os dias do período, inclusive os vazios), hora do dia e transferências.
        vazio = {"total": 0, "transferidas": 0, "retidas": 0, "em_andamento": 0,
                 "encerradas_pelo_agente": 0, "inatividade": 0, "sem_resposta": 0}
        chave_serie = {"transferido": "transferidas", "em_andamento": "em_andamento", "resolvido": "encerradas_pelo_agente",
                       "parou": "inatividade", "sem_resposta": "sem_resposta"}
        serie = defaultdict(lambda: dict(vazio))
        for r in atuais:
            dia = r["dia"].isoformat()
            serie[dia]["total"] += 1
            serie[dia][chave_serie[r["desfecho"]]] += 1
            if r["desfecho"] in ("resolvido", "parou", "sem_resposta"):
                serie[dia]["retidas"] += 1
        dias = (datetime.now(FUSO_BR).date() - inicio.date()).days + 1
        rotulos = perfis.todas_as_categorias()
        transferencias = [r for r in atuais if r["desfecho"] == "transferido"]
        por_hora = Counter(int(r["hora"]) for r in atuais if r["conversou"] and r["hora"] is not None)
        return {
            "atual": atual,
            "anterior": anterior,
            "serie": [{"dia": (inicio + timedelta(days=i)).date().isoformat(),
                       **serie.get((inicio + timedelta(days=i)).date().isoformat(), vazio)} for i in range(dias)],
            "por_hora": [por_hora.get(h, 0) for h in range(24)],
            "categorias": [{"categoria": c, "rotulo": rotulos.get(c, c), "total": n}
                           for c, n in Counter(r["categoria_transferencia"] or "outro" for r in transferencias).most_common()],
            "transferencias": [{"id": r["atendimento_id"], "categoria": r["categoria_transferencia"] or "outro",
                                "rotulo": rotulos.get(r["categoria_transferencia"] or "outro", "Outro assunto"),
                                "motivo": r["motivo_transferencia"] or ""} for r in transferencias][:1000],
        }

    def _agora(escolhidos: list[Agent]) -> dict:
        """A situação neste momento, com a MESMA régua da barra da Central ao vivo (pages/central.tsx):
        atendendo agora = conversa aberta com mensagem nos últimos 15 min (quem está na mesa do escritório);
        o resto do que está aberto é espera pelo contato: conversas abertas paradas (e as que passaram do prazo
        de inatividade, que a rotina já deveria ter encerrado) e boas-vindas ainda sem resposta."""
        agora = time.time()
        abertas = [s for s in _sessoes_de(escolhidos, limite=2000)
                   if not s.session_id.startswith("painel-")
                   and ((s.session_data or {}).get("session_state") or {}).get("status", STATUS_EM_ATENDIMENTO) == STATUS_EM_ATENDIMENTO]
        faixas = Counter()
        for sessao in abertas:
            parada = agora - (_ultima_atividade(sessao) or agora)
            prazo = perfis.obter(getattr(sessao, "agent_id", None) or perfis.PADRAO).minutos_inatividade * 60
            faixas["atendendo" if parada <= SEGUNDOS_ATENDENDO_AGORA else "fora_do_prazo" if parada > prazo else "paradas"] += 1
        recentes = _so_boas_vindas(escolhidos, datetime.now(FUSO_BR) - timedelta(days=DIAS_SO_BOAS_VINDAS))
        return {
            "atendendo_agora": faixas["atendendo"],
            "abertas_paradas": faixas["paradas"] + faixas["fora_do_prazo"],
            "abertas_fora_do_prazo": faixas["fora_do_prazo"],
            "aguardando_boas_vindas": sum(r["status"] == STATUS_EM_ATENDIMENTO for r in recentes),
        }

    def _qualidade(escolhidos: list[Agent], inicio: datetime) -> dict:
        """Avaliações da equipe (Calibração), bloqueios do guardrail e as avaliações automáticas diárias."""
        from sqlalchemy import MetaData, Table, inspect

        from agente.agente import schema_banco

        engine, schema = agente.db.db_engine, schema_banco()
        existentes = set(inspect(engine).get_table_names(schema=schema))
        ids = [um.id for um in escolhidos]
        saida = {"avaliadas": 0, "positivas": 0, "negativas": 0, "aprovacao_pct": None, "guardrail": 0,
                 "nota_automatica": None, "nota_automatica_serie": [], "confiabilidade_pct": None}
        metadados = MetaData(schema=schema)
        with engine.connect() as conexao:
            if "avaliacoes_humanas" in existentes:
                avaliacoes = Table("avaliacoes_humanas", metadados, autoload_with=engine)
                for origem, nota, n in conexao.execute(
                        select(avaliacoes.c.origem, avaliacoes.c.nota, func.count()).where(
                            avaliacoes.c.criada_em >= inicio, avaliacoes.c.agente.in_(ids))
                        .group_by(avaliacoes.c.origem, avaliacoes.c.nota)).all():
                    if origem == datasets.ORIGEM_GUARDRAIL:
                        saida["guardrail"] += n
                    elif nota == 1:
                        saida["positivas"] += n
                    elif nota == -1:
                        saida["negativas"] += n
                saida["avaliadas"] = saida["positivas"] + saida["negativas"]
                if saida["avaliadas"]:
                    saida["aprovacao_pct"] = round(saida["positivas"] / saida["avaliadas"], 4)
            tabela_evals = getattr(agente.db, "eval_table_name", None) or "agno_eval_runs"
            if tabela_evals in existentes:
                evals = Table(tabela_evals, metadados, autoload_with=engine)
                linhas = conexao.execute(select(evals.c.eval_type, evals.c.eval_data, evals.c.created_at).where(
                    evals.c.agent_id.in_(ids), evals.c.created_at >= int(inicio.timestamp()))).all()
                notas_por_dia: dict[str, list[float]] = defaultdict(list)
                confiabilidade_por_dia: dict[str, list[bool]] = defaultdict(list)
                for tipo, dados, criado in linhas:
                    dados = dados if isinstance(dados, dict) else json.loads(dados or "{}")
                    dia = datetime.fromtimestamp(criado, tz=FUSO_BR).date().isoformat()
                    if tipo == "accuracy" and dados.get("avg_score") is not None:
                        notas_por_dia[dia].append(float(dados["avg_score"]))
                    elif tipo == "reliability" and dados.get("eval_status"):
                        confiabilidade_por_dia[dia].append(dados["eval_status"] == "PASSED")
                serie = [{"dia": d, "nota": round(sum(v) / len(v), 2)} for d, v in sorted(notas_por_dia.items())]
                saida["nota_automatica_serie"] = serie
                saida["nota_automatica"] = serie[-1]["nota"] if serie else None
                if confiabilidade_por_dia:
                    ultimo = confiabilidade_por_dia[max(confiabilidade_por_dia)]
                    saida["confiabilidade_pct"] = round(sum(ultimo) / len(ultimo), 4)
        return saida

    @rotas.get("/indicadores", dependencies=protegido)
    def indicadores(
        dias: int = Query(default=30, ge=1, le=365),
        agente_id: str | None = Query(default=None, max_length=60, alias="agente"),
        area: str | None = Query(default=None, max_length=80),
    ) -> dict:
        """Sem filtro, soma todos os agentes; ?area= só os daquela área; ?agente= só aquele. Junto, os mesmos
        números do período anterior de mesmo tamanho, para a variação."""
        agora = datetime.now(FUSO_BR)
        inicio = (agora - timedelta(days=dias - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        inicio_anterior = inicio - timedelta(days=dias)
        escolhidos = _escolhidos(agente_id, area)
        # Só atendimento real: as conversas do Chat de teste do painel (painel-*) ficam de fora, como nas views do
        # banco (eh_teste) e no Supervisor. Senão a Visão geral e as outras contagens não batem.
        sessoes = [s for s in _sessoes_de(escolhidos, int(inicio_anterior.timestamp()), limite=10000)
                   if not s.session_id.startswith("painel-")]
        sem_sessao = _so_boas_vindas(escolhidos, inicio_anterior)
        corte, corte_iso = inicio.timestamp(), inicio.isoformat()
        atual = _medir([s for s in sessoes if (s.created_at or 0) >= corte], [r for r in sem_sessao if r["criada_em"] >= corte_iso])
        anterior = _medir([s for s in sessoes if (s.created_at or 0) < corte], [r for r in sem_sessao if r["criada_em"] < corte_iso])
        resumos = atual.pop("_resumos")
        anterior.pop("_resumos")
        todas = [*resumos, *[r for r in sem_sessao if r["criada_em"] >= corte_iso]]

        # "retidas" segue somando as três formas de retenção; as três também vêm separadas.
        vazio = {"total": 0, "transferidas": 0, "retidas": 0, "em_andamento": 0,
                 "encerradas_pelo_agente": 0, "inatividade": 0, "sem_resposta": 0}
        serie = defaultdict(lambda: dict(vazio))
        for r in todas:
            dia = r["criada_em"][:10] if r["criada_em"] else None
            if not dia:
                continue
            serie[dia]["total"] += 1
            chave = ("transferidas" if r["status"] == STATUS_TRANSFERIDO else
                     "em_andamento" if r["status"] == STATUS_EM_ATENDIMENTO else "retidas")
            serie[dia][chave] += 1
            if chave == "retidas":
                serie[dia]["sem_resposta" if r["status"] == STATUS_SEM_RESPOSTA else
                           "encerradas_pelo_agente" if r["fim"] == "encerramento" else "inatividade"] += 1
        dias_serie = []
        for i in range(dias):
            dia = (inicio + timedelta(days=i)).date().isoformat()
            dias_serie.append({"dia": dia, **serie.get(dia, vazio)})

        categorias = Counter(r["categoria"] or "outro" for r in resumos if r["status"] == STATUS_TRANSFERIDO)
        # Hora (Brasília) em que o contato abriu a conversa com o agente (criada_em já vem no fuso de Brasília).
        por_hora = Counter(int(r["criada_em"][11:13]) for r in resumos if r["criada_em"])
        # Com a migration de agente_metricas aplicada, a régua vem das views do banco (a mesma do BI);
        # sem ela, fica o cálculo acima. O que as views não cobrem (lacunas, custo, duração da
        # conversa) segue do cálculo do servidor.
        das_views = _das_views(escolhidos, inicio, inicio_anterior)
        fonte = "servidor"
        if das_views:
            fonte = "views"
            atual.update(das_views["atual"])
            anterior.update(das_views["anterior"])
            dias_serie = das_views["serie"]
            por_hora = Counter(dict(enumerate(das_views["por_hora"])))
        return {
            "periodo": {"inicio": inicio.date().isoformat(), "fim": agora.date().isoformat(), "dias": dias},
            "fonte": fonte,
            "totais": {
                **atual,
                # Fora do total: o agente nem soube do contato (o aviso de entrada da Unnichat não chegou).
                "nao_chegaram": len(_nao_chegaram(escolhidos, inicio)),
                "custo_configurado": atual["custo_reais"] is not None,
            },
            "anterior": anterior,
            "qualidade": _qualidade(escolhidos, inicio),
            "serie": dias_serie,
            "categorias": das_views["categorias"] if das_views else [
                {"categoria": c, "rotulo": perfis.todas_as_categorias().get(c, c), "total": n}
                for c, n in categorias.most_common()
            ],
            "origens": [{"origem": o, "total": n} for o, n in Counter(r["origem"] for r in todas).most_common()],
            "ultimas_transferencias": [r for r in resumos if r["status"] == STATUS_TRANSFERIDO][:8],
            # Todas as transferências do período, com o motivo escrito pelo agente: a Visão geral as agrupa por tema.
            "transferencias": das_views["transferencias"] if das_views else [
                {"id": r["id"], "categoria": r["categoria"] or "outro", "rotulo": r["categoria_rotulo"] or "Outro assunto",
                 "motivo": r["motivo"] or ""}
                for r in resumos if r["status"] == STATUS_TRANSFERIDO
            ][:1000],
            "por_hora": [por_hora.get(h, 0) for h in range(24)],
            "agora": _agora(escolhidos),
        }

    @rotas.get("/indicadores/por-hora", dependencies=protegido)
    def por_hora(
        horas: int = Query(default=24, ge=1, le=HORAS_MAX_CENTRAL),
        desde: int | None = Query(default=None, ge=0, description="Início do período (epoch, s). Sem ele, as últimas `horas`."),
        ate: int | None = Query(default=None, ge=0, description="Fim do período (epoch, s), com `desde`."),
    ) -> dict:
        """Quando os contatos conversam, hora a hora (Brasília), no mesmo período da Central (`horas`, ou
        `desde`/`ate`). Conta contatos de verdade: quem mandou ao menos uma mensagem ao agente no período (pelo
        contato, então o contato com duas conversas conta uma vez). Em cada hora, os contatos diferentes que
        escreveram nela; `total_contatos` é o número de contatos diferentes no período inteiro (não a soma das
        horas, porque o mesmo contato pode escrever em várias). Conversas de teste (painel-*) ficam de fora."""
        inicio, fim = _periodo_central(horas, desde, ate)
        sessoes = [s for s in _sessoes_de(_escolhidos(None, None), inicio, LIMITE_CENTRAL * 4, fim, por_atividade=True)
                   if not s.session_id.startswith("painel-")]
        por_hora_contatos: dict[int, set] = {h: set() for h in range(24)}
        mensagens: Counter = Counter()
        todos: set = set()
        for sessao in sessoes:
            contato = sessao.user_id or sessao.session_id
            for run in sessao.runs or []:
                if _no_periodo(run.created_at, inicio, fim):
                    hora = datetime.fromtimestamp(run.created_at, tz=FUSO_BR).hour
                    por_hora_contatos[hora].add(contato)
                    mensagens[hora] += 1
                    todos.add(contato)
        return {
            "desde": inicio,
            "ate": fim,
            "total_contatos": len(todos),
            "total_mensagens": sum(mensagens.values()),
            "contatos": [len(por_hora_contatos[h]) for h in range(24)],
            "mensagens": [mensagens.get(h, 0) for h in range(24)],
        }

    # O link da gestão (sem login): as mesmas contas da Visão geral, só agregadas. Sem `protegido`: quem guarda é o
    # código do link. Um minuto de cache por consulta, para o link aberto em várias telas não pesar no banco.
    cache_gestao: dict[str, tuple[float, dict]] = {}
    trava_gestao = threading.Lock()

    def _da_cache_gestao(chave: str, calcular) -> dict:
        with trava_gestao:
            guardado = cache_gestao.get(chave)
            if guardado and time.time() - guardado[0] < 60:
                return guardado[1]
        valor = calcular()
        with trava_gestao:
            if len(cache_gestao) > 200:
                cache_gestao.clear()
            cache_gestao[chave] = (time.time(), valor)
        return valor

    @rotas.get("/gestao-link")
    def gestao_link(_quem: str = Depends(exigir("gerenciar_usuarios"))) -> dict:
        """O caminho do link da gestão, para copiar no painel. Só para quem gerencia usuários."""
        codigo = os.getenv("PAINEL_LINK_GESTAO", "").strip()
        ativo = len(codigo) >= TAMANHO_MINIMO_CODIGO_GESTAO
        return {"ativo": ativo, "caminho": f"/painel/gestao/{codigo}" if ativo else None}

    @rotas.get("/gestao/{codigo}/indicadores")
    def gestao_indicadores(codigo: str, dias: int = Query(default=30, ge=1, le=90)) -> dict:
        """A Visão geral do link da gestão: só números agregados (ver so_agregados)."""
        conferir_link_gestao(codigo)
        return _da_cache_gestao(f"indicadores:{dias}", lambda: so_agregados(indicadores(dias=dias, agente_id=None, area=None)))

    @rotas.get("/gestao/{codigo}/por-hora")
    def gestao_por_hora(
        codigo: str,
        horas: int = Query(default=24, ge=1, le=HORAS_MAX_CENTRAL),
        desde: int | None = Query(default=None, ge=0),
        ate: int | None = Query(default=None, ge=0),
    ) -> dict:
        """Quando os contatos conversam, no link da gestão: só contagens por hora."""
        conferir_link_gestao(codigo)
        # O período "até agora" anda com o relógio: a chave usa o minuto, para a cache não congelar o número.
        chave = f"por-hora:{horas}:{desde}:{ate}:{int(time.time() // 60) if desde is None else ''}"
        return _da_cache_gestao(chave, lambda: por_hora(horas=horas, desde=desde, ate=ate))

    def _so_boas_vindas(escolhidos: list[Agent] | None, inicio: datetime | None = None,
                        session_id: str | None = None) -> list[dict]:
        """Conversas da Unnichat em que o contato recebeu as boas-vindas e nunca respondeu (desde `inicio`, ou só
        a de `session_id`): não têm sessão do agente (ela nasce na primeira resposta), então ficam fora de
        _sessoes_de. Passado o prazo de inatividade do agente, contam como sem resposta; antes, como em
        atendimento. Uma por contato (unnichat_conversas guarda a conversa vigente de cada um). No formato de
        _resumo, com so_boas_vindas e, para a ficha do contato, contato_id e telefone."""
        from sqlalchemy import MetaData, Table, exists, inspect

        from agente.agente import schema_banco

        engine, schema = agente.db.db_engine, schema_banco()
        tabela_sessoes = getattr(agente.db, "session_table_name", None) or "agno_sessions"
        if not {"unnichat_conversas", tabela_sessoes} <= set(inspect(engine).get_table_names(schema=schema)):
            return []
        metadados = MetaData(schema=schema)
        conversas = Table("unnichat_conversas", metadados, autoload_with=engine)
        sessoes = Table(tabela_sessoes, metadados, autoload_with=engine)
        filtros = [conversas.c.onboarding_em.isnot(None), ~exists().where(sessoes.c.session_id == conversas.c.session_id)]
        if inicio is not None:
            filtros.append(conversas.c.iniciada_em >= inicio)
        if session_id is not None:
            filtros.append(conversas.c.session_id == session_id)
        with engine.connect() as conexao:
            linhas = conexao.execute(select(conversas).where(*filtros)).mappings().all()
        ids = None if escolhidos is None else {um.id for um in escolhidos}
        agora = datetime.now(timezone.utc)
        saida = []
        for linha in linhas:
            # Conversa de equipe conta para o agente que recebe a saudação (o padrão da equipe).
            quem = equipes.padrao(equipes.EQUIPES[linha["agente"]]) if linha["agente"] in equipes.EQUIPES else (linha["agente"] or perfis.PADRAO)
            if ids is not None and quem not in ids:
                continue
            iniciada = linha["iniciada_em"] if linha["iniciada_em"].tzinfo else linha["iniciada_em"].replace(tzinfo=timezone.utc)
            prazo = timedelta(minutes=perfis.obter(quem).minutos_inatividade)
            quando = iniciada.astimezone(FUSO_BR).isoformat()
            saida.append({
                "id": linha["session_id"], "agente": quem, "area": perfis.identidade(quem)["area"],
                "origem": _origem(linha["session_id"]), "nome": linha["nome"] or "",
                "status": STATUS_SEM_RESPOSTA if agora - iniciada >= prazo else STATUS_EM_ATENDIMENTO,
                "fim": None, "criada_em": quando, "atualizada_em": quando, "mensagens": 0,
                "ultima_mensagem": "", "ultima_resposta": "", "categoria": None, "categoria_rotulo": None,
                "motivo": None, "tokens_entrada": 0, "tokens_saida": 0, "duracao_media_s": None,
                "so_boas_vindas": True, "equipe": linha["agente"] if linha["agente"] in equipes.EQUIPES else None,
                "contato_id": linha["contato_id"], "telefone": linha["telefone"] or "",
            })
        return saida

    def _nao_chegaram(escolhidos: list[Agent] | None, inicio: datetime) -> list[dict]:
        """Do canal WhatsApp do projeto base (entradas que não chegaram ao servidor). O GestorGov ainda não tem
        canal com o cidadão: nada a conferir."""
        return []

    def _sem_sessao(session_id: str) -> dict:
        """Uma conversa sem sessão do agente: só de boas-vindas ou de quem o aviso não chegou. 404 se não há."""
        if session_id.startswith(PREFIXO_NAO_CHEGOU):
            achadas = [r for r in _nao_chegaram(None, datetime.now(FUSO_BR) - timedelta(days=DIAS_SO_BOAS_VINDAS))
                       if r["id"] == session_id]
        else:
            achadas = _so_boas_vindas(None, session_id=session_id)
        if not achadas:
            raise HTTPException(status_code=404, detail="Conversa não encontrada.")
        return achadas[0]

    @rotas.get("/conversas", dependencies=protegido)
    def conversas(
        status: str | None = Query(default=None),
        busca: str | None = Query(default=None, max_length=120),
        origem: str | None = Query(default=None, max_length=40),
        agente_id: str | None = Query(default=None, max_length=60, alias="agente"),
        area: str | None = Query(default=None, max_length=80),
        limite: int = Query(default=200, ge=1, le=1000),
    ) -> dict:
        # Sem filtro, as conversas de todos os agentes; ?area= ou ?agente= filtram no servidor (antes do limite).
        escolhidos = _escolhidos(agente_id, area)
        resumos = [_resumo(s) for s in _sessoes_de(escolhidos, limite=limite)]
        # E as só de boas-vindas (o contato ainda não respondeu) dos últimos dias, sem o contato e o telefone.
        # E quem entrou com o agente na Unnichat e o aviso não chegou ao servidor (agente/conferencia.py).
        recentes = datetime.now(FUSO_BR) - timedelta(days=DIAS_SO_BOAS_VINDAS)
        resumos += [{k: v for k, v in r.items() if k not in ("contato_id", "telefone")}
                    for r in [*_so_boas_vindas(escolhidos, recentes), *_nao_chegaram(escolhidos, recentes)]]
        resumos = sorted(resumos, key=lambda r: r["atualizada_em"] or "", reverse=True)[:limite]
        if origem:
            resumos = [r for r in resumos if r["origem"].lower() == origem.lower()]
        if status:
            resumos = [r for r in resumos if r["status"] == status]
        if busca:
            termo = busca.lower()
            resumos = [
                r for r in resumos
                if termo in " ".join(
                    str(r[k] or "") for k in ("id", "nome", "ultima_mensagem", "ultima_resposta", "motivo")
                ).lower()
            ]
        return {"conversas": resumos, "total": len(resumos)}

    @rotas.get("/conversas/{session_id}", dependencies=protegido)
    def conversa(session_id: str) -> dict:
        sessao = _sessao(agente.db, session_id)
        if sessao is None:
            # Só as boas-vindas, ou o aviso de entrada nem chegou: o que houve está na conversa do WhatsApp
            # (ficha do contato).
            resumo = {k: v for k, v in _sem_sessao(session_id).items() if k != "contato_id"}
            return {**resumo, "itens": [], "acoes": []}
        estado = (sessao.session_data or {}).get("session_state") or {}
        itens = []
        for run in sessao.runs or []:
            quando = _iso(run.created_at)
            itens.append({"papel": "contato", "texto": _texto_entrada(run), "quando": quando,
                          "anexos": _anexos_da_mensagem(run)})
            itens.append({
                "papel": "agente",
                "agente": getattr(run, "agent_id", None),  # numa equipe, quem respondeu esta mensagem
                "run_id": run.run_id,
                # Exemplos aprovados e trechos de documentos que entraram nesta resposta.
                "calibracao": (run.metadata or {}).get("calibracao") if getattr(run, "metadata", None) else None,
                "texto": run.content or "",
                "quando": quando,
                "ferramentas": [
                    {"nome": t.tool_name, "argumentos": t.tool_args} for t in (run.tools or [])
                ],
                "duracao_s": round(run.metrics.duration, 2) if run.metrics and run.metrics.duration else None,
                "tokens": (run.metrics.input_tokens or 0) + (run.metrics.output_tokens or 0) if run.metrics else None,
            })
        return {**_resumo(sessao), "itens": itens, "acoes": estado.get("acoes") or [],
                "telefone": estado.get("telefone") or "", "equipe": getattr(sessao, "team_id", None)}

    @rotas.get("/conversas/{session_id}/rastreamento", dependencies=protegido)
    def rastreamento_da_conversa(session_id: str) -> dict:
        """Por que o agente respondeu o que respondeu: raciocínio, ferramentas, contexto e Learning (agente/rastreamento.py)."""
        from agente import rastreamento
        from agente.agente import schema_banco

        sessao = _sessao(agente.db, session_id)
        if sessao is None:
            raise HTTPException(status_code=404, detail="Conversa não encontrada.")
        return rastreamento.conversa(sessao, agente.db.db_engine, schema_banco())

    @rotas.get("/conversas/{session_id}/ficha", dependencies=protegido)
    def ficha_do_contato(session_id: str, atualizar: bool = Query(default=False)) -> dict:
        """O que o Unnichat (contato, tags, negócios, atendente, conversa inteira) sabe do contato da conversa:
        a coluna da direita em Conversas. Só leitura."""
        sessao = _sessao(agente.db, session_id)
        if sessao is None:
            sem = _sem_sessao(session_id)
            return ficha.montar(sem["contato_id"], sem["telefone"], atualizar)
        estado = (sessao.session_data or {}).get("session_state") or {}
        return ficha.montar(estado.get("unnichat_contato"), estado.get("telefone"), atualizar)

    async def _pedido_chat(
        mensagem: str, session_id: str | None, nome_contato: str, telefone: str, arquivos: list[UploadFile],
        agente_id: str = "",
    ) -> tuple:
        """Valida a mensagem do chat de teste e devolve os argumentos de `responder`. `agente_id`: com quem
        conversar, um agente ou uma equipe (vazio = o padrão); a conversa segue com quem a começou, mesmo
        sem repetir o id."""
        atendentes = {**agentes, **equipes.EQUIPES}
        if agente_id and agente_id not in atendentes:
            raise HTTPException(status_code=404, detail=f"Agente ou equipe desconhecida: {agente_id}. Existem: {', '.join(atendentes)}.")
        escolhido = atendentes.get(agente_id) or agente
        if not agente_id and session_id:
            # Conversa em andamento: segue com quem a começou.
            escolhido = _da_sessao(session_id)
        anexos = []
        if len(arquivos) > MAX_ANEXOS:
            raise HTTPException(status_code=422, detail=f"Envie no máximo {MAX_ANEXOS} arquivos por mensagem.")
        for arquivo in arquivos:
            tipo = (arquivo.content_type or "").split(";")[0].strip().lower()
            if tipo not in TIPOS_ANEXO:
                raise HTTPException(status_code=422, detail=f"Tipo de arquivo não aceito: {arquivo.filename} ({tipo or 'desconhecido'}).")
            conteudo = await arquivo.read(MAX_BYTES_ANEXO + 1)
            if len(conteudo) > MAX_BYTES_ANEXO:
                raise HTTPException(status_code=422, detail=f"{arquivo.filename} passa de 10 MB.")
            anexos.append((arquivo.filename or "arquivo", tipo, conteudo))
        texto = mensagem.strip()
        if not texto and not anexos:
            raise HTTPException(status_code=422, detail="Escreva uma mensagem ou anexe um arquivo.")
        # Só arquivo, como acontece no WhatsApp: o agente recebe uma frase neutra junto.
        texto = texto or "(o contato enviou o anexo sem texto)"

        session_id = session_id or f"painel-{uuid.uuid4().hex[:12]}"
        nome = nome_contato.strip()
        # Cada contato simulado tem a própria memória: o mesmo nome em conversas diferentes = o mesmo
        # contato voltando (é assim que se testa a memória). Sem nome, a conversa é um contato avulso.
        user_id = f"painel:{nome.lower()}" if nome else session_id
        return escolhido, session_id, texto, nome, user_id, telefone.strip(), anexos

    @rotas.post("/chat", dependencies=[*protegido, Depends(exigir("usar_chat"))])
    async def chat(
        mensagem: str = Form(default="", max_length=2000),
        session_id: str | None = Form(default=None, max_length=120),
        nome_contato: str = Form(default="", max_length=120),
        telefone: str = Form(default="", max_length=30),
        arquivos: list[UploadFile] = File(default=[]),
        agente_id: str = Form(default="", max_length=60, alias="agente"),
    ) -> dict:
        argumentos = await _pedido_chat(mensagem, session_id, nome_contato, telefone, arquivos, agente_id)
        resultado = await run_in_threadpool(responder, *argumentos)
        return {"session_id": argumentos[1], **resultado}

    @rotas.post("/chat/etapas", dependencies=[*protegido, Depends(exigir("usar_chat"))])
    async def chat_etapas(
        mensagem: str = Form(default="", max_length=2000),
        session_id: str | None = Form(default=None, max_length=120),
        nome_contato: str = Form(default="", max_length=120),
        telefone: str = Form(default="", max_length=30),
        arquivos: list[UploadFile] = File(default=[]),
        agente_id: str = Form(default="", max_length=60, alias="agente"),
    ) -> StreamingResponse:
        """O mesmo que /chat, transmitido em linhas JSON enquanto o agente trabalha: cada etapa
        (contexto, modelo, ferramentas, memória), o texto à medida que é escrito e o resultado final."""
        argumentos = await _pedido_chat(mensagem, session_id, nome_contato, telefone, arquivos, agente_id)

        fila: queue.Queue = queue.Queue()

        def trabalhar() -> None:
            # Uma thread só do começo ao fim: o contexto do trace (agente/atendimento.py) não pode
            # mudar de thread entre um evento e outro, como aconteceria iterando direto na resposta.
            try:
                for evento in responder_em_etapas(*argumentos):
                    if evento["tipo"] == "fim":
                        evento = {**evento, "session_id": argumentos[1]}
                    fila.put(evento)
            except Exception as erro:
                log_warning(f"Chat de teste falhou: {type(erro).__name__}: {erro}")
                fila.put({"tipo": "erro", "mensagem": "O agente não conseguiu responder agora."})
            finally:
                fila.put(None)

        def linhas():
            yield json.dumps({"tipo": "inicio", "session_id": argumentos[1]}) + "\n"
            while (evento := fila.get()) is not None:
                yield json.dumps(evento, ensure_ascii=False, default=str) + "\n"

        threading.Thread(target=trabalhar, name=f"chat-{argumentos[1]}", daemon=True).start()
        # Gerador síncrono: o Starlette o lê numa thread do pool, sem travar o servidor.
        return StreamingResponse(
            linhas(),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @rotas.get("/central", dependencies=protegido)
    def central(
        horas: int = Query(default=24, ge=1, le=HORAS_MAX_CENTRAL),
        desde: int | None = Query(default=None, ge=0, description="Início do período (epoch, s). Sem ele, as últimas `horas`."),
        ate: int | None = Query(default=None, ge=0, description="Fim do período (epoch, s). Sem ele, até agora."),
        incluir_testes: bool = Query(default=False),
    ) -> dict:
        """A central de atendimento em 3D: cada agente com as conversas que tiveram atividade no período
        (quem está em atendimento ocupa uma mesa; as transferidas vão para a equipe humana). transferida_em e
        encerrada_em dizem quando: a Central conta as transferidas e encerradas do período por eles. Sem
        incluir_testes, as conversas do chat de teste do painel ficam de fora (como em alertas e acontecimentos)."""
        agora = time.time()
        inicio, fim = _periodo_central(horas, desde, ate)
        campos = ("id", "origem", "nome", "status", "fim", "criada_em", "atualizada_em", "mensagens", "ultima_mensagem",
                  "categoria_rotulo", "motivo", "duracao_media_s", "transferida_em", "encerrada_em")
        calibracao = datasets.resumo_por_agente(agente.db.db_engine, getattr(agente.db, "db_schema", None))
        saida = []
        publicados = [a for a in agentes.values() if perfis.publicado(a.id)]
        # As boas-vindas que ainda aguardam o contato contam como em atendimento, como em Conversas: as duas
        # telas mostram o mesmo número. As que passaram do prazo sem resposta já terminaram e não ocupam a mesa.
        # Só até agora: um período que já terminou não tem quem esteja aguardando. Uma busca para todos os
        # agentes (cada uma lê a estrutura das tabelas no banco), separada depois por agente.
        aguardando: dict[str, list[dict]] = defaultdict(list)
        if fim is None:
            for resumo in _so_boas_vindas(publicados, datetime.fromtimestamp(inicio, tz=FUSO_BR)):
                if resumo["status"] == STATUS_EM_ATENDIMENTO:
                    aguardando[resumo["agente"]].append(resumo)
        for um in publicados:
            conversas = []
            recentes = _sessoes(um, inicio, LIMITE_CENTRAL, fim, por_atividade=True)
            vistas = {s.session_id for s in recentes}
            # Até agora: também as em atendimento sem atividade no período (o contato sumiu e a rotina ainda não
            # encerrou). Conversas mostra todas as abertas, e as duas telas precisam bater.
            abertas_antes = [] if fim is not None else [
                s for s in _sessoes(um, None, LIMITE_CENTRAL, None, por_atividade=True) if s.session_id not in vistas
                and ((s.session_data or {}).get("session_state") or {}).get("status", STATUS_EM_ATENDIMENTO) == STATUS_EM_ATENDIMENTO]
            for sessao in [*recentes, *abertas_antes]:
                if sessao.session_id.startswith("painel-") and not incluir_testes:
                    continue
                resumo = _resumo(sessao)
                conversas.append({k: resumo[k] for k in campos} | {
                    # Segundos desde a última mensagem: perto de zero = conversando agora.
                    "parada_ha_s": round(agora - ultima) if (ultima := _ultima_atividade(sessao)) else None,
                    # A regra dos números da Central: transferida / encerrada dentro do período.
                    "transferida_no_periodo": _iso_no_periodo(resumo["transferida_em"], inicio, fim),
                    "encerrada_no_periodo": _iso_no_periodo(resumo["encerrada_em"], inicio, fim),
                })
            for resumo in aguardando.get(um.id, []):
                conversas.append({k: resumo.get(k) for k in campos} | {
                    "ultima_mensagem": "Boas-vindas enviadas, aguardando o contato",
                    "parada_ha_s": round(agora - datetime.fromisoformat(resumo["atualizada_em"]).timestamp()),
                    "transferida_no_periodo": False, "encerrada_no_periodo": False,
                })
            saida.append({
                "id": um.id,
                **perfis.identidade(um.id),  # nome, cargo e área: a Central agrupa as baias por área
                "funcao": um.name,
                "modelo": um.model.id if um.model else None,
                "minutos_inatividade": perfis.obter(um.id).minutos_inatividade,
                "conversas": conversas,
                "indicadores": _indicadores_da_mesa(conversas, calibracao.get(um.id, {})),
            })
        # As conversas de equipe já estão na mesa de quem está com elas; aqui, quem forma cada equipe.
        lista_equipes = [{"id": e["id"], "nome": e["nome"], "membros": e["membros"], "padrao": e["padrao"]}
                         for e in equipes.listar() if e["publicada"]]
        return {"horas": horas, "desde": inicio, "ate": fim, "agentes": saida, "equipes": lista_equipes}

    def _iso_no_periodo(texto: str | None, inicio: int, fim: int | None) -> bool:
        return bool(texto) and _no_periodo(datetime.fromisoformat(texto).timestamp(), inicio, fim)

    def _indicadores_da_mesa(conversas: list[dict], calibracao: dict) -> dict:
        """O que a mesa de cada agente mostra: agora, no período e a nota da Calibração. Transferidas: as
        transferidas dentro do período (a mesma regra dos números do topo da Central)."""
        total = len(conversas)
        transferidas = sum(bool(c.get("transferida_no_periodo")) for c in conversas)
        duracoes = [c["duracao_media_s"] for c in conversas if c.get("duracao_media_s")]
        return {
            "em_atendimento": sum(c["status"] == STATUS_EM_ATENDIMENTO for c in conversas),
            "conversando_agora": sum(c["parada_ha_s"] is not None and c["parada_ha_s"] <= 120 for c in conversas),
            "conversas": total,
            "transferencia_pct": round(transferidas / total, 3) if total else None,
            "tempo_medio_resposta_s": round(sum(duracoes) / len(duracoes), 2) if duracoes else None,
            "calibracao_avaliadas": calibracao.get("avaliadas", 0),
            "calibracao_aprovacao": calibracao.get("aprovacao"),
        }

    @rotas.get("/central/acontecimentos", dependencies=protegido)
    def acontecimentos(
        horas: int = Query(default=24, ge=1, le=HORAS_MAX_CENTRAL),
        desde: int | None = Query(default=None, ge=0, description="Início do período (epoch, s). Sem ele, as últimas `horas`."),
        ate: int | None = Query(default=None, ge=0, description="Fim do período (epoch, s). Sem ele, até agora."),
        incluir_testes: bool = Query(default=False),
        limite: int = Query(default=5000, ge=1, le=20000),
    ) -> dict:
        """O que os agentes fizeram no período, montado do que fica gravado (sobrevive a reinícios, ao
        contrário do feed): cada resposta, as ferramentas usadas, bloqueio do guardrail e falha, as
        transferências, os encerramentos e as boas-vindas do Unnichat. O mais novo primeiro, no formato dos
        eventos ao vivo. Os mesmos agentes e o mesmo período dos números da Central (/central): os
        encerramentos daqui são as encerradas de lá. Sem incluir_testes, as conversas do chat de teste do
        painel ficam de fora. `total` conta todos; `eventos` traz até `limite`."""
        inicio, fim = _periodo_central(horas, desde, ate)
        categorias = perfis.todas_as_categorias()
        lista: list[dict] = []
        vistas: set[str] = set()

        def no_periodo(momento: float | None) -> bool:
            return _no_periodo(momento, inicio, fim)

        for um in [a for a in agentes.values() if perfis.publicado(a.id)]:
            for sessao in _sessoes(um, inicio, LIMITE_CENTRAL, fim, por_atividade=True):
                if sessao.session_id in vistas or (sessao.session_id.startswith("painel-") and not incluir_testes):
                    continue
                vistas.add(sessao.session_id)
                estado = (sessao.session_data or {}).get("session_state") or {}
                base_evento = {"session_id": sessao.session_id, "origem": ao_vivo._origem(sessao.session_id),
                               "contato": estado.get("nome_contato") or ""}
                dono = getattr(sessao, "agent_id", None) or um.id
                for run in sessao.runs or []:
                    if not no_periodo(run.created_at):
                        continue
                    quem = getattr(run, "agent_id", None) or dono  # numa equipe, quem respondeu
                    momento = run.created_at
                    for ferramenta in run.tools or []:
                        # Transferir e encerrar entram pelas ações, que trazem o motivo.
                        if ferramenta.tool_name not in ("transferir_para_humano", "encerrar_atendimento"):
                            lista.append({**base_evento, "tipo": "ferramenta", "agente": quem, "quando": momento,
                                          "ferramenta": ferramenta.tool_name})
                    erro = "error" in str(getattr(run, "status", "")).lower()
                    if run.content == guardrails.BLOQUEIO_MANIPULACAO:
                        lista.append({**base_evento, "tipo": "guardrail", "agente": quem, "quando": momento,
                                      "texto": ao_vivo._trecho(_texto_entrada(run))})
                    elif erro:
                        lista.append({**base_evento, "tipo": "erro", "agente": quem, "quando": momento,
                                      "texto": ao_vivo._trecho(run.content)})
                    else:
                        duracao = run.metrics.duration if run.metrics and run.metrics.duration else None
                        lista.append({**base_evento, "tipo": "respondeu", "agente": quem,
                                      "quando": momento + (duracao or 0), "texto": ao_vivo._trecho(run.content),
                                      "duracao_s": round(duracao, 2) if duracao else None})
                for acao in estado.get("acoes") or []:
                    momento = quando_da_acao(acao, sessao)
                    if not no_periodo(momento):
                        continue
                    if acao.get("tipo") == "transferencia":
                        lista.append({**base_evento, "tipo": "transferiu", "agente": dono, "quando": momento,
                                      "categoria": acao.get("categoria"),
                                      "categoria_rotulo": categorias.get(acao.get("categoria") or ""),
                                      "motivo": acao.get("motivo")})
                    elif acao.get("tipo") in ("encerramento", "inatividade"):
                        lista.append({**base_evento, "tipo": "encerrou", "agente": dono, "quando": momento,
                                      "motivo": "sem resposta do contato" if acao["tipo"] == "inatividade" else acao.get("motivo")})

        # Boas-vindas do onboarding (a conversa abre no Unnichat antes de o contato responder).
        try:
            engine = agente.db.db_engine
            tabela = Table("unnichat_conversas", MetaData(), schema=getattr(agente.db, "db_schema", None), autoload_with=engine)
            filtros = [tabela.c.onboarding_em >= datetime.fromtimestamp(inicio, tz=timezone.utc)]
            if fim is not None:
                filtros.append(tabela.c.onboarding_em <= datetime.fromtimestamp(fim, tz=timezone.utc))
            with engine.connect() as conexao:
                for linha in conexao.execute(select(tabela).where(*filtros)).mappings():
                    momento = linha["onboarding_em"]
                    momento = momento if momento.tzinfo else momento.replace(tzinfo=timezone.utc)
                    lista.append({"tipo": "boas_vindas", "agente": linha["agente"] or perfis.PADRAO,
                                  "session_id": linha["session_id"], "origem": "whatsapp",
                                  "contato": linha["nome"] or "", "quando": momento.timestamp()})
        except Exception as erro:  # sem a tabela (servidor sem Unnichat), o histórico segue sem as boas-vindas
            log_warning(f"Central: boas-vindas fora dos acontecimentos: {type(erro).__name__}: {erro}")

        lista.sort(key=lambda e: e["quando"], reverse=True)
        total = len(lista)
        lista = lista[:limite]
        for i, evento in enumerate(lista, start=1):
            evento["id"] = i
            evento["quando"] = datetime.fromtimestamp(evento["quando"], tz=timezone.utc).isoformat(timespec="seconds")
        return {"horas": horas, "desde": inicio, "ate": fim, "eventos": lista, "total": total}

    @rotas.get("/central/feed", dependencies=protegido)
    def feed(
        limite: int = Query(default=50, ge=1, le=300),
        depois_de: int = Query(default=0, ge=0),
        agente_id: str | None = Query(default=None, max_length=60, alias="agente"),
    ) -> dict:
        """Os últimos acontecimentos (o mais novo por último), para o feed abrir preenchido. Ficam na
        memória do servidor: um reinício começa vazio."""
        return {"eventos": ao_vivo.recentes(limite, depois_de, agente_id)}

    @rotas.get("/central/eventos", dependencies=protegido)
    async def eventos_ao_vivo() -> StreamingResponse:
        """Os acontecimentos dos atendimentos em tempo real, uma linha JSON por evento (o mesmo formato
        do /chat/etapas). Tipos: mensagem, pensando, ferramenta, respondeu, transferiu, encerrou,
        guardrail, erro; a cada 15 s sem nada, {"tipo": "ping"} mantém a conexão."""
        async def linhas():
            yield json.dumps({"tipo": "conectado", "ultimo_id": (ao_vivo.recentes(1) or [{"id": 0}])[-1]["id"]}) + "\n"
            chave = ao_vivo.inscrever()
            try:
                while True:
                    try:
                        evento = await asyncio.wait_for(chave[1].get(), timeout=15)
                    except TimeoutError:
                        yield json.dumps({"tipo": "ping"}) + "\n"
                        continue
                    yield json.dumps(evento, ensure_ascii=False) + "\n"
            finally:
                ao_vivo.cancelar(chave)

        return StreamingResponse(linhas(), media_type="application/x-ndjson",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    MINUTOS_TRANSFERIDA = int(os.getenv("ALERTA_TRANSFERIDA_MIN", "15"))
    HORAS_ROTINA_ALERTAS = 48  # a rotina de baixa automática olha as conversas destas últimas horas

    @rotas.get("/central/alertas", dependencies=protegido)
    def alertas(
        minutos_transferida: int = Query(default=MINUTOS_TRANSFERIDA, ge=1, le=1440),
        incluir_testes: bool = Query(default=False),
        horas: int = Query(default=24, ge=1, le=HORAS_MAX_CENTRAL),
        desde: int | None = Query(default=None, ge=0, description="Início do período (epoch, s). Sem ele, as últimas `horas`."),
        ate: int | None = Query(default=None, ge=0, description="Fim do período (epoch, s). Sem ele, até agora."),
    ) -> dict:
        """O que pede atenção agora, nas conversas com atividade no período (o mesmo da Central): resposta que
        falhou, conversa transferida há tempo sem sabermos se a equipe assumiu e bloqueios do guardrail
        esperando curadoria (estes, de qualquer data). Sem incluir_testes, as conversas do chat de teste do
        painel ficam de fora. `alertas` são os abertos; `baixados`, os que já tiveram baixa (agente/alertas.py)."""
        inicio, fim = _periodo_central(horas, desde, ate)
        abertos, baixados = alertas_mod.separar(_calcular_alertas(inicio, fim, minutos_transferida, incluir_testes))
        return {"desde": inicio, "ate": fim, "alertas": abertos, "total": len(abertos), "baixados": baixados,
                "baixa_disponivel": alertas_mod.disponivel()}

    class PedidoBaixa(BaseModel):
        tipo: str = Field(max_length=40)
        session_id: str = Field(min_length=1, max_length=200)
        referencia: float
        motivo: str | None = Field(default=None, max_length=40)

    @rotas.post("/central/alertas/baixa", dependencies=protegido)
    def dar_baixa_alerta(pedido: PedidoBaixa, quem: str = Depends(exigir("tratar_alertas"))) -> dict:
        """Baixa manual de um alerta (aba Alertas). Volta aberto se acontecer outra coisa na conversa."""
        try:
            alertas_mod.dar_baixa(pedido.tipo, pedido.session_id, pedido.referencia, pedido.motivo or "resolvido", quem)
        except alertas_mod.ErroAlerta as erro:
            raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro
        return {"ok": True}

    @rotas.post("/central/alertas/reabrir", dependencies=protegido)
    def reabrir_alerta(pedido: PedidoBaixa, _quem: str = Depends(exigir("tratar_alertas"))) -> dict:
        try:
            alertas_mod.reabrir(pedido.tipo, pedido.session_id, pedido.referencia)
        except alertas_mod.ErroAlerta as erro:
            raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro
        return {"ok": True}

    @rotas.post("/manutencao/alertas", dependencies=[*protegido, Depends(so_sistema)])
    def baixa_automatica_alertas() -> dict:
        """Chamada a cada 10 minutos pelo Scheduler: dá baixa nos alertas em que a equipe já respondeu o contato
        no WhatsApp (agente/alertas.py)."""
        inicio, _ = _periodo_central(HORAS_ROTINA_ALERTAS, None, None)
        abertos, _ = alertas_mod.separar(_calcular_alertas(inicio, None, MINUTOS_TRANSFERIDA, False))
        return alertas_mod.baixa_automatica(abertos)

    def _calcular_alertas(inicio: int, fim: int | None, minutos_transferida: int, incluir_testes: bool) -> list[dict]:
        """Os alertas das conversas com atividade no período. `referencia`: o momento do acontecimento (a
        transferência ou a resposta que falhou), que identifica o alerta na baixa."""
        agora = time.time()
        lista = []
        vistas: set[str] = set()
        for um in agentes.values():
            for sessao in _sessoes(um, inicio, LIMITE_CENTRAL, fim, por_atividade=True):
                if sessao.session_id in vistas:
                    continue
                vistas.add(sessao.session_id)
                resumo = _resumo(sessao)
                if resumo["origem"] == "Painel" and not incluir_testes:
                    continue
                ultima = _ultima_atividade(sessao)
                parada_min = round((agora - ultima) / 60) if ultima else None
                runs = sessao.runs or []
                # O bloqueio do guardrail também termina com status de erro, mas o contato recebeu resposta.
                falhou = (bool(runs) and "error" in str(getattr(runs[-1], "status", "")).lower()
                          and getattr(runs[-1], "content", None) != guardrails.BLOQUEIO_MANIPULACAO)
                base_alerta = {"agente": um.id, "session_id": resumo["id"], "contato": resumo["nome"],
                               "origem": resumo["origem"], "parada_min": parada_min,
                               "categoria_rotulo": resumo.get("categoria_rotulo"),
                               "desde": resumo["transferida_em"] or resumo["atualizada_em"]}
                if resumo["status"] == STATUS_EM_ATENDIMENTO and falhou:
                    lista.append({**base_alerta, "tipo": "falha_na_resposta", "nivel": "alto",
                                  "referencia": getattr(runs[-1], "created_at", None) or ultima,
                                  "texto": "A última resposta do agente falhou: o contato pode estar sem resposta."})
                elif resumo["status"] == STATUS_TRANSFERIDO and parada_min is not None and parada_min >= minutos_transferida:
                    transferida = resumo["transferida_em"]
                    lista.append({**base_alerta, "tipo": "transferida_aguardando", "nivel": "medio",
                                  "referencia": datetime.fromisoformat(transferida).timestamp() if transferida else ultima,
                                  "texto": f"Transferida há {parada_min} min ({resumo.get('categoria_rotulo') or 'sem categoria'}): "
                                           "confira se a equipe assumiu."})
        engine = agente.db.db_engine
        for agente_id, dele in datasets.resumo_por_agente(engine, getattr(agente.db, "db_schema", None)).items():
            if dele["guardrail_pendentes"]:
                lista.append({"agente": agente_id, "tipo": "guardrail_pendente", "nivel": "baixo",
                              "quantidade": dele["guardrail_pendentes"],
                              "texto": f"{dele['guardrail_pendentes']} bloqueio(s) do guardrail esperando curadoria."})
        ordem = {"alto": 0, "medio": 1, "baixo": 2}
        lista.sort(key=lambda a: (ordem[a["nivel"]], -(a.get("parada_min") or 0)))
        return lista

    @rotas.get("/central/setores", dependencies=protegido)
    def setores(
        horas: int = Query(default=24, ge=1, le=HORAS_MAX_CENTRAL),
        desde: int | None = Query(default=None, ge=0, description="Início do período (epoch, s). Sem ele, as últimas `horas`."),
        ate: int | None = Query(default=None, ge=0, description="Fim do período (epoch, s). Sem ele, até agora."),
        agente_id: str | None = Query(default=None, max_length=60, alias="agente"),
        minutos_transferida: int = Query(default=int(os.getenv("ALERTA_TRANSFERIDA_MIN", "15")), ge=1, le=1440),
        incluir_testes: bool = Query(default=False),
    ) -> dict:
        """Os números de cada setor do escritório da Central, no período: ferramentas usadas, mensagens,
        transferências e base de conhecimento. Com ?agente=, só os dele; sem, a soma de todos.
        "aguardando" segue a regra do alerta transferida_aguardando. Sem incluir_testes, sem o chat de teste."""
        agora = time.time()
        inicio, fim = _periodo_central(horas, desde, ate)
        escolhidos = _escolhidos(agente_id, None)
        ids = {um.id for um in escolhidos}

        ferramentas: dict[str, dict] = {}
        mensagens = {"recebidas": 0, "respondidas": 0, "por_origem": {"whatsapp": 0, "painel": 0, "outro": 0}}
        por_categoria: Counter = Counter()
        aguardando = 0
        for sessao in _sessoes_de(escolhidos, inicio, LIMITE_CENTRAL, fim, por_atividade=True):
            if sessao.session_id.startswith("painel-") and not incluir_testes:
                continue
            resumo = _resumo(sessao)
            dono = resumo["agente"]
            if dono not in ids:
                continue
            runs = [r for r in sessao.runs or [] if _no_periodo(getattr(r, "created_at", None), inicio, fim)]
            mensagens["recebidas"] += len(runs)
            mensagens["respondidas"] += sum(bool(r.content) for r in runs)
            mensagens["por_origem"][_canal(sessao.session_id)] += len(runs)
            for run in runs:
                for chamada in getattr(run, "tools", None) or []:
                    nome = getattr(chamada, "tool_name", None)
                    if not nome:
                        continue
                    dela = ferramentas.setdefault(nome, {"total": 0, "por_agente": {}, "sem_resultado": 0})
                    dela["total"] += 1
                    dela["por_agente"][dono] = dela["por_agente"].get(dono, 0) + 1
                    dela["sem_resultado"] += bool(_SEM_RESULTADO.search(str(getattr(chamada, "result", "") or "")))
            # As transferências feitas no período (a mesma regra das Transferidas da Central).
            estado = (sessao.session_data or {}).get("session_state") or {}
            for acao in estado.get("acoes") or []:
                if acao.get("tipo") == "transferencia" and _no_periodo(quando_da_acao(acao, sessao), inicio, fim):
                    por_categoria[(dono, acao.get("categoria") or "outro")] += 1
            ultima = _ultima_atividade(sessao)
            if resumo["status"] == STATUS_TRANSFERIDO and ultima and (agora - ultima) / 60 >= minutos_transferida:
                aguardando += 1

        conhecimento_por_agente = {"documentos_ativos": {}, "exemplos_ativos": {}}
        if conhecimento.disponivel():
            consultas = (
                ("documentos_ativos", conhecimento._t("documentos"), conhecimento._t("documentos").c.status == "pronto"),
                ("exemplos_ativos", conhecimento._t("exemplos"), true()),
            )
            with agente.db.db_engine.connect() as conexao:
                for chave, tabela, condicao in consultas:
                    linhas = conexao.execute(
                        select(tabela.c.agente, func.count()).where(tabela.c.ativo.is_(True), condicao,
                                                                    tabela.c.agente.in_(ids))
                        .group_by(tabela.c.agente)
                    ).all()
                    conhecimento_por_agente[chave] = {um: 0 for um in sorted(ids)} | dict(linhas)

        return {
            "horas": horas,
            "desde": inicio,
            "ate": fim,
            "agente": agente_id,
            "ferramentas": dict(sorted(ferramentas.items(), key=lambda item: -item[1]["total"])),
            "mensagens": mensagens,
            "transferencias": {
                "por_categoria": [
                    {"agente": dono, "categoria": categoria,
                     "rotulo": perfis.obter(dono).categorias_transferencia.get(categoria, categoria), "total": total}
                    for (dono, categoria), total in por_categoria.most_common()
                ],
                "aguardando": aguardando,
            },
            "conhecimento": conhecimento_por_agente,
        }

    @rotas.post("/chat/{session_id}/inatividade", dependencies=[*protegido, Depends(exigir("usar_chat"))])
    def inatividade(session_id: str) -> dict:
        return {"session_id": session_id, **encerrar_por_inatividade(_da_sessao(session_id), session_id)}

    @rotas.post("/manutencao/inatividade", dependencies=[*protegido, Depends(so_sistema)])
    def varrer_inativas() -> dict:
        """Chamada pelo Scheduler do AgentOS: encerra as conversas paradas de cada agente. No GestorGov quem
        conversa são os servidores, pelo painel: encerra sem mandar despedida."""
        total = {"verificadas": 0, "encerradas": []}
        for um in [*agentes.values(), *equipes.EQUIPES.values()]:
            resultado = encerrar_inativas(um)
            total["verificadas"] += resultado["verificadas"]
            total["encerradas"] += resultado["encerradas"]
        return total

    @rotas.post("/manutencao/avaliacoes", dependencies=[*protegido, Depends(so_sistema)])
    def avaliacoes_diarias() -> dict:
        """Chamada uma vez por dia pelo Scheduler: as avaliações rodam num processo separado
        (agente/manutencao.py) e os resultados aparecem na tela Evaluation do AgentOS."""
        from agente import manutencao

        from agente import fabrica_recursos

        if not manutencao.avaliacoes_ligadas():
            return {"iniciada": False, "motivo": "AVALIACOES_DIARIAS desligada"}
        # Casos de teste da fábrica e dataset da Calibração de cada agente publicado, um agente por vez.
        publicados = [um for um in agentes.values() if perfis.publicado(um.id)]
        return {**manutencao.iniciar_avaliacoes(), "fabrica": fabrica_recursos.avaliar_em_fila(publicados, "rotina diária")}

    @rotas.post("/manutencao/limpeza", dependencies=[*protegido, Depends(so_sistema)])
    def limpeza() -> dict:
        """Chamada uma vez por dia pelo Scheduler: registros antigos da Unnichat, traces e execuções de
        rotinas (agente/manutencao.py)."""
        from agente import manutencao
        from agente.agente import schema_banco

        engine, schema = agente.db.db_engine, schema_banco()
        return {**manutencao.limpar_unnichat(engine, schema), **manutencao.limpar_registros_tecnicos(engine, schema)}

    # Base de conhecimento de cada agente (?agente=<id>; vazio = a da Luna).
    @rotas.get("/base", dependencies=protegido)
    def ler_base(agente_id: str | None = Query(default=None, max_length=60, alias="agente")) -> dict:
        return _base_iso(base.obter(_do_agente(agente_id).id).atual())

    @rotas.put("/base", dependencies=[*protegido, Depends(exigir("editar_conhecimento"))])
    def gravar_base(pedido: PedidoBase, agente_id: str | None = Query(default=None, max_length=60, alias="agente")) -> dict:
        return _base_iso(base.obter(_do_agente(agente_id).id).salvar(pedido.conteudo, pedido.observacao))

    @rotas.post("/base/restaurar", dependencies=[*protegido, Depends(exigir("editar_conhecimento"))])
    def restaurar_base(agente_id: str | None = Query(default=None, max_length=60, alias="agente")) -> dict:
        return _base_iso(base.obter(_do_agente(agente_id).id).restaurar_padrao())

    @rotas.get("/base/historico", dependencies=protegido)
    def historico_base(agente_id: str | None = Query(default=None, max_length=60, alias="agente")) -> dict:
        return {"versoes": [_base_iso(v) for v in base.obter(_do_agente(agente_id).id).historico()]}

    return rotas
