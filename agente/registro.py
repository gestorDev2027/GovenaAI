"""Põe no ar, sem reiniciar o servidor, um agente criado agora (na implantação ou na Fábrica).

app.py liga `montador` a uma função que monta o Agent do perfil e o entrega ao AgentOS e ao painel. Antes disso
(ao subir, ou no terminal), `ativar` não faz nada: quem chama monta depois (ex.: a demonstração devolve os ids).
"""

from collections.abc import Callable

from agno.utils.log import log_warning

montador: Callable[[str], None] | None = None


def ativar(agente_id: str) -> None:
    if montador is None:
        return
    try:
        montador(agente_id)
    except Exception as erro:  # o agente fica salvo; entra no próximo início
        log_warning(f"Agente {agente_id} salvo, mas não entrou no ar agora: {type(erro).__name__}: {erro}")
