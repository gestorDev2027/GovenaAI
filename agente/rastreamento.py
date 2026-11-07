"""Rastreamento de uma conversa para o painel (Central ao vivo e Conversas): por que o agente respondeu o que
respondeu. Só leitura.

Junta, por resposta: a mensagem do contato, o resumo do raciocínio do modelo (AGENTE_PENSAMENTOS), as ferramentas
com argumentos e resultado, tempo e tokens, e o contexto que entrou nas instruções daquela resposta (histórico do
WhatsApp, trechos de documentos, exemplos aprovados, roteiro), lido das etapas do trace (agno_spans). E, da
conversa inteira: o que o Learning registrou (resumo da sessão com o plano, perfil e memórias do contato) e as ações
(transferência, encerramento).
"""

import json
from datetime import datetime, timezone

from sqlalchemy import MetaData, Table, inspect, select
from sqlalchemy.engine import Engine

MAX_RESPOSTAS = 40
MAX_RESULTADO = 2000
BLOCOS = {"whatsapp": "conversa_no_whatsapp", "trechos": "trechos_de_documentos", "exemplos": "exemplos_aprovados",
          "roteiro": "roteiro_relevante"}


def _json(valor):
    if isinstance(valor, (dict, list)) or valor is None:
        return valor
    try:
        return json.loads(valor)
    except (TypeError, ValueError):
        return valor


def _curto(valor, limite: int = MAX_RESULTADO) -> str:
    texto = valor if isinstance(valor, str) else json.dumps(valor, ensure_ascii=False, default=str)
    return texto if len(texto) <= limite else texto[:limite] + "…"


def _bloco(texto: str, tag: str) -> str | None:
    inicio, fim = texto.find(f"<{tag}>"), texto.find(f"</{tag}>")
    return texto[inicio + len(tag) + 2:fim].strip() if inicio >= 0 and fim > inicio else None


def _instrucoes_da_chamada(atributos: dict) -> str:
    """As instruções (mensagem de sistema) que foram ao modelo nesta chamada."""
    for i in range(4):
        if atributos.get(f"llm.input_messages.{i}.message.role") == "system":
            return str(atributos.get(f"llm.input_messages.{i}.message.content") or "")
    return ""


def _etapas(engine: Engine, schema: str | None, session_id: str) -> dict[str, dict]:
    """Por run_id: as chamadas ao modelo (tempo, tokens) e o contexto extra que entrou nas instruções."""
    existentes = set(inspect(engine).get_table_names(schema=schema))
    if not {"agno_traces", "agno_spans"} <= existentes:
        return {}
    metadados = MetaData(schema=schema)
    traces = Table("agno_traces", metadados, autoload_with=engine)
    spans = Table("agno_spans", metadados, autoload_with=engine)
    with engine.connect() as conexao:
        dos_traces = {t.trace_id: t.run_id for t in conexao.execute(
            select(traces.c.trace_id, traces.c.run_id).where(traces.c.session_id == session_id)).all()}
        if not dos_traces:
            return {}
        linhas = conexao.execute(
            select(spans.c.trace_id, spans.c.name, spans.c.duration_ms, spans.c.status_code, spans.c.attributes,
                   spans.c.start_time)
            .where(spans.c.trace_id.in_(list(dos_traces)), spans.c.name.like("%.invoke"))
            .order_by(spans.c.start_time)).all()
    por_run: dict[str, dict] = {}
    for linha in linhas:
        run_id = dos_traces.get(linha.trace_id)
        if not run_id:
            continue
        atributos = _json(linha.attributes) or {}
        dele = por_run.setdefault(run_id, {"chamadas_modelo": [], "contexto": {}})
        dele["chamadas_modelo"].append({
            "modelo": atributos.get("llm.model_name"),
            "duracao_ms": linha.duration_ms,
            "tokens_entrada": atributos.get("llm.token_count.prompt"),
            "tokens_saida": atributos.get("llm.token_count.completion"),
            "tokens_cache": atributos.get("llm.token_count.prompt_details.cache_read"),
            "erro": linha.status_code == "ERROR",
        })
        if not dele["contexto"]:  # as instruções são as mesmas em todas as chamadas da resposta
            instrucoes = _instrucoes_da_chamada(atributos)
            dele["contexto"] = {chave: bool(_bloco(instrucoes, tag)) for chave, tag in BLOCOS.items()}
            whatsapp = _bloco(instrucoes, BLOCOS["whatsapp"])  # as regras do bloco, uma linha em branco, as mensagens
            dele["contexto"]["whatsapp_texto"] = whatsapp.split("\n\n", 1)[-1] if whatsapp else None
    return por_run


def _aprendizado(engine: Engine, schema: str | None, session_id: str, user_id: str | None) -> dict:
    """O que o Learning guardou: resumo da sessão (com o plano) e, do contato, perfil e memórias."""
    if "agno_learnings" not in set(inspect(engine).get_table_names(schema=schema)):
        return {}
    tabela = Table("agno_learnings", MetaData(schema=schema), autoload_with=engine)
    condicao = tabela.c.session_id == session_id
    if user_id:
        condicao = condicao | ((tabela.c.user_id == user_id) & tabela.c.learning_type.in_(["user_profile", "user_memory"]))
    with engine.connect() as conexao:
        linhas = conexao.execute(select(tabela.c.learning_type, tabela.c.content, tabela.c.updated_at)
                                 .where(condicao).order_by(tabela.c.updated_at)).all()
    saida: dict = {}
    for tipo, conteudo, _ in linhas:
        dado = _json(conteudo) or {}
        if tipo == "session_context":
            saida["resumo"] = {k: dado.get(k) for k in ("summary", "goal", "plan", "progress")}
        elif tipo == "user_profile":
            saida["perfil"] = {k: v for k, v in dado.items() if k not in ("user_id", "agent_id", "team_id") and v}
        elif tipo == "user_memory":
            saida["memorias"] = [m.get("memory") or m.get("content") or m.get("text") or _curto(m, 300)
                                 for m in dado.get("memories") or [] if isinstance(m, dict)]
    return saida


def conversa(sessao, engine: Engine, schema: str | None) -> dict:
    """O rastreamento da sessão do Agno (agent session)."""
    estado = (sessao.session_data or {}).get("session_state") or {}
    etapas = _etapas(engine, schema, sessao.session_id)
    respostas = []
    for run in (sessao.runs or [])[-MAX_RESPOSTAS:]:
        if getattr(run, "parent_run_id", None):
            continue
        entrada = getattr(run, "input", None)
        metricas = getattr(run, "metrics", None)
        respostas.append({
            "run_id": run.run_id,
            "quando": datetime.fromtimestamp(run.created_at, timezone.utc).isoformat() if run.created_at else None,
            "agente": getattr(run, "agent_id", None),
            "mensagem": str(getattr(entrada, "input_content", entrada) or ""),
            "resposta": run.content or "",
            "raciocinio": getattr(run, "reasoning_content", None) or None,
            "duracao_s": round(metricas.duration, 2) if metricas and metricas.duration else None,
            "tokens": {
                "entrada": getattr(metricas, "input_tokens", None),
                "saida": getattr(metricas, "output_tokens", None),
                "raciocinio": getattr(metricas, "reasoning_tokens", None),
            } if metricas else None,
            "ferramentas": [{"nome": t.tool_name, "argumentos": t.tool_args, "resultado": _curto(t.result) if t.result else None,
                             "erro": bool(getattr(t, "tool_call_error", False))} for t in (run.tools or [])],
            "calibracao": (run.metadata or {}).get("calibracao") if getattr(run, "metadata", None) else None,
            **etapas.get(run.run_id, {"chamadas_modelo": [], "contexto": {}}),
        })
    return {
        "session_id": sessao.session_id,
        "status": estado.get("status"),
        "nome": estado.get("nome_contato") or "",
        "acoes": estado.get("acoes") or [],
        **_aprendizado(engine, schema, sessao.session_id, getattr(sessao, "user_id", None)),
        "respostas": respostas,
    }
