"""Uma troca de mensagens com o contato, com as regras de estado do atendimento.

Usado pelo chat do painel, pela implantação e pelo terminal: o agente só responde enquanto a conversa está
"em_atendimento"; transferida ou encerrada, a mensagem é ignorada.

Quem atende pode ser um agente ou uma equipe (agente/equipes.py: o Team do Agno, em que a recepção
escolhe o agente). Na equipe, a resposta é vista como a do agente que respondeu (`agent_id`), e é com
ele que andam o guardrail, a Central ao vivo, a transferência e o resultado.
"""

import time
from contextlib import contextmanager
from collections.abc import Iterator
from datetime import datetime

from agno.agent import Agent
from agno.db.base import SessionType
from agno.media import Audio, File, Image
from agno.run.agent import RunEvent, RunOutput
from agno.utils.log import log_warning

from agente.ferramentas import STATUS_EM_ATENDIMENTO, STATUS_ENCERRADO, STATUS_TRANSFERIDO
from agente import ao_vivo, base, conhecimento, equipes, guardrails, perfis


def _estado(agente: Agent, session_id: str) -> dict:
    # Conversa que ainda não existe no banco: o Agno lança exceção em vez de devolver vazio.
    if agente.get_session(session_id=session_id) is None:
        return {}
    return agente.get_session_state(session_id=session_id) or {}


@contextmanager
def _trace_proprio():
    """Cada resposta do agente vira um trace próprio (resposta → modelo → ferramentas), sem herdar o
    contexto da requisição. Em produção as chamadas chegam pela Cloudflare com um `traceparent` que
    pode vir marcado como "não amostrar": herdado, ele fazia o trace do agente ser descartado."""
    try:
        from opentelemetry import context as otel_context
    except ImportError:  # sem OpenTelemetry instalado: nada a isolar
        yield
        return
    token = otel_context.attach(otel_context.Context())
    try:
        yield
    finally:
        otel_context.detach(token)


def _midias(anexos: list[tuple[str, str, bytes]] | None) -> dict:
    imagens, arquivos, audios = [], [], []
    for nome, tipo, conteudo in anexos or []:
        if tipo.startswith("image/"):
            imagens.append(Image(content=conteudo, mime_type=tipo, alt_text=nome))
        elif tipo.startswith("audio/"):
            audios.append(Audio(content=conteudo, mime_type=tipo, format=tipo.split("/")[-1]))
        else:
            arquivos.append(File(content=conteudo, mime_type=tipo, filename=nome, name=nome))
    return {"images": imagens or None, "files": arquivos or None, "audio": audios or None}


def _contexto(agente: Agent, mensagem: str) -> dict | None:
    """Exemplos aprovados e trechos de documentos parecidos com a mensagem (agente/conhecimento.py)."""
    try:
        return conhecimento.contexto(agente.id, mensagem)
    except Exception as erro:  # sem embedding ou sem banco: responde sem o contexto extra
        log_warning(f"Contexto de calibração indisponível: {type(erro).__name__}: {erro}")
        return None


def _parametros(ctx: dict | None, whatsapp: str | None = None) -> dict:
    # whatsapp: a conversa do contato com a equipe no canal (agente/historico_canal.py), só nesta resposta.
    dependencias = {**({"calibracao": ctx} if ctx else {}), **({"whatsapp": whatsapp} if whatsapp else {})}
    return {
        "dependencies": dependencias or None,
        "add_dependencies_to_context": False,  # entra pelas instruções desta resposta, não na mensagem do contato
        "metadata": {"calibracao": conhecimento.ids_usados(ctx)} if ctx else None,
    }


def _contexto_da_equipe(equipe, mensagem: str) -> dict:
    """Na equipe, cada agente recebe os próprios exemplos e trechos: a recepção só escolhe quem responde."""
    return {m.id: _contexto(m, mensagem) for m in equipe.members}


def _quem_atende(atendente, session_id: str) -> str:
    """O agente da conversa antes de responder: na equipe, quem está com ela agora (ou o padrão)."""
    return equipes.agente_atual(atendente, session_id) if equipes.eh_equipe(atendente) else atendente.id


def rodar(
    agente: Agent,
    session_id: str,
    mensagem: str,
    user_id: str,
    session_state: dict,
    anexos: list[tuple[str, str, bytes]] | None = None,
    whatsapp: str | None = None,
):
    """Uma resposta do agente, do jeito que o contato a recebe: com os exemplos aprovados e os trechos
    (documentos e, no modo busca, o roteiro) parecidos com a mensagem e, do canal, a conversa do contato com a
    equipe (`whatsapp`). Usada pelo atendimento e pelas avaliações, para que elas meçam exatamente o que vai
    para o contato. Devolve (RunOutput, contexto); na equipe, a resposta vem como a do agente que respondeu (agent_id)."""
    if equipes.eh_equipe(agente):
        por_agente = _contexto_da_equipe(agente, mensagem)
        dependencias = {"calibracao_por_agente": por_agente, **({"whatsapp": whatsapp} if whatsapp else {})}
        parametros = {"dependencies": dependencias, "add_dependencies_to_context": False}
    else:
        por_agente, parametros = None, None
        ctx = _contexto(agente, mensagem)
    with _trace_proprio():
        saida = agente.run(
            mensagem,
            **(parametros or _parametros(ctx, whatsapp)),
            **_midias(anexos),
            session_id=session_id,
            user_id=user_id,
            session_state=session_state,
        )
    if por_agente is not None:
        saida = equipes._RespostaDaEquipe(saida, equipes.resposta_do_membro(saida), equipes.padrao(agente))
        ctx = por_agente.get(saida.agent_id)
    _aplicar_guardrail(agente, session_id, mensagem, saida, session_state)
    return saida, ctx


def _aplicar_guardrail(agente: Agent, session_id: str, mensagem: str, saida: RunOutput, session_state: dict) -> bool:
    """Pedido de manipulação barrado (agente/guardrails.py): o contato recebe a seção do roteiro, não o aviso
    técnico."""
    if saida.content != guardrails.BLOQUEIO_MANIPULACAO:
        return False
    quem = getattr(saida, "agent_id", None) or agente.id  # na equipe, o agente da resposta (ou o padrão)
    saida.content = base.secao(base.obter(quem).texto(), guardrails.SECAO_FORA_DO_ATENDIMENTO) or ""
    log_warning(f"Guardrail: pedido de manipulação barrado na sessão {session_id}.")
    ao_vivo.publicar("guardrail", quem, session_id, session_state.get("nome_contato", ""), texto=mensagem)
    return True


def _avisar_desfecho(agente: Agent, session_id: str, contato: str, saida: RunOutput, acoes_antes: int) -> None:
    """Central ao vivo: a resposta e o que ela decidiu (transferência ou encerramento)."""
    quem = getattr(saida, "agent_id", None) or agente.id
    duracao = getattr(saida.metrics, "duration", None) if saida.metrics else None
    ao_vivo.publicar("respondeu", quem, session_id, contato, texto=saida.content or "",
                     duracao_s=round(duracao, 2) if duracao else None)
    estado = _estado(agente, session_id)
    rotulos = perfis.obter(quem).categorias_transferencia
    for acao in (estado.get("acoes") or [])[acoes_antes:]:
        if acao.get("tipo") == "transferencia":
            categoria = acao.get("categoria") or "outro"
            ao_vivo.publicar("transferiu", quem, session_id, contato, categoria=categoria,
                             categoria_rotulo=rotulos.get(categoria, categoria), motivo=acao.get("motivo") or "")
        elif acao.get("tipo") == "encerramento":
            ao_vivo.publicar("encerrou", quem, session_id, contato, motivo="atendimento concluído")


def _resultado(agente: Agent, session_id: str, saida: RunOutput, ctx: dict | None) -> dict:
    estado = _estado(agente, session_id)
    metricas = saida.metrics
    return {
        "respondeu": True,
        "agente": getattr(saida, "agent_id", None) or agente.id,  # na equipe, o agente que respondeu
        "equipe": agente.id if equipes.eh_equipe(agente) else None,
        "resposta": saida.content or "",
        "run_id": saida.run_id,  # identifica a resposta (ex.: para a avaliação humana no painel)
        "calibracao": conhecimento.ids_usados(ctx),
        "status": estado.get("status", STATUS_EM_ATENDIMENTO),
        "acoes": estado.get("acoes", []),
        "ferramentas": [t.tool_name for t in (saida.tools or [])],
        "metricas": {
            "tokens_entrada": getattr(metricas, "input_tokens", None),
            "tokens_saida": getattr(metricas, "output_tokens", None),
            "duracao_s": getattr(metricas, "duration", None),
        },
    }


def responder(
    agente: Agent,
    session_id: str,
    mensagem: str,
    nome_contato: str = "",
    user_id: str | None = None,
    telefone: str = "",
    anexos: list[tuple[str, str, bytes]] | None = None,
    estado_extra: dict | None = None,
    whatsapp: str | None = None,
) -> dict:
    """Uma mensagem do contato. `anexos`: (nome do arquivo, tipo MIME, conteúdo), como chegam do WhatsApp:
    print do erro (imagem), PDF (boleto, documento) ou áudio. `whatsapp`: a conversa do contato com a equipe
    no canal (agente/historico_canal.py), que entra só nas instruções desta resposta."""
    estado = _estado(agente, session_id)
    status = estado.get("status", STATUS_EM_ATENDIMENTO)
    if status != STATUS_EM_ATENDIMENTO:
        return {"respondeu": False, "resposta": None, "status": status, "acoes": estado.get("acoes", [])}

    acoes_antes = len(estado.get("acoes", []))
    quem = _quem_atende(agente, session_id)
    ao_vivo.publicar("mensagem", quem, session_id, nome_contato, texto=mensagem)
    ao_vivo.publicar("pensando", quem, session_id, nome_contato)
    try:
        saida, ctx = rodar(
            agente, session_id, mensagem, user_id or session_id,
            # O telefone do WhatsApp é o que a consulta ao cadastro usa para achar o contato.
            # estado_extra: dados do canal (ex.: o id do contato na Unnichat, para a despedida por inatividade).
            {"nome_contato": nome_contato, "telefone": telefone, **(estado_extra or {})},
            anexos,
            whatsapp,
        )
    except Exception as erro:
        ao_vivo.publicar("erro", quem, session_id, nome_contato, texto=f"{type(erro).__name__}: {erro}")
        raise
    _avisar_desfecho(agente, session_id, nome_contato, saida, acoes_antes)
    return _resultado(agente, session_id, saida, ctx)


def responder_em_etapas(
    agente: Agent,
    session_id: str,
    mensagem: str,
    nome_contato: str = "",
    user_id: str | None = None,
    telefone: str = "",
    anexos: list[tuple[str, str, bytes]] | None = None,
) -> Iterator[dict]:
    """O mesmo que `responder`, contando o que o agente faz enquanto responde (chat de teste do painel).

    Eventos, nesta ordem: {"tipo": "etapa", "id", "chave", "estado": "rodando" | "concluida" | "erro", ...}
    para cada passo (contexto, chamada ao modelo, ferramenta, memória), {"tipo": "texto", "delta"} com a
    resposta à medida que é escrita e, no fim, {"tipo": "fim", ...} com o mesmo conteúdo de `responder`.
    """
    if equipes.eh_equipe(agente):
        # Equipe: a recepção escolhe o agente e a resposta vem inteira (sem as etapas do modelo).
        yield {"tipo": "etapa", "id": "recepcao", "chave": "recepcao", "estado": "rodando"}
        inicio = time.perf_counter()
        resultado = responder(agente, session_id, mensagem, nome_contato, user_id, telefone, anexos)
        yield {"tipo": "etapa", "id": "recepcao", "chave": "recepcao", "estado": "concluida",
               "duracao_s": round(time.perf_counter() - inicio, 2), "agente": resultado.get("agente"),
               "nome": perfis.identidade(resultado.get("agente"))["nome"] if resultado.get("agente") else None}
        if resultado.get("resposta"):
            yield {"tipo": "texto", "delta": resultado["resposta"]}
        yield {"tipo": "fim", **resultado}
        return

    estado = _estado(agente, session_id)
    status = estado.get("status", STATUS_EM_ATENDIMENTO)
    if status != STATUS_EM_ATENDIMENTO:
        yield {"tipo": "fim", "respondeu": False, "resposta": None, "status": status, "acoes": estado.get("acoes", [])}
        return

    acoes_antes = len(estado.get("acoes", []))
    ao_vivo.publicar("mensagem", agente.id, session_id, nome_contato, texto=mensagem)
    ao_vivo.publicar("pensando", agente.id, session_id, nome_contato)
    yield {"tipo": "etapa", "id": "contexto", "chave": "contexto", "estado": "rodando"}
    inicio = time.perf_counter()
    ctx = _contexto(agente, mensagem)
    usados = conhecimento.ids_usados(ctx)
    yield {
        "tipo": "etapa", "id": "contexto", "chave": "contexto", "estado": "concluida",
        "duracao_s": round(time.perf_counter() - inicio, 2),
        "contagem": {k: len(usados.get(k, [])) for k in ("exemplos", "trechos", "roteiro")},
    }

    saida, chamadas, inicio_modelo, barrado = None, 0, 0.0, None
    # Consumido de ponta a ponta numa só thread (painel_api.py), como o trace exige.
    with _trace_proprio():
        for item in agente.run(
            mensagem,
            **_parametros(ctx),
            **_midias(anexos),
            session_id=session_id,
            user_id=user_id or session_id,
            session_state={"nome_contato": nome_contato, "telefone": telefone},
            stream=True,
            stream_events=True,
            yield_run_output=True,
        ):
            if isinstance(item, RunOutput):
                saida = item
                continue
            evento = getattr(item, "event", "")
            if evento == RunEvent.model_request_started.value:
                chamadas += 1
                inicio_modelo = time.perf_counter()
                yield {"tipo": "etapa", "id": f"modelo-{chamadas}", "chave": "modelo", "estado": "rodando",
                       "modelo": getattr(item, "model", None)}
            elif evento == RunEvent.model_request_completed.value:
                yield {"tipo": "etapa", "id": f"modelo-{chamadas}", "chave": "modelo", "estado": "concluida",
                       "duracao_s": round(time.perf_counter() - inicio_modelo, 2),
                       "tokens": getattr(item, "total_tokens", None),
                       "tokens_raciocinio": getattr(item, "reasoning_tokens", None)}
            elif evento in (RunEvent.tool_call_started.value, RunEvent.tool_call_completed.value):
                ferramenta = item.tool
                if ferramenta is None:
                    continue
                concluiu = evento == RunEvent.tool_call_completed.value
                duracao = getattr(ferramenta.metrics, "duration", None) if ferramenta.metrics else None
                yield {
                    "tipo": "etapa", "id": ferramenta.tool_call_id or ferramenta.tool_name, "chave": "ferramenta",
                    "nome": ferramenta.tool_name, "argumentos": ferramenta.tool_args or {},
                    "estado": ("erro" if ferramenta.tool_call_error else "concluida") if concluiu else "rodando",
                    "duracao_s": round(duracao, 2) if concluiu and duracao else None,
                }
            elif evento in (RunEvent.memory_update_started.value, RunEvent.memory_update_completed.value):
                yield {"tipo": "etapa", "id": "memoria", "chave": "memoria",
                       "estado": "concluida" if evento == RunEvent.memory_update_completed.value else "rodando"}
            elif evento == RunEvent.run_content.value and isinstance(getattr(item, "content", None), str):
                yield {"tipo": "texto", "delta": item.content}
            elif evento == RunEvent.run_error.value:
                conteudo = getattr(item, "content", None)
                if conteudo == guardrails.BLOQUEIO_MANIPULACAO:
                    # O guardrail barrou: em etapas o Agno não entrega a resposta; ela sai da seção do roteiro, abaixo.
                    barrado = RunOutput(run_id=getattr(item, "run_id", None), agent_id=agente.id,
                                        session_id=session_id, content=conteudo)
                    continue
                ao_vivo.publicar("erro", agente.id, session_id, nome_contato, texto=conteudo or "falha no modelo")
                raise RuntimeError(conteudo or "O agente não conseguiu responder.")

    saida = saida or barrado
    if saida is None:
        ao_vivo.publicar("erro", agente.id, session_id, nome_contato, texto="terminou sem resposta")
        raise RuntimeError("O agente terminou sem resposta.")
    if _aplicar_guardrail(agente, session_id, mensagem, saida, {"nome_contato": nome_contato, "telefone": telefone}):
        yield {"tipo": "texto", "delta": saida.content}
    _avisar_desfecho(agente, session_id, nome_contato, saida, acoes_antes)
    yield {"tipo": "fim", **_resultado(agente, session_id, saida, ctx)}


def encerrar_por_inatividade(agente: Agent, session_id: str) -> dict:
    """Encerra com a despedida do perfil do agente (seção do roteiro), salvo se a conversa já foi transferida ou encerrada.
    Na equipe, a despedida é a de quem está com a conversa."""
    quem = _quem_atende(agente, session_id)
    despedida = perfis.obter(quem).encerramento_inatividade() or None
    estado = _estado(agente, session_id)
    status = estado.get("status", STATUS_EM_ATENDIMENTO)
    if status in (STATUS_TRANSFERIDO, STATUS_ENCERRADO):
        return {"encerrou": False, "status": status, "mensagem": None}
    if not estado:
        # O contato não chegou a responder às boas-vindas: não há conversa gravada para encerrar.
        return {"encerrou": True, "status": STATUS_ENCERRADO, "mensagem": despedida}
    # registrado_em como nas ações das ferramentas (agente/ferramentas.py): sem ele, a Central não sabe quando encerrou.
    acoes = estado.get("acoes", []) + [{"tipo": "inatividade", "motivo": "Sem resposta do contato",
                                        "registrado_em": datetime.now().isoformat(timespec="seconds")}]
    agente.update_session_state({"status": STATUS_ENCERRADO, "acoes": acoes}, session_id=session_id)
    ao_vivo.publicar("encerrou", quem, session_id, estado.get("nome_contato", ""), motivo="inatividade")
    return {"encerrou": True, "status": STATUS_ENCERRADO, "mensagem": despedida}


def encerrar_inativas(agente: Agent, minutos: int | None = None) -> dict:
    """Encerra as conversas em atendimento sem mensagem do contato há `minutos` (padrão: o do perfil
    do agente), rodada pelo Scheduler para cada agente.

    A despedida fica registrada na ação da conversa; nas conversas da Unnichat, quem chama
    (painel_api.py) também a envia ao contato.
    """
    equipe = equipes.eh_equipe(agente)
    tipo = SessionType.TEAM if equipe else SessionType.AGENT
    perfil_id = equipes.padrao(agente) if equipe else agente.id
    limite = time.time() - (minutos or perfis.obter(perfil_id).minutos_inatividade) * 60
    sessoes = agente.db.get_sessions(
        session_type=tipo, sort_by="updated_at", sort_order="desc", limit=1000, include_runs=False
    )
    encerradas = []
    for sessao in sessoes:
        dono = getattr(sessao, "team_id", None) if equipe else getattr(sessao, "agent_id", None)
        if dono not in ((agente.id,) if equipe else (None, agente.id)):
            continue
        estado = (sessao.session_data or {}).get("session_state") or {}
        if estado.get("status", STATUS_EM_ATENDIMENTO) != STATUS_EM_ATENDIMENTO:
            continue
        if not sessao.updated_at or sessao.updated_at > limite:
            continue
        # No Agno 3 as respostas ficam numa tabela à parte e a sessão nem sempre tem a atualização
        # renovada a cada mensagem: confere a hora da última resposta antes de encerrar.
        completa = agente.db.get_session(session_id=sessao.session_id, session_type=tipo)
        runs = (completa.runs or []) if completa else []
        ultima = max((getattr(r, "created_at", None) or 0 for r in runs), default=0)
        if ultima > limite:
            continue
        if encerrar_por_inatividade(agente, sessao.session_id)["encerrou"]:
            encerradas.append(sessao.session_id)
    return {"verificadas": len(sessoes), "encerradas": encerradas}
