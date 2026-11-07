"""Baixa dos alertas da Central.

Os alertas são calculados a cada leitura (painel_api.py, /central/alertas). Esta tabela guarda o que não dá para
calcular: a baixa (quem, quando e por quê). Cada alerta é a dupla
(tipo, conversa) com a `referencia`, o momento do acontecimento (a transferência ou a resposta que falhou): se
acontecer outra coisa na conversa (nova transferência, nova falha), a referência muda e o alerta volta aberto.

Baixa automática (rotina a cada 10 min, /painel/api/manutencao/alertas): quando alguém da equipe escreveu ao cidadão
no WhatsApp depois do acontecimento (unnichat.pessoa_escreveu_desde). Baixa manual: pelos botões da aba Alertas.
"""

import threading
from datetime import datetime, timezone

from agno.utils.log import log_info, log_warning
from sqlalchemy import Column, DateTime, Float, MetaData, String, Table, and_, or_, select, update
from sqlalchemy.engine import Engine

# Os alertas que têm baixa. O bloqueio do guardrail sai quando é tratado na Calibração.
TIPOS_COM_BAIXA = ("falha_na_resposta", "transferida_aguardando")
MOTIVOS = {
    "equipe_assumiu": "Equipe assumiu",
    "resolvido": "Resolvido",
    "nao_precisa": "Não precisa de ação",
    "humano_respondeu": "A equipe respondeu no WhatsApp",
}
AUTOMATICA = "baixa automática"

_estado: dict = {}
_trava = threading.Lock()


class ErroAlerta(Exception):
    def __init__(self, status: int, detalhe: str):
        super().__init__(detalhe)
        self.status, self.detalhe = status, detalhe


def iniciar(engine: Engine, schema: str | None = None) -> None:
    tabela = Table(
        "central_alertas", MetaData(schema=schema),
        Column("tipo", String(40), primary_key=True),
        Column("session_id", String(200), primary_key=True),
        Column("referencia", Float, nullable=False),  # epoch do acontecimento
        Column("baixa_motivo", String(40), nullable=True),
        Column("baixa_por", String(200), nullable=True),
        Column("baixa_em", DateTime(timezone=True), nullable=True),
    )
    try:
        tabela.metadata.create_all(engine, tables=[tabela])
    except Exception as erro:  # banco só de leitura (teste local): o painel segue, sem baixa
        log_warning(f"Alertas: sem a tabela central_alertas, a baixa fica desligada: {type(erro).__name__}: {erro}")
        return
    _estado.update(engine=engine, tabela=tabela)


def disponivel() -> bool:
    return "engine" in _estado


def _agora() -> datetime:
    return datetime.now(timezone.utc)


def _iso(momento) -> str | None:
    if momento and momento.tzinfo is None:  # o SQLite devolve sem fuso; gravamos sempre em UTC
        momento = momento.replace(tzinfo=timezone.utc)
    return momento.isoformat(timespec="seconds") if momento else None


def _mesma(referencia_gravada: float | None, referencia: float | None) -> bool:
    return referencia_gravada is not None and referencia is not None and abs(referencia_gravada - referencia) < 1


def registros(chaves: list[tuple[str, str]]) -> dict[tuple[str, str], dict]:
    """O que está gravado para estes alertas, por (tipo, session_id)."""
    if not disponivel() or not chaves:
        return {}
    tabela = _estado["tabela"]
    saida: dict[tuple[str, str], dict] = {}
    with _estado["engine"].connect() as conexao:
        for inicio in range(0, len(chaves), 300):
            parte = chaves[inicio:inicio + 300]
            filtro = or_(*(and_(tabela.c.tipo == t, tabela.c.session_id == s) for t, s in parte))
            for linha in conexao.execute(select(tabela).where(filtro)).mappings():
                saida[(linha["tipo"], linha["session_id"])] = dict(linha)
    return saida


def separar(lista: list[dict]) -> tuple[list[dict], list[dict]]:
    """(abertos, com baixa). Cada alerta com baixa ganha `baixa` {motivo, motivo_rotulo, por, em}. Um alerta
    sem conversa (guardrail) fica sempre aberto."""
    com_conversa = [a for a in lista if a.get("session_id") and a["tipo"] in TIPOS_COM_BAIXA]
    gravados = registros(list({(a["tipo"], a["session_id"]) for a in com_conversa}))
    abertos, baixados = [], []
    for alerta in lista:
        linha = gravados.get((alerta["tipo"], alerta.get("session_id") or ""))
        vale = linha is not None and _mesma(linha["referencia"], alerta.get("referencia"))
        if vale and linha["baixa_em"]:
            motivo = linha["baixa_motivo"] or "resolvido"
            baixados.append({**alerta, "baixa": {"motivo": motivo, "motivo_rotulo": MOTIVOS.get(motivo, motivo),
                                                 "por": linha["baixa_por"], "em": _iso(linha["baixa_em"])}})
        else:
            abertos.append(alerta)
    return abertos, baixados


def _gravar(tipo: str, session_id: str, referencia: float, **campos) -> None:
    """Grava os campos do alerta. Referência nova (outro acontecimento) começa do zero: sem baixa."""
    tabela, engine = _estado["tabela"], _estado["engine"]
    with _trava, engine.begin() as conexao:
        atual = conexao.execute(select(tabela).where(tabela.c.tipo == tipo, tabela.c.session_id == session_id)).mappings().first()
        if atual is None:
            valores = {"tipo": tipo, "session_id": session_id, "referencia": referencia, "baixa_motivo": None,
                       "baixa_por": None, "baixa_em": None, **campos}
            conexao.execute(tabela.insert().values(**valores))
            return
        if not _mesma(atual["referencia"], referencia):
            campos = {"baixa_motivo": None, "baixa_por": None, "baixa_em": None, **campos}
        conexao.execute(update(tabela).where(tabela.c.tipo == tipo, tabela.c.session_id == session_id)
                        .values(referencia=referencia, **campos))


def _conferir(tipo: str, session_id: str, referencia: float | None) -> None:
    if not disponivel():
        raise ErroAlerta(503, "A baixa de alertas não está disponível neste servidor (sem a tabela central_alertas).")
    if tipo not in TIPOS_COM_BAIXA:
        raise ErroAlerta(422, "Este alerta não tem baixa: o bloqueio do guardrail sai quando é tratado na Calibração.")
    if not session_id or referencia is None:
        raise ErroAlerta(422, "Alerta sem conversa ou sem o momento do acontecimento.")


def dar_baixa(tipo: str, session_id: str, referencia: float, motivo: str, por: str) -> None:
    _conferir(tipo, session_id, referencia)
    if motivo not in MOTIVOS:
        raise ErroAlerta(422, f"Motivo inválido. Opções: {', '.join(MOTIVOS)}.")
    _gravar(tipo, session_id, referencia, baixa_motivo=motivo, baixa_por=por, baixa_em=_agora())


def reabrir(tipo: str, session_id: str, referencia: float) -> None:
    _conferir(tipo, session_id, referencia)
    _gravar(tipo, session_id, referencia, baixa_motivo=None, baixa_por=None, baixa_em=None)



def contato_da_conversa(session_id: str) -> str | None:
    """O id do contato na Unnichat, pelo id da conversa (unnichat-<contato>-<epoch>)."""
    if not session_id.startswith("unnichat-"):
        return None
    meio = session_id.removeprefix("unnichat-")
    contato, _, final = meio.rpartition("-")
    return contato if contato and final.isdigit() else None


def baixa_automatica(abertos: list[dict], limite: int = 80) -> dict:
    """Dá baixa nos alertas abertos em que alguém da equipe escreveu ao cidadão pelo WhatsApp depois do
    acontecimento. Até `limite` consultas à Unnichat por rodada (as mais antigas primeiro)."""
    from agente import unnichat

    if not disponivel():
        return {"conferidos": 0, "baixas": 0, "motivo": "sem a tabela central_alertas"}
    if not unnichat.disponivel():
        return {"conferidos": 0, "baixas": 0, "motivo": "sem a chave da Unnichat"}
    candidatos = sorted((a for a in abertos if a["tipo"] in TIPOS_COM_BAIXA and a.get("referencia")
                         and contato_da_conversa(a.get("session_id") or "")), key=lambda a: a["referencia"])[:limite]
    baixas = 0
    for alerta in candidatos:
        try:
            if unnichat.pessoa_escreveu_desde(contato_da_conversa(alerta["session_id"]), alerta["referencia"]):
                dar_baixa(alerta["tipo"], alerta["session_id"], alerta["referencia"], "humano_respondeu", AUTOMATICA)
                baixas += 1
        except Exception as erro:  # Unnichat fora do ar: confere de novo na próxima rodada
            log_warning(f"Alertas: não deu para conferir {alerta['session_id']} na Unnichat: {type(erro).__name__}: {erro}")
    if baixas:
        log_info(f"Alertas: {baixas} baixa(s) automática(s) (a equipe respondeu no WhatsApp).")
    return {"conferidos": len(candidatos), "baixas": baixas}
