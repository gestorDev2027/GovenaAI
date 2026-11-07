"""CompanyOS do Agno no GestorGov: cada setor de cada município ativo vira um Product, e cada atividade de
rotina do setor (atividades_setor, tipo "rotina") vira uma Routine executada pelo agente do setor.

- Product: o setor (ex.: "Regulação · Exemplópolis-SP"), com o propósito do setor.
- Routine: a atividade (ex.: "Fila de espera", a cada hora). Ela olha o trabalho e PROPÕE Projects e Tasks.
- Ninguém aprova o próprio trabalho: as propostas esperam um servidor aceitar (auto_accept desligado), e as
  entregas voltam para revisão. Quem aprova é o responsável do setor (servidores.aprova_tarefas).

Ligado com GESTORGOV_COMPANYOS=sim. Os Products são montados ao subir o servidor a partir do banco: um
município que conclui o onboarding entra no próximo deploy ou reinício. Se o Agno instalado não tiver o
CompanyOS, ou o banco não responder, o servidor sobe sem ele (com aviso no log).
"""

import os
import re
import unicodedata

from agno.utils.log import log_warning

from agente import gestao, perfis

FUSO = "America/Sao_Paulo"


def ligado() -> bool:
    return os.getenv("GESTORGOV_COMPANYOS", "nao").strip().lower() in ("sim", "1", "true")


def _slug(texto: str) -> str:
    sem = "".join(c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", sem.lower()).strip("-")[:40]


def _instrucoes(atividade: dict, setor: dict, municipio: dict) -> str:
    return f"""Rotina "{atividade['nome']}" do setor de {setor['nome']} da Secretaria Municipal de Saúde de {municipio['nome']}-{municipio['uf']}.

O que fazer: {atividade['descricao']}
O que entregar para aprovação: {atividade.get('entregavel') or 'um resumo do que precisa de atenção'}.

Passos:
1. Confira as fontes do setor: os documentos e planilhas do Conhecimento e o cadastro da secretaria (consultar_secretaria, listar_unidades).
2. Veja os Projects e Tasks já abertos deste Product para não repetir trabalho.
3. Se houver algo que precise de atenção, proponha uma Task com a evidência (de onde veio cada número). Se não houver, não proponha nada.
Nunca use nome, CPF ou Cartão SUS de pacientes: só números agregados e códigos. A Task só vale depois de o responsável do setor aprovar."""


def produtos() -> list:
    """Os Products (setores com rotinas) dos municípios ativos. Lista vazia se não der para montar."""
    from agno.company import Product, Routine

    lista = []
    for mun in gestao.municipios():
        if mun.get("situacao") != "ativo":
            continue
        mid = str(mun["id"])
        ligados = {str(a["setor_id"]): a["agente_id"] for a in gestao.agentes_setor(mid) if a.get("ativo", True)}
        por_setor: dict[str, list] = {}
        for a in gestao.atividades(mid):
            if a["tipo"] == "rotina" and a.get("ativa", True) and a.get("cron"):
                por_setor.setdefault(str(a["setor_id"]), []).append(a)
        for setor in gestao.setores(mid):
            sid = str(setor["id"])
            executor = ligados.get(sid)
            if not executor or not perfis.existe(executor) or not por_setor.get(sid):
                continue  # setor sem agente ou sem rotina: nada a agendar
            rotinas = [
                Routine(
                    name=_slug(a["nome"]) or f"rotina-{i}",
                    executor_type="agent",
                    executor_id=executor,
                    cron_expr=a["cron"],
                    timezone=FUSO,
                    instructions=_instrucoes(a, setor, mun),
                    auto_accept=False,
                )
                for i, a in enumerate(por_setor[sid])
            ]
            lista.append(Product(
                id=f"{_slug(mun['nome'])}-{mun['uf'].lower()}-{_slug(setor['nome'])}"[:60],
                name=f"{setor['nome']} · {mun['nome']}-{mun['uf']}",
                purpose=(setor.get("descricao") or f"Atividades do setor de {setor['nome']}")
                + f" na Secretaria Municipal de Saúde de {mun['nome']}-{mun['uf']}.",
                sources=[],
                routines=rotinas,
            ))
    return lista


def configurar(modelo, banco) -> dict:
    """Os argumentos do AgentOS para ligar o CompanyOS ({} quando desligado ou indisponível)."""
    if not ligado():
        return {}
    try:
        from agno.job_queue import QueueConfig
        from agno.os import CompanyConfig

        lista = produtos()
        return {"company": CompanyConfig(model=modelo, products=lista), "queue": QueueConfig(durable=True, db=banco)}
    except Exception as erro:  # Agno sem CompanyOS, banco fora do ar ou cron inválido: sobe sem
        log_warning(f"CompanyOS desligado: {type(erro).__name__}: {erro}")
        return {}
