"""Rotas da qualidade com a régua do Supervisor (agente/qualidade.py).

- GET  /painel/api/qualidade/comparacao   agente × humanos por critério e por tema, para a Visão geral
- GET  /painel/api/qualidade/avaliacoes    as avaliações do agente, com a evidência (a revisão humana)
- PUT  /painel/api/qualidade/avaliacoes/{session_id}/revisao   o nível que o revisor daria em cada critério
- POST /painel/api/manutencao/qualidade    a rotina diária (só o servidor chama; roda em segundo plano)
"""

import threading

from agno.agent import Agent
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from agente import equipes, perfis, qualidade, usuarios
from agente.agente import schema_banco
from painel_api import exigir, exigir_chave, quem_chama


class PedidoRevisao(BaseModel):
    revisao: dict[str, str] = Field(default_factory=dict)


def criar_rotas_qualidade(agentes: dict[str, Agent]) -> APIRouter:
    rotas = APIRouter(prefix="/painel/api", tags=["Qualidade"])
    padrao = next(iter(agentes.values()))
    q = qualidade.Qualidade(padrao.db, schema_banco())

    def disponivel() -> qualidade.Qualidade:
        if q.engine is None:
            raise HTTPException(status_code=503, detail="A tabela de qualidade não está disponível neste banco.")
        return q

    def ids_da_area(area: str | None, agente_id: str | None) -> set[str] | None:
        """Os agentes do filtro da Visão geral, com as equipes cujo padrão está entre eles."""
        if agente_id:
            ids = {agente_id}
        elif area:
            ids = {a for a in agentes if perfis.publicado(a) and perfis.identidade(a)["area"].lower() == area.lower()}
        else:
            return None
        return ids | {eid for eid, equipe in equipes.EQUIPES.items() if equipes.padrao(equipe) in ids}

    @rotas.get("/qualidade/comparacao", dependencies=[Depends(exigir_chave)])
    def comparacao(
        dias: int = Query(default=30, ge=1, le=365),
        area: str | None = Query(default=None, max_length=80),
        agente_id: str | None = Query(default=None, max_length=60, alias="agente"),
    ) -> dict:
        base = disponivel()
        ag = base.agregado_agente(dias, ids_da_area(area, agente_id))
        hu = base.agregado_humanos(dias)
        criterios = []
        for c in qualidade.CRITERIOS:
            conc = ag["concordancia"][c]
            criterios.append({
                "criterio": c,
                "rotulo": qualidade.ROTULOS[c],
                "pergunta": next(d["pergunta"] for d in qualidade.REGUA["dimensoes"] if d["dimensao"] == c),
                "agente": qualidade.distribuicao(ag["por_criterio"][c]),
                "humanos": qualidade.distribuicao(hu["por_criterio"][c]) if hu["disponivel"] else None,
                "concordancia": {**conc, "pct": round(conc["concordou"] / conc["revisadas"], 4) if conc["revisadas"] else None},
            })
        temas = []
        for motivo in sorted(set(ag["por_tema"]) | set(hu.get("por_tema", {})),
                             key=lambda m: -(ag["por_tema"].get(m, {}).get("atendimentos", 0))):
            a, h = ag["por_tema"].get(motivo), (hu.get("por_tema") or {}).get(motivo)
            ok = (lambda t: round(1 - t["abaixo"] / t["avaliaveis"], 4) if t and t["avaliaveis"] else None)
            temas.append({"motivo": motivo, "rotulo": qualidade.ROTULO_TEMA.get(motivo, motivo),
                          "agente_atendimentos": (a or {}).get("atendimentos", 0), "agente_ok": ok(a),
                          "humanos_atendimentos": (h or {}).get("atendimentos", 0), "humanos_ok": ok(h)})
        return {
            "regua": {"versao": qualidade.REGUA["versao"], "copiada_em": qualidade.REGUA["copiada_em"], "modelo": qualidade.modelo()},
            "agente": {"atendimentos": ag["atendimentos"], "revisadas": ag["revisadas"]},
            "humanos": {"disponivel": hu["disponivel"], "atendimentos": hu.get("atendimentos", 0), "motivo": hu.get("motivo")},
            "criterios": criterios,
            "temas": temas,
        }

    @rotas.get("/qualidade/avaliacoes", dependencies=[Depends(exigir_chave)])
    def avaliacoes(
        dias: int = Query(default=30, ge=1, le=365),
        area: str | None = Query(default=None, max_length=80),
        criterio: str | None = Query(default=None, max_length=60),
        nivel: str | None = Query(default=None, max_length=20),
        sem_revisao: bool = Query(default=False),
        limite: int = Query(default=60, ge=1, le=300),
    ) -> dict:
        lista = disponivel().avaliacoes(dias, ids_da_area(area, None), criterio, nivel, sem_revisao, limite)
        return {"avaliacoes": lista, "criterios": [{"criterio": c, "rotulo": qualidade.ROTULOS[c]} for c in qualidade.CRITERIOS]}

    @rotas.put("/qualidade/avaliacoes/{session_id}/revisao")
    def revisar(session_id: str, pedido: PedidoRevisao, quem: str = Depends(exigir("aprovar_calibracao"))) -> dict:
        if not disponivel().revisar(session_id, pedido.revisao, quem):
            raise HTTPException(status_code=404, detail="Avaliação não encontrada.")
        return {"ok": True}

    @rotas.post("/manutencao/qualidade", dependencies=[Depends(exigir_chave)])
    def rotina(painel_sessao: str | None = Cookie(default=None), limite: int = Query(default=400, ge=1, le=2000)) -> dict:
        """A avaliação leva minutos: roda numa thread e responde na hora (o agendador tem prazo curto)."""
        if quem_chama(painel_sessao) != usuarios.SISTEMA:
            raise HTTPException(status_code=403, detail="Rotina interna: só o próprio servidor a chama.")
        threading.Thread(target=disponivel().rodar, kwargs={"limite": limite}, name="qualidade-supervisor", daemon=True).start()
        return {"iniciada": True}

    return rotas
