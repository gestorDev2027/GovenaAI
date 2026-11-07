"""Equipes de agentes: vários agentes no mesmo canal, com uma recepção que escolhe quem responde.

É o Team do Agno no modo route. A recepção (o líder) lê a mensagem e passa a conversa ao agente certo;
quem responde ao contato é sempre o agente, nunca a recepção. Configuração escolhida na prova de 27/10/2026:
- determine_input_for_members=False: o agente recebe a mensagem como o contato escreveu (e os anexos),
  sem a recepção reescrever;
- add_team_history_to_members: o agente que assume no meio vê o que o contato já falou com os outros
  (na prova, a Luna lembrou do problema de acesso depois de a Vera responder sobre a nota fiscal);
- o estado da conversa (status, transferência, encerramento) é um só, o da equipe: a transferência
  feita pela Vera vale para a conversa inteira.

Cada equipe tem os próprios Agents (montados de novo a partir dos perfis), para o Team não mexer nos
que atendem sozinhos. O Agno grava uma conversa só, da equipe (session_type team), com a resposta de
cada agente dentro dela; `conversa()` e `conversas_do_agente()` mostram essa conversa ao painel como se
fosse de agente, com cada resposta atribuída a quem respondeu e a conversa na mesa de quem está com ela.

Configuração no banco (fabrica_equipes), pela fábrica de agentes: nome, membros, orientações para a
recepção, agente padrão (saudação, mensagem vaga e boas-vindas) e publicação (ativa ou inativa).

Exclusão lógica: a equipe excluída sai de EQUIPES e das listas, mas a linha fica (o id continua
reservado e as conversas antigas, com o padrão dela). A equipe do Canal WhatsApp (agente/canal.py), como
atendente ou como agente dos leads, não pode ser desativada nem excluída.
"""

import re
import threading
from datetime import datetime, timezone

from agno.db.base import SessionType
from agno.team import Team
from agno.team.mode import TeamMode
from agno.utils.log import log_warning
from sqlalchemy import JSON, Boolean, Column, DateTime, MetaData, String, Table, Text, insert, inspect, select, text, update
from sqlalchemy.engine import Engine

from agente import guardrails, listas, perfis
from agente.ferramentas import STATUS_EM_ATENDIMENTO

ID_VALIDO = re.compile(r"^[a-z0-9-]{3,30}$")
MAX_MEMBROS = 8
HISTORICO_PARA_MEMBROS = 10  # mensagens anteriores que o agente que assume recebe

ORIENTACOES_BASE = """
Você é a recepção da Secretaria Municipal de Saúde no GestorGov. Você NÃO conversa com o servidor:
a cada mensagem, escolha o agente da equipe que deve responder e passe a mensagem para ele.
- Escolha pelo assunto da mensagem e pela descrição de cada agente.
- Se a conversa já está com um agente e a mensagem continua o mesmo assunto, mantenha o mesmo agente.
- Saudação, agradecimento, mensagem vaga ou assunto que nenhum agente cobre: passe para {padrao}.
- Nunca responda você mesma, nem acrescente nada à resposta do agente.
""".strip()

_estado: dict = {"config": {}}
_trava = threading.Lock()
EQUIPES: dict[str, Team] = {}  # id -> Team; o mesmo dicionário no painel e no AgentOS


class ErroEquipe(Exception):
    def __init__(self, status: int, detalhe: str):
        super().__init__(detalhe)
        self.status, self.detalhe = status, detalhe


def _agora() -> datetime:
    return datetime.now(timezone.utc)


def _iso(momento) -> str | None:
    return momento.isoformat() if momento else None


def eh_equipe(atendente) -> bool:
    return isinstance(atendente, Team)


# ───────── Banco e montagem ─────────

def iniciar(engine: Engine, schema: str | None = None) -> None:
    tabela = Table(
        "fabrica_equipes", MetaData(schema=schema),
        Column("id", String(40), primary_key=True),
        Column("nome", String(80), nullable=False),
        Column("descricao", String(300), nullable=False),
        Column("membros", JSON, nullable=False),  # ids dos agentes, na ordem
        Column("padrao", String(40), nullable=False),  # quem recebe saudação e mensagem vaga
        Column("orientacoes", Text, nullable=False),  # o que a recepção deve saber além da descrição dos agentes
        Column("publicada", Boolean, nullable=False, default=False),
        Column("criado_em", DateTime(timezone=True), nullable=False),
        Column("criado_por", String(200), nullable=False),
        Column("atualizado_em", DateTime(timezone=True), nullable=False),
        Column("atualizado_por", String(200), nullable=False),
        Column("excluida_em", DateTime(timezone=True), nullable=True),
        Column("excluida_por", String(200), nullable=True),
    )
    tabela.metadata.create_all(engine, tables=[tabela])
    # Colunas que chegaram depois da tabela (create_all não altera tabelas existentes).
    existentes = {c["name"] for c in inspect(engine).get_columns(tabela.name, schema=schema)}
    nome = f"{schema}.{tabela.name}" if schema else tabela.name
    for coluna in (tabela.c.excluida_em, tabela.c.excluida_por):
        if coluna.name not in existentes:
            with engine.begin() as conexao:
                conexao.execute(text(f"ALTER TABLE {nome} ADD COLUMN {coluna.name} {coluna.type.compile(dialect=engine.dialect)}"))
    with engine.connect() as conexao:
        linhas = [dict(l) for l in conexao.execute(select(tabela)).mappings().all()]
    _estado.update(engine=engine, tabela=tabela, config={l["id"]: l for l in linhas})


def _vivas() -> dict[str, dict]:
    """As equipes que não foram excluídas (as excluídas ficam em _estado["config"] para as conversas antigas)."""
    return {i: c for i, c in _estado["config"].items() if not c.get("excluida_em")}


def membros_ativos(config: dict) -> list[str]:
    """Quem a recepção pode escolher. Na equipe publicada, só os agentes publicados (despublicar um
    agente na fábrica o tira da distribuição); o padrão fica sempre, porque é para ele que vai o que
    ninguém cobre. Na equipe em rascunho, todos, para testar no chat antes de publicar."""
    return [m for m in config["membros"] if perfis.existe(m)
            and (not config.get("publicada") or m == config["padrao"] or perfis.publicado(m))]


def montar(config: dict, banco) -> Team:
    """O Team da equipe, com Agents próprios montados a partir dos perfis vigentes."""
    from agente.agente import montar_agente  # aqui: agente.agente importa este módulo

    membros = [montar_agente(perfis.PERFIS[m], banco) for m in membros_ativos(config)]
    padrao = perfis.identidade(config["padrao"])["nome"]
    orientacoes = ORIENTACOES_BASE.format(padrao=f"{padrao} ({config['padrao']})")
    if (config.get("orientacoes") or "").strip():
        orientacoes += "\n\nOrientações desta equipe:\n" + config["orientacoes"].strip()
    return Team(
        id=config["id"],
        name=config["nome"],
        description=config["descricao"],
        mode=TeamMode.route,
        members=membros,
        # A recepção só escolhe o agente: raciocínio baixo, para não somar demora a cada mensagem.
        model=_modelo_da_recepcao(),
        instructions=orientacoes,
        db=banco,
        session_state={"status": STATUS_EM_ATENDIMENTO, "acoes": [], "nome_contato": "", "telefone": ""},
        determine_input_for_members=False,
        add_team_history_to_members=True,
        num_team_history_runs=HISTORICO_PARA_MEMBROS,
        add_history_to_context=True,
        num_history_runs=HISTORICO_PARA_MEMBROS,
        markdown=False,
        # CPF e cartão mascarados e manipulação barrada já na recepção (cada agente repete a checagem).
        pre_hooks=guardrails.guardrails(config["padrao"], banco.db_engine, getattr(banco, "db_schema", None)),
    )


def _modelo_da_recepcao():
    from agente.agente import _modelo

    modelo = _modelo()
    modelo.thinking_level = "low"
    return modelo


def montar_todas(banco) -> dict[str, Team]:
    """Monta (ou remonta) todas as equipes salvas, no mesmo dicionário EQUIPES."""
    for config in _vivas().values():
        try:
            EQUIPES[config["id"]] = montar(config, banco)
        except Exception as erro:  # um agente apagado ou mal configurado não derruba as outras equipes
            log_warning(f"Equipe {config['id']} não montada: {type(erro).__name__}: {erro}")
    return EQUIPES


def com_agente(agente_id: str) -> list[str]:
    """As equipes de que o agente faz parte (para remontá-las quando ele muda)."""
    return [i for i, c in _vivas().items() if agente_id in c["membros"]]


def com_padrao(agente_id: str) -> list[str]:
    """Os nomes das equipes em que o agente é o padrão (ele não pode ser excluído enquanto for)."""
    return [c["nome"] for c in _vivas().values() if c["padrao"] == agente_id]


def remover_membro(agente_id: str, autor: str) -> list[str]:
    """Tira o agente (excluído na fábrica) de todas as equipes; devolve os ids das equipes alteradas,
    para quem chama remontá-las."""
    alteradas = []
    with _trava:
        for equipe_id, config in _vivas().items():
            if agente_id not in config["membros"]:
                continue
            membros = [m for m in config["membros"] if m != agente_id]
            agora = _agora()
            with _estado["engine"].begin() as conexao:
                conexao.execute(update(_estado["tabela"]).where(_estado["tabela"].c.id == equipe_id)
                                .values(membros=membros, atualizado_em=agora, atualizado_por=autor))
            config.update(membros=membros, atualizado_em=agora, atualizado_por=autor)
            alteradas.append(equipe_id)
    return alteradas


def padrao(equipe: Team) -> str:
    return _estado["config"].get(equipe.id, {}).get("padrao") or perfis.PADRAO


def publicada(equipe_id: str) -> bool:
    return bool(_estado["config"].get(equipe_id, {}).get("publicada"))


# ───────── Cadastro (fábrica de agentes) ─────────

def _como_dict(config: dict) -> dict:
    return {"id": config["id"], "nome": config["nome"], "descricao": config["descricao"], "membros": list(config["membros"]),
            "padrao": config["padrao"], "orientacoes": config["orientacoes"], "publicada": bool(config["publicada"]),
            "criado_em": _iso(config.get("criado_em")), "criado_por": config.get("criado_por"),
            "atualizado_em": _iso(config.get("atualizado_em")), "atualizado_por": config.get("atualizado_por")}


def listar() -> list[dict]:
    return [_como_dict(c) for c in sorted(_vivas().values(), key=lambda c: c["nome"].lower())]


def obter(equipe_id: str) -> dict:
    if equipe_id not in _vivas():
        raise ErroEquipe(404, f"Equipe desconhecida: {equipe_id}.")
    return _como_dict(_estado["config"][equipe_id])


def _validar(dados: dict) -> dict:
    def erro(texto: str):
        raise ErroEquipe(422, texto)

    nome = " ".join((dados.get("nome") or "").split())
    descricao = " ".join((dados.get("descricao") or "").split())
    if not nome or len(nome) > 80:
        erro("O nome da equipe é obrigatório e tem até 80 caracteres.")
    if len(descricao) > 300:
        erro("A descrição tem até 300 caracteres.")
    membros = list(dict.fromkeys(dados.get("membros") or []))
    desconhecidos = [m for m in membros if not perfis.existe(m)]
    if desconhecidos:
        erro(f"Agente desconhecido: {', '.join(desconhecidos)}.")
    if not 2 <= len(membros) <= MAX_MEMBROS:
        erro(f"Uma equipe tem de 2 a {MAX_MEMBROS} agentes: com um só, ligue o agente direto ao canal.")
    padrao_id = dados.get("padrao") or membros[0]
    if padrao_id not in membros:
        erro("O agente padrão precisa ser um dos membros da equipe.")
    orientacoes = (dados.get("orientacoes") or "").strip()
    if len(orientacoes) > 4000:
        erro("As orientações para a recepção têm até 4.000 caracteres.")
    return {"nome": nome, "descricao": descricao or nome, "membros": membros, "padrao": padrao_id, "orientacoes": orientacoes}


def criar(equipe_id: str, dados: dict, autor: str) -> dict:
    equipe_id = (equipe_id or "").strip()
    if not ID_VALIDO.match(equipe_id):
        raise ErroEquipe(422, "O identificador tem de 3 a 30 caracteres: letras minúsculas, números e hífen.")
    valores = _validar(dados)
    with _trava:
        if equipe_id in _estado["config"] or equipe_id in perfis.PERFIS:
            raise ErroEquipe(409, f"Já existe um agente ou uma equipe com o identificador {equipe_id}.")
        agora = _agora()
        linha = {"id": equipe_id, **valores, "publicada": False, "criado_em": agora, "criado_por": autor,
                 "atualizado_em": agora, "atualizado_por": autor}
        with _estado["engine"].begin() as conexao:
            conexao.execute(insert(_estado["tabela"]).values(**linha))
        _estado["config"][equipe_id] = linha
    return obter(equipe_id)


def alterar(equipe_id: str, dados: dict, autor: str) -> dict:
    obter(equipe_id)
    valores = _validar(dados)
    with _trava:
        agora = _agora()
        with _estado["engine"].begin() as conexao:
            conexao.execute(update(_estado["tabela"]).where(_estado["tabela"].c.id == equipe_id)
                            .values(**valores, atualizado_em=agora, atualizado_por=autor))
        _estado["config"][equipe_id].update(valores, atualizado_em=agora, atualizado_por=autor)
    return obter(equipe_id)


def publicar(equipe_id: str, publicada_: bool, autor: str) -> dict:
    obter(equipe_id)  # 404 se não existe
    with _trava:
        agora = _agora()
        with _estado["engine"].begin() as conexao:
            conexao.execute(update(_estado["tabela"]).where(_estado["tabela"].c.id == equipe_id)
                            .values(publicada=publicada_, atualizado_em=agora, atualizado_por=autor))
        _estado["config"][equipe_id].update(publicada=publicada_, atualizado_em=agora, atualizado_por=autor)
    return obter(equipe_id)


def excluir(equipe_id: str, autor: str) -> None:
    """Exclusão lógica de uma equipe inativa: sai de EQUIPES e das listas."""
    equipe = obter(equipe_id)
    if equipe["publicada"]:
        raise ErroEquipe(409, f"Desative {equipe['nome']} antes de excluir.")
    with _trava:
        agora = _agora()
        with _estado["engine"].begin() as conexao:
            conexao.execute(update(_estado["tabela"]).where(_estado["tabela"].c.id == equipe_id)
                            .values(excluida_em=agora, excluida_por=autor, atualizado_em=agora, atualizado_por=autor))
        _estado["config"][equipe_id].update(excluida_em=agora, excluida_por=autor, atualizado_em=agora, atualizado_por=autor)
        EQUIPES.pop(equipe_id, None)


# ───────── Conversas de equipe vistas como de agente ─────────

def resposta_do_membro(saida):
    """A resposta do agente que atendeu, dentro da resposta da equipe (None se a recepção não passou adiante)."""
    membros = getattr(saida, "member_responses", None) or []
    return membros[-1] if membros else None


class _RespostaDaEquipe:
    """Uma mensagem de conversa de equipe como resposta de agente: a mensagem do contato como chegou, a
    resposta e as ferramentas do agente que atendeu, e o custo da recepção somado ao dele."""

    def __init__(self, da_equipe, do_membro, padrao_id: str):
        self._base = do_membro or da_equipe
        self.input = da_equipe.input
        self.content = da_equipe.content
        self.agent_id = getattr(do_membro, "agent_id", None) or padrao_id
        self.metrics = da_equipe.metrics
        if do_membro is not None and da_equipe.metrics and do_membro.metrics:
            soma = da_equipe.metrics + do_membro.metrics
            soma.duration = da_equipe.metrics.duration  # o tempo que o contato esperou
            self.metrics = soma
        self.tools = getattr(do_membro, "tools", None) if do_membro is not None else []

    def __getattr__(self, nome):
        return getattr(self._base, nome)


class ConversaDaEquipe:
    """Uma conversa de equipe com a cara de uma conversa de agente: `agent_id` é quem está com ela agora
    (o último a responder) e `team_id`, a equipe."""

    def __init__(self, sessao, padrao_id: str):
        self._sessao = sessao
        self.team_id = sessao.team_id
        respostas = list(sessao.runs or [])
        do_membro = {}
        for run in respostas:
            pai = getattr(run, "parent_run_id", None)
            if pai and getattr(run, "agent_id", None):
                do_membro[pai] = run  # o último agente da mensagem vale
        self.runs = [_RespostaDaEquipe(r, do_membro.get(r.run_id), padrao_id)
                     for r in respostas if not getattr(r, "parent_run_id", None)]
        self.agent_id = self.runs[-1].agent_id if self.runs else padrao_id

    def __getattr__(self, nome):
        return getattr(self._sessao, nome)


def _padrao_de(team_id: str | None) -> str:
    return _estado["config"].get(team_id or "", {}).get("padrao") or perfis.PADRAO


def conversa(db, session_id: str):
    """A conversa de equipe com esse id, já no formato de agente; None se não for de equipe. O Agno (3.1.6) devolve
    qualquer sessão com o id pedido como de equipe, inclusive a de um agente: sem `team_id`, não é de equipe (antes,
    a conversa do agente vinha como de equipe e perdia as ferramentas de cada resposta na tela Conversas)."""
    try:
        sessao = db.get_session(session_id=session_id, session_type=SessionType.TEAM)
    except Exception:
        return None
    return ConversaDaEquipe(sessao, _padrao_de(sessao.team_id)) if sessao and getattr(sessao, "team_id", None) else None


def conversas_do_agente(db, agente_id: str, desde_epoch: int | None = None, limite: int = 500,
                        ate_epoch: int | None = None, por_atividade: bool = False) -> list:
    """As conversas de equipe que estão com o agente (o último a responder foi ele)."""
    if not _estado["config"]:
        return []
    # Uma busca para todos os agentes (ver listas.sessoes_recentes).
    sessoes = listas.sessoes_recentes(db, SessionType.TEAM, desde_epoch, limite, ate_epoch, por_atividade)
    saida = []
    for sessao in sessoes:
        if getattr(sessao, "team_id", None) not in _estado["config"]:
            continue
        adaptada = ConversaDaEquipe(sessao, _padrao_de(sessao.team_id))
        if adaptada.agent_id == agente_id:
            saida.append(adaptada)
    return saida


def agente_atual(equipe: Team, session_id: str) -> str:
    """Quem está com a conversa agora (antes de a recepção decidir a próxima mensagem)."""
    adaptada = conversa(equipe.db, session_id)
    return adaptada.agent_id if adaptada else padrao(equipe)
