"""CompanyOS do Agno no GestorGov: cada área de cada organização ativa vira um Product, e cada atividade de
rotina da área (atividades_area, tipo "rotina") vira uma Routine executada pelo agente da área.

- Product: a área (ex.: "Regulação · Secretaria Municipal de Saúde de Exemplópolis"), com o propósito dela.
- Routine: a atividade (ex.: "Fila de espera", a cada hora). Ela olha o trabalho e PROPÕE Projects e Tasks.
- Ninguém aprova o próprio trabalho: as propostas esperam uma pessoa aceitar (auto_accept desligado), e as
  entregas voltam para revisão. Quem aprova é o responsável da área (pessoas.aprova_tarefas).

Ligado com GESTORGOV_COMPANYOS=sim. Os Products são montados ao subir o servidor a partir do banco: uma
organização que conclui a implantação entra no próximo deploy ou reinício. Se o Agno instalado não tiver o
CompanyOS, ou o banco não responder, o servidor sobe sem ele (com aviso no log).
"""

import os
import re
import unicodedata

from agno.utils.log import log_warning

from agente import gestao, perfis, segmentos

FUSO = "America/Sao_Paulo"


def ligado() -> bool:
    return os.getenv("GESTORGOV_COMPANYOS", "nao").strip().lower() in ("sim", "1", "true")


def _slug(texto: str) -> str:
    sem = "".join(c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", sem.lower()).strip("-")[:40]


def _instrucoes(atividade: dict, area: dict, org: dict) -> str:
    r = segmentos.de(org).rotulos
    sensiveis = ("Nunca use nome, CPF ou Cartão SUS de pacientes: só números agregados e códigos."
                 if segmentos.de(org).id == "saude_publica" else
                 "Nunca exponha dados pessoais de clientes ou de funcionários: só números agregados e códigos.")
    return f"""Rotina "{atividade['nome']}" do {r['area']} de {area['nome']} ({org['nome']}).

O que fazer: {atividade['descricao']}
O que entregar para aprovação: {atividade.get('entregavel') or 'um resumo do que precisa de atenção'}.

Passos:
1. Confira as fontes do {r['area']}: os documentos e planilhas do Conhecimento e o cadastro da organização (consultar_organizacao, listar_unidades).
2. Veja os Projects e Tasks já abertos deste Product para não repetir trabalho.
3. Se houver algo que precise de atenção, proponha uma Task com a evidência (de onde veio cada número). Se não houver, não proponha nada.
{sensiveis} A Task só vale depois de o responsável do {r['area']} aprovar."""


def produtos() -> list:
    """Os Products (áreas com rotinas) das organizações ativas. Lista vazia se não der para montar."""
    from agno.company import Product, Routine

    lista = []
    for org in gestao.organizacoes():
        if org.get("situacao") != "ativo":
            continue
        oid = str(org["id"])
        ligados = {str(a["area_id"]): a["agente_id"] for a in gestao.agentes_area(oid) if a.get("ativo", True)}
        por_area: dict[str, list] = {}
        for a in gestao.atividades(oid):
            if a["tipo"] == "rotina" and a.get("ativa", True) and a.get("cron"):
                por_area.setdefault(str(a["area_id"]), []).append(a)
        for area in gestao.areas(oid):
            aid = str(area["id"])
            executor = ligados.get(aid)
            if not executor or not perfis.existe(executor) or not por_area.get(aid):
                continue  # área sem agente ou sem rotina: nada a agendar
            rotinas = [
                Routine(
                    name=_slug(a["nome"]) or f"rotina-{i}",
                    executor_type="agent",
                    executor_id=executor,
                    cron_expr=a["cron"],
                    timezone=FUSO,
                    instructions=_instrucoes(a, area, org),
                    auto_accept=False,
                )
                for i, a in enumerate(por_area[aid])
            ]
            lista.append(Product(
                id=f"{oid[:8]}-{_slug(area['nome'])}"[:60],
                name=f"{area['nome']} · {org.get('sigla') or org['nome']}",
                purpose=(area.get("descricao") or f"Atividades de {area['nome']}") + f" ({org['nome']}).",
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
        # Fila durável só no Postgres (o Agno exige Postgres ou Redis para isso); no SQLite local, em memória:
        # um reinício perde o que estava na fila, mas as rotinas voltam no próximo horário.
        duravel = getattr(getattr(banco, "db_engine", None), "dialect", None) is not None and banco.db_engine.dialect.name == "postgresql"
        fila = QueueConfig(durable=True, db=banco) if duravel else QueueConfig(durable=False)
        return {"company": CompanyConfig(model=modelo, products=lista), "queue": fila}
    except Exception as erro:  # Agno sem CompanyOS, banco fora do ar ou cron inválido: sobe sem
        log_warning(f"CompanyOS desligado: {type(erro).__name__}: {erro}")
        return {}
