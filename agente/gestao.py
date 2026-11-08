"""O cadastro de cada organização no GestorGov (uma Secretaria de Saúde, uma empresa...): a organização, as áreas
(setores, departamentos), as unidades, as pessoas, as atividades, o organograma (cargos, indicadores, entregas,
pendências, status e alertas), os membros e a auditoria. O que muda por segmento está em agente/segmentos.py.

As tabelas são criadas pelas migrations em supabase/gestorgov/ (não pelo servidor): aqui elas são só
descritas, com as mesmas colunas, para o SQLAlchemy ler e gravar. Sem DATABASE_URL (teste local), o
servidor cria as mesmas tabelas num SQLite, sem as regras de segurança do Postgres.

Também ficam aqui as consultas a fontes públicas usadas no onboarding: ViaCEP (CEP → município e endereço),
IBGE (nome → código do município), Nominatim/OpenStreetMap (endereço → coordenadas) e os dados
abertos do CNES (unidades de saúde do município).
"""

import json
import os
import re
import threading
import time
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

from agente import segmentos

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
    org = lambda **kw: uid("organizacao_id", ForeignKey(fk("organizacoes.id")), **kw)
    criado = lambda: Column("criado_em", DateTime(timezone=True), default=_agora)
    atualizado = lambda: Column("atualizado_em", DateTime(timezone=True), default=_agora, onupdate=_agora)
    quando = lambda nome: Column(nome, DateTime(timezone=True))
    t = {}
    # ── Segmentos e catálogos ──
    t["segmentos"] = Table("segmentos", m,
        Column("id", String(40), primary_key=True), Column("nome", Text, nullable=False), Column("descricao", Text),
        Column("ordem", SmallInteger, default=0))
    t["tipos_area"] = Table("tipos_area", m,
        Column("id", String(40), primary_key=True), Column("segmento_id", String(40), nullable=False),
        Column("nome", Text, nullable=False), Column("descricao", Text), Column("icone", Text),
        Column("ordem", SmallInteger, default=0), Column("padrao", Boolean, default=True))
    t["tipos_unidade"] = Table("tipos_unidade", m,
        Column("id", String(40), primary_key=True), Column("segmento_id", String(40)), Column("nome", Text, nullable=False),
        Column("codigos_cnes", JSON().with_variant(ARRAY(Text), "postgresql")), Column("icone", Text), Column("cor", Text),
        Column("ordem", SmallInteger, default=0))
    t["modelos_atividade"] = Table("modelos_atividade", m,
        Column("id", String(60), primary_key=True), Column("tipo_area_id", String(40), nullable=False),
        Column("nome", Text, nullable=False), Column("descricao", Text, nullable=False), Column("tipo", Text, nullable=False),
        Column("frequencia", Text, default="sob_demanda"), Column("cron", Text), Column("entregavel", Text),
        Column("padrao", Boolean, default=True), Column("ordem", SmallInteger, default=0))
    t["modelos_cargo"] = Table("modelos_cargo", m,
        Column("id", Text, primary_key=True), Column("segmento_id", String(40), nullable=False), Column("nome", Text, nullable=False),
        Column("nivel", Text, nullable=False), Column("tipo_area_id", Text), Column("superior_id", Text),
        Column("atribuicoes", Text, nullable=False), Column("rotinas", JSON, default=list), Column("entregas", JSON, default=list),
        Column("padrao", Boolean, default=True), Column("ordem", SmallInteger, default=0))
    t["modelos_indicador"] = Table("modelos_indicador", m,
        Column("id", Text, primary_key=True), Column("modelo_cargo_id", Text, nullable=False), Column("nome", Text, nullable=False),
        Column("fonte", Text, nullable=False), Column("periodicidade", Text, nullable=False), Column("unidade", Text, nullable=False),
        Column("sentido", Text, nullable=False), Column("ordem", SmallInteger, default=0))

    # ── A organização e o cadastro dela ──
    t["organizacoes"] = Table("organizacoes", m,
        uid("id", primary_key=True, default=_id), Column("segmento_id", String(40), nullable=False),
        Column("nome", Text, nullable=False), Column("sigla", Text), Column("cnpj", String(14)), Column("cep", String(8)),
        Column("logradouro", Text), Column("numero", Text), Column("complemento", Text), Column("bairro", Text),
        Column("cidade", Text), Column("uf", String(2)), Column("codigo_ibge", String(7)),
        Column("latitude", Numeric(9, 6)), Column("longitude", Numeric(9, 6)), Column("zoom_mapa", SmallInteger, default=12),
        Column("sede_latitude", Numeric(9, 6)), Column("sede_longitude", Numeric(9, 6)),
        Column("telefone", Text), Column("email", Text), Column("site", Text),
        Column("responsavel_nome", Text), Column("responsavel_email", Text), Column("responsavel_telefone", Text),
        Column("responsavel_cargo", Text), Column("populacao", Integer), Column("andares", SmallInteger, default=3),
        Column("dados_segmento", JSON, default=dict), Column("situacao", Text, default="implantacao"), Column("plano", Text),
        criado(), atualizado(), Column("criado_por", Text))
    t["pessoas"] = Table("pessoas", m,
        uid("id", primary_key=True, default=_id), org(nullable=False),
        Column("email", Text, nullable=False), Column("nome", Text, nullable=False), Column("cargo", Text),
        Column("matricula", Text), uid("area_id"), uid("unidade_id"), Column("papel", Text, default="membro"),
        Column("aprova_tarefas", Boolean, default=False), Column("ativo", Boolean, default=True), criado(), atualizado())
    t["areas"] = Table("areas", m,
        uid("id", primary_key=True, default=_id), org(nullable=False),
        Column("tipo_id", String(40), ForeignKey(fk("tipos_area.id"))), Column("nome", Text, nullable=False),
        Column("descricao", Text), Column("andar", SmallInteger, default=0), Column("posicao", SmallInteger, default=0),
        uid("responsavel_id"), Column("ativo", Boolean, default=True), criado(), atualizado())
    t["unidades"] = Table("unidades", m,
        uid("id", primary_key=True, default=_id), org(nullable=False),
        Column("tipo_id", String(40), ForeignKey(fk("tipos_unidade.id")), default="outro"),
        Column("cnes", String(7)), Column("nome", Text, nullable=False), Column("nome_fantasia", Text),
        Column("endereco", Text), Column("numero", Text), Column("complemento", Text), Column("bairro", Text),
        Column("cep", String(8)), Column("latitude", Numeric(9, 6)), Column("longitude", Numeric(9, 6)),
        Column("coordenadas_origem", Text), Column("telefone", Text), Column("email", Text), Column("horario", JSON),
        Column("gestao", Text), uid("responsavel_id"), Column("agente_id", Text), Column("situacao", Text, default="ativa"),
        Column("origem", Text, default="manual"), Column("dados_cnes", JSON), Column("confirmada", Boolean, default=False),
        Column("conferida_por", Text), quando("conferida_em"), Column("criado_por", Text), criado(), atualizado())
    t["unidade_fotos"] = Table("unidade_fotos", m,
        uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), uid("unidade_id", nullable=False),
        Column("tipo", Text, default="fachada"), Column("caminho", Text, nullable=False), Column("mime", Text, nullable=False),
        Column("bytes", Integer, nullable=False), Column("largura", Integer), Column("altura", Integer), Column("legenda", Text),
        Column("principal", Boolean, default=False), Column("enviada_por", Text, nullable=False),
        Column("enviada_em", DateTime(timezone=True), default=_agora))
    t["agentes_area"] = Table("agentes_area", m,
        uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), uid("area_id", nullable=False),
        Column("agente_id", Text, nullable=False), Column("funcao", Text), Column("mesa", SmallInteger, default=0),
        Column("ativo", Boolean, default=True), criado(), atualizado())
    t["fichas_agente"] = Table("fichas_agente", m,
        Column("agente_id", Text, primary_key=True), uid("organizacao_id", nullable=False),
        Column("caracteristicas", JSON, default=dict), Column("memoria", JSON, default=dict), Column("permissoes", JSON, default=dict),
        Column("escopo", Text, default="area"), Column("integracoes", JSON, default=list),
        Column("atualizado_em", DateTime(timezone=True), default=_agora, onupdate=_agora), Column("atualizado_por", Text))
    t["atividades_area"] = Table("atividades_area", m,
        uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), uid("area_id", nullable=False),
        Column("modelo_id", String(60)), Column("nome", Text, nullable=False), Column("descricao", Text, nullable=False),
        Column("tipo", Text, nullable=False), Column("frequencia", Text, default="sob_demanda"), Column("cron", Text),
        Column("entregavel", Text), Column("agente_id", Text), uid("aprovador_id"), uid("cargo_id"), Column("rotina_id", Text),
        Column("ativa", Boolean, default=True), criado(), atualizado())

    # ── Organograma ──
    t["cargos"] = Table("cargos", m,
        uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), Column("modelo_id", Text),
        Column("nome", Text, nullable=False), Column("nivel", Text, nullable=False), uid("superior_id"), uid("area_id"),
        uid("unidade_id"), uid("responsavel_id"), Column("agente_id", Text), Column("atribuicoes", Text),
        Column("permissoes", JSON, default=list), Column("ativo", Boolean, default=True), Column("ordem", SmallInteger, default=0),
        criado(), atualizado())
    t["indicadores_cargo"] = Table("indicadores_cargo", m,
        uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), uid("cargo_id", nullable=False),
        Column("modelo_id", Text), Column("nome", Text, nullable=False), Column("fonte", Text, nullable=False),
        Column("periodicidade", Text, nullable=False), Column("unidade", Text, nullable=False),
        Column("sentido", Text, nullable=False), Column("meta", Numeric), Column("meta_definida_por", Text),
        Column("ativo", Boolean, default=True), criado())
    t["medicoes"] = Table("medicoes", m,
        Column("id", BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True),
        uid("organizacao_id", nullable=False), uid("indicador_id", nullable=False), Column("referencia", Date, nullable=False),
        Column("valor", Numeric, nullable=False), Column("fonte", Text), Column("registrado_por", Text, nullable=False),
        Column("registrado_em", DateTime(timezone=True), default=_agora))
    t["entregas"] = Table("entregas", m,
        uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), uid("cargo_id", nullable=False),
        Column("titulo", Text, nullable=False), Column("descricao", Text), quando("prazo"),
        Column("situacao", Text, default="prevista"), Column("documento", Text), Column("produzida_por", Text),
        Column("aprovada_por", Text), quando("aprovada_em"), criado(), atualizado())
    t["pendencias"] = Table("pendencias", m,
        uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), uid("cargo_id", nullable=False),
        Column("descricao", Text, nullable=False), Column("motivo", Text), Column("desde", DateTime(timezone=True), default=_agora),
        quando("resolvida_em"), Column("resolvida_por", Text))
    t["status_cargo"] = Table("status_cargo", m,
        uid("cargo_id", primary_key=True), uid("organizacao_id", nullable=False), Column("situacao", Text, default="aguardando"),
        Column("tarefa", Text), Column("atualizado_em", DateTime(timezone=True), default=_agora, onupdate=_agora),
        Column("atualizado_por", Text))
    t["alertas_cargo"] = Table("alertas_cargo", m,
        uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), uid("cargo_id", nullable=False),
        uid("destino_id"), Column("tipo", Text, nullable=False), Column("titulo", Text, nullable=False), Column("detalhe", Text),
        Column("situacao", Text, default="aberto"), uid("escalado_de"), criado(), quando("resolvido_em"), Column("resolvido_por", Text))

    # ── Membros, convites, implantação e auditoria ──
    t["membros"] = Table("membros", m,
        uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), Column("email", Text, nullable=False),
        Column("nome", Text), Column("papel", Text, default="membro"), uid("cargo_id"), Column("ativo", Boolean, default=True),
        criado(), Column("criado_por", Text))
    t["convites"] = Table("convites", m,
        uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), Column("email", Text, nullable=False),
        Column("nome", Text), uid("cargo_id"), Column("token_hash", Text, nullable=False, unique=True),
        Column("origem", Text, default="painel"), quando("aprovado_em"), Column("aprovado_por", Text),
        Column("criado_por", Text, nullable=False), criado(), Column("expira_em", DateTime(timezone=True), nullable=False),
        quando("aceito_em"), quando("cancelado_em"))
    t["implantacao_links"] = Table("implantacao_links", m,
        uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), Column("token_hash", Text, nullable=False, unique=True),
        Column("codigo_hash", Text, nullable=False), Column("criado_por", Text, nullable=False), criado(),
        Column("expira_em", DateTime(timezone=True), nullable=False), quando("cancelado_em"),
        Column("usos", Integer, default=0), Column("falhas", Integer, default=0))
    t["onboardings"] = Table("onboardings", m,
        uid("id", primary_key=True, default=_id), uid("organizacao_id"), Column("session_id", Text),
        Column("etapa", Text, default="organizacao"), Column("estado", JSON, default=dict),
        Column("iniciado_por", Text, nullable=False), Column("iniciado_em", DateTime(timezone=True), default=_agora),
        atualizado(), quando("concluido_em"))
    t["auditoria"] = Table("auditoria", m,
        Column("id", BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True),
        uid("organizacao_id"), Column("em", DateTime(timezone=True), default=_agora), Column("origem", Text, nullable=False),
        Column("quem", Text, nullable=False), Column("acao", Text, nullable=False), Column("entidade", Text, nullable=False),
        Column("entidade_id", Text), Column("antes", JSON), Column("depois", JSON), Column("session_id", Text),
        Column("aprovado_por", Text))
    return t


PASTA_MIGRATIONS = Path(__file__).resolve().parent.parent / "supabase" / "gestorgov"


def comandos_de_catalogo() -> list[str]:
    """Os INSERTs dos catálogos (tipos de setor e de unidade, atividades, cargos e indicadores) das migrations,
    em SQL que o SQLite aceita. Assim o teste local tem as mesmas listas do Supabase, sem copiar os dados para o código."""
    comandos = []
    for arquivo in sorted(PASTA_MIGRATIONS.glob("*.sql")):
        texto = re.sub(r"--[^\n]*", "", arquivo.read_text(encoding="utf-8"))
        for bloco in re.findall(r"insert into gestorgov\.(?:segmentos|tipos_area|tipos_unidade|modelos_atividade|modelos_cargo|modelos_indicador)\b.*?;\s*$",
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


def auditar(conexao, *, organizacao_id: str | None, origem: str, quem: str, acao: str, entidade: str,
            entidade_id: str | None = None, antes: dict | None = None, depois: dict | None = None,
            session_id: str | None = None) -> None:
    conexao.execute(insert(_t("auditoria")).values(
        organizacao_id=organizacao_id, origem=origem, quem=quem, acao=acao, entidade=entidade,
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


_NOMINATIM = {"trava": threading.Lock(), "ultima": 0.0}


def _nominatim(parametros: dict) -> tuple[float, float] | None:
    """Nominatim (OpenStreetMap). No máximo 1 pedido por segundo por processo, como pede a política dele."""
    with _NOMINATIM["trava"]:
        espera = _NOMINATIM["ultima"] + 1.0 - time.monotonic()
        if espera > 0:
            time.sleep(espera)
        _NOMINATIM["ultima"] = time.monotonic()
    try:
        r = httpx.get("https://nominatim.openstreetmap.org/search",
                      params={**parametros, "format": "json", "limit": 1, "countrycodes": "br"},
                      timeout=TEMPO, headers={"User-Agent": USER_AGENT})
        achados = r.json() if r.status_code == 200 else []
    except Exception:
        return None
    if not achados:
        return None
    return float(achados[0]["lat"]), float(achados[0]["lon"])


def buscar_endereco_mapbox(texto: str, limite: int = 5) -> list[dict]:
    """Mapbox Geocoding (base de endereços do Brasil): os endereços que batem com o texto, com o ponto no mapa.
    Sem MAPBOX_TOKEN ou se a fonte falhar, devolve []."""
    token = os.getenv("MAPBOX_TOKEN", "").strip()
    if not token or not (texto or "").strip():
        return []
    try:
        r = httpx.get("https://api.mapbox.com/search/geocode/v6/forward",
                      params={"q": texto, "country": "br", "language": "pt", "limit": limite, "access_token": token},
                      timeout=TEMPO, headers={"User-Agent": USER_AGENT})
        achados = r.json().get("features", []) if r.status_code == 200 else []
    except Exception:
        return []
    saida = []
    for f in achados:
        pr = f.get("properties") or {}
        ctx = pr.get("context") or {}
        lon, lat = (f.get("geometry") or {}).get("coordinates", [None, None])
        saida.append({
            "endereco_completo": pr.get("full_address") or pr.get("name"),
            "logradouro": (ctx.get("street") or {}).get("name") or (ctx.get("address") or {}).get("street_name"),
            "numero": (ctx.get("address") or {}).get("address_number"),
            "bairro": (ctx.get("neighborhood") or ctx.get("locality") or {}).get("name"),
            "cep": re.sub(r"\D", "", (ctx.get("postcode") or {}).get("name") or "") or None,
            "municipio": (ctx.get("place") or {}).get("name"),
            "uf": ((ctx.get("region") or {}).get("region_code") or "").upper() or None,
            "latitude": lat, "longitude": lon, "precisao": pr.get("feature_type"),
        })
    return saida


def geocodificar(endereco: str) -> tuple[float, float] | None:
    """Coordenadas de um endereço em texto livre."""
    if not (endereco or "").strip():
        return None
    return _nominatim({"q": endereco})


def localizar(*, logradouro: str = "", numero: str = "", bairro: str = "", municipio: str = "", uf: str = "",
              cep: str = "") -> tuple[float, float, str] | None:
    """O ponto no mapa de um endereço: (latitude, longitude, origem). Tenta a rua com o número (origem "endereco"),
    depois o CEP ("cep") e, por fim, a rua com o bairro em texto livre ("endereco")."""
    if logradouro and municipio:
        achados = buscar_endereco_mapbox(", ".join(x for x in (f"{logradouro} {numero}".strip(), bairro, municipio, uf) if x), 1)
        if achados and achados[0]["latitude"] is not None and achados[0]["precisao"] in ("address", "street"):
            return (achados[0]["latitude"], achados[0]["longitude"], "endereco")
        rua = f"{numero} {logradouro}".strip() if numero else logradouro
        achado = _nominatim({"street": rua, "city": municipio, "state": uf, "country": "Brasil"})
        if achado:
            return (*achado, "endereco")
    numeros = re.sub(r"\D", "", cep or "")
    if len(numeros) == 8:
        achado = _nominatim({"postalcode": f"{numeros[:5]}-{numeros[5:]}", "country": "Brasil"})
        if achado:
            return (*achado, "cep")
    if logradouro or bairro:
        achado = geocodificar(", ".join(x for x in (logradouro, bairro, municipio, uf, "Brasil") if x))
        if achado:
            return (*achado, "endereco")
    return None


def endereco_por_cep(cep: str, numero: str = "") -> dict | None:
    """ViaCEP + o ponto no mapa: o endereço do CEP (rua, bairro, município e código IBGE) e as coordenadas."""
    achado = buscar_cep(cep)
    if not achado:
        return None
    ponto = localizar(logradouro=achado.get("logradouro") or "", numero=numero, bairro=achado.get("bairro") or "",
                      municipio=achado.get("municipio") or "", uf=achado.get("uf") or "", cep=achado["cep"])
    return {**achado, "numero": numero or None,
            "latitude": ponto[0] if ponto else None, "longitude": ponto[1] if ponto else None,
            "coordenadas_origem": ponto[2] if ponto else None}


CNES_POR_PAGINA = 20
CNES_MAXIMO = 2000
CNES_EM_PARALELO = 5


def pagina_cnes(codigo6: str, offset: int, tentativas: int = 3) -> list[dict] | None:
    """Uma página dos dados abertos do CNES (None quando a API responde com erro). Erro de rede: tenta de novo."""
    base = os.getenv("CNES_API_URL", "https://apidadosabertos.saude.gov.br/cnes/estabelecimentos").rstrip("/")
    for tentativa in range(tentativas):
        try:
            r = httpx.get(base, params={"codigo_municipio": codigo6, "status": 1, "limit": CNES_POR_PAGINA,
                                        "offset": offset},
                          timeout=TEMPO, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        except httpx.HTTPError:
            if tentativa == tentativas - 1:
                raise
            time.sleep(1 + tentativa * 2)
            continue
        if r.status_code != 200:
            return None
        dados = r.json()
        return dados.get("estabelecimentos", dados if isinstance(dados, list) else [])
    return None


def unidades_cnes(codigo_ibge: str) -> list[dict]:
    """Dados abertos do CNES: as unidades do município. A API recebe o código IBGE de 6 dígitos.

    A primeira página diz se há mais; as seguintes vêm CNES_EM_PARALELO por vez. Endereço configurável em
    CNES_API_URL. Se a fonte mudar ou estiver fora do ar, devolve [] e o onboarding segue com o cadastro manual."""
    from concurrent.futures import ThreadPoolExecutor

    codigo6 = re.sub(r"\D", "", codigo_ibge or "")[:6]
    primeira = pagina_cnes(codigo6, 0)
    if not primeira:
        return []
    saida: list[dict] = list(primeira)
    offset = CNES_POR_PAGINA
    if len(primeira) < CNES_POR_PAGINA:
        return saida
    with ThreadPoolExecutor(max_workers=CNES_EM_PARALELO) as grupo:
        while offset < CNES_MAXIMO:
            offsets = [offset + i * CNES_POR_PAGINA for i in range(CNES_EM_PARALELO)
                       if offset + i * CNES_POR_PAGINA < CNES_MAXIMO]
            lotes = list(grupo.map(lambda o: pagina_cnes(codigo6, o), offsets))  # na ordem dos offsets
            for lote in lotes:
                if not lote:
                    return saida
                saida.extend(lote)
                if len(lote) < CNES_POR_PAGINA:
                    return saida
            offset = offsets[-1] + CNES_POR_PAGINA
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


def remover_particulares(organizacao_id: str, quem: str) -> int:
    """Tira do cadastro as unidades importadas do CNES que não são públicas nem conveniadas ao SUS (importações
    antigas, de antes do filtro). Devolve quantas saíram."""
    tu = _t("unidades")
    fora = [u for u in _linhas(select(tu).where(tu.c.organizacao_id == organizacao_id, tu.c.origem == "cnes"))
            if isinstance(u.get("dados_cnes"), dict) and vinculo_cnes(u["dados_cnes"]) is None]
    if not fora:
        return 0
    with _estado["engine"].begin() as c:
        for u in fora:
            c.execute(tu.delete().where(tu.c.id == u["id"]))
        auditar(c, organizacao_id=organizacao_id, origem="sistema", quem=quem, acao="remover_particulares",
                entidade="unidades", depois={"removidas": len(fora)})
    return len(fora)


# ───────────────────────── Leitura ─────────────────────────

def segmentos_cadastrados() -> list[dict]:
    return _linhas(select(_t("segmentos")).order_by(_t("segmentos").c.ordem))


def tipos_area(segmento_id: str | None = None) -> list[dict]:
    t = _t("tipos_area")
    q = select(t).order_by(t.c.ordem)
    return _linhas(q.where(t.c.segmento_id == segmento_id) if segmento_id else q)


def tipos_unidade(segmento_id: str | None = None) -> list[dict]:
    """Os tipos de unidade do segmento (e os que servem a todos, como "outro")."""
    t = _t("tipos_unidade")
    q = select(t).order_by(t.c.ordem)
    return _linhas(q.where((t.c.segmento_id == segmento_id) | t.c.segmento_id.is_(None)) if segmento_id else q)


def modelos_atividade(tipo_area_id: str | None = None) -> list[dict]:
    t = _t("modelos_atividade")
    q = select(t).order_by(t.c.tipo_area_id, t.c.ordem)
    if tipo_area_id:
        q = q.where(t.c.tipo_area_id == tipo_area_id)
    return _linhas(q)


def organizacoes() -> list[dict]:
    return _linhas(select(_t("organizacoes")).order_by(_t("organizacoes").c.nome))


def organizacao(organizacao_id: str) -> dict | None:
    return _uma(select(_t("organizacoes")).where(_t("organizacoes").c.id == organizacao_id))


def segmento_de(organizacao_id: str) -> segmentos.Segmento:
    return segmentos.de(organizacao(organizacao_id))


def membros(organizacao_id: str, so_ativos: bool = True) -> list[dict]:
    t = _t("membros")
    consulta = select(t).where(t.c.organizacao_id == organizacao_id)
    return _linhas(consulta.where(t.c.ativo.is_(True)) if so_ativos else consulta)


def organizacoes_de(email: str) -> list[dict]:
    """As organizações em que a pessoa é membro, com o papel dela."""
    to, tb = _t("organizacoes"), _t("membros")
    consulta = (select(to, tb.c.papel, tb.c.cargo_id).join(tb, tb.c.organizacao_id == to.c.id)
                .where(tb.c.email == (email or "").strip().lower(), tb.c.ativo.is_(True)))
    return _linhas(consulta)


def adicionar_membro(organizacao_id: str, email: str, papel: str, quem: str, nome: str = "", cargo_id: str | None = None) -> None:
    t = _t("membros")
    email = email.strip().lower()
    with _estado["engine"].begin() as c:
        if c.execute(select(t.c.id).where(t.c.organizacao_id == organizacao_id, t.c.email == email)).first():
            return
        c.execute(insert(t).values(id=_id(), organizacao_id=organizacao_id, email=email, papel=papel, criado_por=quem,
                                   nome=nome or None, cargo_id=cargo_id))
        auditar(c, organizacao_id=organizacao_id, origem="sistema", quem=quem, acao="adicionar_membro", entidade="membros",
                depois={"email": email, "papel": papel})


def modelos_cargo(segmento_id: str | None = None) -> list[dict]:
    t = _t("modelos_cargo")
    q = select(t).order_by(t.c.ordem)
    return _linhas(q.where(t.c.segmento_id == segmento_id) if segmento_id else q)


def modelos_indicador(segmento_id: str | None = None) -> list[dict]:
    t, tc = _t("modelos_indicador"), _t("modelos_cargo")
    q = select(t).order_by(t.c.ordem)
    if segmento_id:
        q = q.where(t.c.modelo_cargo_id.in_(select(tc.c.id).where(tc.c.segmento_id == segmento_id)))
    return _linhas(q)


def organizacao_padrao() -> str | None:
    """A organização quando a conversa não diz qual: GESTORGOV_ORGANIZACAO (o id) ou a única cadastrada."""
    escolhida = os.getenv("GESTORGOV_ORGANIZACAO", "").strip()
    t = _t("organizacoes")
    if escolhida:
        achada = _uma(select(t.c.id).where(t.c.id == escolhida))
        return str(achada["id"]) if achada else None
    todas = _linhas(select(t.c.id))
    return str(todas[0]["id"]) if len(todas) == 1 else None


def areas(organizacao_id: str) -> list[dict]:
    t = _t("areas")
    return _linhas(select(t).where(t.c.organizacao_id == organizacao_id).order_by(t.c.andar, t.c.posicao))


def area_por_tipo_ou_nome(organizacao_id: str, chave: str) -> dict | None:
    alvo = _sem_acento(chave)
    for s in areas(organizacao_id):
        if s["tipo_id"] == chave or _sem_acento(s["nome"]) == alvo:
            return s
    return None


def unidades(organizacao_id: str, tipo_id: str | None = None) -> list[dict]:
    t = _t("unidades")
    q = select(t).where(t.c.organizacao_id == organizacao_id).order_by(t.c.tipo_id, t.c.nome)
    if tipo_id:
        q = q.where(t.c.tipo_id == tipo_id)
    return _linhas(q)


def pessoas(organizacao_id: str) -> list[dict]:
    t = _t("pessoas")
    return _linhas(select(t).where(t.c.organizacao_id == organizacao_id).order_by(t.c.nome))


def atividades(organizacao_id: str, area_id: str | None = None) -> list[dict]:
    t = _t("atividades_area")
    q = select(t).where(t.c.organizacao_id == organizacao_id).order_by(t.c.area_id, t.c.nome)
    if area_id:
        q = q.where(t.c.area_id == area_id)
    return _linhas(q)


def agentes_area(organizacao_id: str) -> list[dict]:
    t = _t("agentes_area")
    return _linhas(select(t).where(t.c.organizacao_id == organizacao_id))


def onboarding_aberto(organizacao_id: str) -> dict | None:
    t = _t("onboardings")
    return _uma(select(t).where(t.c.organizacao_id == organizacao_id, t.c.concluido_em.is_(None))
                .order_by(t.c.iniciado_em.desc()))


def _com_fotos(organizacao_id: str, lista: list[dict]) -> list[dict]:
    """As unidades com a foto principal (foto_id) e quantas fotos cada uma tem."""
    principal: dict[str, str] = {}
    quantas: dict[str, int] = {}
    for f in fotos(organizacao_id):
        chave = str(f["unidade_id"])
        quantas[chave] = quantas.get(chave, 0) + 1
        if f["principal"]:
            principal[chave] = str(f["id"])
    return [{**u, "foto_id": principal.get(str(u["id"])), "fotos": quantas.get(str(u["id"]), 0)} for u in lista]


def panorama(organizacao_id: str) -> dict:
    """Tudo o que a tela precisa para desenhar o mapa e o prédio: a organização (com o segmento e os nomes de tela),
    as áreas com atividades, agentes e responsáveis, as unidades, as pessoas e a fase da implantação."""
    org = organizacao(organizacao_id)
    if not org:
        return {"organizacao": None}
    gente = {str(p["id"]): p for p in pessoas(organizacao_id)}
    por_area: dict[str, list] = {}
    for a in atividades(organizacao_id):
        por_area.setdefault(str(a["area_id"]), []).append(a)
    agentes_de: dict[str, list] = {}
    for a in agentes_area(organizacao_id):
        agentes_de.setdefault(str(a["area_id"]), []).append(a)
    lista_areas = []
    for s in areas(organizacao_id):
        resp = gente.get(str(s["responsavel_id"])) if s.get("responsavel_id") else None
        lista_areas.append({**s, "responsavel": resp, "atividades": por_area.get(str(s["id"]), []),
                            "agentes": agentes_de.get(str(s["id"]), [])})
    return _json({
        "organizacao": org,
        "segmento": segmentos.de(org).para_tela(),
        "areas": lista_areas,
        "unidades": _com_fotos(organizacao_id, unidades(organizacao_id)),
        "pessoas": list(gente.values()),
        "onboarding": onboarding_aberto(organizacao_id),
        "pendencias": (falta := pendencias(organizacao_id)),
        "fase": fase_atual(organizacao_id, falta),
    })


# ───────────────────────── Gravação ─────────────────────────

def registrar_organizacao(*, segmento_id: str, nome: str, quem: str, codigo_ibge: str = "", cidade: str = "",
                          uf: str = "", cep: str = "", cnpj: str = "", latitude: float | None = None,
                          longitude: float | None = None, responsavel_nome: str = "", responsavel_email: str = "",
                          session_id: str | None = None) -> dict:
    """Cria (ou atualiza) a organização e abre a implantação. Saúde pública: uma Secretaria de Saúde por município
    (pelo código IBGE). Empresa: uma por CNPJ, quando ele vem."""
    seg = segmentos.segmento(segmento_id)
    to, tb = _t("organizacoes"), _t("onboardings")
    codigo_ibge = re.sub(r"\D", "", codigo_ibge or "")[:7] or None
    cnpj = re.sub(r"\D", "", cnpj or "") or None
    if cnpj and not cnpj_valido(cnpj):
        raise ValueError(f"{cnpj} não é um CNPJ válido (os dígitos verificadores não conferem).")
    with _estado["engine"].begin() as c:
        atual = None
        if seg.um_por_municipio and codigo_ibge:
            atual = c.execute(select(to).where(to.c.segmento_id == seg.id, to.c.codigo_ibge == codigo_ibge)).mappings().first()
        elif cnpj:
            atual = c.execute(select(to).where(to.c.segmento_id == seg.id, to.c.cnpj == cnpj)).mappings().first()
        valores = {"nome": (nome or "").strip(), "codigo_ibge": codigo_ibge, "cidade": cidade or None,
                   "uf": (uf or "").upper() or None, "cep": re.sub(r"\D", "", cep or "") or None, "cnpj": cnpj,
                   "latitude": latitude, "longitude": longitude, "responsavel_nome": responsavel_nome or None,
                   "responsavel_email": (responsavel_email or "").strip().lower() or None}
        if atual:
            oid = str(atual["id"])
            c.execute(update(to).where(to.c.id == atual["id"]).values(**{k: v for k, v in valores.items() if v}))
        else:
            oid = _id()
            c.execute(insert(to).values(id=oid, segmento_id=seg.id, criado_por=quem, dados_segmento={}, **valores))
        auditar(c, organizacao_id=oid, origem="agente", quem=quem, acao="registrar", entidade="organizacoes",
                entidade_id=oid, depois={"segmento_id": seg.id, **valores}, session_id=session_id)
        aberto = c.execute(select(tb).where(tb.c.organizacao_id == oid, tb.c.concluido_em.is_(None))).mappings().first()
        if not aberto:
            c.execute(insert(tb).values(id=_id(), organizacao_id=oid, session_id=session_id, etapa="organizacao",
                                        estado={}, iniciado_por=quem))
    return organizacao(oid) or {}


# ───────── Cadastro detalhado da organização (fase 1 da implantação) ─────────
# Os campos (e os obrigatórios) de cada segmento estão em agente/segmentos.py. Fora deles, a gravação aceita
# também as coordenadas da sede.
CAMPOS_EXTRAS = ("sede_latitude", "sede_longitude")


def cnpj_valido(cnpj: str) -> bool:
    """Confere os dois dígitos verificadores do CNPJ."""
    n = re.sub(r"\D", "", cnpj or "")
    if len(n) != 14 or n == n[0] * 14:
        return False
    def digito(base: str, pesos: list[int]) -> str:
        resto = sum(int(a) * b for a, b in zip(base, pesos)) % 11
        return "0" if resto < 2 else str(11 - resto)
    d1 = digito(n[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    d2 = digito(n[:12] + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return n[12:] == d1 + d2


def _normalizar(tipo: str, valor):
    """Limpa e confere um campo do cadastro pelo tipo (segmentos.TIPOS_CAMPO). ValueError com a explicação se não vale."""
    if valor is None:
        return None
    if isinstance(valor, str):
        valor = valor.strip()
        if not valor:
            return None
    if tipo == "cnpj":
        if not cnpj_valido(str(valor)):
            raise ValueError(f"{valor} não é um CNPJ válido (os dígitos verificadores não conferem).")
        return re.sub(r"\D", "", str(valor))
    if tipo == "cep":
        n = re.sub(r"\D", "", str(valor))
        if len(n) != 8:
            raise ValueError("O CEP precisa ter 8 dígitos.")
        return n
    if tipo == "telefone":
        n = re.sub(r"\D", "", str(valor))
        if len(n) < 10 or len(n) > 13:
            raise ValueError(f"Telefone {valor}: informe com DDD (10 ou 11 dígitos).")
        return str(valor)
    if tipo == "email":
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", str(valor)):
            raise ValueError(f"{valor} não parece um e-mail.")
        return str(valor).lower()
    if tipo == "inteiro":
        n = re.sub(r"\D", "", str(valor))
        if not n:
            raise ValueError(f"{valor}: informe um número.")
        return int(n)
    if tipo == "uf":
        uf = str(valor).upper()
        if not re.fullmatch(r"[A-Z]{2}", uf):
            raise ValueError(f"{valor}: a UF tem duas letras (ex.: RJ).")
        return uf
    return valor


def salvar_cadastro(organizacao_id: str, campos: dict, quem: str, session_id: str | None = None) -> dict:
    """Grava os campos do cadastro da organização que vierem preenchidos (os do segmento, por chave; os de
    dados_segmento podem vir com ou sem o prefixo "dados."). Confere CNPJ, CEP, telefone e e-mail: os inválidos
    voltam em `recusados`, com o motivo; os que o segmento não tem, em `ignorados`."""
    t = _t("organizacoes")
    with _estado["engine"].begin() as c:
        atual = c.execute(select(t).where(t.c.id == organizacao_id)).mappings().first()
        if atual is None:
            raise LookupError("Organização não encontrada.")
        seg = segmentos.de(atual)
        colunas, dados, recusados, ignorados = {}, dict(atual.get("dados_segmento") or {}), {}, []
        for chave, valor in campos.items():
            if valor in (None, ""):
                continue
            if chave in CAMPOS_EXTRAS:
                colunas[chave] = valor
                continue
            campo = seg.campo(chave.removeprefix("dados."))
            if campo is None:
                ignorados.append(chave)
                continue
            try:
                limpo = _normalizar(campo.tipo, valor)
            except ValueError as erro:
                recusados[chave] = str(erro)
                continue
            if limpo is None:
                continue
            if campo.chave.startswith("dados."):
                dados[campo.chave.removeprefix("dados.")] = limpo
            else:
                colunas[campo.chave] = limpo
        antes = {k: atual.get(k) for k in colunas}
        if dados != (atual.get("dados_segmento") or {}):
            colunas["dados_segmento"] = dados
            antes["dados_segmento"] = atual.get("dados_segmento")
        if colunas:
            c.execute(update(t).where(t.c.id == organizacao_id).values(**colunas))
            auditar(c, organizacao_id=organizacao_id, origem="agente", quem=quem, acao="cadastrar", entidade="organizacoes",
                    entidade_id=organizacao_id, antes=antes, depois=colunas, session_id=session_id)
    gravados = [k for k in colunas if k != "dados_segmento"] + [k for k in dados if dados.get(k) != (atual.get("dados_segmento") or {}).get(k)]
    return {"gravados": gravados, "recusados": recusados, "ignorados": ignorados}


def valor_do_campo(org: dict, chave: str):
    if chave.startswith("dados."):
        return (org.get("dados_segmento") or {}).get(chave.removeprefix("dados."))
    return org.get(chave)


def faltando_no_cadastro(organizacao_id: str) -> list[str]:
    """Os campos obrigatórios da fase 1 (pelo segmento) que ainda estão vazios (rótulos)."""
    org = organizacao(organizacao_id) or {}
    return [c.rotulo for c in segmentos.de(org).campos if c.obrigatorio and valor_do_campo(org, c.chave) in (None, "")]


# ───────── As fases da implantação: cada uma obrigatória antes da próxima ─────────

FASES = ("organizacao", "areas", "atividades", "cargos", "responsaveis", "agentes", "equipe", "unidades", "revisao")
# A implantação conclui com as fases até a equipe completas; as unidades podem ficar para depois (o assistente
# continua disponível para cadastrá-las).


def pendencias(organizacao_id: str) -> dict[str, list[str]]:
    """O que falta em cada fase (vazio = fase completa)."""
    org = organizacao(organizacao_id) or {}
    r = segmentos.de(org).rotulos
    lista_setores = areas(organizacao_id)
    com_atividade = {str(a["area_id"]) for a in atividades(organizacao_id)}
    com_agente = {str(a["area_id"]) for a in agentes_area(organizacao_id)}
    estado = (onboarding_aberto(organizacao_id) or {}).get("estado") or {}
    if org.get("situacao") == "ativo":
        estado = {**estado, "unidades_confirmadas": True}  # implantada: as unidades seguem pelo assistente, sem prazo
    qtd_unidades = len(unidades(organizacao_id))
    tc, tv, tm = _t("cargos"), _t("convites"), _t("membros")
    com_cargo = {str(c["area_id"]) for c in _linhas(select(tc.c.area_id).where(tc.c.organizacao_id == organizacao_id,
                                                                                tc.c.area_id.is_not(None)))}
    # Equipe: cada responsável de setor com acesso (membro ou convite); os convites do assistente aprovados no painel.
    gente = {str(p["id"]): p for p in pessoas(organizacao_id)}
    membros_emails = {m["email"] for m in _linhas(select(tm.c.email).where(tm.c.organizacao_id == organizacao_id))}
    convites = _linhas(select(tv).where(tv.c.organizacao_id == organizacao_id, tv.c.aceito_em.is_(None), tv.c.cancelado_em.is_(None)))
    convidados = {c["email"] for c in convites}
    sem_acesso = []
    for s in lista_setores:
        resp = gente.get(str(s.get("responsavel_id"))) if s.get("responsavel_id") else None
        if resp and resp.get("email") and resp["email"].lower() not in membros_emails | convidados:
            sem_acesso.append(f"Dar acesso a {resp['nome']} ({s['nome']})")
    esperando = [f"Aprovar no painel o acesso de {c['email']}" for c in convites
                 if c.get("origem") == "assistente" and not c.get("aprovado_em")]
    return {
        "organizacao": faltando_no_cadastro(organizacao_id),
        "areas": [] if lista_setores else [f"Confirmar os {r['areas']} da {r['organizacao_curta']}"],
        "atividades": [f"Atividades de {s['nome']}" for s in lista_setores if str(s["id"]) not in com_atividade],
        "cargos": [f"Cargos de {s['nome']}" for s in lista_setores if str(s["id"]) not in com_cargo],
        "responsaveis": [f"Responsável de {s['nome']}" for s in lista_setores if not s.get("responsavel_id")],
        "agentes": [f"Agente de {s['nome']}" for s in lista_setores if str(s["id"]) not in com_agente],
        "equipe": sem_acesso + esperando,
        # Unidades: completas quando o responsável confirma a lista ou decide cadastrar depois.
        "unidades": [] if estado.get("unidades_confirmadas") else
                    ([f"Trazer as {r['unidades']} ({'CNES ou CEP' if segmentos.de(org).usa_cnes else 'pelo CEP'}) ou deixar para depois"]
                     if not qtd_unidades else [f"O(a) {r['responsavel']} confirmar que a lista de {r['unidades']} está completa"]),
        "revisao": [],
    }


def fase_atual(organizacao_id: str, falta: dict | None = None) -> str:
    """A primeira fase que ainda tem pendência (na ordem); tudo completo, a revisão."""
    if ((organizacao(organizacao_id) or {}).get("situacao")) == "ativo":
        return "concluido"
    falta = falta if falta is not None else pendencias(organizacao_id)
    return next((f for f in FASES if falta.get(f)), "revisao")


def bloqueio(organizacao_id: str, fase: str) -> list[str]:
    """O que falta nas fases ANTES de `fase` (vazio = pode trabalhar nela)."""
    falta = pendencias(organizacao_id)
    anteriores = FASES[:FASES.index(fase)]
    return [f"{f}: {item}" for f in anteriores for item in falta.get(f, [])]


def sincronizar_etapa(organizacao_id: str) -> str:
    """Grava no onboarding aberto a fase atual (a primeira incompleta). Devolve a fase."""
    fase = fase_atual(organizacao_id)
    avancar_etapa(organizacao_id, fase)
    return fase


def marcar_unidades_confirmadas(organizacao_id: str) -> None:
    to = _t("onboardings")
    aberto = onboarding_aberto(organizacao_id)
    if not aberto:
        return
    with _estado["engine"].begin() as c:
        c.execute(update(to).where(to.c.id == aberto["id"]).values(estado={**(aberto.get("estado") or {}), "unidades_confirmadas": True}))


def avancar_etapa(organizacao_id: str, etapa: str) -> None:
    to = _t("onboardings")
    with _estado["engine"].begin() as c:
        c.execute(update(to).where(to.c.organizacao_id == organizacao_id, to.c.concluido_em.is_(None)).values(etapa=etapa))


def salvar_unidade(organizacao_id: str, *, nome: str, tipo_id: str, quem: str, endereco: str = "", bairro: str = "",
                   cep: str = "", cnes: str = "", latitude: float | None = None, longitude: float | None = None,
                   origem: str = "manual", dados_cnes: dict | None = None, confirmada: bool = True,
                   gestao: str | None = None, session_id: str | None = None, numero: str = "", complemento: str = "",
                   telefone: str = "", email: str = "", coordenadas_origem: str | None = None,
                   origem_auditoria: str = "agente") -> dict:
    tu = _t("unidades")
    cnes = re.sub(r"\D", "", cnes or "")[:7] or None
    valores = {"nome": nome.strip(), "tipo_id": tipo_id, "endereco": endereco or None, "bairro": bairro or None,
               "cep": re.sub(r"\D", "", cep or "") or None, "latitude": latitude, "longitude": longitude,
               "origem": origem, "dados_cnes": dados_cnes, "confirmada": confirmada, "gestao": gestao,
               "numero": numero or None,
               "complemento": complemento or None, "telefone": telefone or None, "email": email or None,
               "coordenadas_origem": coordenadas_origem or (("cnes" if origem == "cnes" else "endereco") if latitude else None)}
    if confirmada:
        valores.update(conferida_por=quem, conferida_em=_agora())
    with _estado["engine"].begin() as c:
        atual = None
        if cnes:
            atual = c.execute(select(tu).where(tu.c.organizacao_id == organizacao_id, tu.c.cnes == cnes)).mappings().first()
        if atual:
            uid = str(atual["id"])
            c.execute(update(tu).where(tu.c.id == atual["id"]).values(**{k: v for k, v in valores.items() if v is not None}))
        else:
            uid = _id()
            c.execute(insert(tu).values(id=uid, organizacao_id=organizacao_id, cnes=cnes, criado_por=quem, **valores))
        auditar(c, organizacao_id=organizacao_id, origem=origem_auditoria, quem=quem, acao="salvar", entidade="unidades",
                entidade_id=uid, depois={**valores, "cnes": cnes, "dados_cnes": None}, session_id=session_id)
    return _json({"id": uid, **valores, "cnes": cnes})


# Campos da unidade que a organização edita pelo painel.
CAMPOS_UNIDADE = ("nome", "nome_fantasia", "tipo_id", "cnes", "endereco", "numero", "complemento", "bairro", "cep",
                  "telefone", "email", "latitude", "longitude", "coordenadas_origem", "situacao", "gestao", "horario")
SITUACOES_UNIDADE = ("ativa", "inativa", "em_obra")


def ligar_agente_as_unidades(organizacao_id: str, agente_id: str) -> int:
    """Põe o agente nas unidades da organização que ainda não têm agente. Devolve quantas ganharam."""
    t = _t("unidades")
    with _estado["engine"].begin() as c:
        return c.execute(update(t).where(t.c.organizacao_id == organizacao_id, t.c.agente_id.is_(None))
                         .values(agente_id=agente_id)).rowcount


def unidade(organizacao_id: str, unidade_id: str) -> dict | None:
    t = _t("unidades")
    return _uma(select(t).where(t.c.organizacao_id == organizacao_id, t.c.id == unidade_id))


def alterar_unidade(organizacao_id: str, unidade_id: str, campos: dict, quem: str, conferir: bool | None = None) -> dict:
    """Altera a unidade (só os campos de CAMPOS_UNIDADE que vierem) e, com `conferir`, marca como conferida (ou
    desmarca). Vai para a auditoria com o antes e o depois. LookupError se a unidade não é do município."""
    t = _t("unidades")
    valores = {k: v for k, v in campos.items() if k in CAMPOS_UNIDADE}
    for chave, tamanho in (("cep", 8), ("cnes", 7)):
        if chave in valores:
            valores[chave] = re.sub(r"\D", "", valores[chave] or "")[:tamanho] or None
    if "situacao" in valores and valores["situacao"] not in SITUACOES_UNIDADE:
        raise ValueError(f"Situação inválida. Use: {', '.join(SITUACOES_UNIDADE)}.")
    if "tipo_id" in valores and valores["tipo_id"] not in {x["id"] for x in tipos_unidade()}:
        raise ValueError("Tipo de unidade inválido.")
    if "nome" in valores and not (valores["nome"] or "").strip():
        raise ValueError("Dê um nome à unidade.")
    if conferir is True:
        valores.update(confirmada=True, conferida_por=quem, conferida_em=_agora())
    elif conferir is False:
        valores.update(confirmada=False, conferida_por=None, conferida_em=None)
    with _estado["engine"].begin() as c:
        atual = c.execute(select(t).where(t.c.organizacao_id == organizacao_id, t.c.id == unidade_id)).mappings().first()
        if atual is None:
            raise LookupError("Unidade não encontrada.")
        if valores:
            c.execute(update(t).where(t.c.id == atual["id"]).values(**valores))
            auditar(c, organizacao_id=organizacao_id, origem="pessoa", quem=quem, acao="alterar", entidade="unidades",
                    entidade_id=str(atual["id"]), antes={k: atual[k] for k in valores if k in atual}, depois=valores)
    return _json(unidade(organizacao_id, unidade_id))


# ───────── Fotos das unidades (arquivo no bucket organizacoes; agente/armazenamento.py) ─────────

TIPOS_FOTO = ("fachada", "interior", "outra")
MAX_BYTES_FOTO = 10 * 1024 * 1024
LADO_MAXIMO_FOTO = 1600  # px: a foto é reduzida e regravada em JPEG (sem os metadados, como a localização do celular)


def fotos(organizacao_id: str, unidade_id: str | None = None) -> list[dict]:
    t = _t("unidade_fotos")
    q = select(t).where(t.c.organizacao_id == organizacao_id).order_by(t.c.principal.desc(), t.c.enviada_em.desc())
    if unidade_id:
        q = q.where(t.c.unidade_id == unidade_id)
    return [{k: v for k, v in f.items() if k != "caminho"} for f in _linhas(q)]


def _preparar_foto(conteudo: bytes) -> tuple[bytes, int, int]:
    """Reduz e regrava em JPEG, já virada conforme o celular tirou. ValueError se não for uma imagem."""
    from io import BytesIO

    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        imagem = Image.open(BytesIO(conteudo))
        imagem = ImageOps.exif_transpose(imagem).convert("RGB")
    except (UnidentifiedImageError, OSError) as erro:
        raise ValueError("O arquivo não é uma imagem (envie JPG, PNG ou WEBP).") from erro
    imagem.thumbnail((LADO_MAXIMO_FOTO, LADO_MAXIMO_FOTO))
    saida = BytesIO()
    imagem.save(saida, "JPEG", quality=82, optimize=True)
    return saida.getvalue(), imagem.width, imagem.height


def salvar_foto(organizacao_id: str, unidade_id: str, conteudo: bytes, quem: str, tipo: str = "fachada",
                legenda: str = "") -> dict:
    from agente import armazenamento

    if not unidade(organizacao_id, unidade_id):
        raise LookupError("Unidade não encontrada.")
    if tipo not in TIPOS_FOTO:
        raise ValueError(f"Tipo de foto inválido. Use: {', '.join(TIPOS_FOTO)}.")
    if len(conteudo) > MAX_BYTES_FOTO:
        raise ValueError("A foto passa de 10 MB.")
    jpeg, largura, altura = _preparar_foto(conteudo)
    fid = _id()
    caminho = f"{organizacao_id}/unidades/{unidade_id}/{fid}.jpg"
    armazenamento.guardar(caminho, jpeg, "image/jpeg")
    t = _t("unidade_fotos")
    with _estado["engine"].begin() as c:
        tem_principal = c.execute(select(t.c.id).where(t.c.unidade_id == unidade_id, t.c.principal.is_(True))).first()
        valores = {"tipo": tipo, "mime": "image/jpeg", "bytes": len(jpeg), "largura": largura, "altura": altura,
                   "legenda": legenda or None, "principal": not tem_principal}
        c.execute(insert(t).values(id=fid, organizacao_id=organizacao_id, unidade_id=unidade_id, caminho=caminho,
                                   enviada_por=quem, enviada_em=_agora(), **valores))
        auditar(c, organizacao_id=organizacao_id, origem="pessoa", quem=quem, acao="enviar_foto", entidade="unidade_fotos",
                entidade_id=fid, depois={**valores, "unidade_id": unidade_id})
    return _json({"id": fid, "unidade_id": unidade_id, **valores})


def _foto(organizacao_id: str, foto_id: str) -> dict | None:
    t = _t("unidade_fotos")
    return _uma(select(t).where(t.c.organizacao_id == organizacao_id, t.c.id == foto_id))


def conteudo_foto(organizacao_id: str, foto_id: str) -> bytes:
    from agente import armazenamento

    dados = _foto(organizacao_id, foto_id)
    if not dados:
        raise LookupError("Foto não encontrada.")
    return armazenamento.ler(dados["caminho"])


def tornar_principal(organizacao_id: str, foto_id: str, quem: str) -> None:
    t = _t("unidade_fotos")
    dados = _foto(organizacao_id, foto_id)
    if not dados:
        raise LookupError("Foto não encontrada.")
    with _estado["engine"].begin() as c:
        c.execute(update(t).where(t.c.unidade_id == dados["unidade_id"]).values(principal=False))
        c.execute(update(t).where(t.c.id == foto_id).values(principal=True))
        auditar(c, organizacao_id=organizacao_id, origem="pessoa", quem=quem, acao="foto_principal", entidade="unidade_fotos",
                entidade_id=str(foto_id))


def apagar_foto(organizacao_id: str, foto_id: str, quem: str) -> None:
    from agente import armazenamento

    t = _t("unidade_fotos")
    dados = _foto(organizacao_id, foto_id)
    if not dados:
        raise LookupError("Foto não encontrada.")
    with _estado["engine"].begin() as c:
        c.execute(t.delete().where(t.c.id == foto_id))
        if dados["principal"]:  # a mais recente que sobrou vira a principal
            outra = c.execute(select(t.c.id).where(t.c.unidade_id == dados["unidade_id"])
                              .order_by(t.c.enviada_em.desc())).first()
            if outra:
                c.execute(update(t).where(t.c.id == outra[0]).values(principal=True))
        auditar(c, organizacao_id=organizacao_id, origem="pessoa", quem=quem, acao="apagar_foto", entidade="unidade_fotos",
                entidade_id=str(foto_id), antes={"unidade_id": str(dados["unidade_id"]), "tipo": dados["tipo"]})
    try:
        armazenamento.remover(dados["caminho"])
    except Exception:  # o registro já saiu; um arquivo órfão no bucket não atrapalha
        pass


def salvar_area(organizacao_id: str, *, nome: str, tipo_id: str | None, quem: str, descricao: str = "",
                 session_id: str | None = None) -> dict:
    ts = _t("areas")
    org = organizacao(organizacao_id)
    if not org:
        raise ValueError("a organização ainda não foi registrada")
    existentes = areas(organizacao_id)
    for s in existentes:
        if _sem_acento(s["nome"]) == _sem_acento(nome) or (tipo_id and s["tipo_id"] == tipo_id):
            return s
    ordem = len(existentes)
    andar, posicao = ordem // 3, ordem % 3  # três salas por andar no prédio 3D
    sid = _id()
    with _estado["engine"].begin() as c:
        c.execute(insert(ts).values(id=sid, organizacao_id=organizacao_id, tipo_id=tipo_id,
                                    nome=nome.strip(), descricao=descricao or None, andar=andar, posicao=posicao))
        to = _t("organizacoes")
        andares = andar + 1
        if andares > (org.get("andares") or 0):
            c.execute(update(to).where(to.c.id == organizacao_id).values(andares=andares))
        auditar(c, organizacao_id=organizacao_id, origem="agente", quem=quem, acao="criar", entidade="areas",
                entidade_id=sid, depois={"nome": nome, "tipo_id": tipo_id, "andar": andar}, session_id=session_id)
    return {"id": sid, "nome": nome, "tipo_id": tipo_id, "andar": andar, "posicao": posicao}


def salvar_atividade(organizacao_id: str, area_id: str, *, nome: str, descricao: str, tipo: str, frequencia: str,
                     quem: str, modelo_id: str | None = None, cron: str | None = None, entregavel: str | None = None,
                     session_id: str | None = None) -> dict:
    ta = _t("atividades_area")
    with _estado["engine"].begin() as c:
        atual = c.execute(select(ta).where(ta.c.area_id == area_id, ta.c.nome == nome)).mappings().first()
        valores = {"descricao": descricao, "tipo": tipo, "frequencia": frequencia, "cron": cron,
                   "entregavel": entregavel, "modelo_id": modelo_id, "ativa": True}
        if atual:
            aid = str(atual["id"])
            c.execute(update(ta).where(ta.c.id == atual["id"]).values(**valores))
        else:
            aid = _id()
            c.execute(insert(ta).values(id=aid, organizacao_id=organizacao_id, area_id=area_id, nome=nome, **valores))
        auditar(c, organizacao_id=organizacao_id, origem="agente", quem=quem, acao="salvar", entidade="atividades_area",
                entidade_id=aid, depois={"nome": nome, **valores}, session_id=session_id)
    return {"id": aid, "nome": nome, **valores}


def salvar_pessoa(organizacao_id: str, *, nome: str, email: str, quem: str, cargo: str = "", area_id: str | None = None,
                    papel: str = "coordenador", aprova_tarefas: bool = True, responsavel_da_area: bool = False,
                    session_id: str | None = None) -> dict:
    tp, ts = _t("pessoas"), _t("areas")
    email = email.strip().lower()
    with _estado["engine"].begin() as c:
        atual = c.execute(select(tp).where(tp.c.organizacao_id == organizacao_id, tp.c.email == email)).mappings().first()
        valores = {"nome": nome.strip(), "cargo": cargo or None, "area_id": area_id, "papel": papel,
                   "aprova_tarefas": aprova_tarefas}
        if atual:
            pid = str(atual["id"])
            c.execute(update(tp).where(tp.c.id == atual["id"]).values(**valores))
        else:
            pid = _id()
            c.execute(insert(tp).values(id=pid, organizacao_id=organizacao_id, email=email, **valores))
        if responsavel_da_area and area_id:
            c.execute(update(ts).where(ts.c.id == area_id).values(responsavel_id=pid))
            ta = _t("atividades_area")
            c.execute(update(ta).where(ta.c.area_id == area_id, ta.c.aprovador_id.is_(None)).values(aprovador_id=pid))
        auditar(c, organizacao_id=organizacao_id, origem="agente", quem=quem, acao="salvar", entidade="pessoas",
                entidade_id=pid, depois={"email": email, **valores}, session_id=session_id)
    return {"id": pid, "email": email, **valores}


def ligar_agente_a_area(organizacao_id: str, area_id: str, agente_id: str, funcao: str, quem: str,
                          session_id: str | None = None) -> None:
    tg, ta = _t("agentes_area"), _t("atividades_area")
    with _estado["engine"].begin() as c:
        existe = c.execute(select(tg.c.id).where(tg.c.area_id == area_id, tg.c.agente_id == agente_id)).first()
        if not existe:
            mesa = len(c.execute(select(tg.c.id).where(tg.c.area_id == area_id)).all())
            c.execute(insert(tg).values(id=_id(), organizacao_id=organizacao_id, area_id=area_id, agente_id=agente_id,
                                        funcao=funcao, mesa=mesa))
        c.execute(update(ta).where(ta.c.area_id == area_id, ta.c.agente_id.is_(None)).values(agente_id=agente_id))
        auditar(c, organizacao_id=organizacao_id, origem="agente", quem=quem, acao="ligar_agente", entidade="agentes_area",
                entidade_id=area_id, depois={"agente_id": agente_id, "funcao": funcao}, session_id=session_id)


def concluir_onboarding(organizacao_id: str, quem: str, session_id: str | None = None) -> None:
    tm, to = _t("organizacoes"), _t("onboardings")
    with _estado["engine"].begin() as c:
        c.execute(update(tm).where(tm.c.id == organizacao_id).values(situacao="ativo"))
        c.execute(update(to).where(to.c.organizacao_id == organizacao_id, to.c.concluido_em.is_(None))
                  .values(etapa="concluido", concluido_em=_agora()))
        auditar(c, organizacao_id=organizacao_id, origem="agente", quem=quem, acao="concluir", entidade="onboardings",
                entidade_id=organizacao_id, session_id=session_id)
