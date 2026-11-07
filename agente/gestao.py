"""O cadastro de cada prefeitura no GestorGov: município, secretaria, setores, unidades, servidores,
atividades, o organograma (cargos, indicadores, entregas, pendências, status e alertas), os membros de
cada prefeitura e a auditoria.

As tabelas são criadas pelas migrations em supabase/gestorgov/ (não pelo servidor): aqui elas são só
descritas, com as mesmas colunas, para o SQLAlchemy ler e gravar. Sem DATABASE_URL (teste local), o
servidor cria as mesmas tabelas num SQLite, sem as regras de segurança do Postgres.

Também ficam aqui as consultas a fontes públicas usadas no onboarding: ViaCEP (CEP → município),
IBGE (nome → código do município), Nominatim/OpenStreetMap (endereço → coordenadas) e os dados
abertos do CNES (unidades de saúde do município).
"""

import json
import os
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import (ARRAY, JSON, BigInteger, Boolean, Column, Date, DateTime, ForeignKey, Integer, MetaData, Numeric, SmallInteger,
                        String, Table, Text, insert, select, update)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.engine import Engine

_estado: dict[str, Any] = {}

USER_AGENT = "GestorGov/1.0 (gestao publica)"
TEMPO = httpx.Timeout(15.0)


def _agora() -> datetime:
    return datetime.now(timezone.utc)


def _id() -> str:
    return str(uuid.uuid4())


# ───────────────────────── Tabelas (as mesmas das migrations) ─────────────────────────

def _tabelas(schema: str | None) -> dict[str, Table]:
    m = MetaData(schema=schema)
    fk = (lambda t: f"{schema}.{t}") if schema else (lambda t: t)
    tipo_id = String(36).with_variant(PG_UUID(as_uuid=False), "postgresql")
    uid = lambda nome, *a, **kw: Column(nome, tipo_id, *a, **kw)  # uuid no Postgres; texto no SQLite
    criado = lambda: Column("criado_em", DateTime(timezone=True), default=_agora)
    atualizado = lambda: Column("atualizado_em", DateTime(timezone=True), default=_agora, onupdate=_agora)
    t = {}
    t["tipos_setor"] = Table("tipos_setor", m,
        Column("id", String(40), primary_key=True), Column("nome", Text, nullable=False), Column("descricao", Text),
        Column("icone", Text), Column("ordem", SmallInteger, default=0), Column("padrao", Boolean, default=True))
    t["tipos_unidade"] = Table("tipos_unidade", m,
        Column("id", String(40), primary_key=True), Column("nome", Text, nullable=False),
        Column("codigos_cnes", JSON().with_variant(ARRAY(Text), "postgresql")), Column("icone", Text), Column("cor", Text), Column("ordem", SmallInteger, default=0))
    t["municipios"] = Table("municipios", m,
        uid("id", primary_key=True, default=_id), Column("codigo_ibge", String(7), nullable=False, unique=True),
        Column("nome", Text, nullable=False), Column("uf", String(2), nullable=False), Column("cep", String(8)),
        Column("endereco_sede", Text), Column("latitude", Numeric(9, 6)), Column("longitude", Numeric(9, 6)),
        Column("zoom_mapa", SmallInteger, default=12), Column("populacao", Integer),
        Column("situacao", Text, default="onboarding"), Column("plano", Text), criado(), atualizado(),
        Column("criado_por", Text))
    t["secretarias"] = Table("secretarias", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", ForeignKey(fk("municipios.id")), nullable=False),
        Column("area", Text, default="saude"), Column("nome", Text, default="Secretaria Municipal de Saúde"),
        Column("sigla", Text), Column("cnpj", String(14)), Column("endereco", Text), Column("cep", String(8)),
        Column("latitude", Numeric(9, 6)), Column("longitude", Numeric(9, 6)), Column("andares", SmallInteger, default=3),
        Column("secretario_nome", Text), Column("secretario_email", Text), criado(), atualizado())
    t["setores"] = Table("setores", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", ForeignKey(fk("municipios.id")), nullable=False),
        uid("secretaria_id", ForeignKey(fk("secretarias.id")), nullable=False),
        Column("tipo_id", String(40), ForeignKey(fk("tipos_setor.id"))), Column("nome", Text, nullable=False),
        Column("descricao", Text), Column("andar", SmallInteger, default=0), Column("posicao", SmallInteger, default=0),
        Column("ativo", Boolean, default=True), uid("responsavel_id"), criado(), atualizado())
    t["unidades"] = Table("unidades", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", ForeignKey(fk("municipios.id")), nullable=False),
        uid("secretaria_id"), Column("tipo_id", String(40), ForeignKey(fk("tipos_unidade.id")), default="outro"),
        Column("cnes", String(7)), Column("nome", Text, nullable=False), Column("nome_fantasia", Text),
        Column("endereco", Text), Column("bairro", Text), Column("cep", String(8)),
        Column("latitude", Numeric(9, 6)), Column("longitude", Numeric(9, 6)), Column("telefone", Text),
        Column("horario", JSON), Column("gestao", Text), uid("responsavel_id"), Column("situacao", Text, default="ativa"),
        Column("origem", Text, default="manual"), Column("dados_cnes", JSON), Column("confirmada", Boolean, default=False),
        criado(), atualizado())
    t["servidores"] = Table("servidores", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", ForeignKey(fk("municipios.id")), nullable=False),
        Column("email", Text, nullable=False), Column("nome", Text, nullable=False), Column("cargo", Text),
        Column("matricula", Text), uid("setor_id"), uid("unidade_id"), Column("papel", Text, default="servidor"),
        Column("aprova_tarefas", Boolean, default=False), Column("ativo", Boolean, default=True), criado(), atualizado())
    t["agentes_setor"] = Table("agentes_setor", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", nullable=False), uid("setor_id", nullable=False),
        Column("agente_id", Text, nullable=False), Column("funcao", Text), Column("mesa", SmallInteger, default=0),
        Column("ativo", Boolean, default=True), criado(), atualizado())
    t["onboardings"] = Table("onboardings", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id"), Column("session_id", Text),
        Column("etapa", Text, default="municipio"), Column("estado", JSON, default=dict),
        Column("iniciado_por", Text, nullable=False), Column("iniciado_em", DateTime(timezone=True), default=_agora),
        atualizado(), Column("concluido_em", DateTime(timezone=True)))
    t["auditoria"] = Table("auditoria", m,
        Column("id", BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True),
        uid("municipio_id"), Column("em", DateTime(timezone=True), default=_agora), Column("origem", Text, nullable=False),
        Column("quem", Text, nullable=False), Column("acao", Text, nullable=False), Column("entidade", Text, nullable=False),
        Column("entidade_id", Text), Column("antes", JSON), Column("depois", JSON), Column("session_id", Text),
        Column("aprovado_por", Text))
    t["modelos_atividade"] = Table("modelos_atividade", m,
        Column("id", String(60), primary_key=True), Column("tipo_setor_id", String(40), nullable=False),
        Column("nome", Text, nullable=False), Column("descricao", Text, nullable=False), Column("tipo", Text, nullable=False),
        Column("frequencia", Text, default="sob_demanda"), Column("cron", Text), Column("entregavel", Text),
        Column("padrao", Boolean, default=True), Column("ordem", SmallInteger, default=0))
    t["atividades_setor"] = Table("atividades_setor", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", nullable=False), uid("setor_id", nullable=False),
        Column("modelo_id", String(60)), Column("nome", Text, nullable=False), Column("descricao", Text, nullable=False),
        Column("tipo", Text, nullable=False), Column("frequencia", Text, default="sob_demanda"), Column("cron", Text),
        Column("entregavel", Text), Column("agente_id", Text), uid("aprovador_id"), Column("rotina_id", Text),
        Column("ativa", Boolean, default=True), Column("cargo_id", tipo_id), criado(), atualizado())

    # ── Organograma (migration 20261107_gestorgov_organograma.sql) ──
    t["membros"] = Table("membros", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", nullable=False), Column("email", Text, nullable=False),
        Column("nome", Text), Column("papel", Text, default="membro"), Column("ativo", Boolean, default=True), criado(),
        Column("criado_por", Text), uid("cargo_id"))
    t["convites"] = Table("convites", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", nullable=False), Column("email", Text, nullable=False),
        Column("nome", Text), uid("cargo_id"), Column("token_hash", Text, nullable=False, unique=True),
        Column("criado_por", Text, nullable=False), criado(), Column("expira_em", DateTime(timezone=True), nullable=False),
        Column("aceito_em", DateTime(timezone=True)), Column("cancelado_em", DateTime(timezone=True)))
    t["modelos_cargo"] = Table("modelos_cargo", m,
        Column("id", Text, primary_key=True), Column("nome", Text, nullable=False), Column("nivel", Text, nullable=False),
        Column("tipo_setor_id", Text), Column("superior_id", Text), Column("atribuicoes", Text, nullable=False),
        Column("rotinas", JSON, default=list), Column("entregas", JSON, default=list), Column("padrao", Boolean, default=True),
        Column("ordem", SmallInteger, default=0))
    t["modelos_indicador"] = Table("modelos_indicador", m,
        Column("id", Text, primary_key=True), Column("modelo_cargo_id", Text, nullable=False), Column("nome", Text, nullable=False),
        Column("fonte", Text, nullable=False), Column("periodicidade", Text, nullable=False), Column("unidade", Text, nullable=False),
        Column("sentido", Text, nullable=False), Column("ordem", SmallInteger, default=0))
    t["cargos"] = Table("cargos", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", nullable=False), Column("modelo_id", Text),
        Column("nome", Text, nullable=False), Column("nivel", Text, nullable=False), uid("superior_id"), uid("setor_id"),
        uid("unidade_id"), uid("responsavel_id"), Column("agente_id", Text), Column("atribuicoes", Text),
        Column("permissoes", JSON, default=list), Column("ativo", Boolean, default=True), Column("ordem", SmallInteger, default=0),
        criado(), atualizado())
    t["indicadores_cargo"] = Table("indicadores_cargo", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", nullable=False), uid("cargo_id", nullable=False),
        Column("modelo_id", Text), Column("nome", Text, nullable=False), Column("fonte", Text, nullable=False),
        Column("periodicidade", Text, nullable=False), Column("unidade", Text, nullable=False),
        Column("sentido", Text, nullable=False), Column("meta", Numeric), Column("meta_definida_por", Text),
        Column("ativo", Boolean, default=True), criado())
    t["medicoes"] = Table("medicoes", m,
        Column("id", BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True),
        uid("municipio_id", nullable=False), uid("indicador_id", nullable=False), Column("referencia", Date, nullable=False),
        Column("valor", Numeric, nullable=False), Column("fonte", Text), Column("registrado_por", Text, nullable=False),
        Column("registrado_em", DateTime(timezone=True), default=_agora))
    t["entregas"] = Table("entregas", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", nullable=False), uid("cargo_id", nullable=False),
        Column("titulo", Text, nullable=False), Column("descricao", Text), Column("prazo", DateTime(timezone=True)),
        Column("situacao", Text, default="prevista"), Column("documento", Text), Column("produzida_por", Text),
        Column("aprovada_por", Text), Column("aprovada_em", DateTime(timezone=True)), criado(), atualizado())
    t["pendencias"] = Table("pendencias", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", nullable=False), uid("cargo_id", nullable=False),
        Column("descricao", Text, nullable=False), Column("motivo", Text), Column("desde", DateTime(timezone=True), default=_agora),
        Column("resolvida_em", DateTime(timezone=True)), Column("resolvida_por", Text))
    t["status_cargo"] = Table("status_cargo", m,
        uid("cargo_id", primary_key=True), uid("municipio_id", nullable=False), Column("situacao", Text, default="aguardando"),
        Column("tarefa", Text), Column("atualizado_em", DateTime(timezone=True), default=_agora, onupdate=_agora),
        Column("atualizado_por", Text))
    t["alertas_cargo"] = Table("alertas_cargo", m,
        uid("id", primary_key=True, default=_id), uid("municipio_id", nullable=False), uid("cargo_id", nullable=False),
        uid("destino_id"), Column("tipo", Text, nullable=False), Column("titulo", Text, nullable=False), Column("detalhe", Text),
        Column("situacao", Text, default="aberto"), uid("escalado_de"), criado(),
        Column("resolvido_em", DateTime(timezone=True)), Column("resolvido_por", Text))
    return t


PASTA_MIGRATIONS = Path(__file__).resolve().parent.parent / "supabase" / "gestorgov"


def comandos_de_catalogo() -> list[str]:
    """Os INSERTs dos catálogos (tipos de setor e de unidade, atividades, cargos e indicadores) das migrations,
    em SQL que o SQLite aceita. Assim o teste local tem as mesmas listas do Supabase, sem copiar os dados para o código."""
    comandos = []
    for arquivo in sorted(PASTA_MIGRATIONS.glob("*.sql")):
        texto = re.sub(r"--[^\n]*", "", arquivo.read_text(encoding="utf-8"))
        for bloco in re.findall(r"insert into gestorgov\.(?:tipos_setor|tipos_unidade|modelos_atividade|modelos_cargo|modelos_indicador)\b.*?;\s*$",
                                texto, flags=re.S | re.M):
            bloco = bloco.replace("gestorgov.", "")
            # text[] do Postgres ('{01,02}') vira JSON no SQLite ('["01","02"]').
            bloco = re.sub(r"'\{([0-9,]*)\}'", lambda m: "'" + json.dumps([c for c in m.group(1).split(",") if c]) + "'", bloco)
            comandos.append(bloco)
    return comandos


def iniciar(engine: Engine, schema: str | None) -> None:
    """Descreve as tabelas. No Postgres elas vêm das migrations; no SQLite local, são criadas aqui, com os catálogos
    (os INSERTs são upserts: rodam a cada início e trazem o catálogo novo de uma migration nova)."""
    tabelas = _tabelas(schema)
    if engine.dialect.name == "sqlite":
        metadata = next(iter(tabelas.values())).metadata
        metadata.create_all(engine)
        with engine.begin() as c:
            # create_all não altera tabela que já existe: as colunas novas das migrations entram aqui.
            for tabela in tabelas.values():
                existentes = {linha[1] for linha in c.exec_driver_sql(f"pragma table_info({tabela.name})")}
                for coluna in tabela.columns:
                    if coluna.name not in existentes:
                        tipo = coluna.type.compile(dialect=engine.dialect)
                        c.exec_driver_sql(f"alter table {tabela.name} add column {coluna.name} {tipo}")
            c.exec_driver_sql("update membros set papel = 'dono' where papel = 'secretario'")  # nome antigo
            for comando in comandos_de_catalogo():
                c.exec_driver_sql(comando)
    _estado.update(engine=engine, schema=schema, t=tabelas)


def disponivel() -> bool:
    return "engine" in _estado


def _t(nome: str) -> Table:
    return _estado["t"][nome]


def _linhas(consulta) -> list[dict]:
    with _estado["engine"].connect() as c:
        return [dict(r) for r in c.execute(consulta).mappings().all()]


def _uma(consulta) -> dict | None:
    with _estado["engine"].connect() as c:
        r = c.execute(consulta).mappings().first()
    return dict(r) if r else None


def _json(valor):
    """Para a auditoria: datas e decimais viram texto."""
    if isinstance(valor, dict):
        return {k: _json(v) for k, v in valor.items()}
    if isinstance(valor, (list, tuple)):
        return [_json(v) for v in valor]
    if isinstance(valor, datetime):
        return valor.isoformat()
    if valor is not None and not isinstance(valor, (str, int, float, bool)):
        return str(valor)
    return valor


def auditar(conexao, *, municipio_id: str | None, origem: str, quem: str, acao: str, entidade: str,
            entidade_id: str | None = None, antes: dict | None = None, depois: dict | None = None,
            session_id: str | None = None) -> None:
    conexao.execute(insert(_t("auditoria")).values(
        municipio_id=municipio_id, origem=origem, quem=quem, acao=acao, entidade=entidade,
        entidade_id=str(entidade_id) if entidade_id else None, antes=_json(antes), depois=_json(depois),
        session_id=session_id))


# ───────────────────────── Fontes públicas ─────────────────────────

def _sem_acento(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn").lower().strip()


def buscar_cep(cep: str) -> dict | None:
    """ViaCEP: o endereço e o código IBGE do município do CEP."""
    numeros = re.sub(r"\D", "", cep or "")
    if len(numeros) != 8:
        return None
    r = httpx.get(f"https://viacep.com.br/ws/{numeros}/json/", timeout=TEMPO, headers={"User-Agent": USER_AGENT})
    dados = r.json() if r.status_code == 200 else {}
    if not dados or dados.get("erro"):
        return None
    return {"cep": numeros, "codigo_ibge": dados.get("ibge"), "municipio": dados.get("localidade"), "uf": dados.get("uf"),
            "logradouro": dados.get("logradouro"), "bairro": dados.get("bairro")}


def buscar_municipio_ibge(nome: str, uf: str) -> dict | None:
    """IBGE: o código de 7 dígitos do município pelo nome e pela UF."""
    uf = (uf or "").strip().upper()
    if len(uf) != 2:
        return None
    r = httpx.get(f"https://servicodados.ibge.gov.br/api/v1/localidades/estados/{uf}/municipios",
                  timeout=TEMPO, headers={"User-Agent": USER_AGENT})
    if r.status_code != 200:
        return None
    alvo = _sem_acento(nome)
    for m in r.json():
        if _sem_acento(m.get("nome", "")) == alvo:
            return {"codigo_ibge": str(m["id"]), "municipio": m["nome"], "uf": uf}
    return None


def geocodificar(endereco: str) -> tuple[float, float] | None:
    """Nominatim (OpenStreetMap): coordenadas de um endereço. Uso leve (1 por vez), como pede a política dele."""
    if not (endereco or "").strip():
        return None
    try:
        r = httpx.get("https://nominatim.openstreetmap.org/search",
                      params={"q": endereco, "format": "json", "limit": 1, "countrycodes": "br"},
                      timeout=TEMPO, headers={"User-Agent": USER_AGENT})
        achados = r.json() if r.status_code == 200 else []
    except Exception:
        return None
    if not achados:
        return None
    return float(achados[0]["lat"]), float(achados[0]["lon"])


def unidades_cnes(codigo_ibge: str) -> list[dict]:
    """Dados abertos do CNES: as unidades do município. A API recebe o código IBGE de 6 dígitos.

    Endereço configurável em CNES_API_URL. Se a fonte mudar ou estiver fora do ar, devolve [] e o
    onboarding segue com o cadastro manual."""
    base = os.getenv("CNES_API_URL", "https://apidadosabertos.saude.gov.br/cnes/estabelecimentos").rstrip("/")
    codigo6 = re.sub(r"\D", "", codigo_ibge or "")[:6]
    saida: list[dict] = []
    offset = 0
    while offset < 2000:
        r = httpx.get(base, params={"codigo_municipio": codigo6, "status": 1, "limit": 20, "offset": offset},
                      timeout=TEMPO, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        if r.status_code != 200:
            break
        dados = r.json()
        lote = dados.get("estabelecimentos", dados if isinstance(dados, list) else [])
        if not lote:
            break
        saida.extend(lote)
        if len(lote) < 20:
            break
        offset += 20
    return saida


def vinculo_cnes(unidade: dict) -> str | None:
    """"publica" (natureza jurídica 1xxx: administração pública), "conveniada" (privada que atende pelo SUS) ou
    None (particular: consultórios e clínicas privadas, que ficam fora do cadastro da Secretaria)."""
    natureza = str(unidade.get("descricao_natureza_juridica_estabelecimento") or unidade.get("natureza_juridica") or "")
    if natureza.startswith("1"):
        return "publica"
    if str(unidade.get("estabelecimento_faz_atendimento_ambulatorial_sus") or "").upper() == "SIM":
        return "conveniada"
    return None


def remover_particulares(municipio_id: str, quem: str) -> int:
    """Tira do cadastro as unidades importadas do CNES que não são públicas nem conveniadas ao SUS (importações
    antigas, de antes do filtro). Devolve quantas saíram."""
    tu = _t("unidades")
    fora = [u for u in _linhas(select(tu).where(tu.c.municipio_id == municipio_id, tu.c.origem == "cnes"))
            if isinstance(u.get("dados_cnes"), dict) and vinculo_cnes(u["dados_cnes"]) is None]
    if not fora:
        return 0
    with _estado["engine"].begin() as c:
        for u in fora:
            c.execute(tu.delete().where(tu.c.id == u["id"]))
        auditar(c, municipio_id=municipio_id, origem="sistema", quem=quem, acao="remover_particulares",
                entidade="unidades", depois={"removidas": len(fora)})
    return len(fora)


# ───────────────────────── Leitura ─────────────────────────

def tipos_setor() -> list[dict]:
    return _linhas(select(_t("tipos_setor")).order_by(_t("tipos_setor").c.ordem))


def tipos_unidade() -> list[dict]:
    return _linhas(select(_t("tipos_unidade")).order_by(_t("tipos_unidade").c.ordem))


def modelos_atividade(tipo_setor_id: str | None = None) -> list[dict]:
    t = _t("modelos_atividade")
    q = select(t).order_by(t.c.tipo_setor_id, t.c.ordem)
    if tipo_setor_id:
        q = q.where(t.c.tipo_setor_id == tipo_setor_id)
    return _linhas(q)


def municipios() -> list[dict]:
    return _linhas(select(_t("municipios")).order_by(_t("municipios").c.nome))


def municipio(municipio_id: str) -> dict | None:
    return _uma(select(_t("municipios")).where(_t("municipios").c.id == municipio_id))


def membros(municipio_id: str, so_ativos: bool = True) -> list[dict]:
    t = _t("membros")
    consulta = select(t).where(t.c.municipio_id == municipio_id)
    return _linhas(consulta.where(t.c.ativo.is_(True)) if so_ativos else consulta)


def municipios_de(email: str) -> list[dict]:
    """Os municípios em que a pessoa é membro, com o papel dela."""
    tm, tb = _t("municipios"), _t("membros")
    consulta = (select(tm, tb.c.papel, tb.c.cargo_id).join(tb, tb.c.municipio_id == tm.c.id)
                .where(tb.c.email == (email or "").strip().lower(), tb.c.ativo.is_(True)))
    return _linhas(consulta)


def adicionar_membro(municipio_id: str, email: str, papel: str, quem: str, nome: str = "", cargo_id: str | None = None) -> None:
    t = _t("membros")
    email = email.strip().lower()
    with _estado["engine"].begin() as c:
        if c.execute(select(t.c.id).where(t.c.municipio_id == municipio_id, t.c.email == email)).first():
            return
        c.execute(insert(t).values(id=_id(), municipio_id=municipio_id, email=email, papel=papel, criado_por=quem,
                                   nome=nome or None, cargo_id=cargo_id))
        auditar(c, municipio_id=municipio_id, origem="sistema", quem=quem, acao="adicionar_membro", entidade="membros",
                depois={"email": email, "papel": papel})


def modelos_cargo() -> list[dict]:
    return _linhas(select(_t("modelos_cargo")).order_by(_t("modelos_cargo").c.ordem))


def modelos_indicador() -> list[dict]:
    return _linhas(select(_t("modelos_indicador")).order_by(_t("modelos_indicador").c.ordem))


def municipio_padrao() -> str | None:
    """O município quando a conversa não diz qual: GESTORGOV_MUNICIPIO (código IBGE) ou o único cadastrado."""
    codigo = os.getenv("GESTORGOV_MUNICIPIO", "").strip()
    t = _t("municipios")
    if codigo:
        achado = _uma(select(t.c.id).where(t.c.codigo_ibge == codigo))
        return str(achado["id"]) if achado else None
    todos = _linhas(select(t.c.id))
    return str(todos[0]["id"]) if len(todos) == 1 else None


def secretaria_saude(municipio_id: str) -> dict | None:
    t = _t("secretarias")
    return _uma(select(t).where(t.c.municipio_id == municipio_id, t.c.area == "saude"))


def setores(municipio_id: str) -> list[dict]:
    t = _t("setores")
    return _linhas(select(t).where(t.c.municipio_id == municipio_id).order_by(t.c.andar, t.c.posicao))


def setor_por_tipo_ou_nome(municipio_id: str, chave: str) -> dict | None:
    alvo = _sem_acento(chave)
    for s in setores(municipio_id):
        if s["tipo_id"] == chave or _sem_acento(s["nome"]) == alvo:
            return s
    return None


def unidades(municipio_id: str, tipo_id: str | None = None) -> list[dict]:
    t = _t("unidades")
    q = select(t).where(t.c.municipio_id == municipio_id).order_by(t.c.tipo_id, t.c.nome)
    if tipo_id:
        q = q.where(t.c.tipo_id == tipo_id)
    return _linhas(q)


def servidores(municipio_id: str) -> list[dict]:
    t = _t("servidores")
    return _linhas(select(t).where(t.c.municipio_id == municipio_id).order_by(t.c.nome))


def atividades(municipio_id: str, setor_id: str | None = None) -> list[dict]:
    t = _t("atividades_setor")
    q = select(t).where(t.c.municipio_id == municipio_id).order_by(t.c.setor_id, t.c.nome)
    if setor_id:
        q = q.where(t.c.setor_id == setor_id)
    return _linhas(q)


def agentes_setor(municipio_id: str) -> list[dict]:
    t = _t("agentes_setor")
    return _linhas(select(t).where(t.c.municipio_id == municipio_id))


def onboarding_aberto(municipio_id: str) -> dict | None:
    t = _t("onboardings")
    return _uma(select(t).where(t.c.municipio_id == municipio_id, t.c.concluido_em.is_(None))
                .order_by(t.c.iniciado_em.desc()))


def panorama(municipio_id: str) -> dict:
    """Tudo o que a tela precisa para desenhar a cidade e o prédio: município, secretaria, setores com
    atividades, agentes e responsáveis, unidades e a etapa do onboarding."""
    mun = municipio(municipio_id)
    if not mun:
        return {}
    pessoas = {str(p["id"]): p for p in servidores(municipio_id)}
    por_setor: dict[str, list] = {}
    for a in atividades(municipio_id):
        por_setor.setdefault(str(a["setor_id"]), []).append(a)
    agentes_de: dict[str, list] = {}
    for a in agentes_setor(municipio_id):
        agentes_de.setdefault(str(a["setor_id"]), []).append(a)
    lista_setores = []
    for s in setores(municipio_id):
        resp = pessoas.get(str(s["responsavel_id"])) if s.get("responsavel_id") else None
        lista_setores.append({**s, "responsavel": resp, "atividades": por_setor.get(str(s["id"]), []),
                              "agentes": agentes_de.get(str(s["id"]), [])})
    return _json({
        "municipio": mun,
        "secretaria": secretaria_saude(municipio_id),
        "setores": lista_setores,
        "unidades": unidades(municipio_id),
        "servidores": list(pessoas.values()),
        "onboarding": onboarding_aberto(municipio_id),
    })


# ───────────────────────── Gravação ─────────────────────────

def registrar_municipio(*, codigo_ibge: str, nome: str, uf: str, quem: str, cep: str = "", endereco_sede: str = "",
                        latitude: float | None = None, longitude: float | None = None, secretario_nome: str = "",
                        secretario_email: str = "", session_id: str | None = None) -> dict:
    """Cria (ou atualiza) o município, a Secretaria de Saúde e o onboarding aberto."""
    tm, ts, to = _t("municipios"), _t("secretarias"), _t("onboardings")
    with _estado["engine"].begin() as c:
        atual = c.execute(select(tm).where(tm.c.codigo_ibge == codigo_ibge)).mappings().first()
        valores = {"nome": nome, "uf": uf.upper(), "cep": re.sub(r"\D", "", cep or "") or None,
                   "endereco_sede": endereco_sede or None, "latitude": latitude, "longitude": longitude}
        if atual:
            mid = str(atual["id"])
            c.execute(update(tm).where(tm.c.id == atual["id"]).values(**{k: v for k, v in valores.items() if v}))
        else:
            mid = _id()
            c.execute(insert(tm).values(id=mid, codigo_ibge=codigo_ibge, criado_por=quem, **valores))
        auditar(c, municipio_id=mid, origem="agente", quem=quem, acao="registrar", entidade="municipios",
                entidade_id=mid, depois={"codigo_ibge": codigo_ibge, **valores}, session_id=session_id)
        sec = c.execute(select(ts).where(ts.c.municipio_id == mid, ts.c.area == "saude")).mappings().first()
        if not sec:
            c.execute(insert(ts).values(id=_id(), municipio_id=mid, area="saude", secretario_nome=secretario_nome or None,
                                        secretario_email=(secretario_email or "").lower() or None))
        elif secretario_nome or secretario_email:
            c.execute(update(ts).where(ts.c.id == sec["id"]).values(
                secretario_nome=secretario_nome or sec["secretario_nome"],
                secretario_email=(secretario_email or "").lower() or sec["secretario_email"]))
        aberto = c.execute(select(to).where(to.c.municipio_id == mid, to.c.concluido_em.is_(None))).mappings().first()
        if not aberto:
            c.execute(insert(to).values(id=_id(), municipio_id=mid, session_id=session_id, etapa="unidades",
                                        estado={}, iniciado_por=quem))
    return municipio(mid) or {}


def avancar_etapa(municipio_id: str, etapa: str) -> None:
    to = _t("onboardings")
    with _estado["engine"].begin() as c:
        c.execute(update(to).where(to.c.municipio_id == municipio_id, to.c.concluido_em.is_(None)).values(etapa=etapa))


def salvar_unidade(municipio_id: str, *, nome: str, tipo_id: str, quem: str, endereco: str = "", bairro: str = "",
                   cep: str = "", cnes: str = "", latitude: float | None = None, longitude: float | None = None,
                   origem: str = "manual", dados_cnes: dict | None = None, confirmada: bool = True,
                   gestao: str | None = None, session_id: str | None = None) -> dict:
    tu = _t("unidades")
    sec = secretaria_saude(municipio_id)
    cnes = re.sub(r"\D", "", cnes or "")[:7] or None
    valores = {"nome": nome.strip(), "tipo_id": tipo_id, "endereco": endereco or None, "bairro": bairro or None,
               "cep": re.sub(r"\D", "", cep or "") or None, "latitude": latitude, "longitude": longitude,
               "origem": origem, "dados_cnes": dados_cnes, "confirmada": confirmada, "gestao": gestao,
               "secretaria_id": str(sec["id"]) if sec else None}
    with _estado["engine"].begin() as c:
        atual = None
        if cnes:
            atual = c.execute(select(tu).where(tu.c.municipio_id == municipio_id, tu.c.cnes == cnes)).mappings().first()
        if atual:
            uid = str(atual["id"])
            c.execute(update(tu).where(tu.c.id == atual["id"]).values(**{k: v for k, v in valores.items() if v is not None}))
        else:
            uid = _id()
            c.execute(insert(tu).values(id=uid, municipio_id=municipio_id, cnes=cnes, **valores))
        auditar(c, municipio_id=municipio_id, origem="agente", quem=quem, acao="salvar", entidade="unidades",
                entidade_id=uid, depois={**valores, "cnes": cnes, "dados_cnes": None}, session_id=session_id)
    return {"id": uid, **valores, "cnes": cnes}


def salvar_setor(municipio_id: str, *, nome: str, tipo_id: str | None, quem: str, descricao: str = "",
                 session_id: str | None = None) -> dict:
    ts = _t("setores")
    sec = secretaria_saude(municipio_id)
    if not sec:
        raise ValueError("o município ainda não tem a Secretaria de Saúde: registre o município primeiro")
    existentes = setores(municipio_id)
    for s in existentes:
        if _sem_acento(s["nome"]) == _sem_acento(nome) or (tipo_id and s["tipo_id"] == tipo_id):
            return s
    ordem = len(existentes)
    andar, posicao = ordem // 3, ordem % 3  # três salas por andar no prédio 3D
    sid = _id()
    with _estado["engine"].begin() as c:
        c.execute(insert(ts).values(id=sid, municipio_id=municipio_id, secretaria_id=str(sec["id"]), tipo_id=tipo_id,
                                    nome=nome.strip(), descricao=descricao or None, andar=andar, posicao=posicao))
        tsec = _t("secretarias")
        andares = andar + 1
        if andares > (sec.get("andares") or 0):
            c.execute(update(tsec).where(tsec.c.id == sec["id"]).values(andares=andares))
        auditar(c, municipio_id=municipio_id, origem="agente", quem=quem, acao="criar", entidade="setores",
                entidade_id=sid, depois={"nome": nome, "tipo_id": tipo_id, "andar": andar}, session_id=session_id)
    return {"id": sid, "nome": nome, "tipo_id": tipo_id, "andar": andar, "posicao": posicao}


def salvar_atividade(municipio_id: str, setor_id: str, *, nome: str, descricao: str, tipo: str, frequencia: str,
                     quem: str, modelo_id: str | None = None, cron: str | None = None, entregavel: str | None = None,
                     session_id: str | None = None) -> dict:
    ta = _t("atividades_setor")
    with _estado["engine"].begin() as c:
        atual = c.execute(select(ta).where(ta.c.setor_id == setor_id, ta.c.nome == nome)).mappings().first()
        valores = {"descricao": descricao, "tipo": tipo, "frequencia": frequencia, "cron": cron,
                   "entregavel": entregavel, "modelo_id": modelo_id, "ativa": True}
        if atual:
            aid = str(atual["id"])
            c.execute(update(ta).where(ta.c.id == atual["id"]).values(**valores))
        else:
            aid = _id()
            c.execute(insert(ta).values(id=aid, municipio_id=municipio_id, setor_id=setor_id, nome=nome, **valores))
        auditar(c, municipio_id=municipio_id, origem="agente", quem=quem, acao="salvar", entidade="atividades_setor",
                entidade_id=aid, depois={"nome": nome, **valores}, session_id=session_id)
    return {"id": aid, "nome": nome, **valores}


def salvar_servidor(municipio_id: str, *, nome: str, email: str, quem: str, cargo: str = "", setor_id: str | None = None,
                    papel: str = "coordenador", aprova_tarefas: bool = True, responsavel_do_setor: bool = False,
                    session_id: str | None = None) -> dict:
    tp, ts = _t("servidores"), _t("setores")
    email = email.strip().lower()
    with _estado["engine"].begin() as c:
        atual = c.execute(select(tp).where(tp.c.municipio_id == municipio_id, tp.c.email == email)).mappings().first()
        valores = {"nome": nome.strip(), "cargo": cargo or None, "setor_id": setor_id, "papel": papel,
                   "aprova_tarefas": aprova_tarefas}
        if atual:
            pid = str(atual["id"])
            c.execute(update(tp).where(tp.c.id == atual["id"]).values(**valores))
        else:
            pid = _id()
            c.execute(insert(tp).values(id=pid, municipio_id=municipio_id, email=email, **valores))
        if responsavel_do_setor and setor_id:
            c.execute(update(ts).where(ts.c.id == setor_id).values(responsavel_id=pid))
            ta = _t("atividades_setor")
            c.execute(update(ta).where(ta.c.setor_id == setor_id, ta.c.aprovador_id.is_(None)).values(aprovador_id=pid))
        auditar(c, municipio_id=municipio_id, origem="agente", quem=quem, acao="salvar", entidade="servidores",
                entidade_id=pid, depois={"email": email, **valores}, session_id=session_id)
    return {"id": pid, "email": email, **valores}


def ligar_agente_ao_setor(municipio_id: str, setor_id: str, agente_id: str, funcao: str, quem: str,
                          session_id: str | None = None) -> None:
    tg, ta = _t("agentes_setor"), _t("atividades_setor")
    with _estado["engine"].begin() as c:
        existe = c.execute(select(tg.c.id).where(tg.c.setor_id == setor_id, tg.c.agente_id == agente_id)).first()
        if not existe:
            mesa = len(c.execute(select(tg.c.id).where(tg.c.setor_id == setor_id)).all())
            c.execute(insert(tg).values(id=_id(), municipio_id=municipio_id, setor_id=setor_id, agente_id=agente_id,
                                        funcao=funcao, mesa=mesa))
        c.execute(update(ta).where(ta.c.setor_id == setor_id, ta.c.agente_id.is_(None)).values(agente_id=agente_id))
        auditar(c, municipio_id=municipio_id, origem="agente", quem=quem, acao="ligar_agente", entidade="agentes_setor",
                entidade_id=setor_id, depois={"agente_id": agente_id, "funcao": funcao}, session_id=session_id)


def concluir_onboarding(municipio_id: str, quem: str, session_id: str | None = None) -> None:
    tm, to = _t("municipios"), _t("onboardings")
    with _estado["engine"].begin() as c:
        c.execute(update(tm).where(tm.c.id == municipio_id).values(situacao="ativo"))
        c.execute(update(to).where(to.c.municipio_id == municipio_id, to.c.concluido_em.is_(None))
                  .values(etapa="concluido", concluido_em=_agora()))
        auditar(c, municipio_id=municipio_id, origem="agente", quem=quem, acao="concluir", entidade="onboardings",
                entidade_id=municipio_id, session_id=session_id)
