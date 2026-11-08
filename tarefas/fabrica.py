"""Casos de teste da Fábrica no Render: cada caso numa máquina própria, e o resultado de cada um no nosso banco.

O resultado de um caso tem a resposta do agente (texto): ele fica em tarefas_execucoes (Supabase), e o retorno da
tarefa no Render leva só o id do caso e se passou.
"""

from agente import fabrica_recursos, segundo_plano
from tarefas import contexto


def id_do_caso(execucao_id: str, caso_id: int) -> str:
    return f"{execucao_id}-c{caso_id}"


def casos(agente_id: str) -> list[int]:
    contexto.ligar()
    return [c["id"] for c in fabrica_recursos.casos_ativos(agente_id)]


def rodar_caso(execucao_id: str, agente_id: str, caso_id: int) -> dict:
    contexto.ligar()
    filho = id_do_caso(execucao_id, caso_id)
    atual = segundo_plano.andamento(filho)
    if atual and atual["situacao"] == "concluida":  # a execução inteira foi repetida: o caso já rodou
        return {"caso": caso_id, "passou": bool((atual.get("resultado") or {}).get("passou"))}
    if atual is None:  # numa nova tentativa, a linha já existe
        segundo_plano.criar("rodar_caso", referencia=execucao_id, execucao_id=filho)
    caso = next((c for c in fabrica_recursos.casos_ativos(agente_id) if c["id"] == caso_id), None)
    if caso is None:
        resultado = {"caso": caso_id, "passou": False, "motivos": ["o caso foi apagado ou desativado no meio"]}
        segundo_plano.concluir(filho, resultado)
    else:
        atendente = contexto.atendente(agente_id)
        resultado = segundo_plano.executar(filho, lambda: fabrica_recursos.rodar_caso(atendente, caso))
    return {"caso": caso_id, "passou": bool(resultado.get("passou"))}


def fechar(execucao_id: str, fabrica_execucao: int, caso_ids: list[int], erro: str | None = None) -> dict:
    """Junta os resultados dos casos (na ordem) e grava a execução da Fábrica."""
    contexto.ligar()
    resultados = []
    for caso_id in caso_ids:
        filho = segundo_plano.andamento(id_do_caso(execucao_id, caso_id)) or {}
        resultados.append(filho.get("resultado") or {
            "caso": caso_id, "passou": False, "motivos": [filho.get("erro") or "o caso não chegou ao fim"]})
    return fabrica_recursos.gravar_execucao(fabrica_execucao, resultados, "falhou" if erro else "concluida", erro)
