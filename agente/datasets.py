"""Regras compartilhadas da avaliação dos agentes: as frases do guardrail de manipulação (guardrail_frases,
editável pelo painel), a régua do juiz (DIRETRIZES, NOTA_MINIMA) e o texto esperado de um caso de teste.
"""

import time
import unicodedata
import re
from datetime import datetime, timezone

from agno.utils.log import log_warning
from sqlalchemy import Boolean, Column, DateTime, Integer, MetaData, String, Table, insert, select, update

from agente import tabelas

TABELA_AVALIACOES = "avaliacoes_humanas"
ORIGEM_GUARDRAIL = "guardrail"
TRANSFERIR = "transferir_para_humano"

# Frases iniciais de manipulação (sem acento e em minúsculas). Só a primeira subida grava estas; depois
# valem as do banco, editadas no painel.
FRASES_PADRAO = (
    "ignore as instrucoes", "ignore suas instrucoes", "ignore as regras", "ignore suas regras",
    "ignore tudo", "esqueca as instrucoes", "esqueca suas instrucoes", "esqueca tudo que",
    "desconsidere as instrucoes", "desconsidere suas instrucoes",
    "mostre seu prompt", "mostre o seu prompt", "me mostra seu prompt", "me mostre seu prompt",
    "qual e o seu prompt", "qual eh o seu prompt", "revele seu prompt", "suas instrucoes internas",
    "prompt do sistema", "system prompt", "modo desenvolvedor", "developer mode", "jailbreak",
    # Troca de papel só com o alvo explícito: "a partir de agora você é meu professor" é pedido legítimo.
    "a partir de agora voce e um assistente", "a partir de agora voce e uma ia", "agora voce e um chatbot",
    "voce agora e um chatbot", "voce nao e mais a lunna", "voce nao e mais a luna", "finja que voce e uma ia",
    "finja que voce nao tem regras",
    "ignore previous instructions", "ignore your instructions", "forget everything", "you are now a",
    "disregard guidelines", "pretend you are", "bypass restrictions",
)
CACHE_FRASES_S = 60  # uma frase editada no painel vale em até 1 minuto

# Avaliação com juiz (AccuracyEval): a mesma régua na madrugada (testes/avaliacoes.py) e na fábrica de
# agentes (agente/fabrica_recursos.py).
NOTA_MINIMA = 7
DIRETRIZES = (
    "A resposta é de um agente de IA que trabalha com os servidores de uma Secretaria Municipal de Saúde, em português. "
    "Dê nota alta quando ela contém as informações e links esperados, respeita as proibições (os 'NÃO') e soa clara "
    "e objetiva, como um colega de trabalho atencioso. Links errados, inventados ou ausentes, dado inventado ou "
    "desrespeitar uma proibição derrubam a nota para 4 ou menos. Diferenças de redação e emojis não tiram pontos. "
    "O primeiro nome do contato e os dados do cadastro da secretaria que o agente consultou podem ser usados: não é dado inventado."
)


def esperado_do_caso(c: dict) -> str:
    """O que o juiz espera de um caso do dataset: a resposta aprovada e, num 👎, o erro que não pode voltar."""
    esperado = (
        f"A equipe aprovou esta resposta para a última mensagem: «{c['gabarito']}». A resposta "
        "da assistente deve passar as mesmas informações, links e orientações e tomar a mesma decisão (transferir "
        "ou não), com redação própria."
    )
    if c["resposta_ruim"]:
        problemas = ", ".join(c["problemas"]) or "sem categoria"
        esperado += (
            f" A equipe REPROVOU esta outra resposta ({problemas}): «{c['resposta_ruim']}». Nota 4 ou menos se a "
            "resposta avaliada repetir o mesmo erro."
        )
    if c.get("comentario"):
        esperado += f" Observação da equipe: {c['comentario']}"
    return esperado


def normalizar(texto: str) -> str:
    """Minúsculas, sem acento e com espaços simples: a forma em que as frases são comparadas."""
    sem_acento = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", sem_acento.lower()).strip()


# ───────── Casos gold e bad ─────────

def _regras_de_ferramenta(problemas: list[str]) -> tuple[list[str], list[str]]:
    exigidas = [TRANSFERIR] if "deveria_transferir" in problemas else []
    proibidas = [TRANSFERIR] if "nao_deveria_transferir" in problemas else []
    return exigidas, proibidas


def caso_da_avaliacao(a: dict) -> dict:
    """Uma avaliação aprovada como caso: mensagens do contato, gabarito, resposta ruim e regras."""
    mensagens = [h["texto"] for h in a.get("historico") or [] if h.get("papel") == "contato"] or [a["mensagem_contato"]]
    problemas = list(a.get("problemas") or [])
    exigidas, proibidas = _regras_de_ferramenta(problemas)
    ruim = a["nota"] == -1
    return {
        "id": a["id"],
        "agente": a["agente"],
        "origem": a["origem"],
        "tipos": ["gold", "bad"] if ruim else ["gold"],
        "mensagens": mensagens,
        "gabarito": (a.get("resposta_ideal") or "") if ruim else (a.get("resposta_ideal") or a["resposta_agente"]),
        "resposta_ruim": a["resposta_agente"] if ruim else None,
        "problemas": problemas,
        "comentario": a.get("comentario"),
        "ferramentas_exigidas": exigidas,
        "ferramentas_proibidas": proibidas,
        "telefone": a.get("telefone"),
        "aprovado_por": a.get("revisada_por"),
        "aprovado_em": a.get("revisada_em"),
    }


# ───────── Frases do guardrail ─────────

def _tabela_frases(schema: str | None) -> Table:
    return Table(
        "guardrail_frases",
        MetaData(schema=schema),
        Column("id", Integer, primary_key=True, autoincrement=True),
        Column("agente", String(60), nullable=True),  # vazio = vale para todos os agentes
        Column("frase", String(200), nullable=False),  # normalizada: minúsculas e sem acento
        Column("ativo", Boolean, nullable=False, default=True),
        Column("criada_por", String(200), nullable=True),
        Column("criada_em", DateTime(timezone=True), nullable=False),
    )


class Frases:
    """Frases de manipulação do banco, com cache curto. Sem banco, valem as FRASES_PADRAO."""

    def __init__(self, engine=None, schema: str | None = None):
        self.engine, self.schema = engine, schema
        self.tabela = _tabela_frases(schema)
        self._cache: tuple[float, list[dict]] | None = None
        if engine is not None:
            try:
                tabelas.criar(engine, [self.tabela])
                self._semear()
            except Exception as erro:
                log_warning(f"Guardrail: frases sem banco, usando as padrão: {type(erro).__name__}: {erro}")
                self.engine = None

    def _semear(self) -> None:
        with self.engine.begin() as conexao:
            if conexao.execute(select(self.tabela.c.id).limit(1)).first() is None:
                agora = datetime.now(timezone.utc)
                conexao.execute(insert(self.tabela), [
                    {"agente": None, "frase": f, "ativo": True, "criada_por": "padrão", "criada_em": agora}
                    for f in FRASES_PADRAO
                ])

    def listar(self) -> list[dict]:
        if self.engine is None:
            return [{"id": None, "agente": None, "frase": f, "ativo": True} for f in FRASES_PADRAO]
        with self.engine.connect() as conexao:
            linhas = conexao.execute(select(self.tabela).order_by(self.tabela.c.id)).mappings().all()
        return [{**dict(l), "criada_em": l["criada_em"].isoformat() if l["criada_em"] else None} for l in linhas]

    def ativas(self, agente: str | None) -> list[str]:
        agora = time.monotonic()
        if self._cache is None or agora - self._cache[0] > CACHE_FRASES_S:
            try:
                self._cache = (agora, self.listar())
            except Exception as erro:  # banco fora: segue com a última lista (ou as padrão)
                log_warning(f"Guardrail: não deu para ler as frases: {type(erro).__name__}: {erro}")
                if self._cache is None:
                    self._cache = (agora, [{"agente": None, "frase": f, "ativo": True} for f in FRASES_PADRAO])
        return [f["frase"] for f in self._cache[1] if f["ativo"] and f["agente"] in (None, agente)]

    def acrescentar(self, frase: str, agente: str | None, quem: str) -> dict:
        normalizada = normalizar(frase)
        if len(normalizada) < 6:
            raise ValueError("A frase precisa ter pelo menos 6 letras: frases curtas barram mensagens comuns.")
        with self.engine.begin() as conexao:
            novo = conexao.execute(insert(self.tabela).values(
                agente=agente or None, frase=normalizada, ativo=True, criada_por=quem,
                criada_em=datetime.now(timezone.utc))).inserted_primary_key[0]
        self._cache = None
        return {"id": novo, "frase": normalizada, "agente": agente or None, "ativo": True}

    def alterar(self, frase_id: int, ativo: bool) -> None:
        with self.engine.begin() as conexao:
            conexao.execute(update(self.tabela).where(self.tabela.c.id == frase_id).values(ativo=ativo))
        self._cache = None


_frases: dict[tuple[int, str | None], Frases] = {}


def frases(engine=None, schema: str | None = None) -> Frases:
    """Uma lista de frases por banco, compartilhada pelos agentes e pelo painel (a edição limpa o cache de todos)."""
    chave = (id(engine), schema)
    if chave not in _frases:
        _frases[chave] = Frases(engine, schema)
    return _frases[chave]
