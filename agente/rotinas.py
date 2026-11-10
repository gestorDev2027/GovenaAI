"""As rotinas das áreas: no horário (cron da atividade), o agente da área analisa e, se houver o que fazer, PROPÕE
uma tarefa (agente/trabalho.py), que espera o aceite de uma pessoa.

Roda pelo nosso agendador (uma thread que acorda a cada minuto), não pela Routine do CompanyOS (que recebe 403 com o
login ligado). Só as organizações ativas (implantação concluída) e só com GESTORGOV_ROTINAS=sim: cada rotina chama o
Gemini no horário dela. `rodar_agora` serve a qualquer momento (botão "Rodar agora" no painel; útil no plano grátis
do Render, que dorme e perde os horários).
"""

import os
import threading
import time
from datetime import date

from agno.utils.log import log_info, log_warning

from agente import gestao, segmentos

FUSO = "America/Sao_Paulo"
_estado: dict = {"proxima": {}, "rodando": False}


def ligadas() -> bool:
    return os.getenv("GESTORGOV_ROTINAS", "nao").strip().lower() in ("sim", "1", "true")


def instrucoes(org: dict, area: dict, atividade: dict) -> str:
    r = segmentos.de(org).rotulos
    sensiveis = "Nunca use nome, CPF ou Cartão SUS de pacientes: só números agregados e códigos."
    return (
        f'Rotina "{atividade["nome"]}" do {r["area"]} de {area["nome"]} ({org["nome"]}).\n\n'
        f"O que fazer: {atividade['descricao']}\n"
        f"O que entregar: {atividade.get('entregavel') or 'um resumo do que precisa de atenção'}.\n\n"
        "1. Confira os dados que você tem (consultar_dados, consultar_organizacao, os documentos da base).\n"
        "2. Se houver algo que precise de atenção, use propor_tarefa UMA vez, com um título curto, o que precisa ser "
        "feito e a evidência (de onde veio cada número). A tarefa espera o aceite do responsável.\n"
        "3. Se não houver nada, não proponha; responda em uma linha que está tudo em dia.\n"
        f"{sensiveis}"
    )


def rodar_agora(organizacao_id: str, atividade_id: str, quem: str) -> dict:
    """Roda a rotina da atividade agora, numa thread (o agente pode demorar). Devolve na hora."""
    from agente import registro, trabalho

    org = gestao.organizacao(organizacao_id)
    atividade = trabalho._atividade(organizacao_id, atividade_id)
    area = next((a for a in gestao.areas(organizacao_id) if str(a["id"]) == str(atividade["area_id"])), None)
    agente_id = trabalho.agente_da_area(organizacao_id, str(atividade["area_id"]))
    agente = (registro.agentes or {}).get(agente_id or "")
    if not org or not area or not agente:
        raise trabalho.ErroTrabalho(422, "A área desta atividade ainda não tem agente no ar.")
    texto = instrucoes(org, area, atividade)
    sessao = f"rotina-{atividade_id}-{date.today().isoformat()}"

    def executar() -> None:
        try:
            agente.run(texto, session_id=sessao, user_id=f"rotina:{atividade_id}",
                       session_state={"organizacao_id": organizacao_id, "atividade_id": atividade_id, "rotina": True})
            log_info(f"Rotina {atividade['nome']} ({atividade_id}) rodou por {quem}.")
        except Exception as erro:
            log_warning(f"Rotina {atividade['nome']} falhou: {type(erro).__name__}: {erro}")

    threading.Thread(target=executar, daemon=True, name=f"rotina-{atividade_id[:8]}").start()
    with gestao._estado["engine"].begin() as c:
        gestao.auditar(c, organizacao_id=organizacao_id, origem="rotina" if quem == "agendador" else "pessoa", quem=quem,
                       acao="rodar_rotina", entidade="atividades_area", entidade_id=atividade_id,
                       depois={"atividade": atividade["nome"], "agente": agente_id}, session_id=sessao)
    return {"rodando": True, "atividade": atividade["nome"], "agente": agente_id, "sessao": sessao}


def _devidas(agora: int) -> list[tuple[str, str]]:
    """As rotinas cujo horário chegou: (organização, atividade)."""
    from agno.scheduler.cron import compute_next_run

    devidas = []
    for org in gestao.organizacoes():
        if org.get("situacao") != "ativo":
            continue
        for a in gestao.atividades(str(org["id"])):
            if a.get("tipo") != "rotina" or not a.get("ativa", True) or not a.get("cron"):
                continue
            chave = str(a["id"])
            proxima = _estado["proxima"].get(chave)
            if proxima is None:  # primeira vez desde que o servidor subiu: só marca o próximo horário
                _estado["proxima"][chave] = compute_next_run(a["cron"], FUSO, agora)
            elif proxima <= agora:
                devidas.append((str(org["id"]), chave))
                _estado["proxima"][chave] = compute_next_run(a["cron"], FUSO, agora)
    return devidas


def iniciar_agendador() -> None:
    """A thread que confere as rotinas a cada minuto (só com GESTORGOV_ROTINAS=sim)."""
    if not ligadas() or _estado["rodando"]:
        return
    _estado["rodando"] = True

    def laco() -> None:
        while True:
            try:
                for oid, atividade_id in _devidas(int(time.time())):
                    rodar_agora(oid, atividade_id, "agendador")
            except Exception as erro:  # um erro numa volta não para o agendador
                log_warning(f"Agendador das rotinas: {type(erro).__name__}: {erro}")
            time.sleep(60)

    threading.Thread(target=laco, daemon=True, name="agendador-rotinas").start()
    log_info("Agendador das rotinas ligado (GESTORGOV_ROTINAS=sim).")
