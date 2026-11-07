"""Ferramentas dos agentes de atendimento (compartilhadas; cada perfil escolhe as suas).

As de transferência e encerramento só registram a ação no estado da sessão; o canal (ex.: a
Unnichat, em unnichat_api.py) lê esse estado e executa a ação: nota para o atendente, tags e
despedida. As de cadastro leem os dados do aluno pelas fontes configuradas (agente/cadastro.py).
"""

import json
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
        email_matricula: str = "",
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
                "email_matricula": email_matricula,
            },
        )
        return (
            "Transferência registrada. Envie ao aluno uma mensagem curta avisando que a "
            "equipe de atendimento continuará por esta mesma conversa."
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
        resumo: Resumo da conversa para quem vai continuar o atendimento, em até 5 linhas: o que o contato quer, o que o cadastro mostrou de relevante e o que já foi feito. Sem repetir saudações.
        email_matricula: E-mail de matrícula ou de compra informado pelo contato, se houver.
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


_DESCRICAO_COMPRAS = (
    "as compras (o que comprou, o meio de pagamento, as datas do pedido e da confirmação e a situação: aprovada, "
    "pagamento pendente, estornada) e as tentativas de pagamento recentes que não deram certo (cartão recusado, "
    "pix ou boleto vencido, compra não finalizada)"
)
_DESCRICAO_AREA = (
    "a área do aluno (conta criada, cursos e até quando tem acesso, contrato pendente, turma da pós)"
)


def criar_consultar_cadastro(compras: bool = True, area: bool = True) -> Callable:
    """A consulta do cadastro com as fontes escolhidas para o agente (na fábrica: "Consultar o cadastro"
    e "Área do aluno"). O bloco da fonte não escolhida vem null."""
    partes = [p for p, usa in ((_DESCRICAO_COMPRAS, compras), (_DESCRICAO_AREA, area)) if usa]

    def consultar_cadastro(run_context: RunContext, email: str = "") -> str:
        from agente import cadastro

        estado = run_context.session_state or {}
        telefone = estado.get("telefone") or ""
        if not cadastro.disponivel():
            return "Consulta do cadastro não configurada. Siga sem esses dados."
        if not telefone and not email.strip():
            return "Sem telefone nem e-mail para consultar. Peça o e-mail usado na matrícula."
        try:
            resultado = cadastro.consultar(telefone or None, email.strip() or None, compras=compras, area=area)
        except Exception as erro:  # o atendimento continua mesmo com o banco fora do ar
            return cadastro.aviso_indisponivel(erro)
        if run_context.session_state is not None:
            run_context.session_state["cadastro_consultado"] = True
        return json.dumps(resultado, ensure_ascii=False, default=str)

    consultar_cadastro.__doc__ = f"""Consulta os dados do aluno: {" e ".join(partes)}. E-mails sempre mascarados;
    nada de CPF, endereço ou valores.

    Usa automaticamente o telefone do WhatsApp do aluno. Passe o e-mail quando o aluno informar um
    (ou quando o telefone não encontrar ninguém). Consulte no máximo uma vez por e-mail. Se vier
    telefone_confere = false, o e-mail é de um cadastro com outro telefone: siga a orientacao que vem junto.

    Args:
        email: E-mail informado pelo aluno, se houver.
    """
    return consultar_cadastro


# Compras e área do aluno: a dos agentes do código (cada fonte só entra se estiver configurada).
consultar_cadastro = criar_consultar_cadastro()


def consultar_brindes(run_context: RunContext, email: str = "") -> str:
    """Consulta no Hub de apostilas se as compras do aluno dão direito à apostila física do Exame CFC ou ao livro
    Guia Prático da Reforma Tributária, e em que etapa está o envio (em preparação, etiquetado, postado, aguardando
    retirada nos Correios, entregue), com o código e o link de rastreio. Sem CPF, nome ou endereço.

    Use quando o aluno perguntar se tem direito ao material físico, quando chega, onde está ou pedir o rastreio.
    Usa automaticamente o telefone do WhatsApp; passe o e-mail quando o aluno informar um (ou quando o telefone não
    encontrar ninguém). Consulte no máximo uma vez por e-mail.

    Como ler o resultado:
    - brinde "tem direito": confirme. "não tem direito" ou "cancelado": diga com clareza, com o motivo que vier;
      se o aluno contestar, disser que um vendedor prometeu ou pedir exceção, ofereça passar para a equipe.
    - brinde "sem registro": não afirme que ele não tem direito; siga a regra da campanha do roteiro.
    - envio: diga a etapa e, se houver, mande o link de rastreio. "aguardando retirada nos Correios": avise que ele
      precisa retirar até a data de retirar_ate, levando documento com foto e o código de rastreio.
    - Endereço de entrega não aparece aqui: alteração de endereço vai para a equipe.
    - Siga a orientacao que vier junto (telefone de outra pessoa, mais de uma pessoa no telefone).

    Args:
        email: E-mail informado pelo aluno, se houver.
    """
    from agente import brindes, cadastro

    estado = run_context.session_state or {}
    telefone = estado.get("telefone") or ""
    if not brindes.disponivel():
        return "Consulta de apostilas e brindes não configurada. Siga a regra do roteiro e, para confirmar, ofereça a equipe."
    if not telefone and not email.strip():
        return "Sem telefone nem e-mail para consultar. Peça o e-mail usado na compra."
    try:
        resultado = brindes.consultar(telefone or None, email.strip() or None)
    except Exception as erro:  # o atendimento continua mesmo com o Hub fora do ar
        return cadastro.aviso_indisponivel(erro)
    return json.dumps(resultado, ensure_ascii=False, default=str)


def buscar_aula(pergunta: str, curso_slug: str = "") -> str:
    """Procura nos conteúdos dos cursos (aulas, apostilas, transcrições) o que mais se aproxima do
    assunto que o aluno não está encontrando. Devolve o curso, o nome da aula e um trecho.

    Use quando o aluno não encontrar uma aula ou um assunto. Não use para responder dúvida de conteúdo
    contábil: essas vão para a Comunidade.

    Args:
        pergunta: O assunto ou a aula que o aluno procura, nas palavras dele.
        curso_slug: Curso do aluno, se souber pelo cadastro (campo curso_slug). Vazio busca em todos.
    """
    from agente import cadastro

    if not cadastro.aulas_disponivel():
        return "Busca de aulas não configurada. Ensine o aluno a usar a pesquisa da plataforma."
    try:
        achados = cadastro.buscar_conteudo(pergunta, curso_slug or None, limite=4)
    except Exception as erro:
        return cadastro.aviso_indisponivel(erro)
    if not achados:
        return "Nada encontrado nos conteúdos para esse assunto. Ensine a usar a pesquisa da plataforma."
    return json.dumps(achados, ensure_ascii=False)
