"""Os agentes de IA de cada prefeitura, criados na implantação: um por setor e o agente das unidades de saúde.

Cada um é um agente da Fábrica (agente/fabrica.py), publicado e marcado com o município dono
(`fabrica_agentes.municipio_id`): só quem é daquela prefeitura o vê e conversa com ele. Os setores com modelo no
código (Compras, Atenção Primária, Regulação) ganham uma cópia dele; os demais, um agente novo com as ferramentas de
consulta. O das unidades é uma cópia do perfil `unidade` (agente/perfis/unidade.py).

O agente criado com o servidor no ar entra no AgentOS na hora, por `registro.ativar` (app.py liga o montador).
Pode rodar de novo: o que já existe não é recriado.
"""

import re
import unicodedata

from agno.utils.log import log_warning

from agente import fabrica, gestao, perfis, registro

# Os agentes do código que servem de modelo (cópia por prefeitura).
MODELO_DO_SETOR = {"compras": "compras", "atencao_primaria": "atencao_primaria", "regulacao": "regulacao"}
MODELO_DAS_UNIDADES = "unidade"
CORES = ("#1A63D8", "#52A2FF", "#1BAF7A", "#F4B800", "#8B5CF6", "#14C4D4", "#E83E8C", "#0D1B38")


def _slug(texto: str) -> str:
    sem = "".join(c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "-", sem).strip("-")


def prefixo(municipio: dict) -> str:
    """O começo do id dos agentes da prefeitura: o nome do município e a UF (ex.: itatiaia-rj)."""
    return f"{_slug(municipio['nome'])[:16].strip('-')}-{(municipio.get('uf') or '').lower()}".strip("-")


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


def _publicar(agente_id: str, municipio_id: str, quem: str) -> None:
    fabrica.publicar(agente_id, True, quem)
    fabrica.definir_municipio(agente_id, municipio_id)
    registro.ativar(agente_id)


def criar_agentes_dos_setores(municipio_id: str, quem: str, prefixo_id: str | None = None) -> dict:
    """Um agente para cada setor que ainda não tem, ligado à mesa do setor (agentes_setor). Devolve os criados agora,
    os setores ligados e os que não deu para criar (com o motivo)."""
    mun = gestao.municipio(municipio_id)
    inicio = prefixo_id or prefixo(mun)
    ligados = {str(a["setor_id"]) for a in gestao.agentes_setor(municipio_id)}
    criados, novos_ligados, falhas = [], [], []
    for i, setor in enumerate(gestao.setores(municipio_id)):
        if str(setor["id"]) in ligados:
            continue
        tipo = setor.get("tipo_id") or _slug(setor["nome"])
        agente_id = f"{inicio}-{tipo.replace('_', '-')}"[:30].strip("-")
        try:
            if not perfis.existe(agente_id):
                agente_id = _id_livre(agente_id)
                dados = {"nome": f"Agente de {setor['nome']}"[:60], "area": setor["nome"][:60],
                         "cargo": f"Agente do setor de {setor['nome']}"[:60],
                         "descricao": (f"Faz as rotinas e prepara os documentos do setor de {setor['nome']} da Secretaria "
                                       f"de Saúde de {mun['nome']}-{mun['uf']}.")[:200],
                         "cor": CORES[i % len(CORES)]}
                modelo = MODELO_DO_SETOR.get(setor.get("tipo_id") or "")
                if modelo and perfis.existe(modelo):
                    fabrica.duplicar(modelo, agente_id, {"nome": dados["nome"], "descricao": dados["descricao"], "cor": dados["cor"]}, quem)
                else:
                    fabrica.criar(agente_id, {**dados, "minutos_inatividade": 480,
                                              "ferramentas": ["consultar_secretaria", "listar_unidades"]}, quem)
                _publicar(agente_id, municipio_id, quem)
                criados.append(agente_id)
            gestao.ligar_agente_ao_setor(municipio_id, str(setor["id"]), agente_id, f"Agente do setor {setor['nome']}", quem=quem)
            novos_ligados.append({"setor": setor["nome"], "agente": perfis.identidade(agente_id)["nome"]})
        except Exception as erro:  # um setor que falha não impede os outros
            log_warning(f"Agente do setor {setor['nome']}: {type(erro).__name__}: {erro}")
            falhas.append({"setor": setor["nome"], "motivo": str(erro)[:160]})
    return {"criados": criados, "ligados": novos_ligados, "falhas": falhas}


def agente_das_unidades(municipio_id: str, quem: str, prefixo_id: str | None = None) -> str | None:
    """O agente das unidades de saúde da prefeitura (cria na primeira vez) e o põe nas unidades sem agente.
    Devolve o id, ou None se não deu para criar."""
    mun = gestao.municipio(municipio_id)
    agente_id = f"{prefixo_id or prefixo(mun)}-unidades"[:30].strip("-")
    try:
        if not perfis.existe(agente_id):
            if not perfis.existe(MODELO_DAS_UNIDADES):
                return None
            fabrica.duplicar(MODELO_DAS_UNIDADES, agente_id, {
                "nome": "Agente das Unidades de Saúde",
                "descricao": f"Trabalha com as equipes das unidades de saúde de {mun['nome']}-{mun['uf']} e reporta à secretaria."[:200],
                "cor": "#14C4D4"}, quem)
            _publicar(agente_id, municipio_id, quem)
        gestao.ligar_agente_as_unidades(municipio_id, agente_id)
        return agente_id
    except Exception as erro:
        log_warning(f"Agente das unidades: {type(erro).__name__}: {erro}")
        return None
