"""O que cada agente da organização é e o que ele enxerga dos dados (CLAUDE.md, §5b).

- Ficha (`fichas_agente`): características (cor, tom, autonomia), memória, escopo (a área dele ou a organização
  inteira), integrações e as PERMISSÕES por tipo de dado: ler, criar, alterar, apagar.
- Ler é direto, dentro do escopo e do que a ficha libera (consultar_dados).
- Mudar (criar, alterar, apagar) nunca é direto: vai pelo CompanyOS, como tarefa que uma pessoa aceita e, no meio da
  execução, como ação que pede aprovação (a construir; a ficha já guarda o que cada agente poderá pedir).

Os tipos de dado (DOMINIOS) dizem o que cada um aceita. Um tipo novo = uma entrada em DOMINIOS e uma função de
leitura em _LEITURAS.
"""

from datetime import datetime, timezone

from sqlalchemy import insert, select, update

from agente import gestao

OPERACOES = ("ler", "criar", "alterar", "apagar")
MUDANCAS = ("criar", "alterar", "apagar")

# id → (nome, descrição, operações aceitas)
DOMINIOS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "unidades": ("Unidades", "As unidades da organização: endereço, tipo, situação.", ("ler", "criar", "alterar", "apagar")),
    "atividades": ("Atividades das áreas", "Rotinas e pedidos sob demanda de cada área.", ("ler", "criar", "alterar", "apagar")),
    "indicadores": ("Indicadores e medições", "Os indicadores dos cargos, as metas e cada valor medido.", ("ler", "criar")),
    "tarefas": ("Tarefas e entregas", "As tarefas da área no CompanyOS: propostas, em execução, em revisão e concluídas.", ("ler",)),
    "equipe": ("Cargos e responsáveis", "O organograma e quem responde por cada área.", ("ler",)),
}
AUTONOMIAS = {"consulta": "Só consulta (não propõe tarefas)", "propoe": "Propõe tarefas e espera a aprovação"}
TONS = ("profissional", "objetivo", "acolhedor")
ESCOPOS = ("area", "organizacao")


class ErroDados(Exception):
    def __init__(self, status: int, detalhe: str):
        super().__init__(detalhe)
        self.status = status
        self.detalhe = detalhe


def _agora() -> datetime:
    return datetime.now(timezone.utc)


# ───────── Ficha ─────────

def ficha_padrao(agente_id: str) -> dict:
    """Sem ficha salva: lê tudo da área dele, propõe tarefas (que alguém aprova), memória da área e da organização."""
    from agente import perfis

    return {
        "agente_id": agente_id,
        "caracteristicas": {"cor": perfis.identidade(agente_id).get("cor") or "#1A63D8", "tom": "profissional", "autonomia": "propoe"},
        "memoria": {"area": True, "organizacao": True},
        "permissoes": {d: ["ler"] for d in DOMINIOS},
        "escopo": "area",
        "integracoes": [],
        "atualizado_em": None,
        "atualizado_por": None,
    }


def ficha(agente_id: str) -> dict:
    linha = gestao._uma(select(gestao._t("fichas_agente")).where(gestao._t("fichas_agente").c.agente_id == agente_id))
    base = ficha_padrao(agente_id)
    if not linha:
        return base
    return gestao._json({**base, **{k: v for k, v in linha.items() if v is not None}})


def salvar_ficha(organizacao_id: str, agente_id: str, dados: dict, quem: str) -> dict:
    """Grava a ficha (só o que vier). Confere tom, autonomia, escopo e as operações de cada tipo de dado."""
    atual = ficha(agente_id)
    novo = {k: atual[k] for k in ("caracteristicas", "memoria", "permissoes", "escopo", "integracoes")}
    if "caracteristicas" in dados:
        c = {**novo["caracteristicas"], **(dados["caracteristicas"] or {})}
        if c.get("tom") not in TONS:
            raise ErroDados(422, f"Tom inválido. Use: {', '.join(TONS)}.")
        if c.get("autonomia") not in AUTONOMIAS:
            raise ErroDados(422, "Autonomia inválida.")
        novo["caracteristicas"] = {k: c[k] for k in ("cor", "tom", "autonomia") if k in c}
    if "memoria" in dados:
        m = dados["memoria"] or {}
        novo["memoria"] = {"area": bool(m.get("area")), "organizacao": bool(m.get("organizacao"))}
    if "permissoes" in dados:
        perm = {}
        for dominio, ops in (dados["permissoes"] or {}).items():
            if dominio not in DOMINIOS:
                continue
            validas = [o for o in OPERACOES if o in (ops or []) and o in DOMINIOS[dominio][2]]
            if validas and "ler" not in validas:
                validas.insert(0, "ler")  # quem muda um dado precisa enxergá-lo
            perm[dominio] = validas
        novo["permissoes"] = perm
    if "escopo" in dados:
        if dados["escopo"] not in ESCOPOS:
            raise ErroDados(422, "Escopo inválido.")
        novo["escopo"] = dados["escopo"]
    if "integracoes" in dados:
        from agente import integracoes

        try:  # só as da Central desta organização (agente/integracoes.py)
            novo["integracoes"] = integracoes.conferir_da_ficha(organizacao_id, [str(i) for i in (dados["integracoes"] or [])][:50])
        except integracoes.ErroIntegracao as erro:
            raise ErroDados(erro.status, erro.detalhe) from erro
    tf = gestao._t("fichas_agente")
    with gestao._estado["engine"].begin() as c:
        existe = c.execute(select(tf.c.agente_id).where(tf.c.agente_id == agente_id)).first()
        if existe:
            c.execute(update(tf).where(tf.c.agente_id == agente_id).values(**novo, atualizado_por=quem, atualizado_em=_agora()))
        else:
            c.execute(insert(tf).values(agente_id=agente_id, organizacao_id=organizacao_id, atualizado_por=quem, atualizado_em=_agora(), **novo))
        gestao.auditar(c, organizacao_id=organizacao_id, origem="pessoa", quem=quem, acao="ficha", entidade="fichas_agente",
                       entidade_id=agente_id, antes={k: atual.get(k) for k in novo}, depois=novo)
    if novo["integracoes"] != atual.get("integracoes"):
        from agente import registro

        registro.ativar(agente_id)  # as ferramentas das integrações mudam: o agente é remontado agora
    return ficha(agente_id)


def pode(agente_id: str, dominio: str, operacao: str) -> bool:
    f = ficha(agente_id)
    if operacao in MUDANCAS and f["caracteristicas"].get("autonomia") == "consulta":
        return False
    return operacao in (f["permissoes"].get(dominio) or [])


def areas_do_agente(organizacao_id: str, agente_id: str) -> set[str]:
    return {str(a["area_id"]) for a in gestao.agentes_area(organizacao_id) if a["agente_id"] == agente_id}


# ───────── Leitura ─────────

def _ler_unidades(oid: str, _areas: set[str] | None, filtro: str) -> list[dict]:
    alvo = gestao._sem_acento(filtro)
    return [{k: u.get(k) for k in ("id", "nome", "tipo_id", "endereco", "numero", "bairro", "cep", "telefone", "situacao", "confirmada", "cnes")}
            for u in gestao.unidades(oid) if not alvo or alvo in gestao._sem_acento(f"{u['nome']} {u.get('bairro') or ''} {u.get('tipo_id') or ''}")][:80]


def _ler_atividades(oid: str, areas: set[str] | None, filtro: str) -> list[dict]:
    nomes = {str(s["id"]): s["nome"] for s in gestao.areas(oid)}
    alvo = gestao._sem_acento(filtro)
    return [{"id": a["id"], "area": nomes.get(str(a["area_id"])), "nome": a["nome"], "descricao": a["descricao"], "tipo": a["tipo"],
             "frequencia": a["frequencia"], "ativa": a.get("ativa", True)}
            for a in gestao.atividades(oid) if (areas is None or str(a["area_id"]) in areas)
            and (not alvo or alvo in gestao._sem_acento(a["nome"]))][:120]


def _ler_indicadores(oid: str, areas: set[str] | None, _filtro: str) -> list[dict]:
    tc, ti, tm = gestao._t("cargos"), gestao._t("indicadores_cargo"), gestao._t("medicoes")
    cargos = {str(c["id"]): c for c in gestao._linhas(select(tc).where(tc.c.organizacao_id == oid))}
    saida = []
    for i in gestao._linhas(select(ti).where(ti.c.organizacao_id == oid, ti.c.ativo.is_(True))):
        cargo = cargos.get(str(i["cargo_id"])) or {}
        if areas is not None and str(cargo.get("area_id")) not in areas:
            continue
        ultima = gestao._uma(select(tm).where(tm.c.indicador_id == i["id"]).order_by(tm.c.referencia.desc()))
        saida.append({"id": i["id"], "indicador": i["nome"], "cargo": cargo.get("nome"), "unidade": i["unidade"], "meta": i["meta"],
                      "periodicidade": i["periodicidade"], "ultima_medicao": {"referencia": ultima["referencia"], "valor": ultima["valor"]} if ultima else None})
    return saida[:120]


def _ler_tarefas(oid: str, areas: set[str] | None, filtro: str) -> list[dict]:
    from agente import trabalho

    alvo = gestao._sem_acento(filtro)
    return [{k: t.get(k) for k in ("id", "titulo", "situacao_nome", "area", "atividade", "criada_em", "entrega")}
            for t in trabalho.tarefas(oid, situacao="todas", limite=120)
            if (areas is None or t["area_id"] in areas) and (not alvo or alvo in gestao._sem_acento(t["titulo"]))][:80]


def _ler_equipe(oid: str, areas: set[str] | None, _filtro: str) -> list[dict]:
    gente = {str(p["id"]): p for p in gestao.pessoas(oid)}
    return [{"area": s["nome"], "responsavel": (gente.get(str(s.get("responsavel_id"))) or {}).get("nome")}
            for s in gestao.areas(oid) if areas is None or str(s["id"]) in areas]


_LEITURAS = {"unidades": _ler_unidades, "atividades": _ler_atividades, "indicadores": _ler_indicadores,
             "tarefas": _ler_tarefas, "equipe": _ler_equipe}


def ler(organizacao_id: str, agente_id: str, dominio: str, filtro: str = "") -> list[dict]:
    if dominio not in DOMINIOS:
        raise ErroDados(422, f"Tipo de dado desconhecido. Use: {', '.join(DOMINIOS)}.")
    if not pode(agente_id, dominio, "ler"):
        raise ErroDados(403, f"A ficha deste agente não libera ler {DOMINIOS[dominio][0].lower()}.")
    f = ficha(agente_id)
    areas = None if f["escopo"] == "organizacao" else areas_do_agente(organizacao_id, agente_id)
    return gestao._json(_LEITURAS[dominio](organizacao_id, areas, filtro or ""))
