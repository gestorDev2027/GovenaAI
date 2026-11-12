"""Tabelas do servidor: criar as que faltam e conferir colunas com uma ida ao banco só.

O `metadata.create_all(engine, tables=[...])` pergunta ao banco tabela por tabela se ela existe; cada módulo que
sobe (base, conhecimento, fábrica, equipes, usuários, tarefas...) fazia isso de novo. No Supabase (São Paulo), visto
do Render (Virginia), cada pergunta é uma viagem de ida e volta. Aqui a lista de tabelas do schema vem numa consulta
só e fica guardada; o `create_all` roda apenas para as que faltam (e continua conferindo antes de criar).

O resultado é o mesmo do `create_all`: tabela que existe não é alterada; tabela que falta é criada com os índices.
"""

import threading

from sqlalchemy import Table, inspect
from sqlalchemy.engine import Engine

_trava = threading.Lock()
_tabelas: dict[tuple[int, str | None], set[str]] = {}
_colunas: dict[tuple[int, str | None], dict[str, set[str]]] = {}


def existentes(engine: Engine, schema: str | None) -> set[str]:
    """Os nomes das tabelas do schema (uma consulta por banco e schema; guardado enquanto o servidor roda)."""
    chave = (id(engine), schema)
    with _trava:
        if chave not in _tabelas:
            _tabelas[chave] = set(inspect(engine).get_table_names(schema=schema))
        return _tabelas[chave]


def criar(engine: Engine, tabelas: list[Table]) -> None:
    """O mesmo que `metadata.create_all(engine, tables=tabelas)`, sem perguntar de novo pelas que já existem."""
    for schema in {t.schema for t in tabelas}:
        ja = existentes(engine, schema)
        faltam = [t for t in tabelas if t.schema == schema and t.name not in ja]
        if not faltam:
            continue
        for metadata in {id(t.metadata): t.metadata for t in faltam}.values():
            metadata.create_all(engine, tables=[t for t in faltam if t.metadata is metadata])
        with _trava:
            ja.update(t.name for t in faltam)
            _colunas.pop((id(engine), schema), None)


def colunas(engine: Engine, tabela: Table) -> set[str]:
    """Os nomes das colunas da tabela no banco. No Postgres, as do schema inteiro vêm numa consulta e ficam guardadas;
    no SQLite (local, sem rede) a reflexão é uma consulta por tabela, então pergunta só pela tabela."""
    if engine.dialect.name != "postgresql":
        return {c["name"] for c in inspect(engine).get_columns(tabela.name, schema=tabela.schema)}
    chave = (id(engine), tabela.schema)
    with _trava:
        if chave not in _colunas:
            todas = inspect(engine).get_multi_columns(schema=tabela.schema)
            _colunas[chave] = {nome: {c["name"] for c in cols} for (_, nome), cols in todas.items()}
        return set(_colunas[chave].get(tabela.name, set()))


def esquecer(engine: Engine, schema: str | None) -> None:
    """Depois de um ALTER TABLE: a próxima conferência pergunta ao banco de novo."""
    with _trava:
        _tabelas.pop((id(engine), schema), None)
        _colunas.pop((id(engine), schema), None)
