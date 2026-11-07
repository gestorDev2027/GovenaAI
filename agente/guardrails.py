"""Guardrails da entrada dos agentes (pre_hooks do Agno), em português.

- Dados sensíveis: CPF e número de cartão saem da mensagem antes de chegar ao modelo e ao histórico
  (ficam como ***). Não bloqueia: o aluno que manda o CPF segue atendido. E-mail e telefone ficam,
  porque a consulta ao cadastro usa o e-mail que o aluno informa.
- Manipulação: pedido para ignorar as instruções, mostrar o prompt ou trocar de papel. As frases ficam
  no banco (guardrail_frases, editável no painel; agente/datasets.py). O Agno interrompe a resposta;
  atendimento.rodar troca o aviso pela seção "## Pedido fora do atendimento" do roteiro e registra o
  caso na fila da Calibração, para o curador confirmar ou apontar falso positivo.

Ofensa, política e assuntos fora do atendimento ficam com as instruções (<fora_do_atendimento>): o
agente responde com calma e volta ao atendimento, sem bloquear nem transferir.
"""

import re
from typing import Union

from agno.exceptions import CheckTrigger, InputCheckError
from agno.guardrails import PIIDetectionGuardrail
from agno.guardrails.base import BaseGuardrail
from agno.run.agent import RunInput
from agno.run.team import TeamRunInput

from agente import datasets

# Conteúdo da resposta interrompida pelo guardrail (o Agno grava str(erro) como conteúdo).
BLOQUEIO_MANIPULACAO = "[guardrail] pedido de manipulação do agente"
SECAO_FORA_DO_ATENDIMENTO = "Pedido fora do atendimento"

PADRAO_CPF = re.compile(r"(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)")
PADRAO_CARTAO = re.compile(r"(?<!\d)\d{4}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}(?!\d)")


def mascarar_texto(texto: str) -> str:
    """O mesmo mascaramento do guardrail, para o que vai a outros lugares (ex.: fila da Calibração)."""
    for padrao in (PADRAO_CPF, PADRAO_CARTAO):
        texto = padrao.sub(lambda m: "*" * len(m.group(0)), texto or "")
    return texto


class BloquearManipulacao(BaseGuardrail):
    def __init__(self, agente_id: str, lista: datasets.Frases):
        self.agente_id, self.lista = agente_id, lista

    def check(self, run_input: Union[RunInput, TeamRunInput]) -> None:
        texto = datasets.normalizar(run_input.input_content_string())
        if any(frase in texto for frase in self.lista.ativas(self.agente_id)):
            raise InputCheckError(BLOQUEIO_MANIPULACAO, check_trigger=CheckTrigger.PROMPT_INJECTION)

    async def async_check(self, run_input: Union[RunInput, TeamRunInput]) -> None:
        self.check(run_input)


def mascarar_dados_sensiveis() -> PIIDetectionGuardrail:
    return PIIDetectionGuardrail(
        mask_pii=True,
        enable_ssn_check=False,  # padrão americano
        enable_email_check=False,  # o aluno informa o e-mail da matrícula para a consulta
        enable_phone_check=False,  # padrão americano; o telefone já vem do WhatsApp
        enable_credit_card_check=False,  # trocado pelo padrão abaixo, que aceita ponto entre os blocos
        custom_patterns={"CPF": PADRAO_CPF, "Cartão": PADRAO_CARTAO},
    )


def guardrails(agente_id: str, engine=None, schema: str | None = None) -> list:
    """Na ordem: primeiro mascara, depois confere manipulação (o texto conferido e guardado já vem mascarado)."""
    return [mascarar_dados_sensiveis(), BloquearManipulacao(agente_id, datasets.frases(engine, schema))]
