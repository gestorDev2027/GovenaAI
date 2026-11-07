"""Ferramentas comuns dos agentes (cada perfil escolhe as suas): transferir para uma pessoa e encerrar.

Elas só registram a ação no estado da sessão; o painel (e, no futuro agente do cidadão, o canal do
WhatsApp) lê esse estado e mostra a ação para a equipe.
"""

from datetime import datetime
from typing import Callable, Literal

from agno.run import RunContext

STATUS_EM_ATENDIMENTO = "em_atendimento"
STATUS_TRANSFERIDO = "transferido"
STATUS_ENCERRADO = "encerrado"


def _registrar(run_context: RunContext, status: str, acao: dict) -> None:
    if run_context.session_state is None:
        run_context.session_state = {}
    run_context.session_state["status"] = status
    run_context.session_state.setdefault("acoes", []).append(
        {**acao, "registrado_em": datetime.now().isoformat(timespec="seconds")}
    )


def criar_transferir(categorias: dict[str, str], quando_usar: str, descricao_categoria: str) -> Callable:
    """Ferramenta de transferência de um agente, com as categorias dele (cada perfil tem as suas).

    A categoria vira um Literal na assinatura: o modelo só consegue escolher uma das previstas, e o
    painel e a nota para o atendente agrupam os motivos por ela.
    """
    Categoria = Literal[tuple(categorias)]  # type: ignore[valid-type]

    def transferir_para_humano(
        run_context: RunContext,
        categoria: Categoria,
        motivo: str,
        dificuldade_relatada: str,
        orientacoes_prestadas: str,
        resumo: str,
    ) -> str:
        _registrar(
            run_context,
            STATUS_TRANSFERIDO,
            {
                "tipo": "transferencia",
                "categoria": categoria if categoria in categorias else "outro",
                "motivo": motivo,
                "dificuldade_relatada": dificuldade_relatada,
                "orientacoes_prestadas": orientacoes_prestadas,
                "resumo": resumo,
            },
        )
        return (
            "Transferência registrada. Avise o contato, numa mensagem curta, que a equipe "
            "continuará por esta mesma conversa."
        )

    transferir_para_humano.quando_usar = quando_usar  # a fábrica de agentes mostra e edita esse texto
    # O Agno lê a descrição e os argumentos da docstring para explicar a ferramenta ao modelo.
    transferir_para_humano.__doc__ = f"""Transfere o atendimento para a equipe humana.

    {quando_usar}

    Args:
        categoria: {descricao_categoria}
        motivo: Motivo da transferência, em uma frase.
        dificuldade_relatada: O que o contato relatou, com as palavras dele quando possível.
        orientacoes_prestadas: Orientações já enviadas e o resultado de cada uma.
        resumo: Resumo da conversa para quem vai continuar o atendimento, em até 5 linhas: o que o contato quer, o que as consultas mostraram de relevante e o que já foi feito. Sem repetir saudações.
    """
    return transferir_para_humano


def encerrar_atendimento(run_context: RunContext, motivo: str) -> str:
    """Encerra o atendimento depois que o contato disser que não precisa de mais ajuda.

    Use somente depois de enviar a mensagem de despedida.

    Args:
        motivo: Motivo do encerramento, em uma frase.
    """
    _registrar(run_context, STATUS_ENCERRADO, {"tipo": "encerramento", "motivo": motivo})
    return "Atendimento encerrado."

