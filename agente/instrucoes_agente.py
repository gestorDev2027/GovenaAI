"""O que é igual nas instruções dos agentes além da Luna: a base de conhecimento vigente de cada um
(editável no painel) entra nas instruções a cada mensagem, e as mensagens fixas (boas-vindas e despedida
por inatividade) saem das seções dela.

Cada agente escreve só o próprio texto (papel, tom, regras) com os marcadores @@BOAS_VINDAS@@ e
@@BASE_DE_CONHECIMENTO@@, e cria um InstrucoesDoAgente com ele (ex.: agente/instrucoes_sdr.py).
"""

from agno.utils.log import log_warning

from agente import base, conhecimento

MARCADOR_BASE = "@@BASE_DE_CONHECIMENTO@@"
MARCADOR_BOAS_VINDAS = "@@BOAS_VINDAS@@"


class InstrucoesDoAgente:
    def __init__(self, agente_id: str, modelo: str, contato: str = "contato"):
        self.agente_id, self.modelo, self.contato = agente_id, modelo, contato

    def _texto(self) -> str:
        return base.obter(self.agente_id).texto()

    def boas_vindas(self, nome: str = "") -> str:
        """A primeira mensagem: a seção "## Boas-vindas" da base, com o primeiro nome do contato."""
        texto = base.secao(self._texto(), "Boas-vindas")
        if not texto:
            log_warning(f'A base de {self.agente_id} não tem a seção "## Boas-vindas": a primeira mensagem não será enviada.')
            return ""
        return base.com_nome(texto, nome)

    def encerramento(self) -> str:
        """A despedida por inatividade: a seção "## Encerramento por inatividade" da base."""
        return base.secao(self._texto(), "Encerramento por inatividade") or ""

    def instrucoes(self) -> str:
        """Instruções com a versão vigente da base (lida a cada mensagem)."""
        texto = self._texto()
        modelo = self.modelo.replace(
            MARCADOR_BOAS_VINDAS,
            base.secao(texto, "Boas-vindas") or f"(nenhuma: a conversa começou pela mensagem do {self.contato})")
        if conhecimento.modo_roteiro() == "busca":
            texto = (
                conhecimento.roteiro_essencial(texto)
                + f"\n\n(As demais seções da base chegam em <roteiro_relevante>, de acordo com a mensagem do {self.contato}.)"
            )
        return modelo.replace(MARCADOR_BASE, texto)
