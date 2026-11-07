"""Embeddings (Gemini) e busca por similaridade, para documentos e exemplos de calibração.

Em produção (Postgres do nexa-DB) a coluna é `vector` do pgvector e a busca é feita no banco
(`<=>`, distância do cosseno). Localmente (SQLite, testes) a coluna guarda a lista em JSON e a conta
é feita em Python: o código é o mesmo nos dois lugares.
"""

import math
import threading
from functools import lru_cache

from sqlalchemy import JSON, Table, select
from sqlalchemy.engine import Engine

MODELO = "gemini-embedding-2"  # o mesmo da busca de aulas (acesso-unico)
DIMENSOES = 1536


def eh_postgres(engine: Engine) -> bool:
    return engine.dialect.name == "postgresql"


def tipo_coluna(engine: Engine):
    if eh_postgres(engine):
        from pgvector.sqlalchemy import Vector

        return Vector(DIMENSOES)
    return JSON


_trava_cliente = threading.Lock()


@lru_cache(maxsize=1)
def _criar_cliente():
    from google import genai

    return genai.Client()


def _cliente():
    """Um cliente só, criado sob trava: sem ela, duas tarefas no primeiro uso (a indexação da partida e a
    de um agente novo) podiam criar dois, e o que ficava fora do cache era fechado no meio da chamada
    ("Cannot send a request, as the client has been closed")."""
    with _trava_cliente:
        return _criar_cliente()


def _normalizar(vetor) -> list[float]:
    vetor = list(vetor)
    norma = math.sqrt(sum(x * x for x in vetor)) or 1.0
    return [x / norma for x in vetor]


def embeddings(textos: list[str], tarefa: str) -> list[list[float]]:
    """`tarefa`: RETRIEVAL_DOCUMENT para o que é guardado, RETRIEVAL_QUERY para a mensagem do aluno."""
    from google.genai import types

    saida: list[list[float]] = []
    for inicio in range(0, len(textos), 50):  # lotes: a API limita a quantidade por chamada
        lote = textos[inicio:inicio + 50]
        cliente = _cliente()  # a referência segura o cliente aberto até o fim da chamada
        resposta = cliente.models.embed_content(
            model=MODELO,
            # Um Content por texto: uma lista de strings vira UM conteúdo só (e um embedding só).
            contents=[types.Content(parts=[types.Part(text=t)]) for t in lote],
            config=types.EmbedContentConfig(task_type=tarefa, output_dimensionality=DIMENSOES),
        )
        if len(resposta.embeddings) != len(lote):
            raise RuntimeError(f"A API devolveu {len(resposta.embeddings)} embeddings para {len(lote)} textos.")
        saida += [_normalizar(e.values) for e in resposta.embeddings]
    return saida


def embedding(texto: str, tarefa: str = "RETRIEVAL_QUERY") -> list[float]:
    return embeddings([texto], tarefa)[0]


def buscar(engine: Engine, tabela: Table, vetor: list[float], filtros: list, limite: int, distancia_maxima: float) -> list[dict]:
    """As linhas mais parecidas (menor distância do cosseno), com a distância em `distancia`."""
    if eh_postgres(engine):
        distancia = tabela.c.embedding.cosine_distance(vetor).label("distancia")
        consulta = select(tabela, distancia).where(*filtros).order_by(distancia).limit(limite)
        with engine.connect() as conexao:
            linhas = [dict(l) for l in conexao.execute(consulta).mappings().all()]
    else:
        with engine.connect() as conexao:
            linhas = [dict(l) for l in conexao.execute(select(tabela).where(*filtros)).mappings().all()]
        for l in linhas:
            outro = l.get("embedding") or []
            l["distancia"] = 1 - sum(a * b for a, b in zip(vetor, outro)) if outro else 2.0
        linhas = sorted(linhas, key=lambda l: l["distancia"])[:limite]
    for l in linhas:
        l.pop("embedding", None)
    return [l for l in linhas if l["distancia"] <= distancia_maxima]
