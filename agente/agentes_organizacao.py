"""Os agentes de IA de cada organização, criados na implantação: um por área e o agente das unidades.

Cada um é um agente da Fábrica (agente/fabrica.py), publicado e marcado com a organização dona
(`fabrica_agentes.organizacao_id`): só quem é daquela organização o vê e conversa com ele. Na saúde, os setores com
modelo no código (Compras, Atenção Primária, Regulação) e as unidades de saúde (agente/perfis/unidade.py) ganham
uma cópia dele; os demais setores, um agente novo com o modelo de instruções da Fábrica
nos nomes do segmento (setor, servidores).

O agente criado com o servidor no ar entra no AgentOS na hora, por `registro.ativar` (app.py liga o montador).
Pode rodar de novo: o que já existe não é recriado.
"""

import re
import unicodedata

from agno.utils.log import log_warning

from agente import fabrica, gestao, perfis, registro, segmentos

# Os agentes do código que servem de modelo (cópia por organização), por tipo de área. Só da saúde, por enquanto.
MODELO_DA_AREA = {"compras": "compras", "atencao_primaria": "atencao_primaria", "regulacao": "regulacao"}
MODELO_DAS_UNIDADES = {"saude_publica": "unidade"}
CORES = ("#1A63D8", "#52A2FF", "#1BAF7A", "#F4B800", "#8B5CF6", "#14C4D4", "#E83E8C", "#0D1B38")
FERRAMENTAS_DE_CONSULTA = ["consultar_organizacao", "listar_unidades"]


def _slug(texto: str) -> str:
    sem = "".join(c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "-", sem).strip("-")


def prefixo(org: dict) -> str:
    """O começo do id dos agentes da organização. Saúde: a cidade e a UF (ex.: itatiaia-rj); num segmento
    sem município único, a sigla (ou o nome)."""
    if segmentos.de(org).um_por_municipio:
        base = f"{_slug(org.get('cidade') or org['nome'])[:16].strip('-')}-{(org.get('uf') or '').lower()}"
    else:
        base = _slug(org.get("sigla") or org["nome"])[:18]
    return base.strip("-")


def _onde(org: dict) -> str:
    """Como a organização aparece nas descrições: "Secretaria Municipal de Saúde (Itatiaia-RJ)"."""
    if segmentos.de(org).um_por_municipio and org.get("cidade"):
        return f"{org['nome']} ({org['cidade']}-{org.get('uf') or ''})".replace("-)", ")")
    return org.get("sigla") or org["nome"]


def _id_livre(base: str) -> str:
    """Um id que cabe na Fábrica (3 a 30 caracteres) e ainda não existe."""
    base = base[:30].strip("-")
    if not perfis.existe(base) and base not in perfis.PERFIS:
        return base
    for n in range(2, 100):
        candidato = f"{base[:27].strip('-')}-{n}"
        if candidato not in perfis.PERFIS:
            return candidato
    raise RuntimeError("Sem id livre para o agente.")


def _publicar(agente_id: str, organizacao_id: str, quem: str) -> None:
    fabrica.publicar(agente_id, True, quem)
    fabrica.definir_organizacao(agente_id, organizacao_id)
    registro.ativar(agente_id)


def criar_agentes_das_areas(organizacao_id: str, quem: str, prefixo_id: str | None = None) -> dict:
    """Um agente para cada área que ainda não tem, ligado à mesa da área (agentes_area). Devolve os criados agora,
    as áreas ligadas e as que não deu para criar (com o motivo)."""
    org = gestao.organizacao(organizacao_id)
    seg = segmentos.de(org)
    tipo_area = seg.rotulos["area"]
    inicio = prefixo_id or prefixo(org)
    ligados = {str(a["area_id"]) for a in gestao.agentes_area(organizacao_id)}
    criados, novos_ligados, falhas = [], [], []
    # A área cadastrada pelo nome ("outras" em salvar_areas) que bate com um tipo do catálogo usa o modelo dele.
    tipo_pelo_nome = {_slug(t["nome"]): t["id"] for t in gestao.tipos_area(seg.id)}
    for i, area in enumerate(gestao.areas(organizacao_id)):
        if str(area["id"]) in ligados:
            continue
        tipo = area.get("tipo_id") or tipo_pelo_nome.get(_slug(area["nome"])) or _slug(area["nome"])
        agente_id = f"{inicio}-{tipo.replace('_', '-')}"[:30].strip("-")
        try:
            if not perfis.existe(agente_id):
                agente_id = _id_livre(agente_id)
                dados = {"nome": f"Agente de {area['nome']}"[:60], "area": area["nome"][:60],
                         "cargo": f"Agente do {tipo_area} de {area['nome']}"[:60],
                         "descricao": (f"Faz as rotinas e prepara os documentos do {tipo_area} de {area['nome']} "
                                       f"da {_onde(org)}.")[:200],
                         "cor": CORES[i % len(CORES)]}
                modelo = MODELO_DA_AREA.get(tipo) if seg.id == "saude_publica" else None
                if modelo and perfis.existe(modelo):
                    fabrica.duplicar(modelo, agente_id, {"nome": dados["nome"], "descricao": dados["descricao"], "cor": dados["cor"]}, quem)
                else:
                    fabrica.criar(agente_id, {**dados, "minutos_inatividade": 480, "ferramentas": FERRAMENTAS_DE_CONSULTA},
                                  quem, segmento_id=seg.id, organizacao=_onde(org))
                _publicar(agente_id, organizacao_id, quem)
                criados.append(agente_id)
            gestao.ligar_agente_a_area(organizacao_id, str(area["id"]), agente_id, f"Agente do {tipo_area} {area['nome']}", quem=quem)
            novos_ligados.append({"area": area["nome"], "agente": perfis.identidade(agente_id)["nome"]})
        except Exception as erro:  # uma área que falha não impede as outras
            log_warning(f"Agente da área {area['nome']}: {type(erro).__name__}: {erro}")
            falhas.append({"area": area["nome"], "motivo": str(erro)[:160]})
    return {"criados": criados, "ligados": novos_ligados, "falhas": falhas}


def agente_das_unidades(organizacao_id: str, quem: str, prefixo_id: str | None = None) -> str | None:
    """O agente das unidades da organização (cria na primeira vez) e o põe nas unidades sem agente.
    Devolve o id, ou None se não deu para criar."""
    org = gestao.organizacao(organizacao_id)
    seg = segmentos.de(org)
    agente_id = f"{prefixo_id or prefixo(org)}-unidades"[:30].strip("-")
    nome = f"Agente das {seg.rotulos['Unidades']}"[:60]
    descricao = f"Trabalha com as equipes das {seg.rotulos['unidades']} da {_onde(org)} e reporta à direção."[:200]
    try:
        if not perfis.existe(agente_id):
            modelo = MODELO_DAS_UNIDADES.get(seg.id)
            if modelo and perfis.existe(modelo):
                fabrica.duplicar(modelo, agente_id, {"nome": nome, "descricao": descricao, "cor": "#14C4D4"}, quem)
            else:
                fabrica.criar(agente_id, {"nome": nome, "area": seg.rotulos["Unidades"][:60], "cargo": nome,
                                          "descricao": descricao, "cor": "#14C4D4", "minutos_inatividade": 480,
                                          "ferramentas": FERRAMENTAS_DE_CONSULTA}, quem, segmento_id=seg.id, organizacao=_onde(org))
            _publicar(agente_id, organizacao_id, quem)
        gestao.ligar_agente_as_unidades(organizacao_id, agente_id)
        return agente_id
    except Exception as erro:
        log_warning(f"Agente das unidades: {type(erro).__name__}: {erro}")
        return None
