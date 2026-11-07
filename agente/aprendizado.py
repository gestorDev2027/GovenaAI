"""O que o agente aprende com cada pessoa que conversa com ele: o Learning do Agno (perfil, memórias e resumo da sessão).

AGENTE_APRENDIZADO escolhe o modo:
  memoria   (padrão) só as memórias automáticas (MemoryManager), como antes;
  learning  o Learning do Agno, que aparece na tela Learning do AgentOS (tabela agno_learnings):
            - perfil do servidor: campos fixos (setor, unidade, cargo, formato preferido das entregas);
            - memórias: os fatos soltos, no lugar do MemoryManager (os dois juntos gravariam em dobro);
            - resumo da sessão: o que está sendo resolvido nesta conversa, com o plano (objetivo e os passos
              já tentados e o resultado de cada um), para o agente não repetir uma orientação.
            O Decision Log do Agno (3.1.6) só registra pelo próprio agente, com uma ferramenta a mais no meio da
            resposta: fica desligado. O porquê de cada resposta vem do resumo do raciocínio do modelo
            (AGENTE_PENSAMENTOS, agente/agente.py), mostrado no rastreamento da conversa no painel.

O que é aprendido vale só para a própria pessoa (user_id). O "conhecimento aprendido" do Learning, que
espalharia para todos o que se aprendeu com uma pessoa, fica desligado: o que vale para todos passa pela
curadoria (calibração) e pela base de conhecimento.

No Agno, as extrações rodam durante a resposta, uma parte depois da outra, e a resposta espera por
elas (agno/agent/_run.py): medido em 21/10/2026, a resposta passava de 7,4 s para 13 s. Aqui elas vão
para uma fila própria e a resposta sai na hora (AprendizadoEmSegundoPlano); o que foi aprendido vale a
partir da mensagem seguinte. Cada parte ligada é uma chamada ao modelo a mais por resposta.
"""

import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Optional

from agno.learn import LearningMachine, SessionContextConfig, UserMemoryConfig, UserProfileConfig
from agno.learn.config import LearningMode
from agno.learn.schemas import UserProfile
from agno.utils.log import log_warning

_fila = ThreadPoolExecutor(max_workers=2, thread_name_prefix="aprendizado")

RESUMO_DA_SESSAO = """
Escreva o resumo em português do Brasil: o que o servidor pediu, o que já foi produzido, o que ficou
aprovado e o que falta. No plano, o objetivo é a entrega pedida e cada passo é o que já foi feito, com o
resultado (ex.: "minuta do termo de referência: falta a quantidade por unidade"). Nunca registre senha,
CPF, Cartão SUS, dados de pacientes ou dados bancários, mesmo que alguém tenha escrito.
""".strip()

MODOS = ("memoria", "learning")


def modo() -> str:
    valor = os.getenv("AGENTE_APRENDIZADO", "memoria").strip().lower()
    return valor if valor in MODOS else "memoria"


@dataclass
class PerfilDoServidor(UserProfile):
    setor: Optional[str] = field(
        default=None, metadata={"description": "Setor da Secretaria de Saúde em que o servidor trabalha"})
    unidade: Optional[str] = field(
        default=None, metadata={"description": "Unidade de saúde ou local de trabalho do servidor, se houver"})
    cargo: Optional[str] = field(
        default=None, metadata={"description": "Cargo ou função do servidor (ex.: coordenador, técnico, secretário)"})
    formato_preferido: Optional[str] = field(
        default=None, metadata={"description": "Como prefere receber as entregas: tamanho, formato, nível de detalhe"})


class AprendizadoEmSegundoPlano(LearningMachine):
    """O Agno chama `process` durante a resposta e espera; aqui a extração vai para a fila e volta na hora."""

    def process(self, *args, **kwargs) -> None:
        # Conversa de avaliação (casos de teste e datasets, sessões "aval-") não ensina nada ao agente.
        sessao = kwargs.get("session_id") or (args[2] if len(args) > 2 else None) or ""
        usuario = kwargs.get("user_id") or (args[1] if len(args) > 1 else None) or ""
        if sessao.startswith("aval-") or usuario.startswith("aval-"):
            return
        _fila.submit(self._processar, args, kwargs)

    def _processar(self, args, kwargs) -> None:
        try:
            super().process(*args, **kwargs)
        except Exception as erro:  # o aprendizado nunca derruba o atendimento
            log_warning(f"Learning: extração falhou: {type(erro).__name__}: {erro}")


def maquina(modelo, instrucoes: str) -> LearningMachine:
    """Learning do agente; `instrucoes` diz o que guardar e o que nunca guardar (perfil do agente)."""
    return AprendizadoEmSegundoPlano(
        model=modelo,
        user_profile=UserProfileConfig(mode=LearningMode.ALWAYS, schema=PerfilDoServidor, additional_instructions=instrucoes),
        user_memory=UserMemoryConfig(mode=LearningMode.ALWAYS, additional_instructions=instrucoes),
        session_context=SessionContextConfig(enable_planning=True, additional_instructions=RESUMO_DA_SESSAO),
    )
