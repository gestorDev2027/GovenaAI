"""Bases de conhecimento editáveis pelo painel, uma por agente.

Cada gravação vira uma linha nova na tabela do agente (o histórico sai de graça): a do onboarding
é `painel_base_conhecimento` (nome original); a dos demais, `painel_base_conhecimento_<id>`. Sem
nenhuma gravação, vale o arquivo do perfil no repositório. O texto vigente fica em memória e é lido
pelas instruções a cada mensagem: salvar no painel muda a próxima resposta, sem reiniciar o servidor.

As funções do módulo (atual, texto, salvar...) operam na base do agente padrão (onboarding), que
é a que o painel edita hoje; `obter(id)` dá a base de qualquer agente.
"""

import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, Text, insert, select
from sqlalchemy.engine import Engine

ARQUIVO_PADRAO = Path(__file__).parent / "base_conhecimento.md"
AGENTE_PADRAO = "onboarding"
MARCA_NOME = "[NOME DO CONTATO]"
MARCA_ATENDENTE = "[NOME DO ATENDENTE]"


def secao(texto: str, titulo: str) -> str | None:
    """O conteúdo da seção "## <titulo>" (com ou sem número, sem diferença de maiúsculas), até o
    próximo título de mesmo nível. None se o roteiro não tiver a seção."""
    padrao = re.compile(rf"^##\s+(?:\d+\.\s*)?{re.escape(titulo)}\s*$", re.IGNORECASE | re.MULTILINE)
    achado = padrao.search(texto)
    if not achado:
        return None
    fim = re.search(r"^#{1,2}\s", texto[achado.end():], re.MULTILINE)
    conteudo = texto[achado.end(): achado.end() + fim.start() if fim else len(texto)].strip()
    return conteudo or None


def com_nome(texto: str, nome: str = "", atendente: str = "") -> str:
    """Troca [NOME DO CONTATO] pelo primeiro nome (sem nome, tira a marca e a pontuação que sobra) e
    [NOME DO ATENDENTE] pelo primeiro nome de quem recebe a transferência."""
    primeiro = (nome or "").strip().split(" ")[0].capitalize()
    if atendente:
        texto = texto.replace(MARCA_ATENDENTE, atendente.strip().split(" ")[0])
    if primeiro:
        return texto.replace(MARCA_NOME, primeiro)
    texto = re.sub(r",?[ \t]*\[NOME DO CONTATO\][ \t]*,?[ \t]*", " ", texto)
    texto = re.sub(r"[ \t]+([!?.,;:])", r"\1", texto)  # "Olá !" -> "Olá!"
    linhas = [l.strip() for l in texto.split("\n")]
    return "\n".join(l[:1].upper() + l[1:] for l in linhas)


_ao_salvar: list = []  # funções (agente_id, texto) chamadas a cada versão salva


def ao_salvar(funcao) -> None:
    """Registra quem quer saber de cada versão salva (ex.: agente/conhecimento.py reindexa o roteiro)."""
    if funcao not in _ao_salvar:
        _ao_salvar.append(funcao)


class BaseConhecimento:
    def __init__(self, agente_id: str, arquivo: Path):
        self.agente_id = agente_id
        self.arquivo = arquivo
        self._engine: Engine | None = None
        self._tabela = self._criar_tabela(None)
        self._atual: dict = {}

    def _criar_tabela(self, schema: str | None) -> Table:
        nome = "painel_base_conhecimento" if self.agente_id == AGENTE_PADRAO else f"painel_base_conhecimento_{self.agente_id}"
        return Table(
            nome,
            MetaData(schema=schema),
            Column("id", Integer, primary_key=True, autoincrement=True),
            Column("conteudo", Text, nullable=False),
            Column("atualizado_em", DateTime(timezone=True), nullable=False),
            Column("observacao", String(300), nullable=True),
        )

    def iniciar(self, engine: Engine, schema: str | None = None) -> None:
        """Liga a base ao banco (no Postgres, dentro do schema do agente) e carrega a versão vigente."""
        self._engine = engine
        self._tabela = self._criar_tabela(schema)
        self._tabela.metadata.create_all(engine, tables=[self._tabela])
        self._carregar()

    def _padrao(self) -> dict:
        return {
            "conteudo": self.arquivo.read_text(encoding="utf-8"),
            "atualizado_em": None,
            "origem": "arquivo",
            "versao": 0,
        }

    def _carregar(self) -> None:
        if self._engine is None:
            self._atual = self._padrao()
            return
        with self._engine.connect() as conexao:
            linha = conexao.execute(select(self._tabela).order_by(self._tabela.c.id.desc()).limit(1)).first()
        if linha is None:
            self._atual = self._padrao()
        else:
            self._atual = {
                "conteudo": linha.conteudo,
                "atualizado_em": linha.atualizado_em,
                "origem": "painel",
                "versao": linha.id,
            }

    def atual(self) -> dict:
        if not self._atual:
            self._carregar()
        return self._atual

    def texto(self) -> str:
        return self.atual()["conteudo"]

    def salvar(self, conteudo: str, observacao: str | None = None) -> dict:
        if self._engine is None:
            raise RuntimeError("Base de conhecimento sem banco configurado.")
        with self._engine.begin() as conexao:
            conexao.execute(
                insert(self._tabela).values(
                    conteudo=conteudo,
                    atualizado_em=datetime.now(timezone.utc),
                    observacao=(observacao or "")[:300] or None,
                )
            )
        self._carregar()
        for funcao in _ao_salvar:
            funcao(self.agente_id, conteudo)
        return self.atual()

    def garantir_secoes(self, titulos: tuple[str, ...]) -> list[str]:
        """Acrescenta à versão vigente as seções que faltam, copiadas do arquivo do repositório, como
        nova versão no histórico (dá para desfazer). Serve para quando um texto sai do código e passa a
        ser seção do roteiro: a versão salva no painel antes disso não a tinha. Devolve as acrescentadas."""
        if self._engine is None or self.atual()["origem"] != "painel":
            return []  # sem versão no banco, já vale o arquivo, que tem as seções
        atual, padrao = self.texto(), self.arquivo.read_text(encoding="utf-8")
        faltam = [t for t in titulos if secao(atual, t) is None and secao(padrao, t) is not None]
        if not faltam:
            return []
        blocos = "\n\n".join(f"## {t}\n{secao(padrao, t)}" for t in faltam)
        # Logo depois da introdução (antes do primeiro "## "), onde ficam no arquivo do repositório.
        inicio = re.search(r"^## ", atual, re.MULTILINE)
        novo = f"{atual[:inicio.start()]}{blocos}\n\n{atual[inicio.start():]}" if inicio else f"{atual.rstrip()}\n\n{blocos}\n"
        self.salvar(novo, f"Seções acrescentadas (saíram do código): {', '.join(faltam)}")
        return faltam

    def restaurar_padrao(self) -> dict:
        """Grava o arquivo do repositório como nova versão (o histórico continua)."""
        return self.salvar(self.arquivo.read_text(encoding="utf-8"), "Restaurado o texto padrão do repositório")

    def historico(self, limite: int = 20) -> list[dict]:
        if self._engine is None:
            return []
        with self._engine.connect() as conexao:
            linhas = conexao.execute(
                select(self._tabela.c.id, self._tabela.c.atualizado_em, self._tabela.c.observacao, self._tabela.c.conteudo)
                .order_by(self._tabela.c.id.desc())
                .limit(limite)
            ).all()
        return [
            {
                "versao": linha.id,
                "atualizado_em": linha.atualizado_em,
                "observacao": linha.observacao,
                "caracteres": len(linha.conteudo),
            }
            for linha in linhas
        ]


_bases: dict[str, BaseConhecimento] = {}


def registrar(agente_id: str, arquivo: Path) -> BaseConhecimento:
    """Cada perfil registra a sua base ao ser importado; `iniciar` liga todas ao banco."""
    if agente_id not in _bases:
        _bases[agente_id] = BaseConhecimento(agente_id, arquivo)
    return _bases[agente_id]


def obter(agente_id: str = AGENTE_PADRAO) -> BaseConhecimento:
    return _bases[agente_id]


SECOES_DE_MENSAGEM = ("Boas-vindas", "Encerramento por inatividade", "Transferência para a equipe",
                      "Pedido fora do atendimento")


def iniciar(engine: Engine, schema: str | None = None) -> None:
    for base in _bases.values():
        base.iniciar(engine, schema)
        base.garantir_secoes(SECOES_DE_MENSAGEM)


registrar(AGENTE_PADRAO, ARQUIVO_PADRAO)


# Atalhos para a base do agente padrão (usados pelo painel e pelas instruções do onboarding).
def atual() -> dict:
    return obter().atual()


def texto() -> str:
    return obter().texto()


def salvar(conteudo: str, observacao: str | None = None) -> dict:
    return obter().salvar(conteudo, observacao)


def restaurar_padrao() -> dict:
    return obter().restaurar_padrao()


def historico(limite: int = 20) -> list[dict]:
    return obter().historico(limite)
