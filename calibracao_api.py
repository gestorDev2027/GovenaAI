"""Calibração humana dos agentes pelo painel (/painel/api/calibracao).

A equipe avalia respostas do agente (no chat de teste ou em conversas reais): 👍 ou 👎, o que
errou, um comentário e como a resposta deveria ser. Toda avaliação entra numa fila; só depois de
aprovada por um curador ela passa a valer:
- vira caso do gold e do bad dataset do agente (agente/datasets.py; testes/avaliacoes.py, grupo
  "humanas"): a resposta ideal aprovada é o gabarito, a resposta original de um 👎 é o erro que não
  pode voltar, e qualquer mudança nas instruções ou na base é medida contra os dois;
- vira exemplo com embedding (agente/conhecimento.py), com os dados pessoais mascarados: o agente
  o recebe nas instruções quando um contato manda uma mensagem parecida.

Nada entra no comportamento do agente sem a aprovação: uma avaliação errada, uma resposta mal
escrita ou um dado de contato não se espalham para outras conversas.

Lacunas (/lacunas): as respostas das conversas reais em que o agente transferiu, disse que não tinha a
informação ou não achou a aula (agente/lacunas.py), agrupadas por assunto. A resposta que o time escreve
numa lacuna entra nesta mesma fila, como avaliação pendente: o caminho até o agente é o de sempre.

Quem pode o quê vem dos usuários do painel (agente/usuarios.py): "avaliar" para dar 👍/👎 e "aprovar na
Calibração" para aprovar, recusar, usar o assistente de curadoria e editar as frases do guardrail. A chave
de acesso (rotinas, AgentOS) pode tudo.
"""

import os
import time
from collections import Counter
from datetime import datetime, timezone

from agno.agent import Agent
from agno.db.base import SessionType
from agno.utils.log import log_warning
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import JSON, Column, DateTime, Integer, MetaData, String, Table, Text, func, insert, select, update

from agente import conhecimento, curadoria, datasets, equipes, lacunas, perfis, usuarios
from agente.agente import schema_banco
from painel_api import _canal, _iso, _ler_sessao, _sessoes, _texto_entrada, exigir_chave

SITUACOES = ("pendente", "aprovada", "recusada")
# O que pode estar errado numa resposta (o painel mostra como opções; "outro" leva ao comentário).
PROBLEMAS = {
    "informacao_errada": "Informação errada ou inventada",
    "nao_seguiu_script": "Não seguiu o script de atendimento",
    "deveria_transferir": "Deveria ter transferido",
    "nao_deveria_transferir": "Transferiu sem precisar",
    "tom": "Tom inadequado",
    "longa_ou_repetitiva": "Longa ou repetitiva",
    "nao_entendeu": "Não entendeu o contato",
    "faltou_informacao": "Faltou informação para responder",
    "outro": "Outro",
}
SITUACOES_LACUNA = ("aberta", "ignorada", "respondida", "avaliada")  # avaliada: a resposta já tem avaliação
MAX_ORGANIZAR = 60  # lacunas por chamada ao modelo


class PedidoAvaliacao(BaseModel):
    session_id: str = Field(min_length=1, max_length=120)
    run_id: str = Field(min_length=1, max_length=120)
    nota: int = Field(ge=-1, le=1)  # 1 = 👍, -1 = 👎
    problemas: list[str] = Field(default_factory=list, max_length=len(PROBLEMAS))
    comentario: str = Field(default="", max_length=2000)
    resposta_ideal: str = Field(default="", max_length=4000)
    origem: str = Field(default="chat_teste", max_length=40)


class MensagemAssistente(BaseModel):
    papel: str = Field(pattern="^(curador|assistente)$")
    texto: str = Field(min_length=1, max_length=4000)


class PedidoAssistente(BaseModel):
    mensagens: list[MensagemAssistente] = Field(min_length=1, max_length=30)
    resposta_ideal_atual: str = Field(default="", max_length=4000)


class PedidoFrase(BaseModel):
    frase: str = Field(min_length=6, max_length=200)
    agente: str | None = Field(default=None, max_length=60)  # vazio = vale para todos os agentes


class PedidoAtivarFrase(BaseModel):
    ativo: bool


class PedidoLacuna(BaseModel):
    session_id: str = Field(min_length=1, max_length=120)
    resposta_ideal: str = Field(min_length=10, max_length=4000)
    comentario: str = Field(default="", max_length=2000)
    problemas: list[str] = Field(default_factory=list, max_length=len(PROBLEMAS))


class PedidoSituacaoLacuna(BaseModel):
    situacao: str = Field(pattern="^(aberta|ignorada)$")


class PedidoRevisao(BaseModel):
    decisao: str = Field(pattern="^(aprovar|recusar)$")
    resposta_ideal: str | None = Field(default=None, max_length=4000)
    observacao: str = Field(default="", max_length=1000)


def _quem(painel_sessao: str | None) -> str:
    sessao = _ler_sessao(painel_sessao)
    return sessao["email"] if sessao else usuarios.SISTEMA


def _pode(quem: str, permissao: str) -> bool:
    """Permissão da pessoa (agente/usuarios.py); a chave de acesso pode tudo."""
    return usuarios.pode(quem, permissao) if usuarios.disponivel() else True


def _pode_aprovar(quem: str) -> bool:
    return _pode(quem, "aprovar_calibracao")


def _negado(permissao: str) -> HTTPException:
    return HTTPException(status_code=403, detail=f"Você não tem a permissão \"{usuarios.PERMISSOES[permissao][0]}\". Peça ao dono do painel.")


def criar_rotas_calibracao(agentes: dict[str, Agent]) -> APIRouter:
    tabela = Table(
        "avaliacoes_humanas",
        MetaData(schema=schema_banco()),
        Column("id", Integer, primary_key=True, autoincrement=True),
        Column("criada_em", DateTime(timezone=True), nullable=False),
        Column("agente", String(60), nullable=False),
        Column("origem", String(40), nullable=False),  # chat_teste ou conversa (real)
        Column("session_id", String(120), nullable=False, index=True),
        Column("run_id", String(120), nullable=False, index=True),
        Column("historico", JSON, nullable=False),  # a conversa até a resposta avaliada (inclusive)
        Column("mensagem_contato", Text, nullable=False),
        Column("resposta_agente", Text, nullable=False),
        Column("telefone", String(30), nullable=True),
        Column("nota", Integer, nullable=False),
        Column("problemas", JSON, nullable=False),
        Column("comentario", Text, nullable=True),
        Column("resposta_ideal", Text, nullable=True),
        Column("avaliador", String(200), nullable=False),
        Column("situacao", String(20), nullable=False, default="pendente"),
        Column("revisada_por", String(200), nullable=True),
        Column("revisada_em", DateTime(timezone=True), nullable=True),
        Column("observacao_revisao", Text, nullable=True),
    )
    # O que o time decidiu sobre cada lacuna (a detecção em si vem das conversas, a cada consulta).
    lacunas_tab = Table(
        "calibracao_lacunas",
        tabela.metadata,
        Column("run_id", String(120), primary_key=True),
        Column("session_id", String(120), nullable=True),
        Column("assunto", String(80), nullable=True),
        Column("situacao", String(20), nullable=True),  # ignorada ou respondida; vazia = aberta
        Column("avaliacao_id", Integer, nullable=True),
        Column("atualizada_por", String(200), nullable=True),
        Column("atualizada_em", DateTime(timezone=True), nullable=True),
    )
    qualquer = next(iter(agentes.values()))
    engine = qualquer.db.db_engine
    tabela.metadata.create_all(engine, tables=[tabela, lacunas_tab])
    frases = datasets.frases(engine, getattr(qualquer.db, "db_schema", None))  # as mesmas dos guardrails dos agentes

    def _linha(l) -> dict:
        d = dict(l)
        for campo in ("criada_em", "revisada_em"):
            d[campo] = d[campo].isoformat() if d.get(campo) else None
        d["problemas_rotulos"] = [PROBLEMAS.get(p, p) for p in d.get("problemas") or []]
        return d

    def _trecho_da_conversa(session_id: str, run_id: str) -> dict:
        # Conversa de equipe vem no formato de agente, com cada resposta atribuída a quem respondeu.
        sessao = equipes.conversa(qualquer.db, session_id) or qualquer.db.get_session(
            session_id=session_id, session_type=SessionType.AGENT)
        if sessao is None:
            raise HTTPException(status_code=404, detail="Conversa não encontrada.")
        historico, alvo = [], None
        for run in sessao.runs or []:
            historico.append({"papel": "contato", "texto": _texto_entrada(run), "quando": _iso(run.created_at)})
            historico.append({"papel": "agente", "texto": run.content or "", "quando": _iso(run.created_at)})
            if run.run_id == run_id:
                alvo = run
                break
        if alvo is None:
            raise HTTPException(status_code=404, detail="Resposta não encontrada nesta conversa.")
        estado = (sessao.session_data or {}).get("session_state") or {}
        return {
            "agente": getattr(alvo, "agent_id", None) or getattr(sessao, "agent_id", None) or next(iter(agentes)),
            "historico": historico,
            "mensagem_contato": historico[-2]["texto"],
            "resposta_agente": historico[-1]["texto"],
            "telefone": estado.get("telefone") or None,
        }

    rotas = APIRouter(prefix="/painel/api/calibracao", tags=["Calibração"], dependencies=[Depends(exigir_chave)])

    @rotas.get("/opcoes")
    def opcoes(painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _quem(painel_sessao)
        lista = [{"id": a.id, **perfis.identidade(a.id)} for a in agentes.values() if perfis.publicado(a.id)]
        # Equipes publicadas (agente/equipes.py): o chat de teste conversa com elas como com um agente.
        lista_equipes = [{"id": e["id"], "nome": e["nome"], "membros": e["membros"], "padrao": e["padrao"]}
                         for e in equipes.listar() if e["publicada"]]
        return {"problemas": PROBLEMAS, "voce": quem, "pode_aprovar": _pode_aprovar(quem), "agentes": lista,
                "equipes": lista_equipes}

    def _gravar_avaliacao(quem: str, pedido: PedidoAvaliacao) -> int:
        trecho = _trecho_da_conversa(pedido.session_id, pedido.run_id)
        valores = {
            **trecho,
            "origem": pedido.origem,
            "nota": pedido.nota,
            "problemas": [p for p in pedido.problemas if p in PROBLEMAS],
            "comentario": pedido.comentario.strip() or None,
            "resposta_ideal": pedido.resposta_ideal.strip() or None,
        }
        with engine.begin() as conexao:
            # A mesma pessoa reavaliando a mesma resposta atualiza a avaliação, enquanto ela estiver pendente.
            existente = conexao.execute(
                select(tabela.c.id, tabela.c.situacao).where(tabela.c.run_id == pedido.run_id, tabela.c.avaliador == quem)
            ).first()
            if existente and existente.situacao != "pendente":
                raise HTTPException(status_code=409, detail="Esta avaliação já foi revisada e não pode mais ser alterada.")
            if existente:
                conexao.execute(update(tabela).where(tabela.c.id == existente.id).values(**valores, criada_em=datetime.now(timezone.utc)))
                return existente.id
            return conexao.execute(insert(tabela).values(
                **valores, session_id=pedido.session_id, run_id=pedido.run_id, avaliador=quem,
                situacao="pendente", criada_em=datetime.now(timezone.utc),
            )).inserted_primary_key[0]

    @rotas.post("/avaliacoes")
    def avaliar(pedido: PedidoAvaliacao, painel_sessao: str | None = Cookie(default=None)) -> dict:
        if pedido.nota == -1 and not (pedido.problemas or pedido.comentario.strip() or pedido.resposta_ideal.strip()):
            raise HTTPException(status_code=422, detail="Diga o que errou: marque um problema, comente ou escreva como deveria ser.")
        quem = _quem(painel_sessao)
        if not _pode(quem, "avaliar"):
            raise _negado("avaliar")
        return {"id": _gravar_avaliacao(quem, pedido), "situacao": "pendente"}

    @rotas.get("/conversa/{session_id}")
    def da_conversa(session_id: str) -> dict:
        """Avaliações de uma conversa, por resposta (para marcar no chat e na tela de conversas)."""
        with engine.connect() as conexao:
            linhas = conexao.execute(select(tabela).where(tabela.c.session_id == session_id).order_by(tabela.c.id)).mappings().all()
        por_resposta: dict[str, list] = {}
        for l in linhas:
            por_resposta.setdefault(l["run_id"], []).append(_linha(l))
        return {"por_resposta": por_resposta}

    @rotas.get("/avaliacoes")
    def listar(
        situacao: str | None = Query(default=None, max_length=20),
        agente: str | None = Query(default=None, max_length=60),
        origem: str | None = Query(default=None, max_length=40),  # chat_teste, conversa ou guardrail
        limite: int = Query(default=100, ge=1, le=500),
    ) -> dict:
        consulta = select(tabela).order_by(tabela.c.id.desc()).limit(limite)
        if situacao:
            consulta = consulta.where(tabela.c.situacao == situacao)
        if agente:
            consulta = consulta.where(tabela.c.agente == agente)
        if origem:
            consulta = consulta.where(tabela.c.origem == origem)
        with engine.connect() as conexao:
            linhas = conexao.execute(consulta).mappings().all()
        return {"avaliacoes": [_linha(l) for l in linhas]}

    @rotas.post("/avaliacoes/{avaliacao_id}/revisar")
    def revisar(avaliacao_id: int, pedido: PedidoRevisao, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _quem(painel_sessao)
        if not _pode_aprovar(quem):
            raise _negado("aprovar_calibracao")
        with engine.begin() as conexao:
            atual = conexao.execute(select(tabela).where(tabela.c.id == avaliacao_id)).mappings().first()
            if atual is None:
                raise HTTPException(status_code=404, detail="Avaliação não encontrada.")
            ideal = (pedido.resposta_ideal if pedido.resposta_ideal is not None else atual["resposta_ideal"] or "").strip()
            if pedido.decisao == "aprovar" and atual["nota"] == -1 and not ideal:
                raise HTTPException(status_code=422, detail="Para aprovar um 👎, escreva como a resposta deveria ser.")
            conexao.execute(update(tabela).where(tabela.c.id == avaliacao_id).values(
                situacao="aprovada" if pedido.decisao == "aprovar" else "recusada",
                resposta_ideal=ideal or None,
                revisada_por=quem,
                revisada_em=datetime.now(timezone.utc),
                observacao_revisao=pedido.observacao.strip() or None,
            ))
        resultado = {"id": avaliacao_id, "situacao": "aprovada" if pedido.decisao == "aprovar" else "recusada"}
        if pedido.decisao == "aprovar" and conhecimento.disponivel():
            # Vira exemplo para as respostas seguintes. Falhar aqui (ex.: embedding fora do ar) não desfaz
            # a aprovação: o caso de avaliação já vale, e o exemplo pode ser gerado de novo aprovando outra vez.
            try:
                sessao = qualquer.db.get_session(session_id=atual["session_id"], session_type=SessionType.AGENT)
                estado = ((sessao.session_data or {}).get("session_state") or {}) if sessao else {}
                resultado["exemplo_id"] = conhecimento.criar_exemplo(
                    {**dict(atual), "resposta_ideal": ideal or None}, quem, [estado.get("nome_contato") or ""])
            except Exception as erro:
                log_warning(f"Calibração: aprovação {avaliacao_id} sem exemplo: {type(erro).__name__}: {erro}")
                resultado["exemplo_erro"] = str(erro)[:300]
        return resultado

    @rotas.post("/avaliacoes/{avaliacao_id}/analisar")
    def analisar(avaliacao_id: int, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Recomendação do assistente de curadoria (Gemini) para uma avaliação. Não decide nada."""
        if not _pode_aprovar(_quem(painel_sessao)):
            raise _negado("aprovar_calibracao")
        with engine.connect() as conexao:
            atual = conexao.execute(select(tabela).where(tabela.c.id == avaliacao_id)).mappings().first()
        if atual is None:
            raise HTTPException(status_code=404, detail="Avaliação não encontrada.")
        try:
            return {"id": avaliacao_id, **curadoria.analisar(dict(atual))}
        except Exception as erro:  # modelo fora do ar, cota, resposta fora do formato
            log_warning(f"Curadoria: análise da avaliação {avaliacao_id} falhou: {type(erro).__name__}: {erro}")
            raise HTTPException(status_code=502, detail=f"O assistente não conseguiu analisar: {str(erro)[:200]}")

    @rotas.post("/avaliacoes/{avaliacao_id}/assistente")
    def assistente(avaliacao_id: int, pedido: PedidoAssistente, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """O chat do painel lateral: o curador pergunta ou pede ajustes, o assistente responde e reescreve."""
        if not _pode_aprovar(_quem(painel_sessao)):
            raise _negado("aprovar_calibracao")
        if pedido.mensagens[-1].papel != "curador":
            raise HTTPException(status_code=422, detail="A última mensagem precisa ser do curador.")
        with engine.connect() as conexao:
            atual = conexao.execute(select(tabela).where(tabela.c.id == avaliacao_id)).mappings().first()
        if atual is None:
            raise HTTPException(status_code=404, detail="Avaliação não encontrada.")
        try:
            return curadoria.conversar(dict(atual), [m.model_dump() for m in pedido.mensagens], pedido.resposta_ideal_atual)
        except Exception as erro:
            log_warning(f"Curadoria: conversa da avaliação {avaliacao_id} falhou: {type(erro).__name__}: {erro}")
            raise HTTPException(status_code=502, detail=f"O assistente não conseguiu responder: {str(erro)[:200]}")

    # ───────── Lacunas ─────────

    def _guardar_lacuna(run_id: str, quem: str, **valores) -> None:
        agora = datetime.now(timezone.utc)
        with engine.begin() as conexao:
            alterou = conexao.execute(update(lacunas_tab).where(lacunas_tab.c.run_id == run_id).values(
                **valores, atualizada_por=quem, atualizada_em=agora)).rowcount
            if not alterou:
                conexao.execute(insert(lacunas_tab).values(run_id=run_id, **valores, atualizada_por=quem, atualizada_em=agora))

    def _lacunas(dias: int, agente_id: str | None) -> tuple[list[dict], int]:
        """As lacunas das conversas reais (WhatsApp) do período, mais recentes primeiro, e quantas respostas foram olhadas."""
        if agente_id and agente_id not in agentes:
            raise HTTPException(status_code=404, detail=f"Agente desconhecido: {agente_id}.")
        desde = int(time.time() - dias * 86400)
        escolhidos = [agentes[agente_id]] if agente_id else [a for a in agentes.values() if perfis.publicado(a.id)]
        sessoes = {s.session_id: s for um in escolhidos for s in _sessoes(um, desde, limite=2000)
                   if _canal(s.session_id) == "whatsapp"}
        categorias = perfis.todas_as_categorias()
        itens, olhadas = [], 0
        for sessao in sessoes.values():
            estado = (sessao.session_data or {}).get("session_state") or {}
            for run in sessao.runs or []:
                if (run.created_at or 0) < desde:
                    continue
                olhadas += 1
                sinais, transferencia = lacunas.sinais(run)
                if not sinais:
                    continue
                categoria = (transferencia or {}).get("categoria")
                itens.append({
                    "id": run.run_id,
                    "session_id": sessao.session_id,
                    "agente": getattr(run, "agent_id", None) or getattr(sessao, "agent_id", None) or perfis.PADRAO,
                    "nome": estado.get("nome_contato") or "",
                    "quando": _iso(run.created_at),
                    "mensagem": _texto_entrada(run),
                    "resposta": run.content or "",
                    "sinais": sinais,
                    "categoria": categoria,
                    "categoria_rotulo": categorias.get(categoria) if categoria else None,
                    "motivo": (transferencia or {}).get("motivo"),
                    "dificuldade": (transferencia or {}).get("dificuldade_relatada"),
                })
        if itens:
            ids = [i["id"] for i in itens]
            with engine.connect() as conexao:
                decididas = {l["run_id"]: dict(l) for l in conexao.execute(
                    select(lacunas_tab).where(lacunas_tab.c.run_id.in_(ids))).mappings().all()}
                avaliadas = set(conexao.execute(select(tabela.c.run_id).where(tabela.c.run_id.in_(ids))).scalars().all())
            for item in itens:
                dela = decididas.get(item["id"]) or {}
                item["assunto"] = dela.get("assunto")
                item["avaliacao_id"] = dela.get("avaliacao_id")
                item["situacao"] = dela.get("situacao") or ("avaliada" if item["id"] in avaliadas else "aberta")
        return sorted(itens, key=lambda i: i["quando"] or "", reverse=True), olhadas

    @rotas.get("/lacunas")
    def listar_lacunas(
        dias: int = Query(default=7, ge=1, le=90),
        agente: str | None = Query(default=None, max_length=60),
    ) -> dict:
        itens, olhadas = _lacunas(dias, agente)

        def grupo(i: dict) -> str:  # sem assunto dado pelo modelo, vale a categoria da transferência
            return i["assunto"] or i["categoria_rotulo"] or "sem assunto"

        por_assunto = Counter(grupo(i) for i in itens)
        abertas = Counter(grupo(i) for i in itens if i["situacao"] == "aberta")
        return {
            "lacunas": itens,
            "assuntos": [{"assunto": a, "total": n, "abertas": abertas.get(a, 0)} for a, n in por_assunto.most_common()],
            "totais": {
                "respostas": olhadas,
                "lacunas": len(itens),
                **{s: sum(i["situacao"] == s for i in itens) for s in SITUACOES_LACUNA},
                "sem_assunto": sum(i["situacao"] == "aberta" and not i["assunto"] for i in itens),
                "por_sinal": {s: sum(s in i["sinais"] for i in itens) for s in lacunas.SINAIS},
            },
            "sinais": lacunas.SINAIS,
        }

    @rotas.post("/lacunas/organizar")
    def organizar_lacunas(
        dias: int = Query(default=7, ge=1, le=90),
        agente: str | None = Query(default=None, max_length=60),
        painel_sessao: str | None = Cookie(default=None),
    ) -> dict:
        """Dá um assunto às lacunas abertas que ainda não têm (MAX_ORGANIZAR por vez)."""
        quem = _quem(painel_sessao)
        if not _pode_aprovar(quem):
            raise _negado("aprovar_calibracao")
        sem = [i for i in _lacunas(dias, agente)[0] if i["situacao"] == "aberta" and not i["assunto"]]
        with engine.connect() as conexao:
            usados = [a for a in conexao.execute(select(lacunas_tab.c.assunto).distinct()).scalars().all() if a]
        lote = [{"id": i["id"], "mensagem": i["mensagem"], "motivo": i["motivo"] or i["dificuldade"]} for i in sem[:MAX_ORGANIZAR]]
        try:
            assuntos = lacunas.organizar(lote, usados)
        except Exception as erro:
            log_warning(f"Lacunas: organização falhou: {type(erro).__name__}: {erro}")
            raise HTTPException(status_code=502, detail=f"O assistente não conseguiu organizar: {str(erro)[:200]}")
        sessao_de = {i["id"]: i["session_id"] for i in sem}
        for run_id, assunto in assuntos.items():
            _guardar_lacuna(run_id, quem, session_id=sessao_de[run_id], assunto=assunto)
        return {"organizadas": len(assuntos), "restantes": max(len(sem) - len(assuntos), 0)}

    @rotas.post("/lacunas/{run_id}/responder")
    def responder_lacuna(run_id: str, pedido: PedidoLacuna, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """A resposta do time vira avaliação pendente (👎 com a resposta ideal) na fila da Calibração."""
        quem = _quem(painel_sessao)
        if not _pode(quem, "avaliar"):
            raise _negado("avaliar")
        problemas = list(dict.fromkeys(["faltou_informacao", *pedido.problemas]))
        avaliacao_id = _gravar_avaliacao(quem, PedidoAvaliacao(
            session_id=pedido.session_id, run_id=run_id, nota=-1, problemas=problemas,
            comentario=pedido.comentario, resposta_ideal=pedido.resposta_ideal, origem="conversa"))
        _guardar_lacuna(run_id, quem, session_id=pedido.session_id, situacao="respondida", avaliacao_id=avaliacao_id)
        return {"id": run_id, "situacao": "respondida", "avaliacao_id": avaliacao_id}

    @rotas.post("/lacunas/{run_id}/situacao")
    def situacao_da_lacuna(run_id: str, pedido: PedidoSituacaoLacuna, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Ignorar (não faltou conhecimento: o contato pediu um atendente, transferir era o certo) ou reabrir."""
        quem = _quem(painel_sessao)
        if not _pode_aprovar(quem):
            raise _negado("aprovar_calibracao")
        _guardar_lacuna(run_id, quem, situacao=None if pedido.situacao == "aberta" else "ignorada")
        return {"id": run_id, "situacao": pedido.situacao}

    @rotas.get("/datasets")
    def dataset(
        agente: str | None = Query(default=None, max_length=60),
        tipo: str | None = Query(default=None, pattern="^(gold|bad)$"),
    ) -> dict:
        """Gold e bad dataset (avaliações aprovadas), por agente: o que testes/avaliacoes.py roda."""
        todos = datasets.casos(engine, getattr(qualquer.db, "db_schema", None), agente=agente)
        filtrados = [c for c in todos if not tipo or tipo in c["tipos"]]
        for c in filtrados:
            c["aprovado_em"] = c["aprovado_em"].isoformat() if c.get("aprovado_em") else None
        return {
            "casos": filtrados,
            "totais": {"gold": sum("gold" in c["tipos"] for c in todos), "bad": sum("bad" in c["tipos"] for c in todos)},
        }

    @rotas.get("/guardrails/frases")
    def listar_frases() -> dict:
        """Frases que barram pedidos de manipulação (comparadas sem acento e em minúsculas)."""
        return {"frases": frases.listar()}

    @rotas.post("/guardrails/frases")
    def acrescentar_frase(pedido: PedidoFrase, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _quem(painel_sessao)
        if not _pode_aprovar(quem):
            raise _negado("aprovar_calibracao")
        if pedido.agente and pedido.agente not in agentes:
            raise HTTPException(status_code=404, detail=f"Agente desconhecido: {pedido.agente}.")
        try:
            return frases.acrescentar(pedido.frase, pedido.agente, quem)
        except ValueError as erro:
            raise HTTPException(status_code=422, detail=str(erro))

    @rotas.post("/guardrails/frases/{frase_id}")
    def ativar_frase(frase_id: int, pedido: PedidoAtivarFrase, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Liga ou desliga uma frase (desligar em vez de apagar: o histórico de por que barrou fica)."""
        if not _pode_aprovar(_quem(painel_sessao)):
            raise _negado("aprovar_calibracao")
        frases.alterar(frase_id, pedido.ativo)
        return {"id": frase_id, "ativo": pedido.ativo}

    @rotas.get("/resumo")
    def resumo() -> dict:
        # Os bloqueios do guardrail entram na fila com nota 1: ficam fora das notas e dos problemas, que
        # medem só o que a equipe avaliou, e têm contagem própria.
        humanas = tabela.c.origem != datasets.ORIGEM_GUARDRAIL
        with engine.connect() as conexao:
            por_situacao = dict(conexao.execute(select(tabela.c.situacao, func.count()).group_by(tabela.c.situacao)).all())
            notas = dict(conexao.execute(select(tabela.c.nota, func.count()).where(humanas).group_by(tabela.c.nota)).all())
            problemas = conexao.execute(select(tabela.c.problemas).where(humanas, tabela.c.nota == -1)).scalars().all()
            guardrail = dict(conexao.execute(
                select(tabela.c.situacao, func.count()).where(tabela.c.origem == datasets.ORIGEM_GUARDRAIL)
                .group_by(tabela.c.situacao)).all())
        contagem: dict[str, int] = {}
        for lista in problemas:
            for p in lista or []:
                contagem[p] = contagem.get(p, 0) + 1
        total = sum(notas.values())
        return {
            "total": total,
            "positivas": notas.get(1, 0),
            "negativas": notas.get(-1, 0),
            "aprovacao": round(notas.get(1, 0) / total, 3) if total else None,
            "por_situacao": {s: por_situacao.get(s, 0) for s in SITUACOES},
            "guardrail": {s: guardrail.get(s, 0) for s in SITUACOES},
            "problemas": sorted(({"problema": k, "rotulo": PROBLEMAS.get(k, k), "total": v} for k, v in contagem.items()),
                                key=lambda x: -x["total"]),
        }

    return rotas


def casos_aprovados(engine, schema: str | None, agente: str | None = None) -> list[dict]:
    """Avaliações aprovadas, cruas. Para os casos gold e bad já montados, use agente.datasets.casos."""
    tabela = Table("avaliacoes_humanas", MetaData(schema=schema), autoload_with=engine)
    consulta = select(tabela).where(tabela.c.situacao == "aprovada").order_by(tabela.c.id)
    if agente:
        consulta = consulta.where(tabela.c.agente == agente)
    with engine.connect() as conexao:
        return [dict(l) for l in conexao.execute(consulta).mappings().all()]
