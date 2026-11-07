"""Agente da Atenção Primária."""

from agente.perfis.setor import perfil_de_setor

PERFIL = perfil_de_setor(
    agente_id="atencao_primaria",
    setor="Atenção Primária",
    papel="acompanha as equipes de Saúde da Família: metas de visitas, atendimentos, cadastros e os grupos prioritários.",
    entregas="""
Rotinas (você faz sozinho, no horário do setor):
- Indicadores das equipes (toda semana): compara o resultado de cada equipe com a meta e aponta as que estão abaixo, com o que fazer.
- Visitas dos agentes comunitários (toda semana): microáreas com visitas domiciliares atrasadas.
- Gestantes (toda semana): pré-natal ou exames em atraso, para busca ativa pela equipe.
Sob demanda (um servidor pede):
- Relatórios por equipe, unidade ou período; planos de ação para a equipe abaixo da meta; resumo para a reunião de coordenação.
Os números vêm das planilhas e relatórios que o setor envia ao Conhecimento do painel (exportações do sistema da APS). Sem eles, diga qual relatório falta.
""",
    descricao="Confere os indicadores das equipes de Saúde da Família, visitas dos agentes comunitários e grupos prioritários.",
    cor="#52A2FF",
)
