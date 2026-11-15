"""Os agentes de IA de cada organização, criados na implantação: um por área e um por unidade.

Cada um é um agente da Fábrica (agente/fabrica.py), publicado e marcado com a organização dona
(`fabrica_agentes.organizacao_id`): só quem é daquela organização o vê e conversa com ele. Na saúde, os setores com
modelo no código (Compras, Atenção Primária, Regulação) e as unidades de saúde (agente/perfis/unidade.py) ganham
uma cópia dele; os demais setores, um agente novo com o modelo de instruções da Fábrica
nos nomes do segmento (setor, servidores).

O agente criado com o servidor no ar entra no AgentOS na hora, por `registro.ativar` (app.py liga o montador).
Pode rodar de novo: o que já existe não é recriado.
"""

import re
import threading
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


# Um agente próprio por unidade (decisão de 15/11/2026): cada UBS, UPA, CAPS... tem o seu, com a unidade nas
# instruções. Antes era um agente só para todas (`<prefixo>-unidades`); as unidades que ainda apontam para ele ganham o
# próprio na próxima passada (agentes_das_unidades, também ao subir o servidor).
_travas: dict[str, threading.Lock] = {}
_trava_das_travas = threading.Lock()


def _trava(organizacao_id: str) -> threading.Lock:
    with _trava_das_travas:
        return _travas.setdefault(organizacao_id, threading.Lock())


def _id_novo(base: str) -> str:
    """Um id de agente que cabe na Fábrica (3 a 30 caracteres) e ainda não existe."""
    base = base[:30].strip("-")
    if len(base) >= 3 and not perfis.existe(base):
        return base
    for n in range(2, 1000):
        candidato = f"{base[:30 - len(str(n)) - 1].strip('-')}-{n}"
        if not perfis.existe(candidato):
            return candidato
    raise RuntimeError("Sem id livre para o agente.")


def _instrucoes_da_unidade(modelo_id: str, unidade: dict, tipo_nome: str, org: dict) -> str | None:
    """As instruções do modelo das unidades com a unidade deste agente no lugar da apresentação genérica."""
    modelo = perfis.PERFIS.get(modelo_id)
    if modelo is None or not modelo.modelo_instrucoes:
        return None
    texto = modelo.modelo_instrucoes
    endereco = ", ".join(str(p) for p in (unidade.get("endereco"), unidade.get("numero"), unidade.get("bairro")) if p)
    detalhes = ", ".join(p for p in (tipo_nome, f"CNES {unidade['cnes']}" if unidade.get("cnes") else "") if p)
    apresentacao = (
        f"Você é o agente responsável pela unidade {unidade['nome']}" + (f" ({detalhes})" if detalhes else "")
        + (f", em {endereco}" if endereco else "") + f", da {_onde(org)}, no Gestor GOV. Trabalha com a equipe desta "
        "unidade (gerência, enfermagem, farmácia, recepção), que fala com você pelo painel, e leva à secretaria o que "
        "acontece nela. Cada unidade tem o seu agente: se perguntarem de outra, use listar_unidades e diga que quem "
        "cuida dela é o agente daquela unidade."
    )
    # A primeira linha do modelo é a apresentação genérica do setor; o resto (regras, base) fica igual.
    primeira, _, resto = texto.partition("\n")
    texto = f"{apresentacao}\n{resto}" if primeira.startswith("Você é") else f"{apresentacao}\n\n{texto}"
    return texto.replace("Pergunte sempre de qual unidade a pessoa fala, se ela não disser.",
                         f"Quando a pessoa não disser de qual unidade fala, é da {unidade['nome']}.")


def _criar_agente_da_unidade(org: dict, seg, unidade: dict, tipos: dict, inicio: str, quem: str) -> str:
    tipo = tipos.get(unidade.get("tipo_id")) or {}
    tipo_nome = tipo.get("nome") or seg.rotulos["Unidade"]
    agente_id = _id_novo(f"{inicio}-{_slug(unidade['nome'])}")
    nome = f"Agente da {unidade['nome']}"[:60]
    descricao = (f"Responsável pela {unidade['nome']} ({tipo_nome}) da {_onde(org)}: estoque, produção e ocorrências "
                 "da unidade, e o que precisa de decisão da secretaria.")[:200]
    dados = {"nome": nome, "descricao": descricao, "cor": tipo.get("cor") or "#14C4D4",
             "cargo": "Agente responsável pela unidade", "area": seg.rotulos["Unidades"][:60]}
    modelo = MODELO_DAS_UNIDADES.get(seg.id)
    if modelo and perfis.existe(modelo):
        fabrica.duplicar(modelo, agente_id, dados, quem, instrucoes=_instrucoes_da_unidade(modelo, unidade, tipo_nome, org))
    else:
        fabrica.criar(agente_id, {**dados, "minutos_inatividade": 480, "ferramentas": FERRAMENTAS_DE_CONSULTA},
                      quem, segmento_id=seg.id, organizacao=_onde(org))
    _publicar(agente_id, str(org["id"]), quem)
    gestao.definir_agente_da_unidade(str(org["id"]), str(unidade["id"]), agente_id, quem)
    return agente_id


def agentes_das_unidades(organizacao_id: str, quem: str, prefixo_id: str | None = None) -> dict:
    """Um agente próprio para cada unidade que ainda não tem (ou que ainda usa o agente compartilhado antigo). Pode
    rodar de novo: a unidade com agente próprio fica como está. Devolve os criados agora e as falhas (com o motivo).
    Uma passada por organização de cada vez (a implantação e a passada ao subir podem coincidir)."""
    with _trava(organizacao_id):
        org = gestao.organizacao(organizacao_id)
        if org is None:
            return {"criados": [], "falhas": []}
        seg = segmentos.de(org)
        inicio = prefixo_id or prefixo(org)
        compartilhado = f"{inicio}-unidades"[:30].strip("-")
        tipos = {t["id"]: t for t in gestao.tipos_unidade(seg.id)}
        criados, falhas = [], []
        for unidade in gestao.unidades(organizacao_id):
            atual = unidade.get("agente_id")
            if atual and atual != compartilhado and perfis.existe(atual):
                continue
            try:
                criados.append(_criar_agente_da_unidade(org, seg, unidade, tipos, inicio, quem))
            except Exception as erro:  # uma unidade que falha não impede as outras
                log_warning(f"Agente da unidade {unidade.get('nome')}: {type(erro).__name__}: {erro}")
                falhas.append({"unidade": unidade.get("nome"), "motivo": str(erro)[:160]})
        # O agente compartilhado antigo sai do ar quando nenhuma unidade usa mais (as conversas dele ficam guardadas).
        if criados and perfis.existe(compartilhado) and not any(
                u.get("agente_id") == compartilhado for u in gestao.unidades(organizacao_id)):
            try:
                fabrica.publicar(compartilhado, False, quem)
            except Exception as erro:
                log_warning(f"Agente compartilhado {compartilhado}: {type(erro).__name__}: {erro}")
        return {"criados": criados, "falhas": falhas}


def agentes_das_unidades_em_segundo_plano(organizacao_id: str, quem: str) -> None:
    """O mesmo, sem esperar (a importação do CNES traz dezenas de unidades de uma vez)."""
    threading.Thread(target=agentes_das_unidades, args=(organizacao_id, quem), daemon=True,
                     name=f"agentes-unidades-{organizacao_id[:8]}").start()


def migrar_agentes_das_unidades(quem: str = "sistema") -> None:
    """Ao subir o servidor: as organizações com unidade sem agente próprio ganham os agentes (em segundo plano)."""
    def rodar() -> None:
        try:
            for org in gestao.organizacoes():
                if gestao.unidades(str(org["id"])):
                    agentes_das_unidades(str(org["id"]), quem)
        except Exception as erro:
            log_warning(f"Agentes das unidades ao subir: {type(erro).__name__}: {erro}")

    threading.Thread(target=rodar, daemon=True, name="agentes-unidades").start()
