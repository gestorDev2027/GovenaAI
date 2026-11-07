"""Demonstração pronta: a Secretaria Municipal de Saúde de Itatiaia-RJ montada de ponta a ponta.

Liga com GESTORGOV_DEMO=itatiaia (app.py chama `semear` ao subir, antes de montar o AgentOS). Pode rodar a cada
início: cada passo só acrescenta o que falta, nada é duplicado. Monta, com as mesmas ferramentas do Assistente de
Implantação:

1. o município (IBGE 3302254) e a Secretaria de Saúde;
2. as unidades de saúde do CNES (dados abertos; se a fonte não responder, segue sem elas);
3. os setores (todos os tipos do catálogo) e as atividades sugeridas de cada um;
4. o organograma padrão (38 cargos, com hierarquia, indicadores e permissões);
5. pessoas FICTÍCIAS nos cargos de direção e nas superintendências (e-mails @itatiaia.exemplo.gov.br, sem
   login), como responsáveis dos setores: são elas que aprovam o que os agentes entregam;
6. um agente de IA por setor (o dos modelos do código para Compras, Atenção Primária e Regulação; os demais
   criados na Fábrica), publicados e ligados às mesas do prédio e às atividades;
7. a implantação concluída: o município fica ativo e, com GESTORGOV_COMPANYOS=sim, as atividades de rotina
   viram os fluxos do Agno (Routines do CompanyOS), executados pelo agente do setor.

O dono da prefeitura na demonstração é GESTORGOV_DEMO_DONO (ou PAINEL_DONO), se ainda não houver dono.
"""

import os
import re
import unicodedata
from types import SimpleNamespace

from agno.utils.log import log_info, log_warning

from agente import acessos, fabrica, gestao, perfis
from agente import ferramentas_gestao as ferramentas

QUEM = "demonstracao"
CODIGO_IBGE = "3302254"
COORDENADAS_ITATIAIA = (-22.4964, -44.5636)
DOMINIO = "itatiaia.exemplo.gov.br"

# Os agentes do código que servem de modelo (cópia por prefeitura); os demais setores ganham agente na Fábrica.
MODELO_DO_SETOR = {"compras": "compras", "atencao_primaria": "atencao_primaria", "regulacao": "regulacao"}
CORES = ("#1A63D8", "#52A2FF", "#1BAF7A", "#F4B800", "#8B5CF6", "#14C4D4", "#E83E8C", "#0D1B38")

# Pessoas fictícias: modelo do cargo → nome. Os superintendentes respondem pelo setor da sala do cargo.
PESSOAS = {
    "secretario": "Helena Duarte Ribeiro",
    "secretario_adjunto": "Marcos Vinícius Teixeira",
    "chefe_gabinete": "Renata Albuquerque Lima",
    "sup_aps": "Juliana Pacheco Moraes",
    "sup_especializada": "Ricardo Fontes Barreto",
    "sup_urgencia": "André Luiz Campos",
    "sup_vigilancia": "Patrícia Nogueira Silva",
    "sup_farmacia": "Fernanda Rocha Azevedo",
    "sup_regulacao": "Eduardo Martins Prado",
    "sup_planejamento": "Camila Torres Fagundes",
    "sup_administrativo": "Rogério Antunes Melo",
    "sup_pessoas": "Luciana Brandão Costa",
    "sup_ti": "Thiago Mendes Carvalho",
    "ouvidoria": "Sandra Regina Oliveira",
    "coord_transporte": "José Carlos Vieira",
    "coord_mental": "Beatriz Lacerda Souza",
}
# Quem responde por cada setor (aprova o que o agente entrega), pelo modelo do cargo.
RESPONSAVEL_DO_SETOR = {
    "gabinete": "secretario", "atencao_primaria": "sup_aps", "atencao_especializada": "sup_especializada",
    "urgencia": "sup_urgencia", "vigilancia": "sup_vigilancia", "farmacia": "sup_farmacia", "regulacao": "sup_regulacao",
    "financeiro": "sup_administrativo", "rh": "sup_pessoas", "ti": "sup_ti", "ouvidoria": "ouvidoria",
    "transporte": "coord_transporte", "saude_mental": "coord_mental",
}
# Setores sem cargo próprio no catálogo: um coordenador fictício, só no cadastro de servidores.
COORDENADORES = {
    "compras": ("Gustavo Henrique Lopes", "Coordenador de Compras e Licitações"),
    "faturamento": ("Aline Ferreira Cardoso", "Coordenadora de Faturamento e Informação"),
    "almoxarifado": ("Paulo Sérgio Ramos", "Coordenador de Almoxarifado e Patrimônio"),
}


def ligada() -> str | None:
    valor = os.getenv("GESTORGOV_DEMO", "").strip().lower()
    return valor or None


def _slug(texto: str) -> str:
    sem = "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", ".", sem).strip(".")


def _contexto(municipio_id: str | None) -> SimpleNamespace:
    """O que as ferramentas da implantação leem do RunContext do Agno."""
    return SimpleNamespace(session_state={"municipio_id": municipio_id}, agent_id=QUEM, session_id=None)


def semear() -> list[str]:
    """Monta (ou completa) a demonstração. Devolve os ids dos agentes criados agora, para o app montá-los."""
    if ligada() != "itatiaia":
        return []
    if not gestao.disponivel() or not fabrica.disponivel():
        log_warning("Demonstração: o cadastro ou a Fábrica não estão disponíveis; nada foi semeado.")
        return []
    try:
        return _semear_itatiaia()
    except Exception as erro:  # a demonstração nunca impede o servidor de subir
        log_warning(f"Demonstração: falhou ({type(erro).__name__}: {erro}).")
        return []


def _semear_itatiaia() -> list[str]:
    # 1. Município
    existente = next((m for m in gestao.municipios() if m.get("codigo_ibge") == CODIGO_IBGE), None)
    if existente:
        mid = str(existente["id"])
    else:
        coordenadas = gestao.geocodificar("Itatiaia, RJ, Brasil") or COORDENADAS_ITATIAIA
        mid = str(gestao.registrar_municipio(
            codigo_ibge=CODIGO_IBGE, nome="Itatiaia", uf="RJ", quem=QUEM, latitude=coordenadas[0],
            longitude=coordenadas[1], secretario_nome=PESSOAS["secretario"],
            secretario_email=f"{_slug(PESSOAS['secretario'])}@{DOMINIO}")["id"])
    ctx = _contexto(mid)

    # 2. Unidades do CNES (só as públicas e as conveniadas ao SUS; tira as particulares de importações antigas)
    if not gestao.unidades(mid):
        log_info(f"Demonstração: {ferramentas.importar_unidades_cnes(ctx)[:160]}")
    else:
        removidas = gestao.remover_particulares(mid, QUEM)
        if removidas:
            log_info(f"Demonstração: {removidas} unidades particulares saíram do cadastro.")

    # 3. Setores e atividades
    tipos = [t["id"] for t in gestao.tipos_setor()]
    ferramentas.salvar_setores(ctx, tipos)
    for setor in gestao.setores(mid):
        if setor.get("tipo_id") and not gestao.atividades(mid, str(setor["id"])):
            modelos = [m["id"] for m in gestao.modelos_atividade(setor["tipo_id"]) if m.get("padrao")]
            if modelos:
                ferramentas.salvar_atividades(ctx, setor["tipo_id"], modelos)

    # 4. Organograma
    acessos.montar_organograma_padrao(mid, QUEM)

    # 5. Pessoas fictícias nos cargos e como responsáveis dos setores
    _pessoas_nos_cargos(mid)

    # 6. Um agente de IA por setor
    criados = _agentes_por_setor(mid)

    # 7. Implantação concluída e o dono da demonstração
    gestao.concluir_onboarding(mid, quem=QUEM)
    dono = (os.getenv("GESTORGOV_DEMO_DONO") or os.getenv("PAINEL_DONO") or "").strip().lower()
    if dono and not gestao.membros(mid, so_ativos=False):
        gestao.adicionar_membro(mid, dono, "dono", QUEM)
    log_info(f"Demonstração de Itatiaia pronta: {len(gestao.setores(mid))} setores, {len(gestao.unidades(mid))} unidades, "
             f"{len(criados)} agentes criados agora.")
    return criados


def _pessoas_nos_cargos(municipio_id: str) -> None:
    tc = gestao._t("cargos")
    cargos = {c["modelo_id"]: c for c in acessos.cargos(municipio_id) if c.get("modelo_id")}
    setores = {str(s["id"]): s for s in gestao.setores(municipio_id)}
    por_tipo = {s.get("tipo_id"): str(s["id"]) for s in setores.values() if s.get("tipo_id")}
    responde_por = {modelo: tipo for tipo, modelo in RESPONSAVEL_DO_SETOR.items()}
    for modelo, nome in PESSOAS.items():
        cargo = cargos.get(modelo)
        if not cargo:
            continue
        setor_id = por_tipo.get(responde_por.get(modelo)) or (cargo.get("setor_id") if cargo.get("setor_id") in setores else None)
        responsavel = modelo in responde_por and bool(setor_id)
        pessoa = gestao.salvar_servidor(
            municipio_id, nome=nome, email=f"{_slug(nome)}@{DOMINIO}", quem=QUEM, cargo=cargo["nome"], setor_id=setor_id,
            papel="coordenador" if responsavel else "servidor", aprova_tarefas=True, responsavel_do_setor=responsavel)
        with gestao._estado["engine"].begin() as c:
            c.execute(gestao.update(tc).where(tc.c.id == cargo["id"]).values(responsavel_id=pessoa["id"]))
    for tipo, (nome, cargo_nome) in COORDENADORES.items():
        if tipo in por_tipo:
            gestao.salvar_servidor(municipio_id, nome=nome, email=f"{_slug(nome)}@{DOMINIO}", quem=QUEM, cargo=cargo_nome,
                                   setor_id=por_tipo[tipo], papel="coordenador", aprova_tarefas=True,
                                   responsavel_do_setor=True)


def _agentes_por_setor(municipio_id: str) -> list[str]:
    criados: list[str] = []
    ligados = {str(a["setor_id"]) for a in gestao.agentes_setor(municipio_id)}
    for i, setor in enumerate(gestao.setores(municipio_id)):
        tipo = setor.get("tipo_id")
        if not tipo or str(setor["id"]) in ligados:
            continue
        agente_id = f"itatiaia-{tipo.replace('_', '-')}"[:30]
        if not perfis.existe(agente_id):
            dados = {"nome": f"Agente de {setor['nome']}"[:60], "area": setor["nome"][:60],
                     "cargo": f"Agente do setor de {setor['nome']}"[:60],
                     "descricao": (f"Faz as rotinas e prepara os documentos do setor de {setor['nome']} da Secretaria "
                                   f"de Saúde de Itatiaia-RJ.")[:200],
                     "cor": CORES[i % len(CORES)]}
            modelo = MODELO_DO_SETOR.get(tipo)
            if modelo and perfis.existe(modelo):
                fabrica.duplicar(modelo, agente_id, {"nome": dados["nome"], "descricao": dados["descricao"], "cor": dados["cor"]}, QUEM)
            else:
                fabrica.criar(agente_id, {**dados, "minutos_inatividade": 480,
                                          "ferramentas": ["consultar_secretaria", "listar_unidades"]}, QUEM)
            fabrica.publicar(agente_id, True, QUEM)
            fabrica.definir_municipio(agente_id, municipio_id)
            criados.append(agente_id)
        gestao.ligar_agente_ao_setor(municipio_id, str(setor["id"]), agente_id, f"Agente do setor {setor['nome']}", quem=QUEM)
    # Os cargos de cada sala (superintendência, coordenações) passam a ter o agente do setor.
    tc = gestao._t("cargos")
    with gestao._estado["engine"].begin() as c:
        for ligado in gestao.agentes_setor(municipio_id):
            c.execute(gestao.update(tc).where(tc.c.municipio_id == municipio_id, tc.c.setor_id == ligado["setor_id"],
                                              tc.c.agente_id.is_(None)).values(agente_id=ligado["agente_id"]))
    return criados
