"""Limpeza rodada pelo agendador do AgentOS (ver app.py e painel_api.py): traces e execuções de rotinas com mais
de DIAS_TRACES dias. As conversas, respostas e memórias ficam."""

import os
from datetime import datetime, timedelta, timezone

from agno.utils.log import log_info
from sqlalchemy import MetaData, Table, delete, inspect
from sqlalchemy.engine import Engine

DIAS_TRACES = int(os.getenv("TRACES_RETENCAO_DIAS", "30"))


def limpar_registros_tecnicos(engine: Engine, schema: str | None, dias: int = DIAS_TRACES) -> dict:
    """Apaga, com mais de `dias` dias, os traces (etapas e rastreamentos) e as execuções das rotinas
    agendadas: crescem a cada minuto e só servem para investigar o passado recente."""
    limite = datetime.now(timezone.utc) - timedelta(days=dias)
    existentes = set(inspect(engine).get_table_names(schema=schema))
    resultado = {"etapas": 0, "traces": 0, "execucoes_de_rotinas": 0}
    metadados = MetaData(schema=schema)
    with engine.begin() as conexao:
        # As datas dos traces são texto ISO em UTC: a comparação de texto respeita a ordem do tempo.
        if "agno_spans" in existentes:  # antes dos traces: cada etapa aponta para o seu trace
            spans = Table("agno_spans", metadados, autoload_with=engine)
            resultado["etapas"] = conexao.execute(delete(spans).where(spans.c.created_at < limite.isoformat())).rowcount
        if "agno_traces" in existentes:
            traces = Table("agno_traces", metadados, autoload_with=engine)
            resultado["traces"] = conexao.execute(delete(traces).where(traces.c.created_at < limite.isoformat())).rowcount
        if "agno_schedule_runs" in existentes:  # datas em segundos desde 1970
            execucoes = Table("agno_schedule_runs", metadados, autoload_with=engine)
            resultado["execucoes_de_rotinas"] = conexao.execute(
                delete(execucoes).where(execucoes.c.created_at < int(limite.timestamp()))).rowcount
    if any(resultado.values()):
        log_info(f"Limpeza de registros técnicos: {resultado} (mais de {dias} dias).")
    return resultado
