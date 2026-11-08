"""Trabalho demorado fora do turno do agente e da requisição do painel, com o andamento no banco.

- `disparar(tipo, entrada, local=...)` grava a linha em `tarefas_execucoes` e roda a tarefa:
  - no Render Workflows (GESTORGOV_WORKFLOWS=sim com RENDER_API_KEY, ou RENDER_USE_LOCAL_DEV=true para o servidor
    local de tarefas): cada execução numa máquina própria, com novas tentativas e tempo limite. As tarefas estão em
    `tarefas/` (o serviço gestorgov-tarefas do render.yaml);
  - sem isso (desenvolvimento local, SQLite) ou se o Render recusar: a função `local`, numa thread deste processo.
- **A entrada só leva ids e números.** O Render guarda por um tempo os argumentos e o retorno de cada execução, então
  ali nunca vai nome, e-mail, texto livre ou dado de paciente. O que a tarefa precisar além dos ids fica em
  `contexto` (nesta tabela, no nosso banco) ou ela lê do cadastro.
- A tarefa marca o andamento aqui (`executar`, `comecar`, `concluir`, `falhar`); o painel e os agentes leem com
  `andamento` e `esperar`.
"""

import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Callable

from agno.utils.log import log_info, log_warning
from sqlalchemy import JSON, Column, DateTime, MetaData, String, Table, Text, insert, select, update
from sqlalchemy.engine import Engine

ATIVAS = ("na_fila", "rodando")
# Estados finais de uma execução no Render (TaskRun.status).
FINAIS_RENDER_COM_ERRO = ("failed", "canceled")
ID_SEGURO = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")

_estado: dict = {"engine": None, "tabela": None}


def _agora() -> datetime:
    return datetime.now(timezone.utc)


def iniciar(engine: Engine, schema: str | None = None) -> None:
    metadados = MetaData(schema=schema)
    _estado["tabela"] = Table(
        "tarefas_execucoes", metadados,
        Column("id", String(64), primary_key=True),
        Column("tipo", String(40), nullable=False, index=True),
        Column("municipio_id", String(36), index=True),
        Column("referencia", String(80), index=True),
        Column("run_id", String(80)),  # a execução no Render (vazio quando rodou numa thread do servidor)
        Column("situacao", String(16), nullable=False, default="na_fila"),
        Column("contexto", JSON),  # o que a tarefa precisa e não pode ir para o Render (sessão, quem pediu)
        Column("progresso", JSON),
        Column("resultado", JSON),
        Column("erro", Text),
        Column("criado_por", String(200)),
        Column("criado_em", DateTime(timezone=True)),
        Column("iniciada_em", DateTime(timezone=True)),
        Column("concluida_em", DateTime(timezone=True)),
    )
    metadados.create_all(engine, tables=[_estado["tabela"]])
    _estado["engine"] = engine


def disponivel() -> bool:
    return _estado["engine"] is not None


def _t() -> Table:
    return _estado["tabela"]


def remoto() -> bool:
    """As tarefas vão para o Render Workflows (e não para uma thread deste servidor)?"""
    if os.getenv("GESTORGOV_WORKFLOWS", "nao").strip().lower() not in ("sim", "1", "true"):
        return False
    local_dev = os.getenv("RENDER_USE_LOCAL_DEV", "").strip().lower() in ("1", "true", "sim")
    return bool(os.getenv("RENDER_API_KEY", "").strip()) or local_dev


def _servico() -> str:
    return os.getenv("GESTORGOV_WORKFLOW", "gestorgov-tarefas").strip() or "gestorgov-tarefas"


def _conferir_entrada(entrada: list) -> None:
    """Só ids e números vão para o Render: um texto que não pareça id é recusado (e é erro de programação)."""
    for valor in entrada:
        if valor is None or isinstance(valor, (bool, int, float)):
            continue
        if isinstance(valor, str) and ID_SEGURO.match(valor) and "@" not in valor:
            continue
        raise ValueError(f"Entrada de tarefa só aceita ids e números (recebeu {type(valor).__name__}).")


def _alterar(execucao_id: str, **valores) -> None:
    with _estado["engine"].begin() as conexao:
        conexao.execute(update(_t()).where(_t().c.id == execucao_id).values(**valores))


def criar(tipo: str, *, municipio_id: str | None = None, referencia: str | None = None, criado_por: str = "sistema",
          contexto: dict | None = None, execucao_id: str | None = None) -> str:
    execucao_id = execucao_id or uuid.uuid4().hex
    with _estado["engine"].begin() as conexao:
        conexao.execute(insert(_t()).values(
            id=execucao_id, tipo=tipo, municipio_id=municipio_id, referencia=referencia, situacao="na_fila",
            contexto=contexto or {}, criado_por=criado_por, criado_em=_agora()))
    return execucao_id


def disparar(tipo: str, entrada: list, *, local: Callable[[str], dict | None], municipio_id: str | None = None,
             referencia: str | None = None, criado_por: str = "sistema", contexto: dict | None = None,
             forcar_local: bool = False) -> str:
    """Começa a tarefa e devolve o id da execução (acompanhe com `andamento`/`esperar`).

    `entrada`: os argumentos da tarefa no Render depois do id da execução (só ids e números).
    `local(execucao_id)`: o mesmo trabalho, para rodar numa thread quando o Render não está ligado.
    """
    _conferir_entrada(entrada)
    execucao_id = criar(tipo, municipio_id=municipio_id, referencia=referencia, criado_por=criado_por, contexto=contexto)
    if remoto() and not forcar_local:
        try:
            from render import Render

            run = Render().workflows.start_task(f"{_servico()}/{tipo}", [execucao_id, *entrada])
            _alterar(execucao_id, run_id=str(run.id))
            log_info(f"Tarefa {tipo} ({execucao_id}) no Render: {run.id}")
            return execucao_id
        except Exception as erro:  # sem SDK, chave errada ou Render fora: roda aqui mesmo, para nada se perder
            log_warning(f"Tarefa {tipo} não foi para o Render ({type(erro).__name__}: {erro}); roda neste servidor.")
    threading.Thread(target=executar, args=(execucao_id, lambda: local(execucao_id)), daemon=True,
                     name=f"tarefa-{tipo}").start()
    return execucao_id


def comecar(execucao_id: str) -> None:
    _alterar(execucao_id, situacao="rodando", iniciada_em=_agora(), erro=None)


def progresso(execucao_id: str, dados: dict) -> None:
    _alterar(execucao_id, progresso=dados)


def concluir(execucao_id: str, resultado: dict | None) -> None:
    _alterar(execucao_id, situacao="concluida", resultado=resultado or {}, concluida_em=_agora())


def falhar(execucao_id: str, erro: Exception | str) -> None:
    texto = erro if isinstance(erro, str) else f"{type(erro).__name__}: {erro}"
    _alterar(execucao_id, situacao="erro", erro=texto[:2000], concluida_em=_agora())


def executar(execucao_id: str, trabalho: Callable[[], dict | None]) -> dict:
    """Roda o trabalho marcando o andamento. Repassa o erro (no Render, é o que dispara a nova tentativa)."""
    comecar(execucao_id)
    try:
        resultado = trabalho() or {}
    except Exception as erro:
        log_warning(f"Tarefa {execucao_id} falhou: {type(erro).__name__}: {erro}")
        falhar(execucao_id, erro)
        raise
    concluir(execucao_id, resultado)
    return resultado


def _dict(linha) -> dict:
    d = dict(linha)
    for chave in ("criado_em", "iniciada_em", "concluida_em"):
        d[chave] = d[chave].isoformat() if d.get(chave) else None
    return d


def _conferir_no_render(linha: dict) -> dict:
    """Execução no Render que parou sem avisar (tempo esgotado, cancelada): marca o erro aqui."""
    if linha["situacao"] not in ATIVAS or not linha.get("run_id") or not remoto():
        return linha
    try:
        from render import Render

        status = Render().workflows.get_task_run(linha["run_id"]).status
        status = getattr(status, "value", status)
    except Exception:
        return linha
    if status in FINAIS_RENDER_COM_ERRO:
        falhar(linha["id"], f"A execução no Render terminou como {status}.")
        return {**linha, "situacao": "erro", "erro": f"A execução no Render terminou como {status}."}
    return linha


def andamento(execucao_id: str) -> dict | None:
    with _estado["engine"].connect() as conexao:
        linha = conexao.execute(select(_t()).where(_t().c.id == execucao_id)).mappings().first()
    return _conferir_no_render(_dict(linha)) if linha else None


def ultima(tipo: str, *, municipio_id: str | None = None, referencia: str | None = None) -> dict | None:
    q = select(_t()).where(_t().c.tipo == tipo)
    if municipio_id:
        q = q.where(_t().c.municipio_id == municipio_id)
    if referencia:
        q = q.where(_t().c.referencia == referencia)
    with _estado["engine"].connect() as conexao:
        linha = conexao.execute(q.order_by(_t().c.criado_em.desc()).limit(1)).mappings().first()
    return _conferir_no_render(_dict(linha)) if linha else None


def ativa(tipo: str, referencia: str) -> bool:
    achada = ultima(tipo, referencia=referencia)
    return bool(achada and achada["situacao"] in ATIVAS)


def esperar(execucao_id: str, segundos: float) -> dict | None:
    """Espera a execução terminar (até `segundos`) e devolve a situação, terminada ou não."""
    limite = time.monotonic() + segundos
    atual = andamento(execucao_id)
    while atual and atual["situacao"] in ATIVAS and time.monotonic() < limite:
        time.sleep(1)
        atual = andamento(execucao_id)
    return atual


def limpar_presas() -> int:
    """Ao subir o servidor: as execuções que rodavam numa thread dele (sem run_id) morreram com o processo."""
    with _estado["engine"].begin() as conexao:
        return conexao.execute(update(_t()).where(_t().c.situacao.in_(ATIVAS), _t().c.run_id.is_(None)).values(
            situacao="erro", erro="O servidor reiniciou no meio da execução.", concluida_em=_agora())).rowcount
