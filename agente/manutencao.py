"""Tarefas de manutenção rodadas pelo agendador do AgentOS (ver app.py e painel_api.py).

- Avaliações diárias: o script testes/avaliacoes.py roda num PROCESSO SEPARADO. Ele troca as fontes
  de dados por alunos fictícios dentro do próprio processo (cadastro simulado); dentro do servidor,
  isso valeria para os alunos de verdade. Os resultados vão para o banco do agente (tela Evaluation).
- Limpeza: registros mínimos da Unnichat (contatos que o agente não atende) e ids de mensagens já
  respondidas, com mais de DIAS_RETENCAO dias; traces e execuções de rotinas, com mais de DIAS_TRACES.
"""

import os
import subprocess
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agno.utils.log import log_info, log_warning
from sqlalchemy import MetaData, Table, delete, inspect, select
from sqlalchemy.engine import Engine

RAIZ = Path(__file__).resolve().parent.parent
REGISTRO_AVALIACOES = RAIZ / "dados" / "avaliacoes_ultima.log"
DIAS_RETENCAO = int(os.getenv("UNNICHAT_RETENCAO_DIAS", "30"))

_avaliacao: dict = {"processo": None, "iniciada_em": None}
_trava = threading.Lock()


def avaliacoes_ligadas() -> bool:
    return os.getenv("AVALIACOES_DIARIAS", "sim").strip().lower() not in ("nao", "não", "0", "false")


def iniciar_avaliacoes() -> dict:
    """Dispara as avaliações em segundo plano; uma execução por vez."""
    with _trava:
        processo = _avaliacao["processo"]
        if processo is not None and processo.poll() is None:
            return {"iniciada": False, "motivo": "já em andamento", "desde": _avaliacao["iniciada_em"]}
        REGISTRO_AVALIACOES.parent.mkdir(exist_ok=True)
        saida = open(REGISTRO_AVALIACOES, "w", encoding="utf-8")
        processo = subprocess.Popen(
            [sys.executable, "-m", "testes.avaliacoes", "--sem-humanas"],
            cwd=RAIZ, stdout=saida, stderr=subprocess.STDOUT,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        _avaliacao.update(processo=processo, iniciada_em=datetime.now(timezone.utc).isoformat(timespec="seconds"))

    def acompanhar():
        codigo = processo.wait()
        saida.close()
        resumo = next((l.strip() for l in reversed(REGISTRO_AVALIACOES.read_text(encoding="utf-8").splitlines())
                       if "avaliações aprovadas" in l), "sem resumo")
        (log_info if codigo == 0 else log_warning)(f"Avaliações diárias terminaram (código {codigo}): {resumo}")

    threading.Thread(target=acompanhar, daemon=True).start()
    return {"iniciada": True, "desde": _avaliacao["iniciada_em"]}


def limpar_unnichat(engine: Engine, schema: str | None, dias: int = DIAS_RETENCAO) -> dict:
    """Apaga, com mais de `dias` dias: registros mínimos de unnichat_eventos (sem o corpo do contato,
    ou seja, de quem o agente não atendeu) e ids de unnichat_mensagens (só servem para não responder
    duas vezes a mesma mensagem). As conversas atendidas ficam."""
    limite = datetime.now(timezone.utc) - timedelta(days=dias)
    existentes = set(inspect(engine).get_table_names(schema=schema))
    resultado = {"eventos": 0, "mensagens": 0}
    metadados = MetaData(schema=schema)
    with engine.begin() as conexao:
        if "unnichat_eventos" in existentes:
            eventos = Table("unnichat_eventos", metadados, autoload_with=engine)
            antigos = conexao.execute(select(eventos.c.id, eventos.c.corpo).where(eventos.c.recebido_em < limite)).all()
            minimos = [i for i, corpo in antigos if not (isinstance(corpo, dict) and "contact" in corpo)]
            for inicio in range(0, len(minimos), 500):
                resultado["eventos"] += conexao.execute(
                    delete(eventos).where(eventos.c.id.in_(minimos[inicio:inicio + 500]))).rowcount
        if "unnichat_mensagens" in existentes:
            mensagens = Table("unnichat_mensagens", metadados, autoload_with=engine)
            resultado["mensagens"] = conexao.execute(delete(mensagens).where(mensagens.c.recebida_em < limite)).rowcount
    if resultado["eventos"] or resultado["mensagens"]:
        log_info(f"Limpeza da Unnichat: {resultado} (mais de {dias} dias).")
    return resultado


DIAS_TRACES = int(os.getenv("TRACES_RETENCAO_DIAS", "30"))


def limpar_registros_tecnicos(engine: Engine, schema: str | None, dias: int = DIAS_TRACES) -> dict:
    """Apaga, com mais de `dias` dias, os traces (etapas e rastreamentos) e as execuções das rotinas
    agendadas: crescem a cada minuto e só servem para investigar o passado recente. As conversas,
    respostas, memórias e avaliações ficam."""
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
