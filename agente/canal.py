"""Canal WhatsApp: quem atende pela Unnichat, configurado pelo painel e guardado no banco.

Três escolhas, que valem na mensagem seguinte, sem deploy:
- atendente: o agente ou a equipe publicada que atende as conversas (com uma equipe, a recepção
  escolhe o agente a cada mensagem);
- leads: o que fazer com quem não é aluno numa conversa nova: "" (sem porta, o atendente atende
  todos), "nenhum" (fica com o time na caixa da Unnichat) ou um agente ou equipe publicada;
- tags_sem_agente: contato com uma dessas tags não é atendido. Terminada em *, vale como prefixo
  (ex.: black_26_* cala o agente com qualquer tag de fluxo da Black). `agente-transferiu` e
  `agente-veio-do-comercial` valem sempre;
- dias_comercial: na entrada do negócio no CS, quem conversou com alguém do time pelo Live Chat nesses
  últimos dias (ou tem a tag do comercial) veio pelo comercial: ganha a tag `agente-veio-do-comercial` e
  o agente não entra nem depois (0 desliga a conversa; a tag do comercial continua valendo). Tirar a
  tag devolve o aluno ao agente;
- somente_pipeline: só atende quem tem negócio aberto no pipeline do onboarding (UNNICHAT_PIPELINE_ONBOARDING,
  o CS); a entrada de um negócio de outro pipeline não abre onboarding. Ligado por padrão quando o
  pipeline está configurado;
- horas_pessoa: se alguém da equipe escreveu ao contato pelo Live Chat nessas últimas horas, o agente
  não responde nem manda a despedida (0 desliga). Cobre o vendedor que esqueceu a tag.
- pela_tag (desligado por padrão): quem o agente atende passa a ser decidido na Unnichat. A automação do
  onboarding põe a tag do agente (TAG_ATENDE, `EC-AGENTE-LUNNA-CS`) em quem comprou, direto ou pelo comercial,
  e o agente atende só quem tem essa tag, com as boas-vindas a cada entrada no CS. As travas acima (tags,
  dias_comercial, somente_pipeline, horas_pessoa e a porta do lead) deixam de barrar e só ficam registradas
  no evento (coluna `observado`), para medir; `agente-transferiu` continua calando o agente nas mensagens.

A URL da automação fica só /unnichat/auto?token=...; `&agente=` e `&leads=` na URL continuam valendo
por cima do canal (ex.: a automação de teste). Cada gravação é uma versão nova (canal_whatsapp), com
quem salvou e quando; a vigente é a última. Antes da primeira gravação, valem os padrões de antes:
o agente padrão, sem porta do lead, e as tags de UNNICHAT_TAGS_SEM_AGENTE.
"""

import os
import re
import threading
from datetime import datetime, timezone

from agno.utils.log import log_warning
from sqlalchemy import JSON, Column, DateTime, Integer, MetaData, String, Table, insert, select
from sqlalchemy.engine import Engine

from agente import equipes, perfis
from agente.unnichat import TAG_TRANSFERIU

SEM_AGENTE = "nenhum"  # leads: quem não é aluno não é atendido por agente
TAG_VEIO_DO_COMERCIAL = "agente-veio-do-comercial"  # posta na entrada no CS de quem comprou com o comercial
TAG_COMERCIAL = "comercial-em-atendimento"
# Sem elas, o agente voltaria a falar com quem já foi para a equipe ou comprou com o comercial.
TAGS_FIXAS = (TAG_TRANSFERIU, TAG_VEIO_DO_COMERCIAL)
MAX_TAGS = 40
TAG_VALIDA = re.compile(r"^[a-z0-9][a-z0-9 _.:/-]{1,78}\*?$")
HISTORICO = 20
HORAS_PESSOA = 24  # a janela de 24 h do WhatsApp
MAX_HORAS_PESSOA = 168
DIAS_COMERCIAL = 7  # a negociação do comercial costuma levar alguns dias até o pagamento
MAX_DIAS_COMERCIAL = 60
# Posta pela automação "Onboarding - Atribuir para a Lunna" da Unnichat (29/10/2026); com pela_tag, só quem a tem é atendido.
TAG_ATENDE = os.getenv("UNNICHAT_TAG_ATENDE", "ec-agente-lunna-cs").strip().lower()

_estado: dict = {"vigente": None}
_trava = threading.Lock()


class ErroCanal(Exception):
    def __init__(self, status: int, detalhe: str):
        super().__init__(detalhe)
        self.status, self.detalhe = status, detalhe


def _iso(momento) -> str | None:
    if momento and momento.tzinfo is None:  # o SQLite devolve sem fuso; gravamos sempre em UTC
        momento = momento.replace(tzinfo=timezone.utc)
    return momento.isoformat() if momento else None


def _tags_do_ambiente() -> list[str]:
    padrao = f"{TAG_TRANSFERIU},comercial-em-atendimento"
    return [t.strip().lower() for t in os.getenv("UNNICHAT_TAGS_SEM_AGENTE", padrao).split(",") if t.strip()]


def _pipeline_do_ambiente() -> str:
    return os.getenv("UNNICHAT_PIPELINE_ONBOARDING", "").strip()


def padrao() -> dict:
    """O que vale antes da primeira gravação (o comportamento de antes do canal)."""
    return {"atendente": perfis.PADRAO, "leads": "", "tags_sem_agente": _tags_do_ambiente(), "horas_pessoa": HORAS_PESSOA,
            "somente_pipeline": bool(_pipeline_do_ambiente()), "dias_comercial": DIAS_COMERCIAL, "pela_tag": False}


def iniciar(engine: Engine, schema: str | None = None) -> None:
    tabela = Table(
        "canal_whatsapp", MetaData(schema=schema),
        Column("versao", Integer, primary_key=True, autoincrement=True),
        Column("config", JSON, nullable=False),  # atendente, leads, tags_sem_agente
        Column("salvo_em", DateTime(timezone=True), nullable=False),
        Column("salvo_por", String(200), nullable=False),
    )
    tabela.metadata.create_all(engine, tables=[tabela])
    with engine.connect() as conexao:
        linha = conexao.execute(select(tabela).order_by(tabela.c.versao.desc()).limit(1)).mappings().first()
    _estado.update(engine=engine, tabela=tabela, vigente=dict(linha) if linha else None)


# ───────── O que a Unnichat usa ─────────

def salvo() -> bool:
    """Já foi configurado pelo painel? Aí a conversa nova é sempre do atendente do canal, como com `&agente=`."""
    return _estado["vigente"] is not None


def _config() -> dict:
    return {**padrao(), **(_estado["vigente"] or {}).get("config", {})}


def _existe(atendente_id: str) -> bool:
    # Agente excluído na fábrica continua em PERFIS (para as conversas antigas), mas não existe mais.
    perfil = perfis.PERFIS.get(atendente_id)
    return atendente_id in equipes.EQUIPES or (perfil is not None and not getattr(perfil, "excluido", False))


def atendente() -> str:
    """Quem atende. Se o escolhido sumiu (equipe apagada ou não montada), o agente padrão, com aviso."""
    escolhido = _config()["atendente"]
    if _existe(escolhido):
        return escolhido
    log_warning(f"Canal WhatsApp: o atendente {escolhido} não existe mais; atendendo com {perfis.PADRAO}.")
    return perfis.PADRAO


def leads() -> str | None:
    """None sem porta do lead; "nenhum" ou o id de quem atende os leads. Escolhido que sumiu: ninguém."""
    escolhido = _config()["leads"]
    if not escolhido or escolhido == SEM_AGENTE or _existe(escolhido):
        return escolhido or None
    log_warning(f"Canal WhatsApp: o agente dos leads {escolhido} não existe mais; leads ficam sem agente.")
    return SEM_AGENTE


def tags_sem_agente() -> list[str]:
    tags = _config()["tags_sem_agente"]
    return [*TAGS_FIXAS, *(t for t in tags if t not in TAGS_FIXAS)]


def dias_comercial() -> int:
    """Quantos dias antes da entrada no CS uma conversa com o time marca o aluno como do comercial (0 = só a tag)."""
    return int(_config()["dias_comercial"])


def pipeline_obrigatorio() -> str | None:
    """O pipeline em que o contato precisa ter negócio aberto para ser atendido; None quando desligado."""
    pipeline = _pipeline_do_ambiente()
    return pipeline if pipeline and _config()["somente_pipeline"] else None


def horas_pessoa() -> int:
    """Janela da trava por pessoa da equipe, em horas (0 = desligada)."""
    return int(_config()["horas_pessoa"])


def pela_tag() -> bool:
    """Só quem tem a tag do agente (TAG_ATENDE) é atendido; as demais travas só ficam registradas."""
    return bool(_config()["pela_tag"])


def casa(tag: str, regra: str) -> bool:
    """A tag do contato bate com a regra: igual, ou começando por ela quando a regra termina em *."""
    return tag.startswith(regra[:-1]) if regra.endswith("*") else tag == regra


# ───────── Painel ─────────

def _opcoes() -> list[dict]:
    """Quem pode atender pelo canal: agentes e equipes publicados."""
    agentes = [{"id": i, "nome": perfis.identidade(i)["nome"], "tipo": "agente"} for i in perfis.PERFIS if perfis.publicado(i)]
    times = [{"id": e["id"], "nome": e["nome"], "tipo": "equipe"} for e in equipes.listar() if e["publicada"]]
    return agentes + times


def obter() -> dict:
    vigente = _estado["vigente"]
    config = _config()
    opcoes = _opcoes()
    publicados = {o["id"] for o in opcoes}
    return {
        "atendente": config["atendente"], "leads": config["leads"],
        # Falso quando o escolhido foi despublicado ou excluído depois de salvo: a tela avisa.
        "atendente_ativo": config["atendente"] in publicados,
        "leads_ativo": config["leads"] in ("", SEM_AGENTE) or config["leads"] in publicados,
        "tags_sem_agente": [t for t in config["tags_sem_agente"] if t not in TAGS_FIXAS],
        "tags_fixas": list(TAGS_FIXAS),
        "horas_pessoa": int(config["horas_pessoa"]),
        "somente_pipeline": bool(config["somente_pipeline"]),
        "dias_comercial": int(config["dias_comercial"]),
        "pela_tag": bool(config["pela_tag"]),
        "tag_atende": TAG_ATENDE,
        "pipeline_id": _pipeline_do_ambiente() or None,  # o de UNNICHAT_PIPELINE_ONBOARDING (o CS)
        "salvo": vigente is not None,
        "versao": (vigente or {}).get("versao"),
        "salvo_em": _iso((vigente or {}).get("salvo_em")), "salvo_por": (vigente or {}).get("salvo_por"),
        "opcoes": opcoes,
    }


def historico() -> list[dict]:
    tabela = _estado["tabela"]
    with _estado["engine"].connect() as conexao:
        linhas = conexao.execute(select(tabela).order_by(tabela.c.versao.desc()).limit(HISTORICO)).mappings().all()
    return [{"versao": l["versao"], **padrao(), **l["config"], "salvo_em": _iso(l["salvo_em"]), "salvo_por": l["salvo_por"]} for l in linhas]


def _validar(dados: dict) -> dict:
    def erro(texto: str):
        raise ErroCanal(422, texto)

    publicados = {o["id"] for o in _opcoes()}
    quem = (dados.get("atendente") or "").strip()
    if quem not in publicados:
        erro(f"Escolha um agente ou uma equipe publicada para atender. Opções: {', '.join(sorted(publicados))}.")
    porta = (dados.get("leads") or "").strip()
    if porta and porta != SEM_AGENTE and porta not in publicados:
        erro(f"Para os leads, escolha \"{SEM_AGENTE}\", deixe vazio ou escolha um agente ou uma equipe publicada.")
    tags = []
    for bruta in dados.get("tags_sem_agente") or []:
        tag = " ".join(str(bruta).split()).lower()
        if not tag or tag in TAGS_FIXAS or tag in tags:
            continue
        if not TAG_VALIDA.match(tag):
            erro(f"Tag inválida: {tag}. Use letras minúsculas, números, hífen ou sublinhado; * só no fim, como prefixo.")
        if tag.endswith("*") and len(tag) < 4:
            erro(f"O prefixo {tag} é curto demais: calaria o agente com contatos demais. Use pelo menos 3 caracteres antes do *.")
        tags.append(tag)
    if len(tags) > MAX_TAGS:
        erro(f"Até {MAX_TAGS} tags.")
    horas = dados.get("horas_pessoa", HORAS_PESSOA)
    if not isinstance(horas, int) or isinstance(horas, bool) or not 0 <= horas <= MAX_HORAS_PESSOA:
        erro(f"As horas depois da mensagem de uma pessoa da equipe vão de 0 (desligado) a {MAX_HORAS_PESSOA}.")
    somente = dados.get("somente_pipeline", True)
    if not isinstance(somente, bool):
        erro("somente_pipeline é verdadeiro ou falso.")
    dias = dados.get("dias_comercial", DIAS_COMERCIAL)
    if not isinstance(dias, int) or isinstance(dias, bool) or not 0 <= dias <= MAX_DIAS_COMERCIAL:
        erro(f"Os dias de conversa com o time antes da entrada no CS vão de 0 a {MAX_DIAS_COMERCIAL}.")
    tag = dados.get("pela_tag", False)
    if not isinstance(tag, bool):
        erro("pela_tag é verdadeiro ou falso.")
    return {"atendente": quem, "leads": porta, "tags_sem_agente": tags, "horas_pessoa": horas, "somente_pipeline": somente,
            "dias_comercial": dias, "pela_tag": tag}


def alterar(dados: dict, autor: str) -> dict:
    config = _validar(dados)
    with _trava:
        linha = {"config": config, "salvo_em": datetime.now(timezone.utc), "salvo_por": autor}
        with _estado["engine"].begin() as conexao:
            versao = conexao.execute(insert(_estado["tabela"]).values(**linha)).inserted_primary_key[0]
        _estado["vigente"] = {"versao": versao, **linha}
    return obter()
