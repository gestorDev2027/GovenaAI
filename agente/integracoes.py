"""Central de integrações (CLAUDE.md, §5b): as integrações externas de cada organização viram ferramentas dos agentes.

Tipos:
- postgres, mysql: bancos de outros sistemas, pelo MCP Toolbox for Databases (agente/toolbox.py). `nosso_banco` é uma
  fonte no banco do GestorGov: só leitura, e o organizacao_id entra como $1 pelo servidor (o modelo nem vê o parâmetro);
  só a equipe da plataforma cadastra;
- http: APIs REST, pelo Toolbox ou, sem ele, chamadas aqui mesmo (com as mesmas travas);
- mcp: servidores MCP externos (JSON-RPC por HTTP, chamado aqui);
- memoria: a memória compartilhada (Mem0 auto-hospedado: vetores no nosso pgvector, modelo e embeddings no Gemini,
  nada na nuvem do Mem0), presa à organização (ou à área) do agente.

Travas de cada chamada (todas no servidor, nunca no modelo):
- o agente só recebe as ferramentas das integrações liberadas na ficha dele (fichas_agente.integracoes) e da
  organização dele;
- o segredo (senha, chave) fica no Vault (funções integracao_*, prefixo "integracao:"); é lido na hora de montar a
  configuração do Toolbox ou de chamar, e nunca vai para a tela, para o prompt ou para a auditoria;
- o host precisa estar nos hosts liberados da integração e não pode apontar para rede interna;
- limite de chamadas por minuto, por integração;
- ferramenta que altera dados não roda na hora: vira um pedido que uma pessoa aprova (Integrações → Pedidos);
- cada chamada vai para integracao_chamadas (quem, qual agente, quando, ok/erro, duração), sem argumentos nem
  resposta; a resposta volta ao modelo cortada e com CPF e cartão mascarados.
"""

import ipaddress
import json
import os
import re
import socket
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from agno.tools.function import Function
from agno.utils.log import log_warning
from sqlalchemy import (JSON, BigInteger, Boolean, Column, DateTime, Integer, MetaData, String, Table, Text, delete, func, insert,
                        select, text, update)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.engine import Engine

from agente import gestao

TIPOS = {
    "postgres": "Banco PostgreSQL",
    "mysql": "Banco MySQL",
    "http": "API REST (HTTP)",
    "mcp": "Servidor MCP",
    "memoria": "Memória compartilhada (Mem0)",
}
TIPOS_PARAMETRO = ("string", "integer", "float", "boolean")
LOCAIS_HTTP = ("query", "body")
METODOS_LEITURA = ("GET",)
METODOS = ("GET", "POST", "PUT", "PATCH", "DELETE")
NOME_FERRAMENTA = re.compile(r"^[a-z][a-z0-9_]{2,40}$")
NOME_PARAMETRO = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,40}$")
HOST_VALIDO = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
SQL_MUDA = re.compile(r"\b(insert|update|delete|merge|upsert|create|alter|drop|truncate|grant|revoke|call|do|copy|replace)\b", re.I)
MAX_RESPOSTA = 6000
ESCOPOS_MEMORIA = ("organizacao", "area")

_estado: dict = {}
_trava = threading.Lock()


class ErroIntegracao(Exception):
    def __init__(self, status: int, detalhe: str):
        super().__init__(detalhe)
        self.status, self.detalhe = status, detalhe


def _erro(texto: str, status: int = 422):
    raise ErroIntegracao(status, texto)


def _agora() -> datetime:
    return datetime.now(timezone.utc)


def _id() -> str:
    return str(uuid.uuid4())


def _hex(valor) -> str:
    return str(valor).replace("-", "")


# ───────── Tabelas (as mesmas da migration 20261113_gestorgov_integracoes.sql) ─────────

def _tabelas(schema: str | None, sqlite: bool) -> dict[str, Table]:
    m = MetaData(schema=schema)
    tipo_id = String(36).with_variant(PG_UUID(as_uuid=False), "postgresql")
    uid = lambda nome, *a, **kw: Column(nome, tipo_id, *a, **kw)  # noqa: E731
    quando = lambda nome, **kw: Column(nome, DateTime(timezone=True), **kw)  # noqa: E731
    t = {
        "integracoes": Table(
            "integracoes", m,
            uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), Column("nome", Text, nullable=False),
            Column("descricao", Text, default=""), Column("tipo", Text, nullable=False), Column("endereco", Text),
            Column("porta", Integer), Column("banco", Text), Column("usuario", Text), Column("config", JSON, default=dict),
            Column("nosso_banco", Boolean, default=False), Column("hosts_liberados", JSON, default=list),
            Column("segredo_ref", Text), Column("segredo_final", Text), Column("situacao", Text, default="ativa"),
            Column("limite_por_minuto", Integer, default=30), quando("ultimo_teste_em"), Column("ultimo_teste_ok", Boolean),
            Column("ultimo_teste_detalhe", Text), Column("criado_por", Text, nullable=False), quando("criado_em", default=_agora),
            Column("atualizado_por", Text), quando("atualizado_em", default=_agora, onupdate=_agora)),
        "ferramentas": Table(
            "integracao_ferramentas", m,
            uid("id", primary_key=True, default=_id), uid("organizacao_id", nullable=False), uid("integracao_id", nullable=False),
            Column("nome", Text, nullable=False), Column("descricao", Text, nullable=False), Column("sql", Text),
            Column("metodo", Text), Column("caminho", Text), Column("corpo", Text), Column("parametros", JSON, default=list),
            Column("altera_dados", Boolean, default=False), Column("ativa", Boolean, default=True),
            Column("criado_por", Text, nullable=False), quando("criado_em", default=_agora), Column("atualizado_por", Text),
            quando("atualizado_em", default=_agora, onupdate=_agora)),
        "chamadas": Table(
            "integracao_chamadas", m,
            Column("id", BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True),
            uid("organizacao_id", nullable=False), uid("integracao_id"), uid("ferramenta_id"), Column("ferramenta", Text, nullable=False),
            Column("agente_id", Text), Column("quem", Text, nullable=False), Column("sessao_id", Text),
            quando("em", default=_agora), Column("situacao", Text, nullable=False), Column("duracao_ms", Integer),
            Column("detalhe", Text), Column("argumentos", JSON), Column("decidido_por", Text), quando("decidido_em")),
    }
    if sqlite:
        # Sem Postgres não há Vault: no SQLite local de desenvolvimento o segredo fica nesta tabela, sem criptografia.
        t["cofre_local"] = Table("integracao_cofre_local", m, Column("nome", String(80), primary_key=True),
                                 Column("valor", Text, nullable=False))
    return t


def iniciar(engine: Engine, schema: str | None) -> None:
    """Descreve as tabelas. No Postgres elas vêm da migration; no SQLite local, são criadas aqui."""
    sqlite = engine.dialect.name == "sqlite"
    tabelas = _tabelas(schema, sqlite)
    if sqlite:
        next(iter(tabelas.values())).metadata.create_all(engine)
    _estado.update(engine=engine, schema=schema, t=tabelas)


def disponivel() -> bool:
    return "engine" in _estado


def _t(nome: str) -> Table:
    return _estado["t"][nome]


def _linhas(consulta) -> list[dict]:
    with _estado["engine"].connect() as c:
        return [dict(r) for r in c.execute(consulta).mappings().all()]


def _uma(consulta) -> dict | None:
    linhas = _linhas(consulta)
    return linhas[0] if linhas else None


# ───────── Cofre (Vault) ─────────

def _funcao(nome: str) -> str:
    schema = _estado.get("schema")
    return (f"{_estado['engine'].dialect.identifier_preparer.quote_schema(schema)}." if schema else "") + nome


def _no_cofre(operacao: str, nome: str, valor: str | None = None, descricao: str = ""):
    """Grava, lê ou apaga um segredo: Vault no Postgres (só alcança "integracao:<nome>"); tabela local no SQLite."""
    engine = _estado["engine"]
    if "cofre_local" not in _estado["t"]:
        sql = {"gravar": f"select {_funcao('integracao_salvar_segredo')}(:nome, :valor, :descricao)",
               "ler": f"select {_funcao('integracao_ler_segredo')}(:nome)",
               "apagar": f"select {_funcao('integracao_apagar_segredo')}(:nome)"}[operacao]
        try:
            with engine.begin() as c:
                return c.execute(text(sql), {"nome": nome, "valor": valor, "descricao": descricao}).scalar()
        except Exception as erro:
            if "does not exist" in str(erro):
                _erro("O cofre das integrações ainda não foi criado no banco (migration 20261113_gestorgov_integracoes.sql).", 503)
            raise
    tabela = _t("cofre_local")
    with engine.begin() as c:
        if operacao == "ler":
            return c.execute(select(tabela.c.valor).where(tabela.c.nome == nome)).scalar()
        c.execute(delete(tabela).where(tabela.c.nome == nome))
        if operacao == "gravar":
            c.execute(insert(tabela).values(nome=nome, valor=valor))
    return None


def ler_segredo(integracao: dict) -> str | None:
    """Só para montar a configuração do Toolbox e as chamadas. Nunca vai para a tela, o prompt ou a auditoria."""
    if integracao.get("nosso_banco"):
        return _url_nosso_banco().password if _url_nosso_banco() else None
    ref = integracao.get("segredo_ref")
    return _no_cofre("ler", ref) if ref else None


# ───────── Hosts ─────────

def _endereco_interno(endereco: str) -> bool:
    ip = ipaddress.ip_address(endereco)
    return (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified
            or (ip.version == 6 and ip.ipv4_mapped is not None and _endereco_interno(str(ip.ipv4_mapped))))


def bloquear_rede_interna(host: str, porta: int = 443) -> None:
    """Recusa host que aponte para rede interna (servidor, rede privada, metadados da nuvem), pela resolução atual."""
    try:
        enderecos = {item[4][0] for item in socket.getaddrinfo(host, porta, proto=socket.IPPROTO_TCP)}
    except socket.gaierror:
        _erro(f"O host {host} não foi encontrado.", 502)
    if not enderecos or any(_endereco_interno(e.split("%")[0]) for e in enderecos):
        _erro(f"O host {host} aponta para uma rede interna: chamada recusada.", 403)


def host_de(integracao: dict) -> str | None:
    endereco = (integracao.get("endereco") or "").strip()
    if integracao["tipo"] in ("http", "mcp"):
        return (urlparse(endereco).hostname or "").lower() or None
    return endereco.lower() or None


def _conferir_host(integracao: dict) -> None:
    """O host da integração está liberado e não aponta para rede interna (o nosso banco é do próprio servidor)."""
    if integracao["tipo"] == "memoria" or integracao.get("nosso_banco"):
        return
    host = host_de(integracao)
    if not host or host not in (integracao.get("hosts_liberados") or []):
        _erro(f"O host {host or '(vazio)'} não está nos hosts liberados desta integração.", 403)
    bloquear_rede_interna(host, int(integracao.get("porta") or 443))


# ───────── Leitura ─────────

def _url_nosso_banco():
    from sqlalchemy.engine import make_url

    url = os.getenv("DATABASE_URL")
    return make_url(url.replace("postgres://", "postgresql://", 1)) if url else None


def _sem_segredo(linha: dict) -> dict:
    saida = gestao._json({k: v for k, v in linha.items() if k != "segredo_ref"})
    saida["tem_segredo"] = bool(linha.get("segredo_ref")) or bool(linha.get("nosso_banco"))
    return saida


def _ferramenta_dict(linha: dict) -> dict:
    return gestao._json(linha)


def integracoes(organizacao_id: str) -> list[dict]:
    ti, tf = _t("integracoes"), _t("ferramentas")
    ferramentas: dict[str, list[dict]] = {}
    for f in _linhas(select(tf).where(tf.c.organizacao_id == organizacao_id).order_by(tf.c.nome)):
        ferramentas.setdefault(str(f["integracao_id"]), []).append(_ferramenta_dict(f))
    usam = _agentes_que_usam(organizacao_id)
    return [{**_sem_segredo(i), "ferramentas": ferramentas.get(str(i["id"]), []), "agentes": usam.get(str(i["id"]), [])}
            for i in _linhas(select(ti).where(ti.c.organizacao_id == organizacao_id).order_by(ti.c.nome))]


def _integracao(organizacao_id: str, integracao_id: str) -> dict:
    ti = _t("integracoes")
    try:
        uuid.UUID(str(integracao_id))
    except ValueError:
        _erro("Integração não encontrada.", 404)
    linha = _uma(select(ti).where(ti.c.id == integracao_id, ti.c.organizacao_id == organizacao_id))
    if not linha:
        _erro("Integração não encontrada.", 404)
    return linha


def integracao(organizacao_id: str, integracao_id: str) -> dict:
    _integracao(organizacao_id, integracao_id)  # 404 se não for desta organização
    return next(i for i in integracoes(organizacao_id) if str(i["id"]) == str(integracao_id))


def _ferramenta(organizacao_id: str, integracao_id: str, ferramenta_id: str) -> dict:
    tf = _t("ferramentas")
    try:
        uuid.UUID(str(ferramenta_id))
    except ValueError:
        _erro("Ferramenta não encontrada.", 404)
    linha = _uma(select(tf).where(tf.c.id == ferramenta_id, tf.c.integracao_id == integracao_id, tf.c.organizacao_id == organizacao_id))
    if not linha:
        _erro("Ferramenta não encontrada.", 404)
    return linha


def _agentes_que_usam(organizacao_id: str) -> dict[str, list[str]]:
    """integracao_id → agentes cuja ficha a libera."""
    tf = gestao._t("fichas_agente")
    saida: dict[str, list[str]] = {}
    for f in gestao._linhas(select(tf.c.agente_id, tf.c.integracoes).where(tf.c.organizacao_id == organizacao_id)):
        for i in f["integracoes"] or []:
            saida.setdefault(str(i), []).append(f["agente_id"])
    return saida


def ids_da_organizacao(organizacao_id: str) -> set[str]:
    ti = _t("integracoes")
    return {str(r["id"]) for r in _linhas(select(ti.c.id).where(ti.c.organizacao_id == organizacao_id))}


# ───────── Cadastro ─────────

def _validar_integracao(dados: dict, atual: dict | None, pode_nosso_banco: bool) -> dict:
    tipo = dados.get("tipo") or (atual or {}).get("tipo")
    if tipo not in TIPOS:
        _erro(f"Tipo inválido. Use: {', '.join(TIPOS)}.")
    if atual and tipo != atual["tipo"]:
        _erro("O tipo não muda depois de criado: crie outra integração.")
    pega = lambda k, padrao=None: dados[k] if k in dados else (atual or {}).get(k, padrao)  # noqa: E731
    nome = " ".join((pega("nome") or "").split())
    if not 2 <= len(nome) <= 80:
        _erro("O nome tem de 2 a 80 caracteres.")
    valores = {"tipo": tipo, "nome": nome, "descricao": " ".join((pega("descricao") or "").split())[:500]}
    nosso = bool(pega("nosso_banco", False))
    if nosso and (tipo != "postgres" or not pode_nosso_banco):
        _erro("Fonte no banco do GestorGov: só do tipo postgres e só a equipe da plataforma cadastra.", 403)
    valores["nosso_banco"] = nosso
    try:
        limite = int(pega("limite_por_minuto", 30) or 30)
    except (TypeError, ValueError):
        limite = 0
    if not 1 <= limite <= 600:
        _erro("O limite de chamadas fica entre 1 e 600 por minuto.")
    valores["limite_por_minuto"] = limite
    situacao = pega("situacao", "ativa")
    if situacao not in ("ativa", "pausada"):
        _erro("Situação inválida: ativa ou pausada.")
    valores["situacao"] = situacao
    config = dict(pega("config") or {})
    endereco = (pega("endereco") or "").strip()
    if tipo == "memoria":
        escopo = config.get("escopo") or "organizacao"
        if escopo not in ESCOPOS_MEMORIA:
            _erro("A memória é da organização inteira ou de cada área.")
        valores.update(endereco=None, porta=None, banco=None, usuario=None, hosts_liberados=[], config={"escopo": escopo})
        return valores
    if nosso:
        valores.update(endereco=None, porta=None, banco=None, usuario=None, hosts_liberados=[], config={})
        return valores
    if tipo in ("http", "mcp"):
        partes = urlparse(endereco)
        if partes.scheme != "https" or not partes.hostname:
            _erro("O endereço precisa começar com https:// e ter um host.")
        if partes.username or partes.password:
            _erro("Não ponha usuário ou senha no endereço: a chave vai no campo do segredo.")
        valores.update(endereco=endereco.rstrip("/"), porta=None, banco=None, usuario=None)
        cabecalho = (config.get("cabecalho_segredo") or "Authorization").strip()
        if not re.match(r"^[A-Za-z0-9-]{1,60}$", cabecalho):
            _erro("Nome de cabeçalho inválido para a chave.")
        fixos = {}
        for nome_c, valor_c in (config.get("cabecalhos") or {}).items():
            if not re.match(r"^[A-Za-z0-9-]{1,60}$", nome_c) or nome_c.lower() in ("authorization", "cookie", cabecalho.lower()):
                _erro(f'Cabeçalho fixo inválido: "{nome_c}". A chave de acesso vai no segredo, nunca num cabeçalho fixo.')
            fixos[nome_c] = str(valor_c)[:300]
        valores["config"] = {"cabecalho_segredo": cabecalho, "prefixo_segredo": (config.get("prefixo_segredo") or "")[:20],
                             "cabecalhos": fixos, "timeout_s": min(max(int(config.get("timeout_s") or 15), 3), 60)}
    else:
        host = endereco.lower()
        if not HOST_VALIDO.match(host):
            _erro("Informe só o host do banco (ex.: banco.sistema.gov.br), sem protocolo nem porta.")
        try:
            porta = int(pega("porta") or (5432 if tipo == "postgres" else 3306))
        except (TypeError, ValueError):
            porta = 0
        if not 1 <= porta <= 65535:
            _erro("Porta inválida.")
        banco, usuario = (pega("banco") or "").strip(), (pega("usuario") or "").strip()
        if not banco or not usuario or len(banco) > 120 or len(usuario) > 120:
            _erro("Informe o nome do banco e o usuário (a senha vai no segredo).")
        sslmode = config.get("sslmode") or "require"
        if sslmode not in ("require", "verify-full", "verify-ca", "prefer"):
            _erro("sslmode inválido.")
        valores.update(endereco=host, porta=porta, banco=banco, usuario=usuario, config={"sslmode": sslmode})
    host = host_de(valores)
    hosts = [h.strip().lower() for h in (pega("hosts_liberados") or []) if str(h).strip()][:20] or [host]
    for h in hosts:
        if not HOST_VALIDO.match(h) or h.endswith((".local", ".internal", ".localhost")):
            _erro(f"Host liberado inválido: {h}.")
    if host not in hosts:
        _erro(f"O host do endereço ({host}) precisa estar nos hosts liberados.")
    valores["hosts_liberados"] = hosts
    return valores


def _gravar_segredo(integracao_id: str, valor: str, nome: str) -> dict:
    valor = (valor or "").strip()
    if not 1 <= len(valor) <= 8000 or "\n" in valor:
        _erro("O segredo tem de 1 a 8.000 caracteres, numa linha só.")
    ref = _hex(integracao_id)
    _no_cofre("gravar", ref, valor, f"Integração {nome}")
    return {"segredo_ref": ref, "segredo_final": valor[-4:] if len(valor) >= 8 else "…"}


def salvar(organizacao_id: str, integracao_id: str | None, dados: dict, quem: str, pode_nosso_banco: bool = False) -> dict:
    """Cria ou altera. `dados["segredo"]`, se vier, vai direto para o Vault; nunca volta."""
    atual = _integracao(organizacao_id, integracao_id) if integracao_id else None
    valores = _validar_integracao(dados, atual, pode_nosso_banco)
    ti = _t("integracoes")
    with _trava:
        repetida = _uma(select(ti.c.id).where(ti.c.organizacao_id == organizacao_id, ti.c.nome == valores["nome"]))
        if repetida and str(repetida["id"]) != str(integracao_id or ""):
            _erro(f"Já existe uma integração chamada {valores['nome']}.", 409)
        novo_id = str(integracao_id) if integracao_id else _id()
        if dados.get("segredo"):
            if valores["tipo"] == "memoria" or valores["nosso_banco"]:
                _erro("Esta integração não usa segredo.")
            valores.update(_gravar_segredo(novo_id, dados["segredo"], valores["nome"]))
        with _estado["engine"].begin() as c:
            if atual:
                c.execute(update(ti).where(ti.c.id == novo_id).values(**valores, atualizado_por=quem, atualizado_em=_agora()))
            else:
                c.execute(insert(ti).values(id=novo_id, organizacao_id=organizacao_id, criado_por=quem, atualizado_por=quem, **valores))
        with gestao._estado["engine"].begin() as c:
            esconder = lambda d: {k: v for k, v in (d or {}).items() if k not in ("segredo_ref",)}  # noqa: E731
            gestao.auditar(c, organizacao_id=organizacao_id, origem="pessoa", quem=quem,
                           acao="alterar" if atual else "criar", entidade="integracoes", entidade_id=novo_id,
                           antes=esconder(atual), depois={**esconder(valores), "segredo_trocado": bool(dados.get("segredo"))})
    ao_mudar(organizacao_id)
    return integracao(organizacao_id, novo_id)


def excluir(organizacao_id: str, integracao_id: str, quem: str) -> None:
    atual = _integracao(organizacao_id, integracao_id)
    usam = _agentes_que_usam(organizacao_id).get(str(integracao_id))
    if usam:
        _erro(f"A integração está liberada para: {', '.join(usam)}. Tire das fichas antes de excluir.", 409)
    if atual.get("segredo_ref"):
        _no_cofre("apagar", atual["segredo_ref"])
    ti, tf = _t("integracoes"), _t("ferramentas")
    with _estado["engine"].begin() as c:
        c.execute(delete(tf).where(tf.c.integracao_id == integracao_id))
        c.execute(delete(ti).where(ti.c.id == integracao_id))
    with gestao._estado["engine"].begin() as c:
        gestao.auditar(c, organizacao_id=organizacao_id, origem="pessoa", quem=quem, acao="excluir", entidade="integracoes",
                       entidade_id=integracao_id, antes={k: v for k, v in atual.items() if k != "segredo_ref"})
    ao_mudar(organizacao_id)


def _validar_parametros(lista, tipo: str) -> list[dict]:
    saida, nomes = [], set()
    for p in lista or []:
        nome = (p.get("nome") or "").strip()
        if not NOME_PARAMETRO.match(nome) or nome in nomes or nome == "organizacao_id":
            _erro(f'Parâmetro inválido ou repetido: "{nome}".')
        tipo_p = p.get("tipo") or "string"
        if tipo_p not in TIPOS_PARAMETRO:
            _erro(f'Parâmetro "{nome}": tipo inválido ({", ".join(TIPOS_PARAMETRO)}).')
        local = (p.get("local") or "query") if tipo == "http" else None
        if tipo == "http" and local not in LOCAIS_HTTP:
            _erro(f'Parâmetro "{nome}": vai na consulta (query) ou no corpo (body).')
        nomes.add(nome)
        saida.append({"nome": nome, "tipo": tipo_p, "descricao": " ".join((p.get("descricao") or "").split())[:300] or nome,
                      "obrigatorio": bool(p.get("obrigatorio", True)), **({"local": local} if local else {})})
    if len(saida) > 20:
        _erro("Até 20 parâmetros por ferramenta.")
    return saida


def _validar_ferramenta(integ: dict, dados: dict) -> dict:
    nome = (dados.get("nome") or "").strip()
    if integ["tipo"] == "mcp":
        if not re.match(r"^[A-Za-z0-9_.-]{1,64}$", nome):
            _erro("O nome é o da ferramenta no servidor MCP (letras, números, _ . -).")
    elif not NOME_FERRAMENTA.match(nome):
        _erro("O nome tem de 3 a 41 caracteres: letras minúsculas, números e _ (começa por letra).")
    descricao = " ".join((dados.get("descricao") or "").split())
    if not 20 <= len(descricao) <= 1500:
        _erro("A descrição tem de 20 a 1.500 caracteres: é por ela que o agente decide quando usar a ferramenta.")
    altera = bool(dados.get("altera_dados"))
    parametros = _validar_parametros(dados.get("parametros"), integ["tipo"])
    valores = {"nome": nome, "descricao": descricao, "parametros": parametros, "ativa": bool(dados.get("ativa", True)),
               "sql": None, "metodo": None, "caminho": None, "corpo": None}
    if integ["tipo"] == "memoria":
        _erro("A memória não tem ferramentas para cadastrar: ela entra inteira no agente.")
    if integ["tipo"] in ("postgres", "mysql"):
        sql = (dados.get("sql") or "").strip().rstrip(";")
        if not sql or len(sql) > 8000 or ";" in sql:
            _erro("A consulta é obrigatória, tem até 8.000 caracteres e é um comando só.")
        if SQL_MUDA.search(re.sub(r"'[^']*'", "''", sql)):
            altera = True  # o que muda dado sempre espera uma pessoa, mesmo sem a marcação
        if integ.get("nosso_banco"):
            if altera:
                _erro("No banco do GestorGov, só consultas (a fonte é só leitura).")
            if not re.search(r"\$1(?!\d)", sql):
                _erro("No banco do GestorGov, a consulta filtra pela organização com $1 (o servidor põe o organizacao_id).")
        valores["sql"] = sql
    elif integ["tipo"] == "http":
        metodo = (dados.get("metodo") or "GET").upper()
        if metodo not in METODOS:
            _erro(f"Método inválido: {', '.join(METODOS)}.")
        if metodo not in METODOS_LEITURA:
            altera = True if metodo != "POST" else altera  # POST pode ser consulta; o resto sempre muda
        caminho = (dados.get("caminho") or "").strip()
        if not caminho.startswith("/") or "://" in caminho or ".." in caminho or "{" in caminho or len(caminho) > 500:
            _erro("O caminho começa com / e é fixo (os parâmetros vão na consulta ou no corpo).")
        corpo = (dados.get("corpo") or "").strip() or None
        if corpo and len(corpo) > 4000:
            _erro("O corpo tem até 4.000 caracteres.")
        valores.update(metodo=metodo, caminho=caminho, corpo=corpo)
    valores["altera_dados"] = altera
    return valores


def salvar_ferramenta(organizacao_id: str, integracao_id: str, ferramenta_id: str | None, dados: dict, quem: str) -> dict:
    integ = _integracao(organizacao_id, integracao_id)
    atual = _ferramenta(organizacao_id, integracao_id, ferramenta_id) if ferramenta_id else None
    valores = _validar_ferramenta(integ, dados)
    tf = _t("ferramentas")
    with _trava:
        repetida = _uma(select(tf.c.id).where(tf.c.integracao_id == integracao_id, tf.c.nome == valores["nome"]))
        if repetida and str(repetida["id"]) != str(ferramenta_id or ""):
            _erro(f"Esta integração já tem a ferramenta {valores['nome']}.", 409)
        novo_id = str(ferramenta_id) if ferramenta_id else _id()
        with _estado["engine"].begin() as c:
            if atual:
                c.execute(update(tf).where(tf.c.id == novo_id).values(**valores, atualizado_por=quem, atualizado_em=_agora()))
            else:
                c.execute(insert(tf).values(id=novo_id, organizacao_id=organizacao_id, integracao_id=integracao_id,
                                            criado_por=quem, atualizado_por=quem, **valores))
        with gestao._estado["engine"].begin() as c:
            gestao.auditar(c, organizacao_id=organizacao_id, origem="pessoa", quem=quem, acao="alterar" if atual else "criar",
                           entidade="integracao_ferramentas", entidade_id=novo_id, antes=atual, depois=valores)
    ao_mudar(organizacao_id)
    return _ferramenta_dict(_ferramenta(organizacao_id, integracao_id, novo_id))


def excluir_ferramenta(organizacao_id: str, integracao_id: str, ferramenta_id: str, quem: str) -> None:
    atual = _ferramenta(organizacao_id, integracao_id, ferramenta_id)
    with _estado["engine"].begin() as c:
        c.execute(delete(_t("ferramentas")).where(_t("ferramentas").c.id == ferramenta_id))
    with gestao._estado["engine"].begin() as c:
        gestao.auditar(c, organizacao_id=organizacao_id, origem="pessoa", quem=quem, acao="excluir",
                       entidade="integracao_ferramentas", entidade_id=ferramenta_id, antes=atual)
    ao_mudar(organizacao_id)


# ───────── Depois de mudar: o Toolbox e os agentes ─────────

def ao_mudar(organizacao_id: str) -> None:
    """Remonta a configuração do Toolbox e os agentes da organização que usam as integrações (sem reiniciar)."""
    from agente import registro, toolbox

    toolbox.agendar_reinicio()
    for agentes in _agentes_que_usam(organizacao_id).values():
        for agente_id in agentes:
            registro.ativar(agente_id)


# ───────── Auditoria e limite ─────────

def _registrar(org: str, ferramenta: dict | None, nome: str, *, quem: str, situacao: str, agente_id: str | None = None,
               sessao_id: str | None = None, duracao_ms: int | None = None, detalhe: str | None = None,
               argumentos: dict | None = None) -> int:
    with _estado["engine"].begin() as c:
        r = c.execute(insert(_t("chamadas")).values(
            organizacao_id=org, integracao_id=(ferramenta or {}).get("integracao_id"), ferramenta_id=(ferramenta or {}).get("id"),
            ferramenta=nome[:120], agente_id=agente_id, quem=quem[:200], sessao_id=sessao_id, situacao=situacao,
            duracao_ms=duracao_ms, detalhe=(detalhe or "")[:300] or None, argumentos=argumentos))
        return int(r.inserted_primary_key[0])


def _passou_do_limite(integ: dict) -> bool:
    tc = _t("chamadas")
    desde = _agora() - timedelta(minutes=1)
    with _estado["engine"].connect() as c:
        feitas = c.execute(select(func.count()).select_from(tc).where(
            tc.c.integracao_id == integ["id"], tc.c.em >= desde, tc.c.situacao.in_(("ok", "erro")))).scalar() or 0
    return feitas >= int(integ["limite_por_minuto"] or 30)


def chamadas(organizacao_id: str, limite: int = 100) -> list[dict]:
    tc = _t("chamadas")
    linhas = _linhas(select(tc).where(tc.c.organizacao_id == organizacao_id).order_by(tc.c.em.desc()).limit(min(limite, 500)))
    return [gestao._json({k: v for k, v in l.items() if k != "argumentos"}) for l in linhas]


# ───────── Execução ─────────

def _resposta(texto: str) -> str:
    from agente.guardrails import mascarar_texto  # CPF e cartão não voltam ao modelo

    texto = mascarar_texto(texto or "")
    return texto if len(texto) <= MAX_RESPOSTA else texto[:MAX_RESPOSTA] + "\n…(resposta cortada)"


def _mascarar_args(argumentos: dict) -> dict:
    from agente.guardrails import mascarar_texto

    return {k: mascarar_texto(v) if isinstance(v, str) else v for k, v in argumentos.items()}


def _conferir_argumentos(ferramenta: dict, argumentos: dict) -> dict:
    """Só os parâmetros declarados, com o tipo certo. O organizacao_id nunca vem do modelo."""
    saida = {}
    for p in ferramenta["parametros"] or []:
        valor = argumentos.get(p["nome"])
        if valor in (None, ""):
            if p.get("obrigatorio"):
                _erro(f"Falta o parâmetro obrigatório {p['nome']}.")
            continue
        try:
            valor = {"integer": int, "float": float, "boolean": lambda v: v if isinstance(v, bool) else str(v).lower() in ("true", "1", "sim"),
                     "string": lambda v: str(v)[:2000]}[p["tipo"]](valor)
        except (TypeError, ValueError):
            _erro(f"O parâmetro {p['nome']} precisa ser {p['tipo']}.")
        saida[p["nome"]] = valor
    return saida


def _renderizar_corpo(modelo: str | None, argumentos: dict, parametros: list[dict]) -> str | None:
    """O corpo da requisição: o modelo com {{.parametro}} (o mesmo formato do Toolbox) ou, sem modelo, JSON."""
    do_corpo = {p["nome"]: argumentos[p["nome"]] for p in parametros if p.get("local") == "body" and p["nome"] in argumentos}
    if not modelo:
        return json.dumps(do_corpo, ensure_ascii=False) if do_corpo else None

    def trocar(m):
        valor = argumentos.get(m.group(1))
        if valor is None:
            return "null"
        return json.dumps(valor, ensure_ascii=False)[1:-1] if isinstance(valor, str) else json.dumps(valor)

    return re.sub(r"\{\{\s*\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}", trocar, modelo)


def _cabecalhos(integ: dict) -> dict:
    config = integ.get("config") or {}
    cabecalhos = dict(config.get("cabecalhos") or {})
    segredo = ler_segredo(integ) if integ.get("segredo_ref") else None
    if segredo:
        cabecalhos[config.get("cabecalho_segredo") or "Authorization"] = (config.get("prefixo_segredo") or "") + segredo
    return cabecalhos


def _http_direto(integ: dict, ferramenta: dict, argumentos: dict) -> str:
    """Sem o Toolbox: a chamada HTTP aqui mesmo, com as mesmas travas (host liberado, sem rede interna)."""
    consulta = {p["nome"]: argumentos[p["nome"]] for p in ferramenta["parametros"] if p.get("local", "query") == "query" and p["nome"] in argumentos}
    corpo = _renderizar_corpo(ferramenta.get("corpo"), argumentos, ferramenta["parametros"])
    cabecalhos = _cabecalhos(integ)
    if corpo is not None:
        cabecalhos.setdefault("Content-Type", "application/json")
    resposta = httpx.request(ferramenta["metodo"], integ["endereco"] + ferramenta["caminho"], params=consulta or None,
                             content=corpo.encode() if corpo is not None else None, headers=cabecalhos,
                             timeout=(integ.get("config") or {}).get("timeout_s", 15), follow_redirects=False)
    if resposta.status_code >= 400:
        raise RuntimeError(f"A API respondeu {resposta.status_code}.")
    return resposta.text


def _mcp(integ: dict, metodo: str, parametros: dict | None = None) -> dict:
    """Uma chamada JSON-RPC a um servidor MCP (HTTP "streamable"): initialize, depois o método pedido."""
    cabecalhos = {**_cabecalhos(integ), "Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    tempo = (integ.get("config") or {}).get("timeout_s", 15)

    def enviar(cliente, corpo):
        r = cliente.post(integ["endereco"], json=corpo, headers=cabecalhos, timeout=tempo)
        if r.status_code >= 400:
            raise RuntimeError(f"O servidor MCP respondeu {r.status_code}.")
        if "Mcp-Session-Id" in r.headers:
            cabecalhos["Mcp-Session-Id"] = r.headers["Mcp-Session-Id"]
        if "id" not in corpo:
            return {}
        texto = r.text
        if "text/event-stream" in r.headers.get("content-type", ""):
            dados = [l[5:].strip() for l in texto.splitlines() if l.startswith("data:")]
            texto = next((d for d in reversed(dados) if '"id"' in d), "{}")
        mensagem = json.loads(texto or "{}")
        if mensagem.get("error"):
            raise RuntimeError(f"O servidor MCP recusou: {str(mensagem['error'].get('message'))[:200]}")
        return mensagem.get("result") or {}

    with httpx.Client(follow_redirects=False) as cliente:
        enviar(cliente, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "gestorgov", "version": "1.0"}}})
        enviar(cliente, {"jsonrpc": "2.0", "method": "notifications/initialized"})
        return enviar(cliente, {"jsonrpc": "2.0", "id": 2, "method": metodo, "params": parametros or {}})


def _executar(integ: dict, ferramenta: dict, argumentos: dict) -> str:
    """Roda de fato (já conferidos limite, aprovação e argumentos). Devolve o texto da resposta."""
    from agente import toolbox

    _conferir_host(integ)
    if integ["tipo"] == "mcp":
        resultado = _mcp(integ, "tools/call", {"name": ferramenta["nome"], "arguments": argumentos})
        partes = [c.get("text", "") for c in resultado.get("content") or [] if c.get("type") == "text"]
        if resultado.get("isError"):
            raise RuntimeError(("A ferramenta MCP devolveu erro: " + " ".join(partes))[:300])
        return "\n".join(partes) or json.dumps(resultado.get("structuredContent") or {}, ensure_ascii=False)
    if toolbox.ligado():
        if integ.get("nosso_banco"):
            argumentos = {"organizacao_id": str(integ["organizacao_id"]), **argumentos}
        return toolbox.invocar(toolbox.nome_ferramenta(ferramenta["id"]), argumentos)
    if integ["tipo"] == "http":
        return _http_direto(integ, ferramenta, argumentos)
    raise RuntimeError("Bancos externos precisam do MCP Toolbox ligado no servidor (GESTORGOV_TOOLBOX=sim).")


def chamar(organizacao_id: str, ferramenta_id: str, argumentos: dict, *, quem: str, agente_id: str | None = None,
           sessao_id: str | None = None) -> str:
    """O que o agente chama. Devolve sempre um texto para o modelo (nunca levanta); tudo fica na auditoria."""
    tf, ti = _t("ferramentas"), _t("integracoes")
    ferramenta = _uma(select(tf).where(tf.c.id == ferramenta_id, tf.c.organizacao_id == organizacao_id))
    integ = _uma(select(ti).where(ti.c.id == ferramenta["integracao_id"], ti.c.organizacao_id == organizacao_id)) if ferramenta else None
    nome = (ferramenta or {}).get("nome") or "?"
    if not ferramenta or not integ or not ferramenta["ativa"] or integ["situacao"] != "ativa":
        _registrar(organizacao_id, ferramenta, nome, quem=quem, agente_id=agente_id, sessao_id=sessao_id, situacao="recusada",
                   detalhe="Integração ou ferramenta desligada.")
        return json.dumps({"erro": "Esta integração está desligada no momento."}, ensure_ascii=False)
    try:
        args = _conferir_argumentos(ferramenta, argumentos or {})
    except ErroIntegracao as erro:
        _registrar(organizacao_id, ferramenta, nome, quem=quem, agente_id=agente_id, sessao_id=sessao_id, situacao="recusada",
                   detalhe=erro.detalhe)
        return json.dumps({"erro": erro.detalhe}, ensure_ascii=False)
    if ferramenta["altera_dados"]:
        pedido = _registrar(organizacao_id, ferramenta, nome, quem=quem, agente_id=agente_id, sessao_id=sessao_id,
                            situacao="aguardando_aprovacao", argumentos=_mascarar_args(args))
        return json.dumps({"situacao": "aguardando_aprovacao", "pedido": pedido,
                           "aviso": "Esta ação altera dados em outro sistema: o pedido foi para aprovação de uma pessoa "
                                    "(Integrações → Pedidos). Diga isso a quem pediu; não diga que já foi feito."}, ensure_ascii=False)
    return _rodar_registrando(integ, ferramenta, args, quem=quem, agente_id=agente_id, sessao_id=sessao_id)


def _rodar_registrando(integ: dict, ferramenta: dict, args: dict, *, quem: str, agente_id: str | None, sessao_id: str | None,
                       pedido_id: int | None = None) -> str:
    org = str(integ["organizacao_id"])
    if _passou_do_limite(integ):
        situacao, detalhe, saida, duracao = "recusada", f"Limite de {integ['limite_por_minuto']} chamadas por minuto.", None, None
    else:
        inicio = time.perf_counter()
        try:
            saida, situacao, detalhe = _resposta(_executar(integ, ferramenta, args)), "ok", None
        except ErroIntegracao as erro:
            saida, situacao, detalhe = None, "erro", erro.detalhe
        except Exception as erro:  # a mensagem do erro pode trazer dado: só o tipo e o começo
            saida, situacao, detalhe = None, "erro", f"{type(erro).__name__}: {str(erro)[:200]}"
        duracao = int((time.perf_counter() - inicio) * 1000)
    if pedido_id is None:
        _registrar(org, ferramenta, ferramenta["nome"], quem=quem, agente_id=agente_id, sessao_id=sessao_id, situacao=situacao,
                   duracao_ms=duracao, detalhe=detalhe)
    else:
        tc = _t("chamadas")
        with _estado["engine"].begin() as c:
            c.execute(update(tc).where(tc.c.id == pedido_id).values(situacao=situacao, duracao_ms=duracao, detalhe=detalhe,
                                                                    argumentos=None, decidido_por=quem, decidido_em=_agora()))
    if situacao != "ok":
        return json.dumps({"erro": detalhe}, ensure_ascii=False)
    return saida


# ───────── Pedidos que esperam uma pessoa ─────────

def pedidos(organizacao_id: str) -> list[dict]:
    tc = _t("chamadas")
    return [gestao._json(l) for l in _linhas(select(tc).where(tc.c.organizacao_id == organizacao_id,
                                                            tc.c.situacao == "aguardando_aprovacao").order_by(tc.c.em))]


def decidir(organizacao_id: str, pedido_id: int, aprovar: bool, quem: str, motivo: str = "") -> dict:
    """Aprovado, roda agora (com os argumentos guardados) e os argumentos saem da tabela; negado, só sai da fila."""
    tc = _t("chamadas")
    pedido = _uma(select(tc).where(tc.c.id == pedido_id, tc.c.organizacao_id == organizacao_id))
    if not pedido or pedido["situacao"] != "aguardando_aprovacao":
        _erro("Pedido não encontrado ou já decidido.", 404)
    if not aprovar:
        with _estado["engine"].begin() as c:
            c.execute(update(tc).where(tc.c.id == pedido_id).values(situacao="negada", argumentos=None, decidido_por=quem,
                                                                    decidido_em=_agora(), detalhe=(motivo or "Negado")[:300]))
        return {"situacao": "negada"}
    tf, ti = _t("ferramentas"), _t("integracoes")
    ferramenta = _uma(select(tf).where(tf.c.id == pedido["ferramenta_id"]))
    integ = _uma(select(ti).where(ti.c.id == pedido["integracao_id"])) if ferramenta else None
    if not ferramenta or not integ or integ["situacao"] != "ativa":
        _erro("A integração ou a ferramenta foi desligada: o pedido não pode rodar.", 409)
    saida = _rodar_registrando(integ, ferramenta, pedido["argumentos"] or {}, quem=quem, agente_id=pedido["agente_id"],
                               sessao_id=pedido["sessao_id"], pedido_id=pedido_id)
    final = _uma(select(tc).where(tc.c.id == pedido_id))
    return {"situacao": final["situacao"], "detalhe": final["detalhe"], "resposta": saida[:2000] if final["situacao"] == "ok" else None}


# ───────── Teste ─────────

def testar(organizacao_id: str, integracao_id: str, quem: str) -> dict:
    """Confere a conexão (sem rodar ferramenta): host liberado, segredo no cofre e o servidor respondendo."""
    from agente import toolbox

    integ = _integracao(organizacao_id, integracao_id)
    inicio = time.perf_counter()
    ok, detalhe = True, "Conexão funcionando."
    try:
        _conferir_host(integ)
        if integ["tipo"] == "memoria":
            detalhe = memoria_disponivel() or "Memória pronta (Mem0 no nosso pgvector)."
            ok = detalhe.startswith("Memória pronta")
        elif integ["tipo"] == "http":
            r = httpx.request("HEAD", integ["endereco"] + "/", headers=_cabecalhos(integ), timeout=10, follow_redirects=False)
            ok, detalhe = r.status_code < 500, f"A API respondeu {r.status_code}."
        elif integ["tipo"] == "mcp":
            nomes = [t.get("name") for t in (_mcp(integ, "tools/list").get("tools") or [])]
            detalhe = f"Servidor MCP respondeu. Ferramentas oferecidas: {', '.join(nomes[:30]) or 'nenhuma'}."
        elif integ["tipo"] == "postgres":
            _testar_postgres(integ)
        else:
            with socket.create_connection((integ["endereco"], int(integ["porta"] or 3306)), timeout=8):
                detalhe = "A porta do MySQL respondeu (a autenticação é conferida pelo Toolbox ao subir)."
        if ok and integ["tipo"] in ("postgres", "mysql", "http"):
            detalhe += " " + toolbox.situacao()["texto"]
    except ErroIntegracao as erro:
        ok, detalhe = False, erro.detalhe
    except Exception as erro:
        ok, detalhe = False, f"{type(erro).__name__}: {str(erro)[:200]}"
    ti = _t("integracoes")
    with _estado["engine"].begin() as c:
        c.execute(update(ti).where(ti.c.id == integracao_id).values(ultimo_teste_em=_agora(), ultimo_teste_ok=ok,
                                                                    ultimo_teste_detalhe=detalhe[:500]))
    _registrar(organizacao_id, {"integracao_id": integracao_id, "id": None}, "(teste de conexão)", quem=quem,
               situacao="ok" if ok else "erro", duracao_ms=int((time.perf_counter() - inicio) * 1000), detalhe=None if ok else detalhe)
    return {"ok": ok, "detalhe": detalhe}


def _testar_postgres(integ: dict) -> None:
    import psycopg

    if integ.get("nosso_banco"):
        url = _url_nosso_banco()
        if not url:
            _erro("Sem DATABASE_URL: o banco do GestorGov não está no Postgres neste servidor.")
        dados = {"host": url.host, "port": url.port or 5432, "dbname": url.database, "user": url.username, "password": url.password}
    else:
        dados = {"host": integ["endereco"], "port": integ["porta"], "dbname": integ["banco"], "user": integ["usuario"],
                 "password": ler_segredo(integ) or "", "sslmode": (integ.get("config") or {}).get("sslmode", "require")}
    with psycopg.connect(connect_timeout=8, **dados) as conexao:
        conexao.execute("select 1")


def testar_ferramenta(organizacao_id: str, integracao_id: str, ferramenta_id: str, argumentos: dict, quem: str) -> dict:
    """Uma pessoa roda a ferramenta com argumentos de teste. Só as de leitura: as que alteram dados passam pelos pedidos."""
    integ = _integracao(organizacao_id, integracao_id)
    ferramenta = _ferramenta(organizacao_id, integracao_id, ferramenta_id)
    if ferramenta["altera_dados"]:
        _erro("Ferramenta que altera dados não tem teste direto: ela só roda depois de aprovada num pedido.")
    args = _conferir_argumentos(ferramenta, argumentos or {})
    return {"resultado": _rodar_registrando(integ, ferramenta, args, quem=quem, agente_id=None, sessao_id=None)[:4000]}


# ───────── Ficha: o que o agente recebe ─────────

def conferir_da_ficha(organizacao_id: str, ids: list[str]) -> list[str]:
    """As integrações da ficha: só ids desta organização."""
    validas = ids_da_organizacao(organizacao_id)
    estranhas = [i for i in ids if str(i) not in validas]
    if estranhas:
        _erro("Integração desconhecida nesta organização.", 422)
    return list(dict.fromkeys(str(i) for i in ids))


def _nome_funcao(integ: dict, ferramenta: dict) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", gestao._sem_acento(integ["nome"])).strip("_")[:24] or "integracao"
    return re.sub(r"[^a-zA-Z0-9_]", "_", f"{base}__{ferramenta['nome']}")[:60]


def _esquema(parametros: list[dict]) -> dict:
    tipos = {"string": "string", "integer": "integer", "float": "number", "boolean": "boolean"}
    return {"type": "object",
            "properties": {p["nome"]: {"type": tipos[p["tipo"]], "description": p["descricao"]} for p in parametros},
            "required": [p["nome"] for p in parametros if p.get("obrigatorio")]}


def ferramentas_do_agente(agente_id: str) -> list:
    """As ferramentas das integrações liberadas na ficha do agente (e da organização dele). Nunca derruba o agente."""
    if not disponivel() or not gestao.disponivel():
        return []
    from agente import dados_agente, fabrica

    oid = fabrica.organizacao_do_agente(agente_id)
    ids = [str(i) for i in (dados_agente.ficha(agente_id).get("integracoes") or [])]
    if not oid or not ids:
        return []
    ti, tf = _t("integracoes"), _t("ferramentas")
    saida, nomes = [], set()
    for integ in _linhas(select(ti).where(ti.c.organizacao_id == oid, ti.c.id.in_(ids), ti.c.situacao == "ativa")):
        if integ["tipo"] == "memoria":
            memoria = _memoria_do_agente(oid, agente_id, (integ.get("config") or {}).get("escopo", "organizacao"))
            if memoria is not None:
                saida.append(memoria)
            continue
        for f in _linhas(select(tf).where(tf.c.integracao_id == integ["id"], tf.c.ativa.is_(True))):
            nome = _nome_funcao(integ, f)
            if nome in nomes:
                continue
            nomes.add(nome)
            aviso = (" ALTERA DADOS em outro sistema: a chamada vira um pedido que uma pessoa aprova antes de rodar."
                     if f["altera_dados"] else "")
            saida.append(Function(
                name=nome, description=f"{f['descricao']} (Integração: {integ['nome']}.){aviso}",
                parameters=_esquema(f["parametros"] or []),
                entrypoint=(lambda fid: lambda **argumentos: chamar(oid, fid, argumentos, quem=f"agente:{agente_id}",
                                                                    agente_id=agente_id))(str(f["id"])),
                skip_entrypoint_processing=True))
    return saida


# ───────── Memória (Mem0 auto-hospedado) ─────────

def memoria_disponivel() -> str | None:
    """None se a memória pode subir; senão, o motivo."""
    if os.getenv("MEM0_API_KEY"):
        return "MEM0_API_KEY está definida: a memória da Central é auto-hospedada e não usa a nuvem do Mem0."
    if not _url_nosso_banco():
        return "A memória precisa do Postgres (pgvector) do GestorGov: defina DATABASE_URL."
    import importlib.util

    if importlib.util.find_spec("mem0") is None:
        return "O pacote mem0ai não está instalado no servidor (pip install mem0ai)."
    return None


def config_mem0() -> dict:
    """Vetores no pgvector do nosso Supabase (schema do GestorGov); modelo e embeddings no Gemini."""
    url = _url_nosso_banco().set(drivername="postgresql")
    schema = os.getenv("DATABASE_SCHEMA", "gestorgov")
    conexao = url.render_as_string(hide_password=False)
    conexao += ("&" if "?" in conexao else "?") + f"options=-csearch_path%3D{schema},extensions"
    from agente.agente import PASTA_DADOS

    return {
        "vector_store": {"provider": "pgvector", "config": {"connection_string": conexao, "collection_name": "mem0_memorias",
                                                            "embedding_model_dims": 768}},
        "llm": {"provider": "gemini", "config": {"model": os.getenv("AGENTE_MODELO", "gemini-3.6-flash"),
                                                 "api_key": os.getenv("GOOGLE_API_KEY")}},
        "embedder": {"provider": "gemini", "config": {"model": "models/gemini-embedding-001", "embedding_dims": 768,
                                                      "api_key": os.getenv("GOOGLE_API_KEY")}},
        "history_db_path": str(PASTA_DADOS / "mem0_historico.db"),
    }


def _memoria_do_agente(organizacao_id: str, agente_id: str, escopo: str):
    """Mem0Tools com o user_id preso (org-<id> ou area-<id>): toda busca e gravação fica na organização (ou na área).
    Sem apagar tudo. Indisponível (sem Postgres, sem o pacote ou com a chave da nuvem): o agente sobe sem ela."""
    motivo = memoria_disponivel()
    if motivo:
        log_warning(f"Memória da Central fora do agente {agente_id}: {motivo}")
        return None
    if escopo == "area":
        from agente import dados_agente

        areas = sorted(dados_agente.areas_do_agente(organizacao_id, agente_id))
        dono = f"area-{areas[0]}" if areas else f"org-{organizacao_id}"
    else:
        dono = f"org-{organizacao_id}"
    try:
        os.environ.setdefault("MEM0_TELEMETRY", "False")  # nada sai para a nuvem do Mem0
        from agno.tools.mem0 import Mem0Tools

        # user_id fixo: o modelo não escolhe de quem é a memória; api_key vazia: nunca a nuvem do Mem0.
        return Mem0Tools(config=config_mem0(), api_key=None, user_id=dono, enable_delete_all_memories=False,
                         instructions="Memória compartilhada da organização. Nunca guarde dado de paciente ou de cliente "
                                      "(nome completo, CPF, Cartão SUS): só fatos de trabalho.", add_instructions=True)
    except Exception as erro:
        log_warning(f"Memória da Central fora do agente {agente_id}: {type(erro).__name__}: {erro}")
        return None
