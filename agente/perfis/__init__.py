"""Registro dos agentes do GestorGov.

- onboarding: o assistente de implantação (conversa com o responsável e monta a organização). É o padrão.
- processos: o Assistente de Processos (desenha com o gestor as atividades e os processos dos agentes).
- compras, atencao_primaria, regulacao: os primeiros agentes de setor (agente/perfis/setor.py).
- unidade: o agente das unidades de saúde. Estes quatro são modelos: cada prefeitura ganha a sua cópia na
  implantação (agente/agentes_organizacao.py).

Para acrescentar um agente: crie-o pela fábrica de agentes no painel (agente/fabrica.py), ou crie
`agente/perfis/<id>.py` com um PERFIL e inclua aqui. O servidor passa a servi-lo no AgentOS e no painel.
"""

from agente import base
from agente.perfil import Perfil
from agente.perfis import atencao_primaria, compras, onboarding, processos, regulacao, unidade

PADRAO = onboarding.PERFIL.id

PERFIS: dict[str, Perfil] = {p.id: p for p in (onboarding.PERFIL, processos.PERFIL, compras.PERFIL, atencao_primaria.PERFIL,
                                              regulacao.PERFIL, unidade.PERFIL)}
# Os assistentes do sistema (implantação e processos): têm a tela deles e ficam fora da lista de agentes e das equipes.
ASSISTENTES = frozenset({onboarding.PERFIL.id, processos.PERFIL.id})
# Os modelos do código: cada organização conversa com a cópia dela (agente/agentes_organizacao.py), não com eles.
MODELOS = frozenset({compras.PERFIL.id, atencao_primaria.PERFIL.id, regulacao.PERFIL.id, unidade.PERFIL.id})

for _perfil in PERFIS.values():
    base.registrar(_perfil.id, _perfil.arquivo_base)


def identidade(perfil_id: str | None) -> dict:
    """Como o agente aparece no painel: nome, cargo e área (sem área, "Outros")."""
    perfil = obter(perfil_id)
    return {"nome": perfil.apelido or perfil.nome, "cargo": perfil.cargo or perfil.nome, "area": perfil.area or "Outros",
            "cor": perfil.cor}


def publicado(perfil_id: str | None) -> bool:
    """Ativo. O inativo (ou rascunho) da fábrica de agentes (agente/fabrica.py) fica fora da Central,
    dos filtros, da Calibração, das equipes publicadas e da Unnichat; só o chat de teste o alcança."""
    return perfil_id in PERFIS and PERFIS[perfil_id].publicado and not PERFIS[perfil_id].excluido


def existe(perfil_id: str | None) -> bool:
    """Agente que ainda existe: no registro e não excluído na fábrica."""
    return perfil_id in PERFIS and not PERFIS[perfil_id].excluido


def obter(perfil_id: str | None) -> Perfil:
    """Perfil pelo id; id ausente ou desconhecido (sessões antigas, sem agent_id) cai no padrão."""
    return PERFIS.get(perfil_id or PADRAO, PERFIS[PADRAO])


def todas_as_categorias() -> dict[str, str]:
    """Rótulos de transferência de todos os agentes (o painel mostra conversas de qualquer um)."""
    rotulos: dict[str, str] = {}
    for perfil in PERFIS.values():
        for chave, rotulo in perfil.categorias_transferencia.items():
            rotulos.setdefault(chave, rotulo)
    return rotulos
