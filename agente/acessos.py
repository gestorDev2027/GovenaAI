"""Acessos de cada prefeitura: o dono, os membros, os cargos com as permissões e os convites.

- Dono: quem cadastrou a prefeitura (membros.papel = "dono"). Pode tudo dentro dela e não perde o acesso.
- Membro: convidado pelo dono (ou por quem tem "gerenciar_equipe"). O que ele pode fazer vem do CARGO que
  ocupa (cargos.permissoes): aprovar e devolver entregas, gerenciar os fluxos dos agentes, criar agentes...
- Convite: link com validade de 7 dias; a pessoa define a própria senha. Só o hash do token fica no banco.

Isto é separado das permissões da PLATAFORMA (agente/usuarios.py: a equipe GestorGov, dona do servidor): o dono
de uma prefeitura não enxerga as outras.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import insert, select, update

from agente import gestao

PERMISSOES: dict[str, tuple[str, str]] = {
    "ver_painel": ("Ver o painel", "Cidade, organograma e os indicadores da prefeitura."),
    "aprovar_entregas": ("Aprovar e devolver entregas", "Aprovar ou devolver o que os agentes entregam (documentos, relatórios, tarefas)."),
    "gerenciar_fluxos": ("Gerenciar os fluxos dos agentes", "Rotinas e atividades dos agentes: o que fazem, quando e quem aprova."),
    "criar_agentes": ("Criar e configurar agentes", "Criar agentes de IA e ajustar as instruções e o conhecimento deles."),
    "definir_metas": ("Definir metas", "As metas dos indicadores de cada cargo."),
    "registrar_dados": ("Registrar dados", "Medições, planilhas e documentos de referência dos setores."),
    "gerenciar_unidades": ("Cadastrar unidades", "Cadastrar e conferir as unidades de saúde: endereço, ponto no mapa e fotos."),
    "gerenciar_cargos": ("Gerenciar cargos", "Criar cargos, montar a hierarquia e definir as permissões de cada um."),
    "gerenciar_equipe": ("Gerenciar a equipe", "Convidar pessoas, definir o cargo de cada uma e bloquear acessos."),
    "ver_auditoria": ("Ver a auditoria", "Quem fez o quê e quando, com o antes e o depois."),
}
TODAS = tuple(PERMISSOES)

# Permissões sugeridas ao montar o organograma padrão (o dono muda depois, cargo por cargo).
PADRAO_POR_NIVEL: dict[str, tuple[str, ...]] = {
    "direcao": ("ver_painel", "aprovar_entregas", "gerenciar_fluxos", "criar_agentes", "definir_metas", "registrar_dados",
                "gerenciar_unidades", "ver_auditoria"),
    "superintendencia": ("ver_painel", "aprovar_entregas", "gerenciar_fluxos", "definir_metas", "registrar_dados",
                         "gerenciar_unidades"),
    "coordenacao": ("ver_painel", "aprovar_entregas", "registrar_dados"),
    "unidade": ("ver_painel", "aprovar_entregas", "registrar_dados", "gerenciar_unidades"),
    "controle": ("ver_painel", "ver_auditoria"),
}
NIVEIS = tuple(PADRAO_POR_NIVEL)
VALIDADE_CONVITE = timedelta(days=7)


class ErroAcesso(Exception):
    def __init__(self, status: int, detalhe: str):
        super().__init__(detalhe)
        self.status = status
        self.detalhe = detalhe


def _agora() -> datetime:
    return datetime.now(timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _validas(permissoes) -> list[str]:
    return [p for p in TODAS if p in set(permissoes or [])]


# ───────── Quem é quem ─────────

def contexto(email: str) -> dict | None:
    """A prefeitura de quem está logado e o que ele pode fazer nela. None se não é membro ativo de nenhuma."""
    if not gestao.disponivel() or not email:
        return None
    tm, tc = gestao._t("membros"), gestao._t("cargos")
    with gestao._estado["engine"].connect() as c:
        membro = c.execute(select(tm).where(tm.c.email == email.strip().lower(), tm.c.ativo.is_(True))
                           .order_by(tm.c.criado_em)).mappings().first()
        if not membro:
            return None
        cargo = (c.execute(select(tc).where(tc.c.id == membro["cargo_id"])).mappings().first()
                 if membro["cargo_id"] else None)
    mun = gestao.municipio(str(membro["municipio_id"])) or {}
    dono = membro["papel"] == "dono"
    return {
        "municipio_id": str(membro["municipio_id"]), "municipio": mun.get("nome"), "uf": mun.get("uf"),
        "situacao_municipio": mun.get("situacao"), "papel": membro["papel"],
        "cargo_id": str(cargo["id"]) if cargo else None, "cargo": cargo["nome"] if cargo else None,
        "permissoes": list(TODAS) if dono else _validas(cargo["permissoes"] if cargo else []),
    }


def pode(email: str, permissao: str) -> dict:
    """O contexto, se a pessoa tem a permissão na prefeitura dela; senão, ErroAcesso com o motivo."""
    ctx = contexto(email)
    if not ctx:
        raise ErroAcesso(403, "Você ainda não faz parte de nenhuma prefeitura no GestorGov.")
    if permissao not in ctx["permissoes"]:
        raise ErroAcesso(403, f"Seu cargo não tem a permissão \"{PERMISSOES[permissao][0]}\". Fale com o dono da prefeitura.")
    return ctx


# ───────── Cargos ─────────

def cargos(municipio_id: str) -> list[dict]:
    tc, tm = gestao._t("cargos"), gestao._t("membros")
    lista = gestao._linhas(select(tc).where(tc.c.municipio_id == municipio_id).order_by(tc.c.ordem, tc.c.nome))
    ocupantes: dict[str, list[dict]] = {}
    for m in gestao._linhas(select(tm).where(tm.c.municipio_id == municipio_id, tm.c.cargo_id.is_not(None))):
        ocupantes.setdefault(str(m["cargo_id"]), []).append({"email": m["email"], "nome": m["nome"], "ativo": m["ativo"]})
    return [gestao._json({**c, "permissoes": _validas(c["permissoes"]), "ocupantes": ocupantes.get(str(c["id"]), [])})
            for c in lista]


def montar_organograma_padrao(municipio_id: str, quem: str) -> int:
    """Cria os cargos do catálogo (o organograma do documento), com a hierarquia, a sala (setor do mesmo tipo,
    se houver), os indicadores e as permissões sugeridas. Não repete o que já existe. Devolve quantos criou."""
    tc, ti = gestao._t("cargos"), gestao._t("indicadores_cargo")
    modelos = gestao.modelos_cargo()
    indicadores = gestao.modelos_indicador()
    setor_do_tipo = {s["tipo_id"]: str(s["id"]) for s in gestao.setores(municipio_id) if s.get("tipo_id")}
    criados = 0
    with gestao._estado["engine"].begin() as c:
        antigos = c.execute(select(tc.c.id, tc.c.modelo_id, tc.c.setor_id).where(
            tc.c.municipio_id == municipio_id, tc.c.modelo_id.is_not(None))).mappings().all()
        existentes = {r["modelo_id"]: str(r["id"]) for r in antigos}
        # Cargo montado antes de o setor existir: ganha a sala agora.
        tipo_do_modelo = {m["id"]: m["tipo_setor_id"] for m in modelos}
        for r in antigos:
            setor = setor_do_tipo.get(tipo_do_modelo.get(r["modelo_id"]))
            if not r["setor_id"] and setor:
                c.execute(update(tc).where(tc.c.id == r["id"]).values(setor_id=setor))
        for m in modelos:  # o catálogo vem em ordem: o superior sempre antes
            if m["id"] in existentes:
                continue
            cid = gestao._id()
            permissoes = list(TODAS) if m["id"] == "secretario" else list(PADRAO_POR_NIVEL.get(m["nivel"], ("ver_painel",)))
            c.execute(insert(tc).values(
                id=cid, municipio_id=municipio_id, modelo_id=m["id"], nome=m["nome"], nivel=m["nivel"],
                superior_id=existentes.get(m["superior_id"]) if m["superior_id"] else None,
                setor_id=setor_do_tipo.get(m["tipo_setor_id"]), atribuicoes=m["atribuicoes"], permissoes=permissoes,
                ordem=m["ordem"]))
            existentes[m["id"]] = cid
            criados += 1
            for i in (x for x in indicadores if x["modelo_cargo_id"] == m["id"]):
                c.execute(insert(ti).values(
                    id=gestao._id(), municipio_id=municipio_id, cargo_id=cid, modelo_id=i["id"], nome=i["nome"],
                    fonte=i["fonte"], periodicidade=i["periodicidade"], unidade=i["unidade"], sentido=i["sentido"]))
        gestao.auditar(c, municipio_id=municipio_id, origem="pessoa", quem=quem, acao="montar_organograma",
                       entidade="cargos", depois={"criados": criados})
    return criados


def criar_cargo(municipio_id: str, dados: dict, quem: str) -> dict:
    tc = gestao._t("cargos")
    nivel = dados.get("nivel") or "coordenacao"
    if nivel not in NIVEIS:
        raise ErroAcesso(422, "Nível inválido.")
    _conferir_superior(municipio_id, dados.get("superior_id"))
    cid = gestao._id()
    valores = {"nome": dados["nome"].strip(), "nivel": nivel, "superior_id": dados.get("superior_id") or None,
               "setor_id": dados.get("setor_id") or None,
               "atribuicoes": (dados.get("atribuicoes") or "").strip() or None,
               "permissoes": _validas(dados.get("permissoes", PADRAO_POR_NIVEL[nivel]))}
    with gestao._estado["engine"].begin() as c:
        c.execute(insert(tc).values(id=cid, municipio_id=municipio_id, ordem=999, **valores))
        gestao.auditar(c, municipio_id=municipio_id, origem="pessoa", quem=quem, acao="criar", entidade="cargos",
                       entidade_id=cid, depois=valores)
    return next(x for x in cargos(municipio_id) if x["id"] == cid)


def alterar_cargo(municipio_id: str, cargo_id: str, dados: dict, quem: str) -> dict:
    tc = gestao._t("cargos")
    atual = gestao._uma(select(tc).where(tc.c.id == cargo_id, tc.c.municipio_id == municipio_id))
    if not atual:
        raise ErroAcesso(404, "Cargo não encontrado.")
    valores = {}
    if "nome" in dados and dados["nome"]:
        valores["nome"] = dados["nome"].strip()
    if "atribuicoes" in dados:
        valores["atribuicoes"] = (dados["atribuicoes"] or "").strip() or None
    if "permissoes" in dados:
        valores["permissoes"] = _validas(dados["permissoes"])
    if "ativo" in dados:
        valores["ativo"] = bool(dados["ativo"])
    if "superior_id" in dados:
        if dados["superior_id"] == cargo_id:
            raise ErroAcesso(422, "Um cargo não pode ser superior de si mesmo.")
        _conferir_superior(municipio_id, dados["superior_id"])
        valores["superior_id"] = dados["superior_id"] or None
    with gestao._estado["engine"].begin() as c:
        c.execute(update(tc).where(tc.c.id == cargo_id).values(**valores))
        gestao.auditar(c, municipio_id=municipio_id, origem="pessoa", quem=quem, acao="alterar", entidade="cargos",
                       entidade_id=cargo_id, antes={k: atual.get(k) for k in valores}, depois=valores)
    return next(x for x in cargos(municipio_id) if x["id"] == cargo_id)


def _conferir_superior(municipio_id: str, superior_id: str | None) -> None:
    if not superior_id:
        return
    tc = gestao._t("cargos")
    if not gestao._uma(select(tc.c.id).where(tc.c.id == superior_id, tc.c.municipio_id == municipio_id)):
        raise ErroAcesso(422, "O cargo superior não existe nesta prefeitura.")


# ───────── Equipe e convites ─────────

def equipe(municipio_id: str) -> dict:
    tm, tv, tc = gestao._t("membros"), gestao._t("convites"), gestao._t("cargos")
    nomes = {str(c["id"]): c["nome"] for c in gestao._linhas(select(tc.c.id, tc.c.nome).where(tc.c.municipio_id == municipio_id))}
    membros = [gestao._json({**m, "cargo": nomes.get(str(m["cargo_id"])) if m["cargo_id"] else None})
               for m in gestao._linhas(select(tm).where(tm.c.municipio_id == municipio_id).order_by(tm.c.criado_em))]
    agora = _agora()
    convites = [gestao._json({k: v for k, v in x.items() if k != "token_hash"}
                             | {"cargo": nomes.get(str(x["cargo_id"])) if x["cargo_id"] else None, "aprovado": aprovado(x)})
                for x in gestao._linhas(select(tv).where(tv.c.municipio_id == municipio_id, tv.c.aceito_em.is_(None),
                                                         tv.c.cancelado_em.is_(None)).order_by(tv.c.criado_em.desc()))
                if _aware(x["expira_em"]) > agora]
    return {"membros": membros, "convites": convites}


def _aware(momento: datetime) -> datetime:
    return momento if momento.tzinfo else momento.replace(tzinfo=timezone.utc)  # o SQLite devolve sem fuso


def aprovado(convite: dict) -> bool:
    """Convite do painel nasce aprovado; o do Assistente de Implantação espera o dono aprovar."""
    return (convite.get("origem") or "painel") != "assistente" or bool(convite.get("aprovado_em"))


def convidar(municipio_id: str, email: str, nome: str, cargo_id: str | None, quem: str, origem: str = "painel") -> str:
    """Cria o convite e devolve o token (vai no link; não fica guardado). Com origem "assistente", o convite espera a
    aprovação do dono (aprovar_convite gera o link válido)."""
    email = email.strip().lower()
    tm, tv = gestao._t("membros"), gestao._t("convites")
    if gestao._uma(select(tm.c.id).where(tm.c.municipio_id == municipio_id, tm.c.email == email)):
        raise ErroAcesso(409, "Esta pessoa já faz parte da equipe.")
    if cargo_id:
        _conferir_superior(municipio_id, cargo_id)  # o cargo precisa ser desta prefeitura
    token = secrets.token_urlsafe(32)
    with gestao._estado["engine"].begin() as c:
        c.execute(update(tv).where(tv.c.municipio_id == municipio_id, tv.c.email == email, tv.c.aceito_em.is_(None))
                  .values(cancelado_em=_agora()))  # o convite novo substitui o antigo
        do_painel = origem != "assistente"
        c.execute(insert(tv).values(id=gestao._id(), municipio_id=municipio_id, email=email, nome=nome.strip() or None,
                                    cargo_id=cargo_id or None, token_hash=_hash(token), criado_por=quem,
                                    expira_em=_agora() + VALIDADE_CONVITE, origem=origem,
                                    aprovado_em=_agora() if do_painel else None, aprovado_por=quem if do_painel else None))
        gestao.auditar(c, municipio_id=municipio_id, origem="pessoa", quem=quem, acao="convidar", entidade="convites",
                       depois={"email": email, "cargo_id": cargo_id})
    return token


def aprovar_convite(municipio_id: str, convite_id: str, quem: str) -> str:
    """O dono aprova o acesso que o assistente cadastrou: o convite vale por 7 dias a partir de agora. Devolve o token
    novo (o link); o anterior, que ninguém viu, deixa de valer."""
    tv = gestao._t("convites")
    convite = gestao._uma(select(tv).where(tv.c.id == convite_id, tv.c.municipio_id == municipio_id,
                                           tv.c.aceito_em.is_(None), tv.c.cancelado_em.is_(None)))
    if not convite:
        raise ErroAcesso(404, "Convite não encontrado.")
    token = secrets.token_urlsafe(32)
    with gestao._estado["engine"].begin() as c:
        c.execute(update(tv).where(tv.c.id == convite_id).values(
            token_hash=_hash(token), aprovado_em=_agora(), aprovado_por=quem, expira_em=_agora() + VALIDADE_CONVITE))
        gestao.auditar(c, municipio_id=municipio_id, origem="pessoa", quem=quem, acao="aprovar", entidade="convites",
                       entidade_id=convite_id, depois={"email": convite["email"]})
    return token


def cancelar_convite(municipio_id: str, convite_id: str, quem: str) -> None:
    tv = gestao._t("convites")
    with gestao._estado["engine"].begin() as c:
        feito = c.execute(update(tv).where(tv.c.id == convite_id, tv.c.municipio_id == municipio_id, tv.c.aceito_em.is_(None))
                          .values(cancelado_em=_agora()))
        if not feito.rowcount:
            raise ErroAcesso(404, "Convite não encontrado.")
        gestao.auditar(c, municipio_id=municipio_id, origem="pessoa", quem=quem, acao="cancelar", entidade="convites",
                       entidade_id=convite_id)


def ler_convite(token: str) -> dict:
    tv = gestao._t("convites")
    convite = gestao._uma(select(tv).where(tv.c.token_hash == _hash(token)))
    if not convite or convite["aceito_em"] or convite["cancelado_em"] or _aware(convite["expira_em"]) <= _agora():
        raise ErroAcesso(404, "Convite inválido, vencido ou já usado. Peça um novo ao dono da prefeitura.")
    if not aprovado(convite):
        raise ErroAcesso(403, "Este acesso ainda espera a aprovação do dono da prefeitura no painel.")
    mun = gestao.municipio(str(convite["municipio_id"])) or {}
    cargo = next((c for c in cargos(str(convite["municipio_id"])) if c["id"] == str(convite["cargo_id"])), None)
    return {"id": str(convite["id"]), "municipio_id": str(convite["municipio_id"]), "email": convite["email"],
            "nome": convite["nome"] or "", "municipio": f"{mun.get('nome', '')}-{mun.get('uf', '')}",
            "cargo": cargo["nome"] if cargo else None, "cargo_id": str(convite["cargo_id"]) if convite["cargo_id"] else None}


def aceitar_convite(token: str, nome: str) -> dict:
    """Marca o convite como aceito e põe a pessoa na equipe. A conta (senha) é criada antes, por quem chama."""
    convite = ler_convite(token)
    tv = gestao._t("convites")
    gestao.adicionar_membro(convite["municipio_id"], convite["email"], "membro", convite["email"], nome=nome,
                            cargo_id=convite["cargo_id"])
    with gestao._estado["engine"].begin() as c:
        c.execute(update(tv).where(tv.c.id == convite["id"]).values(aceito_em=_agora()))
    return convite


def alterar_membro(municipio_id: str, email: str, dados: dict, quem: str) -> None:
    tm = gestao._t("membros")
    email = email.strip().lower()
    atual = gestao._uma(select(tm).where(tm.c.municipio_id == municipio_id, tm.c.email == email))
    if not atual:
        raise ErroAcesso(404, "Pessoa não encontrada na equipe.")
    if atual["papel"] == "dono":
        raise ErroAcesso(403, "O dono da prefeitura não pode ser alterado nem bloqueado.")
    valores = {}
    if "cargo_id" in dados:
        if dados["cargo_id"]:
            _conferir_superior(municipio_id, dados["cargo_id"])
        valores["cargo_id"] = dados["cargo_id"] or None
    if "ativo" in dados:
        valores["ativo"] = bool(dados["ativo"])
    with gestao._estado["engine"].begin() as c:
        c.execute(update(tm).where(tm.c.id == atual["id"]).values(**valores))
        gestao.auditar(c, municipio_id=municipio_id, origem="pessoa", quem=quem, acao="alterar", entidade="membros",
                       entidade_id=str(atual["id"]), antes={k: atual.get(k) for k in valores}, depois=valores)


# ───────── Link da implantação: um colaborador da secretaria continua a implantação ─────────

VALIDADE_LINK = timedelta(days=7)
MAX_FALHAS_CODIGO = 5


def criar_link_implantacao(municipio_id: str, quem: str) -> tuple[str, str]:
    """Um link novo (token) e o código de 6 dígitos. Os dois só existem agora; no banco, os hashes."""
    token = secrets.token_urlsafe(24)
    codigo = f"{secrets.randbelow(1_000_000):06d}"
    tl = gestao._t("implantacao_links")
    with gestao._estado["engine"].begin() as c:
        c.execute(insert(tl).values(id=gestao._id(), municipio_id=municipio_id, token_hash=_hash(token),
                                    codigo_hash=_hash(f"{token}:{codigo}"), criado_por=quem,
                                    expira_em=_agora() + VALIDADE_LINK, usos=0, falhas=0))
        gestao.auditar(c, municipio_id=municipio_id, origem="pessoa", quem=quem, acao="compartilhar", entidade="implantacao_links")
    return token, codigo


def _link(token: str) -> dict:
    tl = gestao._t("implantacao_links")
    link = gestao._uma(select(tl).where(tl.c.token_hash == _hash(token)))
    if not link or link["cancelado_em"] or _aware(link["expira_em"]) <= _agora():
        raise ErroAcesso(404, "Link inválido ou vencido. Peça um novo a quem está fazendo a implantação.")
    return link


def ler_link_implantacao(token: str) -> dict:
    link = _link(token)
    mun = gestao.municipio(str(link["municipio_id"])) or {}
    return {"municipio": f"{mun.get('nome', '')}-{mun.get('uf', '')}", "convidado_por": link["criado_por"]}


def entrar_pelo_link(token: str, codigo: str, email: str, nome: str) -> dict:
    """Confere o código e põe a pessoa na prefeitura (membro) para continuar a implantação. Cinco códigos errados
    cancelam o link. A conta (senha) é criada antes, por quem chama."""
    link = _link(token)
    tl = gestao._t("implantacao_links")
    certo = secrets.compare_digest(_hash(f"{token}:{(codigo or '').strip()}"), link["codigo_hash"])
    with gestao._estado["engine"].begin() as c:
        if not certo:
            falhas = (link["falhas"] or 0) + 1
            c.execute(update(tl).where(tl.c.id == link["id"]).values(
                falhas=falhas, cancelado_em=_agora() if falhas >= MAX_FALHAS_CODIGO else None))
            raise ErroAcesso(403, "Código de segurança errado." + (" O link foi cancelado." if falhas >= MAX_FALHAS_CODIGO else ""))
        c.execute(update(tl).where(tl.c.id == link["id"]).values(usos=(link["usos"] or 0) + 1, falhas=0))
    municipio_id = str(link["municipio_id"])
    email = email.strip().lower()
    tm = gestao._t("membros")
    if not gestao._uma(select(tm.c.id).where(tm.c.municipio_id == municipio_id, tm.c.email == email)):
        gestao.adicionar_membro(municipio_id, email, "membro", link["criado_por"], nome=nome)
    return {"municipio_id": municipio_id, **ler_link_implantacao(token)}
