"""Rotas do painel (/painel/api): acesso, implantação, conversas, chat com os agentes e base de conhecimento.

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
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

from agno.agent import Agent
from agno.db.base import SessionType
from agno.utils.log import log_warning
from fastapi import APIRouter, Cookie, Depends, File, Form, Header, HTTPException, Query, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from agente import acessos, ao_vivo, base, conhecimento, equipes, fabrica, gestao, listas, perfis, usuarios
from agente.atendimento import responder, responder_em_etapas
from agente.ferramentas import STATUS_EM_ATENDIMENTO

# Horário de Brasília (sem horário de verão desde 2019).
FUSO_BR = timezone(timedelta(hours=-3))
ORIGENS = {
    "painel-": "Painel",
    "teste-": "Terminal",
    "servidor-": "Servidor",
    "implantacao-": "Implantação",
    "cenario-": "Testes automáticos",
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


class PedidoSenhaNova(BaseModel):
    senha: str = Field(min_length=8, max_length=200)


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
    """Pessoa logada (aprovada ou ainda pendente; bloqueada não): a implantação da própria organização não
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


# ── Escopo por organização ──
# None: a equipe da plataforma (ou a chave, ou o servidor local sem chave) vê todos os agentes. Um conjunto: quem é
# de uma organização vê só os agentes dela (fabrica.agentes_da_organizacao) e as conversas deles.
Escopo = frozenset | None


def _escopo_de(painel_sessao: str | None, authorization: str | None, permissao: str = "ver_painel") -> Escopo:
    if not _chave():
        return None
    sessao = _ler_sessao(painel_sessao)
    if not sessao:
        exigir_chave(authorization=authorization, painel_sessao=None)  # a chave ou o token interno
        return None
    email = sessao["email"]
    dele = usuarios.usuario(email) if usuarios.disponivel() else None
    if dele and dele["situacao"] == "ativo" and permissao in dele["permissoes"]:
        return None
    contexto = acessos.contexto(email)
    if contexto and "ver_painel" in contexto["permissoes"]:
        return frozenset(fabrica.agentes_da_organizacao(contexto["organizacao_id"]))
    _conferir_usuario(email, permissao)  # levanta com o motivo
    return None


def escopo_painel(painel_sessao: str | None = Cookie(default=None),
                  authorization: str | None = Header(default=None)) -> Escopo:
    return _escopo_de(painel_sessao, authorization)


def escopo_chat(painel_sessao: str | None = Cookie(default=None),
                authorization: str | None = Header(default=None)) -> Escopo:
    return _escopo_de(painel_sessao, authorization, "usar_chat")


def no_escopo(agente_id: str | None, escopo: Escopo) -> bool:
    return escopo is None or (agente_id or "") in escopo


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


def _quem(painel_sessao: str | None) -> str:
    return quem_chama(painel_sessao)


def _pode(quem: str, permissao: str) -> bool:
    """Permissão da pessoa (agente/usuarios.py); a chave de acesso pode tudo."""
    return usuarios.pode(quem, permissao) if usuarios.disponivel() else True


def _negado(permissao: str) -> HTTPException:
    rotulo = usuarios.PERMISSOES.get(permissao, (permissao,))[0]
    return HTTPException(status_code=403, detail=f"Você não tem a permissão \"{rotulo}\". Peça ao dono do painel.")


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
        """O agente pedido pelo painel (?agente=<id>); vazio = o padrão."""
        if not agente_id:
            return agente
        if agente_id not in agentes:
            raise HTTPException(status_code=404, detail=f"Agente desconhecido: {agente_id}. Existem: {', '.join(agentes)}.")
        return agentes[agente_id]

    def _da_sessao_no_escopo(session_id: str, escopo: Escopo):
        """A conversa, se ela é de um agente que quem chama pode ver; senão 404 (sem dizer que existe)."""
        if escopo is None:
            return
        sessao = _sessao(agente.db, session_id)
        dono = getattr(sessao, "agent_id", None) or getattr(sessao, "team_id", None)
        if sessao is None or dono not in escopo:
            raise HTTPException(status_code=404, detail="Conversa não encontrada.")

    def _escolhidos(agente_id: str | None, area: str | None, escopo: Escopo = None) -> list[Agent]:
        """Os agentes de um filtro do painel: um agente, os de uma área ou, sem filtro, todos (de quem chama:
        com escopo, só os da organização dele)."""
        if agente_id:
            if not no_escopo(agente_id, escopo):
                raise HTTPException(status_code=404, detail="Agente não encontrado.")
            return [_do_agente(agente_id)]
        publicados = [um for um in agentes.values() if perfis.publicado(um.id) and no_escopo(um.id, escopo)]
        if area:
            return [um for um in publicados if perfis.identidade(um.id)["area"].lower() == area.lower()]
        return publicados

    def _sessoes_de(escolhidos: list[Agent], desde_epoch: int | None = None, limite: int = 500,
                    ate_epoch: int | None = None, por_atividade: bool = False) -> list:
        """As sessões de vários agentes, sem repetir, das mais recentes para as mais antigas."""
        unicas = {s.session_id: s for um in escolhidos
                  for s in _sessoes(um, desde_epoch, limite, ate_epoch, por_atividade)}
        return sorted(unicas.values(), key=lambda s: _ultima_atividade(s) or 0, reverse=True)[:limite]

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
            # Token público do Mapbox (pk.): o mapa da cidade carrega no navegador.
            "mapbox_token": os.getenv("MAPBOX_TOKEN", "").strip() or None,
            # Com o Google ligado, pessoas entram por ele; a chave fica para rotinas (PAINEL_LOGIN_CHAVE=sim reabre).
            "aceita_chave": not google or os.getenv("PAINEL_LOGIN_CHAVE", "").strip().lower() in ("1", "sim", "true"),
            # A organização da pessoa (dono ou membro) e as permissões dela lá (agente/acessos.py).
            "organizacao": acessos.contexto(sessao["email"]) if sessao else None,
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
        """Cadastro pela landing page: cria a conta e já entra. A pessoa vai para a implantação da organização."""
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

    # ───────── Implantação da organização (quem se cadastrou, mesmo antes da aprovação) ─────────

    def _implantacao_da(email: str) -> tuple[str, str | None]:
        """A conversa de implantação da conta (uma por pessoa) e a organização dela, se já registrada."""
        sessao = "implantacao-" + hashlib.sha256(email.encode()).hexdigest()[:16]
        dela = gestao.organizacoes_de(email) if gestao.disponivel() else []
        return sessao, (str(dela[0]["id"]) if dela else None)

    @rotas.get("/implantacao")
    def implantacao(sessao: dict = Depends(exigir_sessao)) -> dict:
        email = sessao["email"]
        session_id, organizacao_id = _implantacao_da(email)
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
            "organizacao_id": organizacao_id,
            "panorama": gestao.panorama(organizacao_id) if organizacao_id else None,
        }

    @rotas.get("/implantacao/catalogo")
    def implantacao_catalogo(sessao: dict = Depends(exigir_sessao)) -> dict:
        """Os tipos de unidade (nome e cor) do segmento da organização da conta, para o quadro da implantação."""
        if not gestao.disponivel():
            return {"tipos_unidade": []}
        _, organizacao_id = _implantacao_da(sessao["email"])
        segmento_id = gestao.segmento_de(organizacao_id).id if organizacao_id else None
        return gestao._json({"tipos_unidade": gestao.tipos_unidade(segmento_id)})

    @rotas.post("/implantacao/mensagem")
    async def implantacao_mensagem(pedido: PedidoImplantacao, sessao: dict = Depends(exigir_sessao)) -> dict:
        email = sessao["email"]
        session_id, organizacao_id = _implantacao_da(email)
        assistente = agentes.get(perfis.PADRAO) or agente
        nome = (sessao.get("nome") or "").split(" ")[0]
        resultado = await run_in_threadpool(
            responder, assistente, session_id, pedido.mensagem.strip(), nome, email, "", None,
            # fase_da_vez: a fase em que a mensagem começou; as ferramentas das fases seguintes esperam a próxima mensagem.
            {"conta_email": email, "conta_nome": sessao.get("nome") or "", "organizacao_id": organizacao_id,
             "fase_da_vez": gestao.fase_atual(organizacao_id) if organizacao_id else "organizacao"},
        )
        _, organizacao_id = _implantacao_da(email)
        return {**resultado, "organizacao_id": organizacao_id,
                "panorama": gestao.panorama(organizacao_id) if organizacao_id else None}

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

    # ───────── Redefinir a senha: o link sai no painel (Usuários) e quem administra manda para a pessoa ─────────

    @rotas.post("/usuarios/{email}/link-senha", dependencies=protegido)
    def link_senha(email: str, quem: str = Depends(exigir("gerenciar_usuarios"))) -> dict:
        try:
            gerado = usuarios.gerar_link_senha(email, quem)
        except usuarios.ErroUsuario as erro:
            raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro
        log_warning(f"Link de redefinir senha gerado para {gerado['email']} por {quem}.")
        return {"caminho": f"/painel/redefinir-senha/{gerado['token']}", "email": gerado["email"],
                "expira_em": gerado["expira_em"]}

    @rotas.get("/redefinir-senha/{token}")
    def ver_link_senha(token: str) -> dict:
        if not usuarios.disponivel():
            raise HTTPException(status_code=503, detail="O login não está ligado neste servidor.")
        try:
            return usuarios.ler_link_senha(token)
        except usuarios.ErroUsuario as erro:
            raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro

    @rotas.post("/redefinir-senha/{token}")
    async def usar_link_senha(token: str, pedido: PedidoSenhaNova, resposta: Response) -> dict:
        if not _chave() or not usuarios.disponivel():
            raise HTTPException(status_code=503, detail="O login não está ligado neste servidor (falta OS_SECURITY_KEY).")
        try:
            dele = await run_in_threadpool(usuarios.redefinir_senha, token, pedido.senha)
        except usuarios.ErroUsuario as erro:
            raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro
        _FALHAS_LOGIN.pop(dele["email"], None)  # senha nova: zera as tentativas erradas
        log_warning(f"Senha redefinida por link: {dele['email']}.")
        _gravar_sessao(resposta, dele["email"], dele["nome"])
        return {"email": dele["email"], "nome": dele["nome"]}

    @rotas.post("/logout")
    def logout(resposta: Response) -> dict:
        resposta.delete_cookie(COOKIE_SESSAO, path="/painel", httponly=True, secure=True, samesite="lax")
        return {"ok": True}

    @rotas.get("/config")
    def config(agente_id: str | None = Query(default=None, max_length=60, alias="agente"),
               escopo: Escopo = Depends(escopo_painel)) -> dict:
        if escopo is not None and not no_escopo(agente_id, escopo):
            # Quem é de uma organização não usa o padrão da plataforma: o primeiro agente dela.
            if not escopo:
                raise HTTPException(status_code=404, detail="Esta organização ainda não tem agentes.")
            agente_id = sorted(escopo)[0]
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

    @rotas.get("/conversas")
    def conversas(
        status: str | None = Query(default=None),
        busca: str | None = Query(default=None, max_length=120),
        origem: str | None = Query(default=None, max_length=40),
        agente_id: str | None = Query(default=None, max_length=60, alias="agente"),
        area: str | None = Query(default=None, max_length=80),
        limite: int = Query(default=200, ge=1, le=1000),
        escopo: Escopo = Depends(escopo_painel),
    ) -> dict:
        # Sem filtro, as conversas de todos os agentes; ?area= ou ?agente= filtram no servidor (antes do limite).
        escolhidos = _escolhidos(agente_id, area, escopo)
        resumos = [_resumo(s) for s in _sessoes_de(escolhidos, limite=limite)]
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

    @rotas.get("/conversas/{session_id}")
    def conversa(session_id: str, escopo: Escopo = Depends(escopo_painel)) -> dict:
        _da_sessao_no_escopo(session_id, escopo)
        sessao = _sessao(agente.db, session_id)
        if sessao is None:
            raise HTTPException(status_code=404, detail="Conversa não encontrada.")
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

    @rotas.get("/conversas/{session_id}/rastreamento")
    def rastreamento_da_conversa(session_id: str, escopo: Escopo = Depends(escopo_painel)) -> dict:
        """Por que o agente respondeu o que respondeu: raciocínio, ferramentas, contexto e Learning (agente/rastreamento.py)."""
        from agente import rastreamento
        from agente.agente import schema_banco

        _da_sessao_no_escopo(session_id, escopo)
        sessao = _sessao(agente.db, session_id)
        if sessao is None:
            raise HTTPException(status_code=404, detail="Conversa não encontrada.")
        return rastreamento.conversa(sessao, agente.db.db_engine, schema_banco())

    async def _pedido_chat(
        mensagem: str, session_id: str | None, nome_contato: str, telefone: str, arquivos: list[UploadFile],
        agente_id: str = "", escopo: Escopo = None, painel_sessao: str | None = None,
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
        if not no_escopo(escolhido.id, escopo):
            raise HTTPException(status_code=403, detail="Escolha um dos agentes da sua organização.")
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

        if escopo is not None:
            # Pessoa de uma organização: conversa de verdade (conta nos números), com o e-mail e o nome dele.
            sessao_login = _ler_sessao(painel_sessao) or {}
            session_id = session_id or f"servidor-{uuid.uuid4().hex[:12]}"
            nome = (sessao_login.get("nome") or "").split(" ")[0]
            return escolhido, session_id, texto, nome, sessao_login.get("email") or session_id, "", anexos
        session_id = session_id or f"painel-{uuid.uuid4().hex[:12]}"
        nome = nome_contato.strip()
        # Cada contato simulado tem a própria memória: o mesmo nome em conversas diferentes = o mesmo
        # contato voltando (é assim que se testa a memória). Sem nome, a conversa é um contato avulso.
        user_id = f"painel:{nome.lower()}" if nome else session_id
        return escolhido, session_id, texto, nome, user_id, telefone.strip(), anexos

    @rotas.post("/chat")
    async def chat(
        mensagem: str = Form(default="", max_length=2000),
        session_id: str | None = Form(default=None, max_length=120),
        nome_contato: str = Form(default="", max_length=120),
        telefone: str = Form(default="", max_length=30),
        arquivos: list[UploadFile] = File(default=[]),
        agente_id: str = Form(default="", max_length=60, alias="agente"),
        escopo: Escopo = Depends(escopo_chat),
        painel_sessao: str | None = Cookie(default=None),
    ) -> dict:
        argumentos = await _pedido_chat(mensagem, session_id, nome_contato, telefone, arquivos, agente_id, escopo, painel_sessao)
        resultado = await run_in_threadpool(responder, *argumentos)
        return {"session_id": argumentos[1], **resultado}

    @rotas.post("/chat/etapas")
    async def chat_etapas(
        mensagem: str = Form(default="", max_length=2000),
        session_id: str | None = Form(default=None, max_length=120),
        nome_contato: str = Form(default="", max_length=120),
        telefone: str = Form(default="", max_length=30),
        arquivos: list[UploadFile] = File(default=[]),
        agente_id: str = Form(default="", max_length=60, alias="agente"),
        escopo: Escopo = Depends(escopo_chat),
        painel_sessao: str | None = Cookie(default=None),
    ) -> StreamingResponse:
        """O mesmo que /chat, transmitido em linhas JSON enquanto o agente trabalha: cada etapa
        (contexto, modelo, ferramentas, memória), o texto à medida que é escrito e o resultado final."""
        argumentos = await _pedido_chat(mensagem, session_id, nome_contato, telefone, arquivos, agente_id, escopo, painel_sessao)

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

    @rotas.get("/agentes")
    def agentes_visiveis(escopo: Escopo = Depends(escopo_painel),
                         painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Os agentes publicados que quem chama pode ver (e as equipes, só para a plataforma)."""
        # Quem é de uma organização vê os agentes dela, um por área, mesmo sendo também da equipe da plataforma.
        sessao = _ler_sessao(painel_sessao) if escopo is None else None
        contexto = acessos.contexto(sessao["email"]) if sessao else None
        if contexto:
            escopo = frozenset(fabrica.agentes_da_organizacao(contexto["organizacao_id"]))
        # Ficam fora os assistentes (implantação e processos têm a tela deles) e os modelos do código (cada
        # organização conversa com a cópia dela).
        lista = [{"id": a.id, **perfis.identidade(a.id)} for a in agentes.values()
                 if perfis.publicado(a.id) and no_escopo(a.id, escopo)
                 and a.id not in perfis.ASSISTENTES and a.id not in perfis.MODELOS]
        lista_equipes = ([] if escopo is not None else
                         [{"id": e["id"], "nome": e["nome"], "membros": e["membros"], "padrao": e["padrao"]}
                          for e in equipes.listar() if e["publicada"]])
        return {"agentes": lista, "equipes": lista_equipes}

    # ───────── Secretaria 3D: o que os agentes fazem ao vivo (agente/ao_vivo.py) ─────────

    @rotas.get("/secretaria/feed")
    def feed(
        limite: int = Query(default=50, ge=1, le=300),
        depois_de: int = Query(default=0, ge=0),
        agente_id: str | None = Query(default=None, max_length=60, alias="agente"),
        escopo: Escopo = Depends(escopo_painel),
    ) -> dict:
        """Os últimos acontecimentos (o mais novo por último), para a tela abrir preenchida. Ficam na memória do
        servidor: um reinício começa vazio."""
        return {"eventos": [e for e in ao_vivo.recentes(limite, depois_de, agente_id) if no_escopo(e.get("agente"), escopo)]}

    @rotas.get("/secretaria/eventos")
    async def eventos_ao_vivo(escopo: Escopo = Depends(escopo_painel)) -> StreamingResponse:
        """Os acontecimentos em tempo real, uma linha JSON por evento. Tipos: mensagem, pensando, ferramenta,
        respondeu, transferiu, encerrou, guardrail, erro; a cada 15 s sem nada, {"tipo": "ping"} mantém a conexão."""
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
                    if no_escopo(evento.get("agente"), escopo):
                        yield json.dumps(evento, ensure_ascii=False) + "\n"
            finally:
                ao_vivo.cancelar(chave)

        return StreamingResponse(linhas(), media_type="application/x-ndjson",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @rotas.post("/manutencao/limpeza", dependencies=[*protegido, Depends(so_sistema)])
    def limpeza() -> dict:
        """Chamada uma vez por dia pelo Scheduler: traces e execuções de rotinas antigos (agente/manutencao.py)."""
        from agente import manutencao
        from agente.agente import schema_banco

        engine, schema = agente.db.db_engine, schema_banco()
        return manutencao.limpar_registros_tecnicos(engine, schema)

    # Base de conhecimento de cada agente (?agente=<id>; vazio = a do padrão).
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
