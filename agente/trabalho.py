"""O trabalho dos agentes no CompanyOS do Agno: áreas, atividades, processos e tarefas.

Como o cadastro vira CompanyOS (decidido em 11/11/2026; CLAUDE.md §5b):
- Área (setor, departamento)      → Product  (id "area-<area_id>", metadata com a organização e a área)
- Atividade (rotina, sob demanda)  → Project  (o id fica em atividades_area.projeto_id)
- Cada execução da atividade       → Task     (proposta → aceita → em execução → em revisão → concluída)
- Agente da área                   → executor da Task (precisa estar no registro: `RegistroVivo`)

O PROCESSO de cada atividade (tabela `processos`) diz os passos e onde há gente decidindo:
- "agente":    o agente faz (analisar, preparar, executar)
- "aceite":    uma pessoa aceita a proposta antes de o trabalho começar
- "aprovacao": uma pessoa aprova uma ação sensível no meio da execução (gravar, enviar)
- "revisao":   uma pessoa avalia a entrega: aprova, ou ajusta e devolve para o agente refazer
Cada passo de gente pode dizer os cargos que decidem; sem cargos, decide quem tem "aprovar entregas" na área, a
direção e o dono. Quem desenha e altera os processos é o Assistente de Processos (em conversa); a implantação cria
o processo padrão de cada atividade.

O CompanyOS usa o mesmo banco dos agentes (o db do Agno). As Routines do CompanyOS não são usadas: as rotinas
rodam pelo nosso agendador e o agente PROPÕE a Task (a Routine declarada no código recebe 403 com o login ligado).
"""

from datetime import datetime, timezone
from typing import Any

from agno.utils.log import log_warning
from sqlalchemy import insert, select, update

from agente import gestao

TIPOS_PASSO = ("agente", "aceite", "aprovacao", "revisao")
PASSOS_DE_GENTE = ("aceite", "aprovacao", "revisao")
SITUACOES = {
    "backlog": "Esperando aceite",
    "ready": "Aceita",
    "in_progress": "Em execução",
    "in_review": "Em revisão",
    "done": "Concluída",
    "cancelled": "Recusada",
}

_estado: dict[str, Any] = {}


def _agora() -> datetime:
    return datetime.now(timezone.utc)


# ───────── Registro: o CompanyOS só aceita executores que ele encontra ─────────

class RegistroVivo:
    """O registro de executores do CompanyOS lido dos agentes no ar (os do código e os da Fábrica, criados na
    implantação sem reiniciar: registro.agentes, que o app.py mantém)."""

    def get_agent(self, agente_id: str | None):
        from agente import registro

        return (registro.agentes or {}).get(agente_id or "")

    def get_team(self, _id: str | None):
        return None

    def get_workflow(self, _id: str | None):
        return None


def iniciar(banco) -> None:
    """Liga o CompanyOS ao banco dos agentes (o mesmo das sessões). Sem o CompanyOS no Agno instalado, fica desligado."""
    try:
        from agno.company import CompanyManager
    except ImportError as erro:  # pragma: no cover
        log_warning(f"CompanyOS indisponível: {erro}")
        return
    _estado["cm"] = CompanyManager(db=banco, registry=RegistroVivo())


def disponivel() -> bool:
    return "cm" in _estado and gestao.disponivel()


def cm():
    return _estado["cm"]


# ───────── Processos ─────────

def processo_padrao(atividade: dict) -> list[dict]:
    """O processo que a implantação cria para a atividade: o agente propõe (rotina) ou alguém pede (sob demanda), uma
    pessoa aceita, o agente faz e uma pessoa revisa a entrega. O Assistente de Processos ajusta depois."""
    entrega = atividade.get("entregavel") or "a entrega"
    inicio = (
        {"tipo": "agente", "titulo": "Analisar e propor", "instrucoes": atividade.get("descricao") or atividade["nome"]}
        if atividade.get("tipo") == "rotina"
        else {"tipo": "agente", "titulo": "Entender o pedido", "instrucoes": "Confirmar o que falta para fazer o pedido."}
    )
    return [
        inicio,
        {"tipo": "aceite", "titulo": "Aceitar a tarefa", "cargos": []},
        {"tipo": "agente", "titulo": "Preparar " + entrega, "instrucoes": atividade.get("descricao") or atividade["nome"]},
        {"tipo": "revisao", "titulo": "Revisar " + entrega, "cargos": []},
    ]


def validar_passos(passos: list[dict]) -> list[dict]:
    """Confere os passos de um processo. ValueError com o motivo."""
    if not passos:
        raise ValueError("O processo precisa de pelo menos um passo.")
    limpos = []
    for i, p in enumerate(passos, 1):
        tipo = p.get("tipo")
        if tipo not in TIPOS_PASSO:
            raise ValueError(f"Passo {i}: tipo inválido ({tipo}). Use: {', '.join(TIPOS_PASSO)}.")
        titulo = (p.get("titulo") or "").strip()
        if not titulo:
            raise ValueError(f"Passo {i}: falta o título.")
        limpo = {"tipo": tipo, "titulo": titulo[:120]}
        if tipo == "agente":
            limpo["instrucoes"] = (p.get("instrucoes") or titulo).strip()[:2000]
        else:
            limpo["cargos"] = [str(c) for c in (p.get("cargos") or [])][:20]
        limpos.append(limpo)
    if not any(p["tipo"] == "aceite" for p in limpos):
        raise ValueError("Todo processo tem um aceite: uma pessoa aceita a tarefa antes de o trabalho começar.")
    if limpos[-1]["tipo"] != "revisao":
        raise ValueError("O último passo é a revisão da entrega por uma pessoa.")
    return limpos


def processo(organizacao_id: str, atividade_id: str) -> dict | None:
    t = gestao._t("processos")
    return gestao._uma(select(t).where(t.c.organizacao_id == organizacao_id, t.c.atividade_id == atividade_id))


def salvar_processo(organizacao_id: str, atividade_id: str, passos: list[dict], quem: str, origem: str = "pessoa",
                    session_id: str | None = None) -> dict:
    """Grava (nova versão) o processo da atividade. A versão anterior fica na auditoria."""
    passos = validar_passos(passos)
    t = gestao._t("processos")
    atual = processo(organizacao_id, atividade_id)
    with gestao._estado["engine"].begin() as c:
        if atual:
            versao = int(atual.get("versao") or 1) + 1
            c.execute(update(t).where(t.c.id == atual["id"]).values(passos=passos, versao=versao, atualizado_por=quem,
                                                                   atualizado_em=_agora()))
            pid = str(atual["id"])
        else:
            versao, pid = 1, gestao._id()
            c.execute(insert(t).values(id=pid, organizacao_id=organizacao_id, atividade_id=atividade_id, passos=passos,
                                       versao=versao, atualizado_por=quem, atualizado_em=_agora()))
        gestao.auditar(c, organizacao_id=organizacao_id, origem=origem, quem=quem, acao="processo", entidade="processos",
                       entidade_id=pid, antes={"passos": (atual or {}).get("passos"), "versao": (atual or {}).get("versao")},
                       depois={"passos": passos, "versao": versao}, session_id=session_id)
    return processo(organizacao_id, atividade_id) or {}


# ───────── Áreas → Products, atividades → Projects ─────────

def id_produto(area_id: str) -> str:
    return f"area-{area_id}"


def garantir_produto(org: dict, area: dict) -> str:
    """O Product da área (cria na primeira vez; o nome acompanha o cadastro)."""
    pid = id_produto(str(area["id"]))
    nome = f"{area['nome']} · {org.get('sigla') or org['nome']}"[:200]
    proposito = (area.get("descricao") or f"O trabalho de {area['nome']}") + f" ({org['nome']})."
    if cm().get(pid) is None:
        cm().create(id=pid, name=nome, purpose=proposito,
                    metadata={"organizacao_id": str(org["id"]), "area_id": str(area["id"])})
    return pid


def garantir_projeto(org: dict, area: dict, atividade: dict) -> str:
    """O Project da atividade (cria na primeira vez e guarda o id na atividade)."""
    if atividade.get("projeto_id") and cm().get_project(atividade["projeto_id"]):
        return atividade["projeto_id"]
    produto = garantir_produto(org, area)
    projeto = cm().create_project(product_id=produto, name=atividade["nome"][:200],
                                  outcome=(atividade.get("entregavel") or atividade.get("descricao") or "")[:500] or None)
    ta = gestao._t("atividades_area")
    with gestao._estado["engine"].begin() as c:
        c.execute(update(ta).where(ta.c.id == atividade["id"]).values(projeto_id=projeto["id"]))
    return projeto["id"]


def sincronizar(organizacao_id: str, quem: str = "sistema") -> dict:
    """Garante o Product de cada área, o Project e o processo de cada atividade. Pode rodar de novo."""
    org = gestao.organizacao(organizacao_id)
    if not org or not disponivel():
        return {"produtos": 0, "projetos": 0, "processos_criados": 0}
    areas = {str(a["id"]): a for a in gestao.areas(organizacao_id)}
    produtos, projetos, novos = set(), 0, 0
    for atividade in gestao.atividades(organizacao_id):
        area = areas.get(str(atividade["area_id"]))
        if not area:
            continue
        produtos.add(garantir_produto(org, area))
        garantir_projeto(org, area, atividade)
        projetos += 1
        if not processo(organizacao_id, str(atividade["id"])):
            salvar_processo(organizacao_id, str(atividade["id"]), processo_padrao(atividade), quem, origem="sistema")
            novos += 1
    for area in areas.values():
        produtos.add(garantir_produto(org, area))
    return {"produtos": len(produtos), "projetos": projetos, "processos_criados": novos}


# ───────── Quem decide ─────────

def pode_decidir(organizacao_id: str, email: str, area_id: str | None, cargos_do_passo: list[str] | None = None) -> bool:
    """Quem aceita, aprova e revisa (decisão de 11/11/2026): o dono e a direção sempre; os cargos que o passo do
    processo nomeia; sem cargos no passo, quem tem "aprovar entregas" num cargo da própria área."""
    from agente import acessos

    ctx = acessos.contexto(email)
    if not ctx or ctx["organizacao_id"] != organizacao_id:
        return False
    if ctx["papel"] == "dono":
        return True
    tc = gestao._t("cargos")
    cargo = gestao._uma(select(tc).where(tc.c.id == ctx["cargo_id"])) if ctx.get("cargo_id") else None
    if not cargo:
        return False
    if cargo["nivel"] == "direcao":
        return True
    if cargos_do_passo:
        return str(cargo["id"]) in set(cargos_do_passo)
    return "aprovar_entregas" in ctx["permissoes"] and area_id is not None and str(cargo.get("area_id")) == str(area_id)


# ───────── Tarefas: propor, listar, aceitar, recusar ─────────

class ErroTrabalho(Exception):
    def __init__(self, status: int, detalhe: str):
        super().__init__(detalhe)
        self.status = status
        self.detalhe = detalhe


def _atividade(organizacao_id: str, atividade_id: str) -> dict:
    ta = gestao._t("atividades_area")
    atividade = gestao._uma(select(ta).where(ta.c.id == atividade_id, ta.c.organizacao_id == organizacao_id))
    if not atividade:
        raise ErroTrabalho(404, "Atividade não encontrada nesta organização.")
    return atividade


def agente_da_area(organizacao_id: str, area_id: str) -> str | None:
    ligados = [a for a in gestao.agentes_area(organizacao_id) if str(a["area_id"]) == str(area_id) and a.get("ativo", True)]
    return ligados[0]["agente_id"] if ligados else None


def propor(organizacao_id: str, atividade_id: str, titulo: str, descricao: str, evidencia: str = "", *,
           origem: str = "agent", quem: str, session_id: str | None = None) -> dict:
    """Uma tarefa nova na atividade, ESPERANDO ACEITE (o processo sempre tem um aceite). `origem`: "agent" quando o
    agente propõe (rotina ou análise), "human" quando alguém pediu."""
    if not disponivel():
        raise ErroTrabalho(503, "O CompanyOS não está ligado neste servidor.")
    org = gestao.organizacao(organizacao_id)
    atividade = _atividade(organizacao_id, atividade_id)
    area = next((a for a in gestao.areas(organizacao_id) if str(a["id"]) == str(atividade["area_id"])), None)
    if not org or not area:
        raise ErroTrabalho(404, "Área da atividade não encontrada.")
    projeto = garantir_projeto(org, area, atividade)
    if not processo(organizacao_id, atividade_id):
        salvar_processo(organizacao_id, atividade_id, processo_padrao(atividade), quem, origem="sistema")
    executor = agente_da_area(organizacao_id, str(area["id"]))
    tarefa = cm().create_task(
        product_id=id_produto(str(area["id"])), project_id=projeto, title=(titulo or atividade["nome"]).strip()[:200],
        brief=(descricao or "").strip()[:4000] or None,
        evidence=[{"type": "note", "text": evidencia.strip()[:2000]}] if (evidencia or "").strip() else None,
        origin="agent" if origem == "agent" else "human",
        executor_type="agent" if executor else None, executor_id=executor)
    with gestao._estado["engine"].begin() as c:
        gestao.auditar(c, organizacao_id=organizacao_id, origem="agente" if origem == "agent" else "pessoa", quem=quem,
                       acao="propor_tarefa", entidade="tarefa", entidade_id=tarefa["id"],
                       depois={"titulo": tarefa["title"], "atividade": atividade["nome"], "area": area["nome"]},
                       session_id=session_id)
    return tarefa


def _produtos_da_organizacao(organizacao_id: str) -> dict[str, dict]:
    return {id_produto(str(a["id"])): a for a in gestao.areas(organizacao_id)}


def _tarefa_da_organizacao(organizacao_id: str, tarefa_id: str) -> tuple[dict, dict]:
    tarefa = cm().get_task(tarefa_id)
    areas = _produtos_da_organizacao(organizacao_id)
    if not tarefa or tarefa["product_id"] not in areas:
        raise ErroTrabalho(404, "Tarefa não encontrada nesta organização.")
    return tarefa, areas[tarefa["product_id"]]


def atividade_da_tarefa(organizacao_id: str, tarefa: dict) -> dict | None:
    ta = gestao._t("atividades_area")
    return gestao._uma(select(ta).where(ta.c.projeto_id == tarefa.get("project_id"), ta.c.organizacao_id == organizacao_id))


def _passo(organizacao_id: str, tarefa: dict, tipo: str) -> dict | None:
    """O passo do processo da atividade da tarefa (o primeiro do tipo)."""
    atividade = atividade_da_tarefa(organizacao_id, tarefa)
    proc = processo(organizacao_id, str(atividade["id"])) if atividade else None
    return next((p for p in (proc or {}).get("passos") or [] if p["tipo"] == tipo), None)


def tarefas(organizacao_id: str, email: str | None = None, situacao: str | None = None, limite: int = 100) -> list[dict]:
    """As tarefas da organização (mais novas primeiro), com a área, a atividade, o agente e se `email` pode decidir o
    passo em que a tarefa está. `situacao`: um status do CompanyOS ou "abertas" (as que esperam uma pessoa)."""
    if not disponivel():
        return []
    from agente import perfis

    areas = _produtos_da_organizacao(organizacao_id)
    atividades = {a.get("projeto_id"): a for a in gestao.atividades(organizacao_id) if a.get("projeto_id")}
    status = None if situacao in (None, "", "abertas", "todas") else situacao
    lista = []
    for produto_id, area in areas.items():
        linhas, _ = cm().list_tasks(product_id=produto_id, status=status, limit=limite, sort_by="created_at", sort_order="desc")
        for t in linhas:
            if situacao == "abertas" and t["status"] not in ("backlog", "in_review"):
                continue
            atividade = atividades.get(t.get("project_id")) or {}
            passo_tipo = {"backlog": "aceite", "in_review": "revisao"}.get(t["status"])
            cargos = (_passo(organizacao_id, t, passo_tipo) or {}).get("cargos") if passo_tipo else None
            executor = t.get("executor_id")
            lista.append(gestao._json({
                "id": t["id"], "titulo": t["title"], "descricao": t.get("brief"), "situacao": t["status"],
                "situacao_nome": SITUACOES.get(t["status"], t["status"]), "origem": t.get("origin"),
                "evidencia": [e.get("text") for e in (t.get("evidence") or []) if isinstance(e, dict) and e.get("text")],
                "area_id": str(area["id"]), "area": area["nome"], "atividade_id": str(atividade["id"]) if atividade else None,
                "atividade": atividade.get("nome"), "agente_id": executor,
                "agente": perfis.identidade(executor)["nome"] if executor and perfis.existe(executor) else None,
                "aceita_por": t.get("accepted_by"), "criada_em": datetime.fromtimestamp(t["created_at"], timezone.utc),
                "historico": [{"de": h.get("from"), "para": h.get("to"), "motivo": h.get("reason"), "por": h.get("accepted_by")}
                              for h in (t.get("transitions") or [])],
                "posso_decidir": bool(email and passo_tipo and pode_decidir(organizacao_id, email, str(area["id"]), cargos)),
            }))
    lista.sort(key=lambda x: x["criada_em"], reverse=True)
    return lista[:limite]


def _decisao(organizacao_id: str, tarefa_id: str, email: str, passo_tipo: str, status_esperado: str) -> tuple[dict, dict]:
    tarefa, area = _tarefa_da_organizacao(organizacao_id, tarefa_id)
    if tarefa["status"] != status_esperado:
        atual = SITUACOES.get(tarefa["status"], tarefa["status"])
        raise ErroTrabalho(409, f"A tarefa está \"{atual}\": não dá para fazer isto agora.")
    cargos = (_passo(organizacao_id, tarefa, passo_tipo) or {}).get("cargos")
    if not pode_decidir(organizacao_id, email, str(area["id"]), cargos):
        raise ErroTrabalho(403, "Quem decide este passo é o cargo definido no processo (ou a direção).")
    return tarefa, area


def aceitar(organizacao_id: str, tarefa_id: str, email: str) -> dict:
    """A pessoa aceita a proposta: a tarefa fica pronta para o agente da área."""
    tarefa, area = _decisao(organizacao_id, tarefa_id, email, "aceite", "backlog")
    executor = tarefa.get("executor_id") or agente_da_area(organizacao_id, str(area["id"]))
    if not executor:
        raise ErroTrabalho(422, f"A área {area['nome']} ainda não tem agente para fazer a tarefa.")
    nova = cm().transition_task(task_id=tarefa_id, target="ready", reason=f"Aceita por {email}", accepted_by=email,
                                executor_type="agent", executor_id=executor)
    with gestao._estado["engine"].begin() as c:
        gestao.auditar(c, organizacao_id=organizacao_id, origem="pessoa", quem=email, acao="aceitar_tarefa",
                       entidade="tarefa", entidade_id=tarefa_id, depois={"titulo": tarefa["title"], "executor": executor})
    return nova


def recusar(organizacao_id: str, tarefa_id: str, email: str, motivo: str) -> dict:
    """A pessoa recusa a proposta, com o motivo (o agente e a equipe veem)."""
    if not (motivo or "").strip():
        raise ErroTrabalho(422, "Diga por que está recusando.")
    tarefa, _ = _decisao(organizacao_id, tarefa_id, email, "aceite", "backlog")
    nova = cm().transition_task(task_id=tarefa_id, target="cancelled", reason=f"Recusada por {email}: {motivo.strip()[:500]}")
    with gestao._estado["engine"].begin() as c:
        gestao.auditar(c, organizacao_id=organizacao_id, origem="pessoa", quem=email, acao="recusar_tarefa",
                       entidade="tarefa", entidade_id=tarefa_id, depois={"titulo": tarefa["title"], "motivo": motivo.strip()})
    return nova


def atencao(organizacao_id: str) -> dict[str, dict]:
    """Por área: quantas tarefas esperam aceite, estão em execução e em revisão (para as salas do prédio)."""
    if not disponivel():
        return {}
    saida = {}
    for produto_id, area in _produtos_da_organizacao(organizacao_id).items():
        contagem = {}
        for chave, status in (("aceite", "backlog"), ("execucao", "in_progress"), ("revisao", "in_review")):
            _, contagem[chave] = cm().list_tasks(product_id=produto_id, status=status, limit=1)
        saida[str(area["id"])] = contagem
    return saida
