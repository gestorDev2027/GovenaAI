"""O banco e o cadastro numa máquina de tarefa: o mesmo Supabase do servidor web, sem montar o AgentOS."""

from agente import base, conhecimento, equipes, fabrica, gestao, perfis, segundo_plano
from agente.agente import criar_banco, montar_agente, schema_banco

_estado: dict = {"banco": None}


def ligar():
    """Liga os módulos ao banco (uma vez por máquina) e devolve o banco do Agno."""
    if _estado["banco"] is None:
        banco = criar_banco()
        schema = schema_banco()
        for modulo in (base, conhecimento, fabrica, equipes, gestao, segundo_plano):
            modulo.iniciar(banco.db_engine, schema)
        _estado["banco"] = banco
    return _estado["banco"]


def atendente(agente_id: str):
    """O agente (ou a equipe) pelo id, montado nesta máquina."""
    banco = ligar()
    if perfis.existe(agente_id):
        return montar_agente(perfis.PERFIS[agente_id], banco)
    equipe = equipes.montar_todas(banco).get(agente_id)
    if equipe is None:
        raise LookupError(f"Agente ou equipe desconhecida: {agente_id}.")
    return equipe
