"""Serviço de workflow do GestorGov (Render Workflows): as tarefas demoradas, cada execução numa máquina própria.

Quem dispara é o servidor web (agente/segundo_plano.py, `disparar`), pelo id "gestorgov-tarefas/<tarefa>". Toda
tarefa recebe primeiro o id da linha em tarefas_execucoes e depois só ids e números (o Render guarda os argumentos
e o retorno de cada execução: nada de nome, e-mail ou dado de paciente). Lê e grava direto no Supabase.

No Render: o serviço `gestorgov-tarefas` do render.yaml (python -m tarefas.main).
Local (Render CLI 2.12 ou mais nova):
  render workflows dev -- .venv\\Scripts\\python -m tarefas.main
  e, no .env do servidor web: GESTORGOV_WORKFLOWS=sim e RENDER_USE_LOCAL_DEV=true
"""

import asyncio

from render import Retry, TaskContext, Workflows

from agente import segundo_plano
from tarefas import cnes, conhecimento, contexto, fabrica

app = Workflows()

# Erros de rede e da cota do Gemini costumam passar: duas novas tentativas, 5 s e depois 10 s.
TENTATIVAS = Retry(max_retries=2, wait_duration_ms=5000, backoff_scaling=2)
# Casos da Fábrica ao mesmo tempo (cada um numa máquina): mais que isso estoura a cota do modelo.
CASOS_POR_VEZ = 5


@app.task(retry=TENTATIVAS, timeout_seconds=1800)
def processar_documento(ctx: TaskContext, execucao_id: str, documento_id: int) -> dict:
    """Texto, trechos e embeddings de uma versão de documento do Conhecimento (o arquivo vem do bucket)."""
    contexto.ligar()
    return segundo_plano.executar(execucao_id, lambda: conhecimento.processar_documento(execucao_id, documento_id))


@app.task(retry=TENTATIVAS, timeout_seconds=1800)
def importar_cnes(ctx: TaskContext, execucao_id: str, organizacao_id: str) -> dict:
    """As unidades públicas e conveniadas ao SUS do município, dos dados abertos do CNES."""
    contexto.ligar()
    return segundo_plano.executar(execucao_id, lambda: cnes.importar_cnes(execucao_id, organizacao_id))


@app.task(retry=Retry(max_retries=1, wait_duration_ms=10000), timeout_seconds=900)
def rodar_caso(ctx: TaskContext, execucao_id: str, agente_id: str, caso_id: int) -> dict:
    """Um caso de teste da Fábrica: uma conversa nova com o agente, conferida pelas regras do caso."""
    return fabrica.rodar_caso(execucao_id, agente_id, caso_id)


# Uma nova tentativa da execução inteira pula os casos que já rodaram (tarefas/fabrica.py).
@app.task(retry=Retry(max_retries=1, wait_duration_ms=10000), timeout_seconds=3600)
async def executar_casos(ctx: TaskContext, execucao_id: str, fabrica_execucao: int, agente_id: str) -> dict:
    """Os casos ativos de um agente, CASOS_POR_VEZ por vez, e a nota da execução no fim."""
    contexto.ligar()
    segundo_plano.comecar(execucao_id)
    caso_ids = fabrica.casos(agente_id)
    try:
        for inicio in range(0, len(caso_ids), CASOS_POR_VEZ):
            lote = caso_ids[inicio:inicio + CASOS_POR_VEZ]
            # Um caso que falhou depois das tentativas não derruba os outros: fica como reprovado no resultado.
            await asyncio.gather(*(ctx.run(rodar_caso, execucao_id, agente_id, c) for c in lote), return_exceptions=True)
            segundo_plano.progresso(execucao_id, {"casos_rodados": inicio + len(lote), "total": len(caso_ids)})
        resumo = fabrica.fechar(execucao_id, fabrica_execucao, caso_ids)
    except Exception as erro:
        fabrica.fechar(execucao_id, fabrica_execucao, caso_ids, erro=f"{type(erro).__name__}: {erro}")
        segundo_plano.falhar(execucao_id, erro)
        raise
    segundo_plano.concluir(execucao_id, resumo)
    return resumo


if __name__ == "__main__":
    app.start()
