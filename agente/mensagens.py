"""Constantes comuns aos agentes do GestorGov.

Os textos das mensagens fixas (boas-vindas e encerramento por inatividade) não ficam no código: são as
seções "## Boas-vindas" e "## Encerramento por inatividade" da base de conhecimento de cada agente,
editáveis no painel.
"""

import os

# Quanto tempo sem mensagem do servidor até a conversa ser encerrada (padrão: 8 h, um expediente).
MINUTOS_INATIVIDADE = int(os.getenv("INATIVIDADE_MINUTOS", str(8 * 60)))
