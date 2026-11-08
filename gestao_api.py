"""Rotas do cadastro das organizações (agente/gestao.py), para as telas do GestorGov.

- GET /painel/api/gestao/organizacoes           as organizações (segmento, situação e etapa da implantação)
- GET /painel/api/gestao/panorama?organizacao=  tudo para desenhar o mapa e o prédio: a organização (com o
                                                segmento e os nomes de tela), as áreas (com atividades, responsável
                                                e agentes), as unidades e a fase da implantação. A tela da
                                                implantação pede de novo a cada resposta do assistente.
- GET /painel/api/gestao/catalogo?segmento=     os segmentos (nomes de tela e campos), os tipos de área, os tipos
                                                de unidade (cor e ícone dos pinos) e o catálogo de atividades
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from agente import gestao, segmentos
from painel_api import exigir_chave


def criar_rotas_gestao() -> APIRouter:
    rotas = APIRouter(prefix="/painel/api/gestao", tags=["GestorGov"], dependencies=[Depends(exigir_chave)])

    def disponivel() -> None:
        if not gestao.disponivel():
            raise HTTPException(status_code=503, detail="O cadastro das organizações não está disponível neste servidor.")

    @rotas.get("/organizacoes")
    def organizacoes() -> dict:
        disponivel()
        saida = []
        for o in gestao.organizacoes():
            aberto = gestao.onboarding_aberto(str(o["id"]))
            saida.append({**gestao._json(o), "etapa": (aberto or {}).get("etapa")})
        return {"organizacoes": saida}

    @rotas.get("/panorama")
    def panorama(organizacao: str | None = Query(default=None, max_length=40)) -> dict:
        disponivel()
        oid = organizacao or gestao.organizacao_padrao()
        if not oid:
            return {"organizacao": None}
        dados = gestao.panorama(oid)
        if not dados.get("organizacao"):
            raise HTTPException(status_code=404, detail="Organização não encontrada.")
        return dados

    @rotas.get("/catalogo")
    def catalogo(segmento: str | None = Query(default=None, max_length=40)) -> dict:
        disponivel()
        tipos = gestao.tipos_area(segmento)
        ids = {t["id"] for t in tipos}
        return gestao._json({
            "segmentos": [s.para_tela() for s in segmentos.SEGMENTOS.values()],
            "tipos_area": tipos,
            "tipos_unidade": gestao.tipos_unidade(segmento),
            "atividades": [a for a in gestao.modelos_atividade() if not segmento or a["tipo_area_id"] in ids],
        })

    return rotas
