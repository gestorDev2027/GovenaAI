"""Visão gerencial do banco dos agentes no painel (/painel/api/banco). Só leitura.

Lista as tabelas do schema dos agentes (gestorgov no Supabase; o SQLite local nos testes) com a
quantidade de linhas e as colunas, e mostra as linhas de cada uma, com paginação e busca. A lista
vem do próprio banco: tabela nova aparece sozinha. Vetores (embedding) aparecem como "vetor de N
dimensões"; textos e JSON longos vêm cortados na listagem e inteiros ao abrir o registro.

Cada consulta roda numa transação de leitura (Postgres: READ ONLY e limite de tempo), e o nome da
tabela só é aceito se estiver na lista do banco. Acesso só para quem tem a permissão "ver o banco" (agente/usuarios.py):
as tabelas têm telefones, mensagens dos contatos e dados de cadastro.
"""

import json
from datetime import date, datetime, timezone
from decimal import Decimal

from agno.agent import Agent
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query
from sqlalchemy import inspect, text

from agente.agente import schema_banco
from painel_api import _negado, _pode, _quem
from painel_api import exigir_chave

LIMITE_CELULA = 300  # caracteres por célula na listagem
LIMITE_REGISTRO = 200_000  # caracteres por campo ao abrir o registro
COLUNAS_OCULTAS = {"token_hash"}

# Grupo e descrição de cada tabela conhecida; as outras aparecem em "Outras".
DESCRICOES: dict[str, tuple[str, str]] = {
    "agno_sessions": ("Agno", "Conversas (sessões) de todos os agentes, com o estado de cada uma"),
    "agno_runs": ("Agno", "Cada resposta do agente: mensagens, ferramentas usadas e métricas"),
    "agno_memories": ("Agno", "Memórias de cada contato, gravadas depois das respostas"),
    "agno_metrics": ("Agno", "Métricas diárias agregadas pelo AgentOS"),
    "agno_eval_runs": ("Agno", "Resultados das avaliações automáticas"),
    "agno_schedules": ("Agno", "Rotinas agendadas: inatividade, avaliações e limpeza"),
    "agno_schedule_runs": ("Agno", "Cada execução das rotinas agendadas"),
    "agno_traces": ("Agno", "Rastreamento de cada execução (início, fim e duração)"),
    "agno_spans": ("Agno", "Etapas de cada rastreamento (modelo, ferramentas)"),
    "agno_knowledge": ("Agno", "Conteúdos do Knowledge do Agno (não usado: a base fica em conhecimento_*)"),
    "agno_learnings": ("Agno", "Aprendizados do Learning do Agno (não ligado)"),
    "agno_components": ("Agno", "Componentes salvos pelo AgentOS"),
    "agno_component_configs": ("Agno", "Versões da configuração dos componentes do AgentOS"),
    "agno_component_links": ("Agno", "Ligações entre componentes do AgentOS"),
    "agno_approvals": ("Agno", "Aprovações humanas de ferramentas (não usadas)"),
    "agno_service_accounts": ("Agno", "Contas de serviço do AgentOS"),
    "agno_tool_results": ("Agno", "Resultados grandes de ferramentas, guardados à parte"),
    "agno_schema_versions": ("Agno", "Versão do esquema de cada tabela do Agno"),
    "conhecimento_documentos": ("Conhecimento", "Documentos enviados e cada versão (arquivo no bucket)"),
    "conhecimento_trechos": ("Conhecimento", "Trechos dos documentos, com o vetor usado na busca"),
    "painel_base_conhecimento": ("Conhecimento", "Versões do roteiro salvas no painel"),
    "calibracao_exemplos": ("Conhecimento", "Exemplos aprovados que o agente recebe, com o vetor"),
}


def _descricao(tabela: str) -> tuple[str, str]:
    if tabela in DESCRICOES:
        return DESCRICOES[tabela]
    if tabela.startswith("painel_base_conhecimento_"):  # um roteiro por agente além do padrão
        return "Conhecimento", f"Versões do roteiro do agente {tabela.removeprefix('painel_base_conhecimento_')}"
    return "Outras", ""


def _texto(valor) -> str:
    return json.dumps(valor, ensure_ascii=False, default=str) if isinstance(valor, (dict, list)) else str(valor)


def _vetor(valor) -> int | None:
    """Tamanho do vetor, quando o valor é um (lista de números, como o SQLite guarda o embedding)."""
    if isinstance(valor, list) and len(valor) > 32 and all(isinstance(x, (int, float)) for x in valor[:32]):
        return len(valor)
    return None


def _valor(coluna: str, valor, limite: int):
    """Valor pronto para o JSON da resposta e se foi cortado."""
    if valor is None or isinstance(valor, bool):
        return valor, False
    if coluna in COLUNAS_OCULTAS:
        return "••••••", False
    if isinstance(valor, (datetime, date)):
        return valor.isoformat(), False
    if isinstance(valor, Decimal):
        return float(valor), False
    if isinstance(valor, (int, float)):
        # As tabelas do Agno guardam datas como segundos desde 1970 (created_at, updated_at...).
        if coluna.endswith("_at") and isinstance(valor, int) and 1e9 < valor < 1e11:
            return datetime.fromtimestamp(valor, timezone.utc).isoformat(), False
        return valor, False
    if isinstance(valor, (bytes, memoryview)):
        return f"({len(bytes(valor))} bytes)", False
    if (dimensoes := _vetor(valor)) is not None:
        return f"vetor de {dimensoes} dimensões", False
    texto = _texto(valor)
    return (texto[:limite] + "…", True) if len(texto) > limite else (texto, False)


def criar_rotas_banco(agentes: dict[str, Agent]) -> APIRouter:
    engine = next(iter(agentes.values())).db.db_engine
    schema = schema_banco()
    postgres = engine.dialect.name == "postgresql"
    citar = engine.dialect.identifier_preparer.quote

    def so_curadores(painel_sessao: str | None = Cookie(default=None)) -> None:
        if not _pode(_quem(painel_sessao), "ver_banco"):
            raise _negado("ver_banco")

    rotas = APIRouter(prefix="/painel/api/banco", tags=["Banco"], dependencies=[Depends(exigir_chave), Depends(so_curadores)])

    def nome_completo(tabela: str) -> str:
        return f"{citar(schema)}.{citar(tabela)}" if schema else citar(tabela)

    def conectar():
        conexao = engine.connect()
        if postgres:  # nada aqui escreve, e nenhuma consulta trava o banco
            conexao.execute(text("SET TRANSACTION READ ONLY"))
            conexao.execute(text("SET LOCAL statement_timeout = '15s'"))
        return conexao

    def colunas_da(tabela: str) -> list[dict]:
        """Colunas na ordem do banco; `vetor` marca as do pgvector (lidas só pelo tamanho)."""
        if tabela not in inspect(engine).get_table_names(schema=schema):
            raise HTTPException(status_code=404, detail=f"Tabela desconhecida: {tabela}.")
        if postgres:
            with conectar() as conexao:
                linhas = conexao.execute(text(
                    "select column_name, data_type, udt_name from information_schema.columns "
                    "where table_schema = :s and table_name = :t order by ordinal_position"), {"s": schema, "t": tabela}).all()
            return [{"nome": n, "tipo": u if t == "USER-DEFINED" else t, "vetor": u == "vector"} for n, t, u in linhas]
        return [{"nome": c["name"], "tipo": str(c["type"]).lower(), "vetor": False}
                for c in inspect(engine).get_columns(tabela, schema=schema)]

    def chave_primaria(tabela: str) -> list[str]:
        return inspect(engine).get_pk_constraint(tabela, schema=schema).get("constrained_columns") or []

    def selecao(colunas: list[dict]) -> str:
        return ", ".join(
            f"vector_dims({citar(c['nome'])}) as {citar(c['nome'])}" if c["vetor"] else citar(c["nome"]) for c in colunas)

    def linha_em_json(colunas: list[dict], linha, limite: int) -> tuple[list, list[str]]:
        valores, cortadas = [], []
        for c, v in zip(colunas, linha):
            if c["vetor"] and v is not None:
                valores.append(f"vetor de {v} dimensões")
                continue
            convertido, cortado = _valor(c["nome"], v, limite)
            valores.append(convertido)
            if cortado:
                cortadas.append(c["nome"])
        return valores, cortadas

    @rotas.get("/tabelas")
    def tabelas() -> dict:
        nomes = sorted(inspect(engine).get_table_names(schema=schema))
        resultado = []
        with conectar() as conexao:
            for nome in nomes:
                linhas = conexao.execute(text(f"select count(*) from {nome_completo(nome)}")).scalar_one()
                grupo, descricao = _descricao(nome)
                resultado.append({"nome": nome, "grupo": grupo, "descricao": descricao, "linhas": linhas})
        return {"banco": "Postgres (Supabase)" if postgres else "SQLite local", "schema": schema, "tabelas": resultado}

    @rotas.get("/tabelas/{tabela}")
    def linhas(
        tabela: str,
        pagina: int = Query(default=1, ge=1, le=100_000),
        por_pagina: int = Query(default=50, ge=10, le=200),
        busca: str = Query(default="", max_length=100),
        ordem: str = Query(default="", max_length=100),
        direcao: str = Query(default="desc", pattern="^(asc|desc)$"),
    ) -> dict:
        colunas = colunas_da(tabela)
        chave = chave_primaria(tabela)
        if ordem and ordem not in {c["nome"] for c in colunas if not c["vetor"]}:
            raise HTTPException(status_code=422, detail=f"Coluna desconhecida para ordenar: {ordem}.")
        # Sem coluna escolhida, mais recentes primeiro: pela chave primária ou pela primeira coluna de data.
        padrao = chave or [c["nome"] for c in colunas if c["nome"] in ("recebido_em", "criada_em", "created_at")][:1]
        ordenar = [ordem] if ordem else padrao
        sentido = direcao if ordem else "desc"
        filtro, parametros = "", {}
        if busca.strip():
            textos = [c for c in colunas if not c["vetor"] and c["nome"] not in COLUNAS_OCULTAS]
            operador = "ilike" if postgres else "like"
            filtro = "where " + " or ".join(f"cast({citar(c['nome'])} as text) {operador} :busca" for c in textos)
            parametros["busca"] = f"%{busca.strip()}%"
        consulta = (f"select {selecao(colunas)} from {nome_completo(tabela)} {filtro} "
                    + (f"order by {', '.join(f'{citar(c)} {sentido}' for c in ordenar)} " if ordenar else "")
                    + "limit :limite offset :inicio")
        with conectar() as conexao:
            total = conexao.execute(text(f"select count(*) from {nome_completo(tabela)} {filtro}"), parametros).scalar_one()
            achadas = conexao.execute(text(consulta), {**parametros, "limite": por_pagina, "inicio": (pagina - 1) * por_pagina}).all()
        indices = [i for i, c in enumerate(colunas) if c["nome"] in chave]
        registros = []
        for linha in achadas:
            valores, cortadas = linha_em_json(colunas, linha, LIMITE_CELULA)
            registros.append({"valores": valores, "cortadas": cortadas,
                              "chave": {colunas[i]["nome"]: _valor("", linha[i], LIMITE_REGISTRO)[0] for i in indices}})
        grupo, descricao = _descricao(tabela)
        return {"tabela": tabela, "grupo": grupo, "descricao": descricao, "colunas": colunas, "chave_primaria": chave,
                "ordem": ordem or (padrao[0] if padrao else None), "direcao": sentido,
                "total": total, "pagina": pagina, "por_pagina": por_pagina, "linhas": registros}

    @rotas.get("/tabelas/{tabela}/registro")
    def registro(tabela: str, chave: str = Query(..., max_length=2000)) -> dict:
        """Um registro inteiro, pela chave primária (JSON {coluna: valor}), sem cortar os textos."""
        colunas = colunas_da(tabela)
        primaria = chave_primaria(tabela)
        try:
            valores_chave = json.loads(chave)
        except ValueError:
            raise HTTPException(status_code=422, detail="Chave inválida.")
        if not primaria or not isinstance(valores_chave, dict) or set(valores_chave) != set(primaria):
            raise HTTPException(status_code=422, detail="Informe todas as colunas da chave primária.")
        onde = " and ".join(f"cast({citar(c)} as text) = :k{i}" for i, c in enumerate(primaria))
        parametros = {f"k{i}": str(valores_chave[c]) for i, c in enumerate(primaria)}
        with conectar() as conexao:
            linha = conexao.execute(text(f"select {selecao(colunas)} from {nome_completo(tabela)} where {onde} limit 1"),
                                    parametros).first()
        if not linha:
            raise HTTPException(status_code=404, detail="Registro não encontrado.")
        valores, _ = linha_em_json(colunas, linha, LIMITE_REGISTRO)
        return {"tabela": tabela, "campos": [{"coluna": c["nome"], "tipo": c["tipo"], "valor": v} for c, v in zip(colunas, valores)]}

    return rotas
