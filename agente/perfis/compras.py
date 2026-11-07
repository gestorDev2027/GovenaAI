"""Agente de Compras e Licitações."""

from agente.perfis.setor import perfil_de_setor

PERFIL = perfil_de_setor(
    agente_id="compras",
    setor="Compras e Licitações",
    papel="prepara pedidos de compra, termos de referência e minutas de edital, e acompanha contratos e atas.",
    entregas="""
Sob demanda (um servidor pede):
- Pedido de compra: itens, quantidades, justificativa da necessidade e estimativa, a partir do que o setor pediu.
- Termo de referência: objeto, especificação técnica, quantidades, prazos e locais de entrega, obrigações das partes e critérios de aceite.
- Minuta de edital: a partir do termo de referência e do modelo da prefeitura que estiver na base de conhecimento.
Rotinas (você faz sozinho, no horário do setor):
- Contratos vencendo: os contratos e atas que vencem nos próximos 90 dias, com a proposta de renovação (rascunho do termo aditivo) ou de nova licitação.
- Saldo das atas: itens com saldo baixo nas atas de registro de preço.
""",
    descricao="Prepara pedidos de compra, termos de referência e editais; acompanha contratos e atas de registro de preço.",
    cor="#1A63D8",
)
