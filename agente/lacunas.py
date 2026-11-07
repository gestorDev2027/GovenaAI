"""Lacunas: as respostas em que o agente não teve o que dizer, achadas nas conversas reais.

Uma resposta é lacuna quando o agente:
- transferiu para a equipe (o caso saiu da mão dele);
- disse ao aluno que não tem a informação, ou registrou isso no raciocínio;
- buscou uma aula e não achou nada.

O servidor só aponta. Quem preenche é o time: a resposta escrita numa lacuna entra na fila da Calibração
como avaliação pendente e, aprovada, vira gabarito e exemplo (calibracao_api.py). Assim o rastro mostra o
que falta e nada entra no comportamento do agente sem uma pessoa conferir (um texto do próprio agente
"não sei" não pode virar conhecimento).

`organizar` pede ao modelo um assunto curto para cada lacuna ("sorteio da Black", "segunda pós"), para
juntar as parecidas; o assunto fica guardado e só as lacunas novas voltam ao modelo.
"""

import re

from agno.agent import Agent
from pydantic import BaseModel, Field

from agente.agente import _modelo

TRANSFERIR = "transferir_para_humano"
BUSCAR_AULA = "buscar_aula"

SINAIS = {
    "transferiu": "Transferiu para a equipe",
    "sem_informacao": "Disse que não tem a informação",
    "aula_nao_encontrada": "Não achou a aula",
}

# O agente dizendo ao aluno (ou a si mesmo, no raciocínio) que não tem a informação. Pede "informação",
# "detalhes", "regras" ou "regulamento" perto da negação, para não confundir com "não encontrei seu cadastro".
_SEM_INFORMACAO = re.compile(
    r"n[ãa]o\s+(tenho|temos|possuo|possui|possu[íi]mos|disponho\s+de|encontrei|localizei|achei|h[áa]"
    r"|consigo\s+(te\s+)?(passar|confirmar|informar|dar))[^.!?\n]{0,40}(informa[çc]|detalhe|regra|regulamento)"
    r"|informa[çc](ão|ões)[^.!?\n]{0,40}n[ãa]o\s+(est[áa]|est[ãa]o|constam?|aparecem?)\s+(dispon[íi]ve|no\s+(roteiro|material|sistema)|aqui)"
    r"|fora\s+do\s+(roteiro|material|que\s+tenho)",
    re.IGNORECASE,
)
# Resultado de ferramenta sem nada: o cadastro devolve "encontrado": False (ou 0 encontrados) e a busca nos
# conteúdos, "Nada encontrado". O painel usa o mesmo critério nas ferramentas da Central.
SEM_RESULTADO = re.compile(r"""encontrad[oa]s?['"]?\s*:\s*(false|0)\b|nada encontrado""", re.IGNORECASE)


def _ferramentas(run) -> list:
    return list(getattr(run, "tools", None) or [])


def sinais(run) -> tuple[list[str], dict | None]:
    """Os sinais de lacuna de uma resposta e, se ela transferiu, os argumentos da transferência."""
    achados, transferencia = [], None
    for chamada in _ferramentas(run):
        nome = getattr(chamada, "tool_name", None)
        if nome == TRANSFERIR:
            transferencia = dict(getattr(chamada, "tool_args", None) or {})
            achados.append("transferiu")
        elif nome == BUSCAR_AULA and SEM_RESULTADO.search(str(getattr(chamada, "result", "") or "")):
            achados.append("aula_nao_encontrada")
    textos = (getattr(run, "content", None), getattr(run, "reasoning_content", None))
    if any(isinstance(t, str) and _SEM_INFORMACAO.search(t) for t in textos):
        achados.append("sem_informacao")
    return list(dict.fromkeys(achados)), transferencia


class Assunto(BaseModel):
    id: str = Field(description="O id da lacuna, igual ao recebido.")
    assunto: str = Field(description="O assunto em 2 a 5 palavras, em minúsculas, sem o nome do aluno.")


class Assuntos(BaseModel):
    assuntos: list[Assunto]


INSTRUCOES = """Você organiza as lacunas de um agente do GestorGov (setores da Secretaria Municipal de Saúde): mensagens em que
o agente não soube responder e encaminhou ou disse que não tinha a informação. Para cada lacuna, dê o assunto concreto da
dúvida do servidor em 2 a 5 palavras (ex.: "modelo de edital do município", "meta de visitas dos ACS", "prazo de envio da produção",
"contrato de manutenção vencido", "fila de cardiologia"). Prefira um assunto da lista dos já usados quando for a mesma
dúvida, escrito igual, para as lacunas parecidas ficarem juntas. Nunca use nome, e-mail ou telefone de pessoas nem dados de pacientes. Responda em
português correto."""


def organizar(lacunas: list[dict], ja_usados: list[str]) -> dict[str, str]:
    """{id: assunto} para as lacunas ({id, mensagem, motivo}). Ids que o modelo não devolver ficam de fora."""
    if not lacunas:
        return {}
    itens = "\n\n".join(
        f"<lacuna id=\"{l['id']}\">\nMensagem do aluno: {l.get('mensagem') or '(vazia)'}\n"
        f"Motivo registrado pelo agente: {l.get('motivo') or '(nenhum)'}\n</lacuna>" for l in lacunas)
    usados = "\n".join(f"- {a}" for a in ja_usados) or "(nenhum ainda)"
    pedido = f"<assuntos_ja_usados>\n{usados}\n</assuntos_ja_usados>\n\n{itens}"
    assistente = Agent(model=_modelo(), instructions=INSTRUCOES, output_schema=Assuntos, markdown=False, telemetry=False)
    resultado = assistente.run(pedido).content
    if not isinstance(resultado, Assuntos):
        raise RuntimeError("O assistente não devolveu os assuntos no formato esperado.")
    validos = {l["id"] for l in lacunas}
    return {a.id: a.assunto.strip().lower()[:80] for a in resultado.assuntos if a.id in validos and a.assunto.strip()}
