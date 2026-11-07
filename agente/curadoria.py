"""Assistente de curadoria: o Gemini analisa uma avaliação humana antes de o curador decidir.

Dois usos: `analisar` (a recomendação de uma avaliação, também em lote) e `conversar` (o chat do
painel lateral, em que o curador pede ajustes e o assistente reescreve a resposta ideal).

Lê o roteiro do agente, a conversa, a resposta do agente e o que a pessoa avaliou (👍/👎, problemas,
comentário, como deveria ser) e devolve uma recomendação (aprovar, recusar ou revisar), o motivo, uma
resposta ideal sugerida e alertas (dado pessoal, informação fora do roteiro, promessa que o agente
não pode fazer). Só recomenda: quem aprova continua sendo o curador, no painel.
"""

from typing import Literal

from agno.agent import Agent
from pydantic import BaseModel, Field

from agente import base
from agente.agente import _modelo


class Analise(BaseModel):
    recomendacao: Literal["aprovar", "recusar", "revisar"] = Field(
        description="aprovar: pode virar gabarito como está (ou com a resposta sugerida); recusar: a avaliação está "
        "errada ou o caso não serve de exemplo; revisar: precisa de uma decisão humana (falta informação, caso ambíguo).")
    confianca: Literal["alta", "media", "baixa"]
    motivo: str = Field(description="Por que, em até 3 frases, citando o trecho do roteiro quando houver.")
    resposta_ideal_sugerida: str = Field(
        description="Como a resposta deveria ser, pronta para o contato no WhatsApp, seguindo o roteiro. Vazia só ao recusar.")
    alertas: list[str] = Field(default_factory=list, description="Riscos concretos; lista vazia se não houver.")


INSTRUCOES = """Você é o assistente de curadoria do GestorGov, o ecossistema de agentes de IA das Secretarias Municipais de Saúde.
A equipe avaliou uma resposta de um agente de setor a um servidor. Uma avaliação aprovada vira gabarito das avaliações
automáticas e exemplo que o agente recebe em conversas parecidas: aprovar algo errado ensina o erro ao agente.

Analise com estes critérios, nesta ordem:
1. A resposta que viraria gabarito (a ideal escrita pela pessoa ou, num 👍 sem ela, a própria resposta do agente) segue o
   roteiro abaixo: links, prazos, passos e a seção "Sempre transferir". Informação que não está no roteiro é inventada.
2. Num 👎, a crítica faz sentido? Se a pessoa errou e a resposta do agente estava certa, recomende recusar.
3. Não promete o que o agente não pode fazer (reembolso, exceção, prazo novo) e não pede senha, CPF completo ou cartão.
4. Tom do atendimento no WhatsApp: cordial, curto, sem markdown (nada de ** ou #), sem repetir a apresentação.
5. Dados pessoais (nome, e-mail, telefone, CPF) serão retirados ao virar exemplo; se a resposta depender deles, avise.

Responda em português correto, direto, sem elogios."""


class RespostaDoAssistente(BaseModel):
    resposta: str = Field(description="O que você diz ao curador: curto e direto.")
    resposta_ideal: str = Field(
        default="",
        description="Só quando o curador pedir para escrever ou ajustar a resposta: o texto COMPLETO, pronto para o contato. "
        "Vazio nas demais perguntas.")


CONVERSA = """Agora você conversa com o curador no painel, sobre esta avaliação. Ele pode perguntar (isto está no roteiro?
por que recusar?) ou pedir para escrever ou ajustar a resposta ideal (mais curta, com o link, outro tom). Ao escrever ou
ajustar, devolva o texto inteiro em resposta_ideal, seguindo o roteiro, e diga em resposta o que mudou. Nunca invente
informação que não está no roteiro: se faltar, diga o que falta."""


def _contexto(avaliacao: dict, ideal_atual: str | None = None) -> str:
    roteiro = base.obter(avaliacao.get("agente") or base.AGENTE_PADRAO).texto()
    historico = "\n".join(
        f"{'Contato' if h.get('papel') == 'contato' else 'Agente'}: {h.get('texto', '')}" for h in (avaliacao.get("historico") or [])[:-2])
    pedido = f"""<roteiro>
{roteiro}
</roteiro>

<conversa_anterior>
{historico or "(sem mensagens anteriores)"}
</conversa_anterior>

<mensagem_do_contato>
{avaliacao.get("mensagem_contato", "")}
</mensagem_do_contato>

<resposta_do_agente>
{avaliacao.get("resposta_agente", "")}
</resposta_do_agente>

<avaliacao_da_equipe>
Nota: {"👍 boa resposta" if avaliacao.get("nota") == 1 else "👎 com problema"}
Problemas marcados: {", ".join(avaliacao.get("problemas") or []) or "nenhum"}
Comentário: {avaliacao.get("comentario") or "(nenhum)"}
Como deveria ser: {avaliacao.get("resposta_ideal") or "(não escrito)"}
</avaliacao_da_equipe>""" + (f"""

<resposta_ideal_em_edicao_pelo_curador>
{ideal_atual}
</resposta_ideal_em_edicao_pelo_curador>""" if ideal_atual and ideal_atual.strip() else "")
    return pedido


def analisar(avaliacao: dict) -> dict:
    """Recomendação para uma avaliação de `avaliacoes_humanas` (o dicionário da linha)."""
    pedido = _contexto(avaliacao)
    assistente = Agent(model=_modelo(), instructions=INSTRUCOES, output_schema=Analise, markdown=False, telemetry=False)
    saida = assistente.run(pedido)
    resultado = saida.content
    if not isinstance(resultado, Analise):
        raise RuntimeError("O assistente não devolveu a análise no formato esperado.")
    return resultado.model_dump()


def conversar(avaliacao: dict, mensagens: list[dict], ideal_atual: str = "") -> dict:
    """Uma resposta do assistente no chat do painel. `mensagens`: [{papel: curador|assistente, texto}]."""
    historico = "\n\n".join(
        f"{'Curador' if m.get('papel') == 'curador' else 'Assistente'}: {m.get('texto', '')}" for m in mensagens[:-1])
    partes = [_contexto(avaliacao, ideal_atual)]
    if historico:
        partes.append(f"<conversa_com_o_curador>\n{historico}\n</conversa_com_o_curador>")
    partes.append(f"<pedido_do_curador>\n{mensagens[-1].get('texto', '')}\n</pedido_do_curador>")
    assistente = Agent(model=_modelo(), instructions=[INSTRUCOES, CONVERSA], output_schema=RespostaDoAssistente,
                       markdown=False, telemetry=False)
    resultado = assistente.run("\n\n".join(partes)).content
    if not isinstance(resultado, RespostaDoAssistente):
        raise RuntimeError("O assistente não respondeu no formato esperado.")
    return resultado.model_dump()
