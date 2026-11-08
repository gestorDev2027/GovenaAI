"""Ferramentas do Assistente de Processos: o gestor desenha, em conversa, as atividades das áreas e o processo de
cada uma (os passos do agente e onde uma pessoa aceita, aprova ou revisa). Grava em agente/trabalho.py.

A organização vem do estado da sessão (organizacao_id, posto pela rota do painel com a organização de quem está
logado; quem conversa precisa da permissão "gerenciar os fluxos").
"""

import json

from agno.run import RunContext
from pydantic import BaseModel, Field

from agente import gestao, trabalho

FREQUENCIAS = ("a_cada_hora", "diaria", "semanal", "mensal", "sob_demanda")
CRON_PADRAO = {"a_cada_hora": "0 * * * *", "diaria": "0 7 * * 1-5", "semanal": "0 7 * * 1", "mensal": "0 7 1 * *"}


class PassoProcesso(BaseModel):
    """Um passo do processo."""

    tipo: str = Field(description="agente (o agente faz), aceite (uma pessoa aceita a tarefa), aprovacao (uma pessoa "
                                  "aprova uma ação sensível antes de o agente fazê-la) ou revisao (uma pessoa avalia a entrega)")
    titulo: str = Field(description="o passo em poucas palavras (ex.: Priorizar os pagamentos)")
    instrucoes: str = Field(default="", description="só nos passos do agente: o que ele faz, em uma ou duas frases")
    cargos: list[str] = Field(default_factory=list,
                              description="só nos passos de pessoa: os NOMES dos cargos que decidem; vazio = quem aprova na área e a direção")


def _json(dados) -> str:
    return json.dumps(gestao._json(dados), ensure_ascii=False, default=str)


def _org(run_context: RunContext) -> str | None:
    return (run_context.session_state or {}).get("organizacao_id")


def _quem(run_context: RunContext) -> str:
    return (run_context.session_state or {}).get("conta_email") or "processos"


def _atividade(oid: str, chave: str) -> dict | None:
    alvo = gestao._sem_acento(chave)
    lista = gestao.atividades(oid)
    return (next((a for a in lista if str(a["id"]) == chave), None)
            or next((a for a in lista if gestao._sem_acento(a["nome"]) == alvo), None)
            or next((a for a in lista if alvo and alvo in gestao._sem_acento(a["nome"])), None))


def _nomes_dos_cargos(oid: str) -> dict[str, str]:
    from agente import acessos

    return {str(c["id"]): c["nome"] for c in acessos.cargos(oid)}


def listar_atividades(run_context: RunContext, area: str = "") -> str:
    """As atividades da organização (ou de uma área), com o tipo, a frequência e o processo de cada uma (os passos e
    quem decide). Use antes de propor qualquer mudança.

    Args:
        area: nome ou tipo da área (vazio: todas).
    """
    oid = _org(run_context)
    if not oid:
        return "Nenhuma organização nesta conversa."
    alvo = gestao.area_por_tipo_ou_nome(oid, area) if area else None
    cargos = _nomes_dos_cargos(oid)
    areas = {str(a["id"]): a["nome"] for a in gestao.areas(oid)}
    saida = []
    for a in gestao.atividades(oid):
        if alvo and str(a["area_id"]) != str(alvo["id"]):
            continue
        proc = trabalho.processo(oid, str(a["id"])) if trabalho.disponivel() else None
        passos = [{**p, "cargos": [cargos.get(c, c) for c in p.get("cargos") or []]} for p in (proc or {}).get("passos") or []]
        saida.append({"atividade": a["nome"], "area": areas.get(str(a["area_id"])), "tipo": a["tipo"],
                      "frequencia": a["frequencia"], "entregavel": a.get("entregavel"),
                      "versao_do_processo": (proc or {}).get("versao"), "passos": passos})
    return _json({"atividades": saida, "areas": list(areas.values())})


def listar_cargos(run_context: RunContext) -> str:
    """Os cargos do organograma (com a área), para dizer quem decide cada passo de pessoa."""
    from agente import acessos

    oid = _org(run_context)
    if not oid:
        return "Nenhuma organização nesta conversa."
    areas = {str(a["id"]): a["nome"] for a in gestao.areas(oid)}
    return _json([{"cargo": c["nome"], "nivel": c["nivel"], "area": areas.get(str(c.get("area_id")))} for c in acessos.cargos(oid)])


def salvar_processo(run_context: RunContext, atividade: str, passos: list[PassoProcesso]) -> str:
    """Grava o processo de uma atividade (uma versão nova; a anterior fica na auditoria). Só depois de o gestor
    confirmar os passos. Regras: tem um aceite (uma pessoa aceita antes de o trabalho começar) e termina numa revisão.

    Args:
        atividade: o nome da atividade.
        passos: os passos, em ordem.
    """
    oid = _org(run_context)
    if not oid:
        return "Nenhuma organização nesta conversa."
    alvo = _atividade(oid, atividade)
    if not alvo:
        return "Atividade não encontrada. Use listar_atividades para ver os nomes."
    por_nome = {gestao._sem_acento(n): i for i, n in _nomes_dos_cargos(oid).items()}
    convertidos, desconhecidos = [], []
    for p in passos or []:
        dados = p.model_dump() if isinstance(p, BaseModel) else dict(p)
        ids = []
        for nome in dados.get("cargos") or []:
            cid = por_nome.get(gestao._sem_acento(nome))
            (ids.append(cid) if cid else desconhecidos.append(nome))
        convertidos.append({**dados, "cargos": ids})
    if desconhecidos:
        return f"Estes cargos não existem: {', '.join(desconhecidos)}. Use listar_cargos e confirme com o gestor."
    try:
        proc = trabalho.salvar_processo(oid, str(alvo["id"]), convertidos, _quem(run_context),
                                        session_id=getattr(run_context, "session_id", None))
    except ValueError as erro:
        return str(erro)
    return _json({"salvo": True, "atividade": alvo["nome"], "versao": proc.get("versao"),
                  "orientacao": "Diga que o processo foi gravado e já aparece na lista ao lado."})


def criar_atividade(run_context: RunContext, area: str, nome: str, descricao: str, tipo: str,
                    frequencia: str = "sob_demanda", entregavel: str = "") -> str:
    """Cria uma atividade numa área (com o processo padrão: o agente faz, uma pessoa aceita e revisa), depois de o
    gestor confirmar. Ajuste o processo em seguida, se ele quiser, com salvar_processo.

    Args:
        area: nome ou tipo da área.
        nome: nome curto da atividade.
        descricao: o que o agente faz, em uma ou duas frases.
        tipo: "rotina" (o agente faz sozinho, num horário) ou "sob_demanda" (alguém pede).
        frequencia: a_cada_hora, diaria, semanal, mensal ou sob_demanda.
        entregavel: o que volta para a pessoa aprovar.
    """
    oid = _org(run_context)
    if not oid:
        return "Nenhuma organização nesta conversa."
    alvo = gestao.area_por_tipo_ou_nome(oid, area)
    if not alvo:
        return "Área não encontrada. As áreas: " + ", ".join(a["nome"] for a in gestao.areas(oid)) + "."
    if tipo not in ("rotina", "sob_demanda"):
        return 'O tipo é "rotina" ou "sob_demanda".'
    if frequencia not in FREQUENCIAS:
        return f"Frequência inválida. Use: {', '.join(FREQUENCIAS)}."
    frequencia = "sob_demanda" if tipo == "sob_demanda" else ("diaria" if frequencia == "sob_demanda" else frequencia)
    atividade = gestao.salvar_atividade(oid, str(alvo["id"]), nome=nome, descricao=descricao, tipo=tipo, frequencia=frequencia,
                                        cron=CRON_PADRAO.get(frequencia), entregavel=entregavel or None, quem=_quem(run_context),
                                        session_id=getattr(run_context, "session_id", None))
    if trabalho.disponivel():
        trabalho.sincronizar(oid, _quem(run_context))
    return _json({"criada": atividade["nome"], "area": alvo["nome"], "processo": "padrão (agente, aceite, agente, revisão)"})


FERRAMENTAS_PROCESSOS = [listar_atividades, listar_cargos, salvar_processo, criar_atividade]
