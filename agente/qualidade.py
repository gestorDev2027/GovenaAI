"""Qualidade das conversas dos agentes com a régua de cinco critérios do GestorGov.

A régua (agente/regua_qualidade.json) julga por IA cinco critérios (compreensão do pedido, qualidade da
resposta, clareza da orientação, desfecho e português), cada um em abaixo / dentro / acima / não avaliável,
e classifica o tema de cada conversa. Este módulo a aplica às conversas concluídas dos agentes, para a Visão
geral mostrar como cada agente está indo.

- A régua é versionada: mudou o JSON, troque a versão (avaliações de versões diferentes não se comparam).
- Uma linha por conversa em `qualidade_supervisor`. A rotina diária (app.py, "avaliar-qualidade") avalia as
  concluídas que ainda não têm linha.
- Ainda não há lado humano para comparar: `agregado_humanos` responde indisponível e a Visão geral mostra
  só o agente.
- Revisão humana: o responsável confere uma amostra; a concordância mede se a régua está sendo aplicada ao
  agente com o rigor esperado.
"""

import json
import os
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agno.db.base import SessionType
from agno.utils.log import log_info, log_warning
from sqlalchemy import JSON, Column, DateTime, Integer, MetaData, String, Table, select, update

REGUA = json.loads((Path(__file__).parent / "regua_qualidade.json").read_text(encoding="utf-8"))
CRITERIOS = [d["dimensao"] for d in REGUA["dimensoes"]]
ROTULOS = {d["dimensao"]: d["rotulo"] for d in REGUA["dimensoes"]}
NIVEIS = ("abaixo", "dentro", "acima", "nao_avaliavel")
TEMAS = {c["motivo"]: c.get("rotulo_motivo") or c["motivo"] for c in REGUA["catalogo"]}
ROTULO_TEMA = TEMAS
TABELA = "qualidade_supervisor"
DIAS_PENDENTES = 30  # a rotina olha as conversas concluídas destes últimos dias


def modelo() -> str:
    """O modelo do avaliador."""
    return os.getenv("QUALIDADE_MODELO", "gemini-2.5-flash")


def ligada() -> bool:
    return os.getenv("QUALIDADE_SUPERVISOR", "sim").strip().lower() not in ("nao", "não", "0", "false")


def _tabela(schema: str | None) -> Table:
    return Table(
        TABELA,
        MetaData(schema=schema),
        Column("session_id", String(160), primary_key=True),
        Column("agente", String(60), nullable=True),
        Column("iniciada_em", DateTime(timezone=True), nullable=True),
        Column("avaliada_em", DateTime(timezone=True), nullable=False),
        Column("modelo", String(60), nullable=False),
        Column("versao_regua", String(60), nullable=False),
        Column("motivo", String(40), nullable=True),
        Column("subcausa", String(60), nullable=True),
        Column("niveis", JSON, nullable=False),  # {criterio: {"nivel": ..., "evidencia": ...}}
        Column("tokens_entrada", Integer, nullable=True),
        Column("tokens_saida", Integer, nullable=True),
        Column("revisao", JSON, nullable=True),  # {criterio: nivel que o revisor daria}
        Column("revisor", String(200), nullable=True),
        Column("revisada_em", DateTime(timezone=True), nullable=True),
    )


# ───────── O prompt: a régua do Supervisor, com o agente no lugar do consultor ─────────

def _instrucoes() -> str:
    blocos = []
    for d in REGUA["dimensoes"]:
        blocos.append(
            f"### {d['dimensao']} — {d['rotulo']}\nPergunta: {d['pergunta']}\n"
            f"- abaixo: {d['criterio_abaixo']}\n- dentro: {d['criterio_dentro']}\n- acima: {d['criterio_acima']}\n"
            f"- nao_avaliavel: {d['criterio_nao_avaliavel']}\nObservação: {d['nota_extra']}"
        )
    catalogo = "\n".join(f"- {c['motivo']} / {c['subcausa']}: {c['rotulo_subcausa']} — {c['descricao']}" for c in REGUA["catalogo"])
    return (
        "Você é o avaliador de qualidade do GestorGov. Avalie o AGENTE de IA de um setor da Secretaria Municipal de "
        "Saúde, que trabalha com os servidores pelo painel. Julgue só as mensagens do [Agente]; as do [Servidor] e do "
        "[Sistema] são contexto. Transferir para uma pessoa avisando o servidor não é promessa descumprida.\n\n"
        "Para cada critério, escolha o nível: abaixo, dentro, acima ou nao_avaliavel, e cite a evidência em uma frase.\n\n"
        + "\n\n".join(blocos)
        + f"\n\nClassifique também o assunto do atendimento num motivo e numa subcausa do catálogo (use os códigos):\n{catalogo}\n"
    )


def _esquema():
    from google.genai import types

    nivel = types.Schema(type=types.Type.OBJECT, properties={
        "nivel": types.Schema(type=types.Type.STRING, enum=list(NIVEIS)),
        "evidencia": types.Schema(type=types.Type.STRING),
    }, required=["nivel", "evidencia"])
    return types.Schema(
        type=types.Type.OBJECT,
        properties={**{c: nivel for c in CRITERIOS},
                    "motivo": types.Schema(type=types.Type.STRING, enum=sorted(TEMAS)),
                    "subcausa": types.Schema(type=types.Type.STRING)},
        required=[*CRITERIOS, "motivo", "subcausa"],
    )


def transcricao(sessao) -> str:
    """A conversa como o avaliador lê: as mensagens do servidor e do agente, as consultas e as ações registradas."""
    estado = (getattr(sessao, "session_data", None) or {}).get("session_state") or {}
    linhas = ["[Agente] (mensagem de boas-vindas automática)"]
    for run in getattr(sessao, "runs", None) or []:
        entrada = getattr(run, "input", None)
        texto = getattr(entrada, "input_content", entrada)
        if isinstance(texto, str) and texto.strip():
            linhas.append(f"[Servidor] {texto.strip()}")
        nomes = [f.tool_name for f in (run.tools or []) if getattr(f, "tool_name", None)]
        if nomes:
            linhas.append(f"[Sistema] o agente consultou: {', '.join(nomes)}")
        if isinstance(run.content, str) and run.content.strip():
            linhas.append(f"[Agente] {run.content.strip()}")
    for acao in estado.get("acoes") or []:
        if acao.get("tipo") == "transferencia":
            linhas.append(f"[Sistema] o agente transferiu para uma pessoa (categoria: {acao.get('categoria')}; motivo: {acao.get('motivo')})")
        elif acao.get("tipo") == "encerramento":
            linhas.append("[Sistema] o agente encerrou o atendimento")
        elif acao.get("tipo") == "inatividade":
            linhas.append("[Sistema] a conversa foi encerrada por falta de resposta do servidor")
    return "\n".join(linhas)


class Qualidade:
    """A tabela das avaliações e as contas da comparação. Sem banco, fica desligada (a tela diz isso)."""

    def __init__(self, db, schema: str | None):
        self.db, self.schema = db, schema
        self.engine = getattr(db, "db_engine", None)
        self.tabela = _tabela(schema)
        self._cliente = None
        self._rodando = False
        try:
            self.tabela.metadata.create_all(self.engine, tables=[self.tabela])
        except Exception as erro:  # banco sem permissão de criar: a tela mostra que está indisponível
            log_warning(f"Qualidade: tabela {TABELA} indisponível: {type(erro).__name__}: {erro}")
            self.engine = None

    # ── Avaliar ──

    def _modelo_gemini(self):
        if self._cliente is None:
            from google import genai

            self._cliente = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        return self._cliente

    def avaliar_sessao(self, sessao) -> dict:
        from google.genai import types

        resposta = self._modelo_gemini().models.generate_content(
            model=modelo(),
            contents=f"CONVERSA:\n{transcricao(sessao)}",
            config=types.GenerateContentConfig(system_instruction=_instrucoes(), temperature=0,
                                               response_mime_type="application/json", response_schema=_esquema()),
        )
        dados = json.loads(resposta.text)
        uso = resposta.usage_metadata
        return {
            "niveis": {c: dados[c] for c in CRITERIOS},
            "motivo": dados.get("motivo"),
            "subcausa": dados.get("subcausa"),
            "tokens_entrada": getattr(uso, "prompt_token_count", None),
            "tokens_saida": getattr(uso, "candidates_token_count", None),
        }

    def pendentes(self, limite: int) -> list:
        """Conversas reais (WhatsApp) concluídas nos últimos dias, ainda sem avaliação desta versão da régua."""
        desde = int((datetime.now(timezone.utc) - timedelta(days=DIAS_PENDENTES)).timestamp())
        with self.engine.connect() as conexao:
            feitas = {r[0] for r in conexao.execute(
                select(self.tabela.c.session_id).where(self.tabela.c.versao_regua == REGUA["versao"])).all()}
        saida = []
        for tipo in (SessionType.AGENT, SessionType.TEAM):
            for sessao in self.db.get_sessions(session_type=tipo, start_timestamp=desde, sort_by="created_at", sort_order="asc") or []:
                estado = (sessao.session_data or {}).get("session_state") or {}
                if (sessao.session_id in feitas or not str(sessao.user_id or "").startswith("unnichat:")
                        or estado.get("status", "em_atendimento") == "em_atendimento" or not sessao.runs):
                    continue
                saida.append(sessao)
        return saida[:limite]

    def rodar(self, limite: int = 400) -> dict:
        """A rotina diária: avalia as pendentes, quatro de cada vez. Uma conversa que falha fica para amanhã."""
        if self.engine is None or not ligada():
            return {"avaliadas": 0, "erros": 0, "motivo": "desligada"}
        if self._rodando:
            return {"avaliadas": 0, "erros": 0, "motivo": "já está rodando"}
        self._rodando = True
        try:
            sessoes = self.pendentes(limite)

            def uma(sessao):
                try:
                    return sessao, self.avaliar_sessao(sessao), None
                except Exception as erro:
                    return sessao, None, f"{type(erro).__name__}: {erro}"

            avaliadas = erros = 0
            with ThreadPoolExecutor(max_workers=4) as pool:
                for sessao, resultado, erro in pool.map(uma, sessoes):
                    if erro:
                        erros += 1
                        log_warning(f"Qualidade: {sessao.session_id} não avaliada: {erro[:200]}")
                        continue
                    self._gravar(sessao, resultado)
                    avaliadas += 1
            log_info(f"Qualidade: {avaliadas} conversas avaliadas com a régua do Supervisor ({erros} com erro).")
            return {"avaliadas": avaliadas, "erros": erros, "pendentes": len(sessoes)}
        finally:
            self._rodando = False

    def _gravar(self, sessao, resultado: dict) -> None:
        criada = getattr(sessao, "created_at", None)
        linha = {
            "agente": getattr(sessao, "agent_id", None) or getattr(sessao, "team_id", None),
            "iniciada_em": datetime.fromtimestamp(criada, tz=timezone.utc) if criada else None,
            "avaliada_em": datetime.now(timezone.utc),
            "modelo": modelo(),
            "versao_regua": REGUA["versao"],
            **resultado,
        }
        with self.engine.begin() as conexao:
            existe = conexao.execute(select(self.tabela.c.session_id).where(self.tabela.c.session_id == sessao.session_id)).first()
            if existe:  # versão nova da régua: reavalia por cima e descarta a revisão antiga
                conexao.execute(update(self.tabela).where(self.tabela.c.session_id == sessao.session_id)
                                .values(**linha, revisao=None, revisor=None, revisada_em=None))
            else:
                conexao.execute(self.tabela.insert().values(session_id=sessao.session_id, **linha))

    # ── Ler ──

    def _linhas(self, desde: datetime, agentes: set[str] | None) -> list[dict]:
        consulta = select(self.tabela).where(self.tabela.c.iniciada_em >= desde, self.tabela.c.versao_regua == REGUA["versao"])
        with self.engine.connect() as conexao:
            linhas = [dict(r) for r in conexao.execute(consulta).mappings().all()]
        return [r for r in linhas if agentes is None or (r["agente"] or "") in agentes]

    def agregado_agente(self, dias: int, agentes: set[str] | None) -> dict:
        desde = datetime.now(timezone.utc) - timedelta(days=dias)
        linhas = self._linhas(desde, agentes)
        por_criterio = {c: Counter(r["niveis"].get(c, {}).get("nivel") for r in linhas) for c in CRITERIOS}
        por_tema = defaultdict(lambda: {"atendimentos": 0, "avaliaveis": 0, "abaixo": 0})
        for r in linhas:
            tema = por_tema[r["motivo"] or "outro"]
            tema["atendimentos"] += 1
            for c in CRITERIOS:
                nivel = r["niveis"].get(c, {}).get("nivel")
                if nivel in ("abaixo", "dentro", "acima"):
                    tema["avaliaveis"] += 1
                    tema["abaixo"] += nivel == "abaixo"
        revisadas = [r for r in linhas if r["revisao"]]
        concordancia = {}
        for c in CRITERIOS:
            pares = [(r["niveis"].get(c, {}).get("nivel"), r["revisao"].get(c)) for r in revisadas if r["revisao"].get(c)]
            concordancia[c] = {"revisadas": len(pares), "concordou": sum(a == b for a, b in pares)}
        return {"atendimentos": len(linhas), "por_criterio": por_criterio, "por_tema": dict(por_tema),
                "revisadas": len(revisadas), "concordancia": concordancia}

    def agregado_humanos(self, dias: int) -> dict:
        """O lado humano da comparação. O GestorGov ainda não tem avaliações humanas com esta régua."""
        return {"disponivel": False, "motivo": "Ainda não há avaliações humanas com esta régua no GestorGov."}

    def avaliacoes(self, dias: int, agentes: set[str] | None, criterio: str | None, nivel: str | None,
                   so_sem_revisao: bool, limite: int) -> list[dict]:
        desde = datetime.now(timezone.utc) - timedelta(days=dias)
        linhas = sorted(self._linhas(desde, agentes), key=lambda r: r["avaliada_em"], reverse=True)
        if criterio and nivel:
            linhas = [r for r in linhas if r["niveis"].get(criterio, {}).get("nivel") == nivel]
        if so_sem_revisao:
            linhas = [r for r in linhas if not r["revisao"]]
        return [{
            "session_id": r["session_id"], "agente": r["agente"],
            "iniciada_em": r["iniciada_em"].isoformat() if r["iniciada_em"] else None,
            "motivo": r["motivo"], "tema": ROTULO_TEMA.get(r["motivo"] or "", r["motivo"]), "subcausa": r["subcausa"],
            "niveis": r["niveis"], "revisao": r["revisao"], "revisor": r["revisor"],
        } for r in linhas[:limite]]

    def revisar(self, session_id: str, revisao: dict[str, str], revisor: str) -> bool:
        valida = {c: n for c, n in revisao.items() if c in CRITERIOS and n in NIVEIS}
        with self.engine.begin() as conexao:
            feito = conexao.execute(update(self.tabela).where(self.tabela.c.session_id == session_id).values(
                revisao=valida or None, revisor=revisor if valida else None,
                revisada_em=datetime.now(timezone.utc) if valida else None))
        return bool(feito.rowcount)


def distribuicao(contagem: Counter) -> dict:
    """Percentuais entre os avaliáveis (sem o não avaliável), como o Supervisor mostra."""
    base = sum(contagem.get(n, 0) for n in ("abaixo", "dentro", "acima"))
    pct = (lambda n: round(contagem.get(n, 0) / base, 4) if base else None)
    return {"avaliaveis": base, "nao_avaliavel": contagem.get("nao_avaliavel", 0),
            "abaixo": pct("abaixo"), "dentro": pct("dentro"), "acima": pct("acima")}
