"""O que o agente aprende com cada aluno: o Learning do Agno (perfil, memórias e resumo da sessão).

AGENTE_APRENDIZADO escolhe o modo:
  memoria   (padrão) só as memórias automáticas (MemoryManager), como antes;
  learning  o Learning do Agno, que aparece na tela Learning do AgentOS (tabela agno_learnings):
            - perfil do aluno: campos fixos (curso, e-mail da matrícula, aparelho, situação do acesso);
            - memórias: os fatos soltos, no lugar do MemoryManager (os dois juntos gravariam em dobro);
            - resumo da sessão: o que está sendo resolvido nesta conversa, com o plano (objetivo e os passos
              já tentados e o resultado de cada um), para o agente não repetir uma orientação.
            O Decision Log do Agno (3.1.6) só registra pelo próprio agente, com uma ferramenta a mais no meio da
            resposta: fica desligado. O porquê de cada resposta vem do resumo do raciocínio do modelo
            (AGENTE_PENSAMENTOS, agente/agente.py), mostrado no rastreamento da conversa no painel.

O que é aprendido vale só para o próprio aluno (user_id). O "conhecimento aprendido" do Learning, que
espalharia para todos o que se aprendeu com um aluno, fica desligado: o que vale para todos passa pela
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
Escreva o resumo em português do Brasil: o que o aluno precisa, o que já foi orientado, o que resolveu
e o que falta. No plano, o objetivo é o problema do aluno e cada passo é uma orientação já dada, com o
resultado que o aluno contou (ex.: "desbloquear pop-up no Safari: não resolveu"). Nunca registre senha,
CPF, dados de cartão, dados bancários ou informações de saúde, mesmo que o aluno tenha escrito; o e-mail
da matrícula pode ficar.
""".strip()

MODOS = ("memoria", "learning")


def modo() -> str:
    valor = os.getenv("AGENTE_APRENDIZADO", "memoria").strip().lower()
    return valor if valor in MODOS else "memoria"


@dataclass
class PerfilDoAluno(UserProfile):
    curso: Optional[str] = field(
        default=None, metadata={"description": "Curso, pós-graduação ou produto que o aluno comprou ou cursa"})
    email_matricula: Optional[str] = field(
        default=None, metadata={"description": "E-mail da matrícula que o aluno informou ou que o cadastro confirmou"})
    aparelho: Optional[str] = field(
        default=None, metadata={"description": "Onde estuda: iPhone, Android, computador, navegador"})
    situacao_acesso: Optional[str] = field(
        default=None, metadata={"description": "Situação do acesso: ainda não acessou, acessou, ou o problema atual"})


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
        user_profile=UserProfileConfig(mode=LearningMode.ALWAYS, schema=PerfilDoAluno, additional_instructions=instrucoes),
        user_memory=UserMemoryConfig(mode=LearningMode.ALWAYS, additional_instructions=instrucoes),
        session_context=SessionContextConfig(enable_planning=True, additional_instructions=RESUMO_DA_SESSAO),
    )
