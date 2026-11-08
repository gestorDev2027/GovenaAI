"""Pesquisa na web (Google) para o Assistente de Implantação: uma chamada à parte ao Gemini com a busca do Google
ligada (`search=True` do Agno), que devolve a resposta e as fontes. O assistente usa para PROPOR dados públicos (CNPJ da
prefeitura, nome do prefeito, telefone da secretaria): nada vai para o cadastro sem a confirmação de quem conversa.
"""

import os

from agno.agent import Agent
from agno.models.google import Gemini
from agno.utils.log import log_warning

INSTRUCOES = """
Você pesquisa dados públicos de prefeituras e secretarias municipais de saúde do Brasil na web.
Responda em português, curto e objetivo, só com o que encontrou nas fontes. Para cada dado, diga de qual site veio.
Se não encontrar, diga que não encontrou: nunca invente CNPJ, telefone, endereço ou nome.
""".strip()


def pesquisar(pergunta: str) -> dict:
    """A resposta da pesquisa e as fontes (títulos e endereços)."""
    modelo = os.getenv("AGENTE_MODELO", "gemini-3.6-flash")
    try:
        pesquisador = Agent(model=Gemini(id=modelo, search=True), instructions=INSTRUCOES, markdown=False, telemetry=False)
        saida = pesquisador.run(pergunta)
    except Exception as erro:  # a pesquisa nunca derruba a conversa
        log_warning(f"Pesquisa na web: {type(erro).__name__}: {erro}")
        return {"resposta": None, "fontes": [], "erro": "A pesquisa na web não respondeu agora."}
    fontes = []
    citacoes = getattr(saida, "citations", None)
    for url in getattr(citacoes, "urls", None) or []:
        endereco = getattr(url, "url", None)
        if endereco and endereco not in [f["url"] for f in fontes]:
            fontes.append({"titulo": getattr(url, "title", None) or "", "url": endereco})
    return {"resposta": saida.content if isinstance(saida.content, str) else str(saida.content or ""), "fontes": fontes[:8]}
