"""As tarefas demoradas do GestorGov (Render Workflows). Ver agente/segundo_plano.py e tarefas/main.py.

Os módulos daqui (conhecimento, cnes, fabrica) são funções comuns, sem o SDK do Render: o servidor web as usa
direto, numa thread, quando o Render não está ligado. Só tarefas/main.py importa o SDK.
"""
