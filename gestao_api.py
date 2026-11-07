"""Rotas do cadastro da prefeitura (agente/gestao.py), para as telas do GestorGov.

- GET /painel/api/gestao/municipios          os municípios (situação e etapa do onboarding)
- GET /painel/api/gestao/panorama?municipio=  tudo para desenhar a cidade e o prédio: município, secretaria,
                                              setores (com atividades, responsável e agentes) e unidades.
                                              A tela de onboarding pede de novo a cada resposta do assistente.
- GET /painel/api/gestao/catalogo            tipos de setor, tipos de unidade (cor e ícone dos pinos) e o
                                              catálogo de atividades
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from agente import gestao
from painel_api import exigir_chave


def criar_rotas_gestao() -> APIRouter:
    rotas = APIRouter(prefix="/painel/api/gestao", tags=["GestorGov"], dependencies=[Depends(exigir_chave)])

    def disponivel() -> None:
        if not gestao.disponivel():
            raise HTTPException(status_code=503, detail="O cadastro da prefeitura não está disponível neste servidor.")

    @rotas.get("/municipios")
    def municipios() -> dict:
        disponivel()
        saida = []
        for m in gestao.municipios():
            aberto = gestao.onboarding_aberto(str(m["id"]))
            saida.append({**gestao._json(m), "etapa": (aberto or {}).get("etapa")})
        return {"municipios": saida}

    @rotas.get("/panorama")
    def panorama(municipio: str | None = Query(default=None, max_length=40)) -> dict:
        disponivel()
        mid = municipio or gestao.municipio_padrao()
        if not mid:
            return {"municipio": None}
        dados = gestao.panorama(mid)
        if not dados:
            raise HTTPException(status_code=404, detail="Município não encontrado.")
        return dados

    @rotas.get("/catalogo")
    def catalogo() -> dict:
        disponivel()
        return gestao._json({"tipos_setor": gestao.tipos_setor(), "tipos_unidade": gestao.tipos_unidade(),
                             "atividades": gestao.modelos_atividade()})

    return rotas
