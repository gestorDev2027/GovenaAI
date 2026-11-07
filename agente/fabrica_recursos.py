"""O que a fábrica de agentes configura além do próprio agente: skills, ferramentas HTTP sem código e
casos de teste. Tudo no banco, no schema do agente, editável pelo painel.

Skills (fabrica_skills): instruções e materiais de referência que o agente só carrega quando precisa
(o Agno lista nome e descrição nas instruções e dá ferramentas para ler o resto). Diferente das skills
em pasta do Agno, estas não têm scripts: o agente lê, nunca executa código vindo do painel.

Ferramentas (fabrica_ferramentas): uma chamada a uma API, com endereço, método e parâmetros fixos; o
modelo só preenche os parâmetros declarados. Servidores MCP ficam para quando houver o primeiro em uso
(a peça do Agno, MCPTools, pede fastmcp e execução assíncrona). As travas:
- o endereço precisa ser https e de um host liberado no painel (fabrica_hosts; FABRICA_HOSTS_PERMITIDOS,
  se existir, entra como lista inicial);
- rede interna nunca: antes de cada chamada, o host é resolvido e endereço privado, local ou de
  metadados da nuvem é recusado, mesmo que o host esteja liberado;
- a chave da API fica no cofre (fabrica_chaves): no Postgres, criptografada no Vault do Supabase, por
  funções que só alcançam os segredos com prefixo "fabrica:" (supabase/gestorgov, migration inicial);
  o painel grava e troca, mas nunca lê o valor de volta;
- a resposta volta cortada e com CPF e cartão mascarados;
- só leitura por enquanto: GET, ou POST de consulta. Ferramenta que altera dados vai precisar de
  aprovação humana antes de existir.

Casos de teste (fabrica_casos, fabrica_execucoes): uma mensagem e o que se espera do agente (a ação, o
motivo da transferência, o que a resposta precisa mencionar e o que não pode dizer), conferidos sem
juiz. A execução roda também o dataset do agente na Calibração (avaliações aprovadas), com o mesmo
juiz e a mesma nota mínima da madrugada (agente/datasets.py): uma avaliação só, a mesma antes de
publicar e todo dia (a rotina diária chama avaliar_em_fila com os agentes publicados).
"""

import ipaddress
import json
import os
import re
import socket
import threading
import unicodedata
import uuid
from datetime import datetime, timezone
from urllib.parse import quote, urlparse

import httpx
from agno.skills import Skills
from agno.skills.skill import Skill
from agno.tools.function import Function
from agno.utils.log import log_warning
from sqlalchemy import JSON, Boolean, Column, DateTime, Integer, MetaData, String, Table, Text, delete, insert, select, text, update
from sqlalchemy.engine import Engine

ID_VALIDO = re.compile(r"^[a-z0-9-]{3,40}$")
HOST_VALIDO = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
PARAMETRO_VALIDO = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,40}$")
TIPOS_PARAMETRO = ("string", "number", "integer", "boolean")
LOCAIS_PARAMETRO = ("query", "path", "body")
METODOS = ("GET", "POST")  # só leitura por enquanto (ver docstring)
MAX_RESPOSTA = 6000
ACOES = ("responder", "transferir", "encerrar", "qualquer")
MAX_CASOS_POR_EXECUCAO = 30

_estado: dict = {}
_trava = threading.Lock()


class ErroRecurso(Exception):
    def __init__(self, status: int, detalhe: str):
        super().__init__(detalhe)
        self.status, self.detalhe = status, detalhe


def _erro(texto: str, status: int = 422):
    raise ErroRecurso(status, texto)


def _agora() -> datetime:
    return datetime.now(timezone.utc)


def _iso(momento: datetime | None) -> str | None:
    return momento.isoformat() if momento else None


def iniciar(engine: Engine, schema: str | None = None) -> None:
    metadados = MetaData(schema=schema)
    comuns = lambda: [  # noqa: E731
        Column("criado_em", DateTime(timezone=True), nullable=False),
        Column("criado_por", String(200), nullable=False),
        Column("atualizado_em", DateTime(timezone=True), nullable=False),
        Column("atualizado_por", String(200), nullable=False),
    ]
    tabelas = {
        "skills": Table(
            "fabrica_skills", metadados,
            Column("id", String(40), primary_key=True),
            Column("nome", String(80), nullable=False),
            Column("descricao", String(400), nullable=False),
            Column("instrucoes", Text, nullable=False),
            Column("referencias", JSON, nullable=False),  # [{nome, conteudo}]
            *comuns(),
        ),
        "ferramentas": Table(
            "fabrica_ferramentas", metadados,
            Column("id", String(40), primary_key=True),
            Column("tipo", String(10), nullable=False),  # http (outros tipos virão aqui)
            Column("nome", String(80), nullable=False),
            Column("descricao", Text, nullable=False),
            Column("config", JSON, nullable=False),
            Column("ativa", Boolean, nullable=False, default=True),
            *comuns(),
        ),
        "casos": Table(
            "fabrica_casos", metadados,
            Column("id", Integer, primary_key=True, autoincrement=True),
            Column("agente", String(40), nullable=False, index=True),
            Column("titulo", String(120), nullable=False),
            Column("mensagem", Text, nullable=False),
            Column("contexto", JSON, nullable=False),  # {nome_contato, telefone}
            Column("esperado", JSON, nullable=False),  # {acao, categoria, mencionar, proibido}
            Column("ativo", Boolean, nullable=False, default=True),
            *comuns(),
        ),
        "execucoes": Table(
            "fabrica_execucoes", metadados,
            Column("id", Integer, primary_key=True, autoincrement=True),
            Column("agente", String(40), nullable=False, index=True),
            Column("situacao", String(20), nullable=False),  # rodando, concluida, falhou
            Column("resultado", JSON, nullable=True),
            Column("iniciada_em", DateTime(timezone=True), nullable=False),
            Column("iniciada_por", String(200), nullable=False),
            Column("concluida_em", DateTime(timezone=True), nullable=True),
        ),
        "hosts": Table(
            "fabrica_hosts", metadados,
            Column("host", String(253), primary_key=True),
            Column("descricao", String(300), nullable=False),
            *comuns(),
        ),
        # Só os dados da chave; o valor fica no cofre (Vault do Supabase).
        "chaves": Table(
            "fabrica_chaves", metadados,
            Column("nome", String(40), primary_key=True),
            Column("descricao", String(300), nullable=False),
            Column("final", String(4), nullable=False),  # os 4 últimos caracteres, para conferir
            *comuns(),
        ),
    }
    if engine.dialect.name != "postgresql":
        # Sem Postgres (SQLite local de desenvolvimento) não há Vault: o valor fica nesta tabela, sem
        # criptografia. Só para teste local.
        tabelas["cofre_local"] = Table("fabrica_cofre_local", metadados, Column("nome", String(40), primary_key=True),
                                       Column("valor", Text, nullable=False))
    metadados.create_all(engine, tables=list(tabelas.values()))
    _estado.update(engine=engine, tabelas=tabelas, schema=schema)


def _t(nome: str) -> Table:
    return _estado["tabelas"][nome]


def _linhas(nome: str, *condicoes) -> list[dict]:
    with _estado["engine"].connect() as conexao:
        consulta = select(_t(nome))
        for condicao in condicoes:
            consulta = consulta.where(condicao)
        return [dict(l) for l in conexao.execute(consulta).mappings().all()]


def _gravar(nome: str, chave, valores: dict, autor: str, criando: bool) -> None:
    tabela = _t(nome)
    agora = _agora()
    with _estado["engine"].begin() as conexao:
        if criando:
            conexao.execute(insert(tabela).values(**valores, criado_em=agora, criado_por=autor,
                                                  atualizado_em=agora, atualizado_por=autor))
        else:
            conexao.execute(update(tabela).where(tabela.c.id == chave)
                            .values(**valores, atualizado_em=agora, atualizado_por=autor))


def _meta(linha: dict) -> dict:
    return {"criado_em": _iso(linha.get("criado_em")), "criado_por": linha.get("criado_por"),
            "atualizado_em": _iso(linha.get("atualizado_em")), "atualizado_por": linha.get("atualizado_por")}


# ───────── Skills ─────────

def _skill_dict(linha: dict) -> dict:
    return {"id": linha["id"], "nome": linha["nome"], "descricao": linha["descricao"], "instrucoes": linha["instrucoes"],
            "referencias": linha["referencias"] or [], **_meta(linha)}


def listar_skills() -> list[dict]:
    return [_skill_dict(l) for l in sorted(_linhas("skills"), key=lambda l: l["nome"].lower())]


def obter_skill(skill_id: str) -> dict:
    achada = _linhas("skills", _t("skills").c.id == skill_id)
    if not achada:
        _erro(f"Skill desconhecida: {skill_id}.", 404)
    return _skill_dict(achada[0])


def _validar_skill(dados: dict) -> dict:
    nome = (dados.get("nome") or "").strip()
    descricao = " ".join((dados.get("descricao") or "").split())
    instrucoes = (dados.get("instrucoes") or "").strip()
    if not nome or len(nome) > 80:
        _erro("O nome da skill é obrigatório e tem até 80 caracteres.")
    if not descricao or len(descricao) > 400:
        _erro("A descrição é obrigatória (até 400 caracteres): é por ela que o agente decide quando usar a skill.")
    if not instrucoes or len(instrucoes) > 30000:
        _erro("As instruções são obrigatórias e têm até 30.000 caracteres.")
    referencias, nomes = [], set()
    for ref in dados.get("referencias") or []:
        nome_ref = (ref.get("nome") or "").strip()
        conteudo = (ref.get("conteudo") or "").strip()
        if not nome_ref or len(nome_ref) > 80 or nome_ref in nomes:
            _erro("Cada material de referência precisa de um nome único de até 80 caracteres.")
        if not conteudo or len(conteudo) > 50000:
            _erro(f'O material "{nome_ref}" precisa de conteúdo (até 50.000 caracteres).')
        nomes.add(nome_ref)
        referencias.append({"nome": nome_ref, "conteudo": conteudo})
    if len(referencias) > 20:
        _erro("Uma skill tem até 20 materiais de referência.")
    return {"nome": nome, "descricao": descricao, "instrucoes": instrucoes, "referencias": referencias}


def salvar_skill(skill_id: str, dados: dict, autor: str, criando: bool) -> dict:
    if not ID_VALIDO.match(skill_id or ""):
        _erro("O identificador tem de 3 a 40 caracteres: letras minúsculas, números e hífen.")
    valores = _validar_skill(dados)
    with _trava:
        existe = bool(_linhas("skills", _t("skills").c.id == skill_id))
        if criando and existe:
            _erro(f"Já existe uma skill com o identificador {skill_id}.", 409)
        if not criando and not existe:
            _erro(f"Skill desconhecida: {skill_id}.", 404)
        _gravar("skills", skill_id, {"id": skill_id, **valores} if criando else valores, autor, criando)
    return obter_skill(skill_id)


def excluir_skill(skill_id: str, usada_por: list[str]) -> None:
    if usada_por:
        _erro(f"A skill está ligada a: {', '.join(usada_por)}. Tire dos agentes antes de excluir.", 409)
    with _estado["engine"].begin() as conexao:
        conexao.execute(delete(_t("skills")).where(_t("skills").c.id == skill_id))


class SkillsDoPainel(Skills):
    """As skills do painel para um agente: só leitura de instruções e de materiais de referência.
    Sem a ferramenta de scripts do Agno (que executaria código)."""

    def __init__(self, ids: list[str]):
        self.loaders = []
        self._skills = {}
        self._referencias: dict[str, dict[str, str]] = {}
        for linha in _linhas("skills", _t("skills").c.id.in_(list(ids))) if ids else []:
            refs = linha["referencias"] or []
            self._skills[linha["id"]] = Skill(
                name=linha["id"], description=linha["descricao"], instructions=linha["instrucoes"],
                source_path="", references=[r["nome"] for r in refs])
            self._referencias[linha["id"]] = {r["nome"]: r["conteudo"] for r in refs}

    def reload(self) -> None:  # as skills do painel são recarregadas remontando o agente
        return None

    def get_system_prompt_snippet(self) -> str:
        if not self._skills:
            return ""
        linhas = [
            "<skills>",
            "Você tem skills: pacotes de orientação para assuntos específicos. Abaixo, só o nome e quando usar.",
            "Quando a conversa tratar do assunto de uma skill, chame get_skill_instructions(skill_name) e siga o que ela diz.",
            "Se a skill listar materiais de referência, leia o necessário com get_skill_reference(skill_name, reference_path).",
            "Não cite o nome das skills nem das ferramentas para o contato.",
        ]
        for skill in self._skills.values():
            refs = f" | materiais: {', '.join(skill.references)}" if skill.references else ""
            linhas.append(f"- {skill.name}: {skill.description}{refs}")
        linhas.append("</skills>")
        return "\n".join(linhas)

    def get_tools(self) -> list[Function]:
        return [
            Function(name="get_skill_instructions", entrypoint=self._get_skill_instructions,
                     description="Carrega as instruções completas de uma skill. Use quando a conversa tratar do assunto dela."),
            Function(name="get_skill_reference", entrypoint=self._get_skill_reference,
                     description="Lê um material de referência de uma skill."),
        ]

    def _get_skill_reference(self, skill_name: str, reference_path: str = "") -> str:
        materiais = self._referencias.get(skill_name)
        if materiais is None:
            return json.dumps({"erro": f"Skill '{skill_name}' não existe.", "skills": list(self._skills)}, ensure_ascii=False)
        if reference_path not in materiais:
            return json.dumps({"erro": f"Material '{reference_path}' não existe.", "materiais": list(materiais)}, ensure_ascii=False)
        return json.dumps({"skill": skill_name, "material": reference_path, "conteudo": materiais[reference_path]},
                          ensure_ascii=False)


def skills_do_agente(ids: list[str] | tuple[str, ...]) -> SkillsDoPainel | None:
    if not ids or "engine" not in _estado:
        return None
    skills = SkillsDoPainel(list(ids))
    return skills if skills._skills else None


# ───────── Ferramentas HTTP ─────────

# Hosts liberados: os do painel e, se houver, os de FABRICA_HOSTS_PERMITIDOS (lista inicial).

def _host_da_url(url: str) -> str | None:
    return urlparse((url or "").replace("{", "x").replace("}", "x")).hostname


def _hosts_do_ambiente() -> list[str]:
    return [h.strip().lower() for h in os.getenv("FABRICA_HOSTS_PERMITIDOS", "").split(",") if h.strip()]


def hosts_permitidos() -> list[str]:
    do_painel = [l["host"] for l in _linhas("hosts")] if "engine" in _estado else []
    return sorted(set(do_painel) | set(_hosts_do_ambiente()))


def listar_hosts() -> list[dict]:
    linhas = {l["host"]: {"host": l["host"], "descricao": l["descricao"], "origem": "painel", **_meta(l)} for l in _linhas("hosts")}
    for host in _hosts_do_ambiente():
        linhas.setdefault(host, {"host": host, "descricao": "Liberado no servidor (FABRICA_HOSTS_PERMITIDOS)", "origem": "servidor"})
    return sorted(linhas.values(), key=lambda h: h["host"])


def _endereco_interno(endereco: str) -> bool:
    ip = ipaddress.ip_address(endereco)
    return (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast
            or ip.is_unspecified or (ip.version == 6 and ip.ipv4_mapped is not None and _endereco_interno(str(ip.ipv4_mapped))))


def _bloquear_rede_interna(host: str) -> None:
    """Recusa host que aponte para rede interna (servidor, rede privada, metadados da nuvem). Conferido a
    cada chamada, pela resolução atual do nome."""
    try:
        enderecos = {item[4][0] for item in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)}
    except socket.gaierror:
        _erro(f"O host {host} não foi encontrado.", 502)
    if not enderecos or any(_endereco_interno(e.split("%")[0]) for e in enderecos):
        _erro(f"O host {host} aponta para uma rede interna: chamada recusada.", 403)


def liberar_host(host: str, descricao: str, autor: str) -> dict:
    host = (host or "").strip().lower()
    if not HOST_VALIDO.match(host):
        _erro("Informe só o nome do host, sem https:// nem caminho (ex.: api.prefeitura.sp.gov.br).")
    if host == "localhost" or host.endswith((".local", ".internal", ".localhost")):
        _erro("Host de rede interna não pode ser liberado.")
    _bloquear_rede_interna(host)
    descricao = " ".join((descricao or "").split())[:300] or "Sem descrição"
    with _trava:
        if _linhas("hosts", _t("hosts").c.host == host):
            _erro(f"O host {host} já está liberado.", 409)
        agora = _agora()
        with _estado["engine"].begin() as conexao:
            conexao.execute(insert(_t("hosts")).values(host=host, descricao=descricao, criado_em=agora, criado_por=autor,
                                                       atualizado_em=agora, atualizado_por=autor))
    return next(h for h in listar_hosts() if h["host"] == host)


def remover_host(host: str) -> None:
    em_uso = [f["id"] for f in listar_ferramentas() if _host_da_url(f["config"].get("url")) == host]
    if em_uso:
        _erro(f"O host é usado por: {', '.join(em_uso)}. Mude ou exclua essas ferramentas antes.", 409)
    with _estado["engine"].begin() as conexao:
        feito = conexao.execute(delete(_t("hosts")).where(_t("hosts").c.host == host))
    if not feito.rowcount:
        _erro(f"O host {host} não foi liberado pelo painel." + (" Ele vem de FABRICA_HOSTS_PERMITIDOS, no servidor."
                                                               if host in _hosts_do_ambiente() else ""), 404)


def _conferir_url(url: str) -> str:
    url = (url or "").strip()
    host = _host_da_url(url)
    if not url.lower().startswith("https://") or not host:
        _erro("O endereço precisa começar com https:// e ter um host.")
    permitidos = hosts_permitidos()
    if host.lower() not in permitidos:
        _erro(f"O host {host} não está liberado. Libere-o em Hosts liberados"
              + (f" (liberados: {', '.join(permitidos)})." if permitidos else "."))
    return url


# Chaves de API: o valor vai para o cofre e nunca volta ao painel.

def _funcao_cofre(nome: str) -> str:
    schema = _estado.get("schema")
    prefixo = f"{_estado['engine'].dialect.identifier_preparer.quote_schema(schema)}." if schema else ""
    return prefixo + nome


def _no_cofre(operacao: str, nome: str, valor: str | None = None, descricao: str = ""):
    """Grava, lê ou apaga o valor de uma chave: Vault no Postgres; tabela local no SQLite de desenvolvimento."""
    engine = _estado["engine"]
    if "cofre_local" not in _estado["tabelas"]:
        sql = {
            "gravar": f"select {_funcao_cofre('fabrica_salvar_segredo')}(:nome, :valor, :descricao)",
            "ler": f"select {_funcao_cofre('fabrica_ler_segredo')}(:nome)",
            "apagar": f"select {_funcao_cofre('fabrica_apagar_segredo')}(:nome)",
        }[operacao]
        try:
            with engine.begin() as conexao:
                return conexao.execute(text(sql), {"nome": nome, "valor": valor, "descricao": descricao}).scalar()
        except Exception as erro:
            if "does not exist" in str(erro):
                _erro("O cofre de chaves ainda não foi criado no banco (migration inicial do GestorGov no Supabase).", 503)
            raise
    tabela = _t("cofre_local")
    with engine.begin() as conexao:
        if operacao == "ler":
            return conexao.execute(select(tabela.c.valor).where(tabela.c.nome == nome)).scalar()
        conexao.execute(delete(tabela).where(tabela.c.nome == nome))
        if operacao == "gravar":
            conexao.execute(insert(tabela).values(nome=nome, valor=valor))
    return None


def listar_chaves() -> list[dict]:
    return [{"nome": l["nome"], "descricao": l["descricao"], "final": l["final"], **_meta(l)}
            for l in sorted(_linhas("chaves"), key=lambda l: l["nome"])]


def salvar_chave(nome: str, valor: str, descricao: str, autor: str) -> dict:
    """Cria ou troca a chave. O valor vai direto para o cofre; aqui só ficam nome, descrição e final."""
    nome = (nome or "").strip()
    if not ID_VALIDO.match(nome):
        _erro("O nome da chave tem de 3 a 40 caracteres: letras minúsculas, números e hífen (ex.: api-crm).")
    valor = (valor or "").strip()
    if len(valor) < 8 or len(valor) > 4000 or "\n" in valor:
        _erro("O valor da chave tem de 8 a 4.000 caracteres, numa linha só.")
    descricao = " ".join((descricao or "").split())[:300] or "Sem descrição"
    with _trava:
        _no_cofre("gravar", nome, valor, descricao)
        existe = bool(_linhas("chaves", _t("chaves").c.nome == nome))
        agora = _agora()
        with _estado["engine"].begin() as conexao:
            if existe:
                conexao.execute(update(_t("chaves")).where(_t("chaves").c.nome == nome).values(
                    descricao=descricao, final=valor[-4:], atualizado_em=agora, atualizado_por=autor))
            else:
                conexao.execute(insert(_t("chaves")).values(nome=nome, descricao=descricao, final=valor[-4:], criado_em=agora,
                                                            criado_por=autor, atualizado_em=agora, atualizado_por=autor))
    return next(c for c in listar_chaves() if c["nome"] == nome)


def apagar_chave(nome: str) -> None:
    em_uso = [f["id"] for f in listar_ferramentas() if (f["config"].get("segredo") or {}).get("chave") == nome]
    if em_uso:
        _erro(f"A chave é usada por: {', '.join(em_uso)}. Mude essas ferramentas antes.", 409)
    if not _linhas("chaves", _t("chaves").c.nome == nome):
        _erro(f"Chave desconhecida: {nome}.", 404)
    with _trava:
        _no_cofre("apagar", nome)
        with _estado["engine"].begin() as conexao:
            conexao.execute(delete(_t("chaves")).where(_t("chaves").c.nome == nome))


def _conferir_segredo(segredo: dict | None) -> dict | None:
    if not segredo or not segredo.get("chave"):
        return None
    chave = segredo["chave"].strip()
    if not _linhas("chaves", _t("chaves").c.nome == chave):
        _erro(f'A chave "{chave}" não existe. Cadastre-a em Chaves de API.')
    cabecalho = (segredo.get("cabecalho") or "Authorization").strip()
    if not re.match(r"^[A-Za-z0-9-]{1,60}$", cabecalho):
        _erro("Nome de cabeçalho inválido para a chave.")
    return {"chave": chave, "cabecalho": cabecalho, "prefixo": (segredo.get("prefixo") or "")[:20]}


def _validar_http(config: dict) -> dict:
    metodo = (config.get("metodo") or "GET").upper()
    if metodo not in METODOS:
        _erro("Por enquanto só GET ou POST de consulta: ferramenta que altera dados vai precisar de aprovação humana.")
    url = _conferir_url(config.get("url"))
    parametros, nomes = [], set()
    for p in config.get("parametros") or []:
        nome = (p.get("nome") or "").strip()
        if not PARAMETRO_VALIDO.match(nome) or nome in nomes:
            _erro(f'Parâmetro inválido ou repetido: "{nome}".')
        tipo = p.get("tipo") or "string"
        local = p.get("local") or ("query" if metodo == "GET" else "body")
        if tipo not in TIPOS_PARAMETRO or local not in LOCAIS_PARAMETRO:
            _erro(f'Parâmetro "{nome}": tipo ({", ".join(TIPOS_PARAMETRO)}) ou local ({", ".join(LOCAIS_PARAMETRO)}) inválido.')
        if local == "path" and "{" + nome + "}" not in url:
            _erro(f'O parâmetro "{nome}" vai no caminho, mas o endereço não tem {{{nome}}}.')
        nomes.add(nome)
        parametros.append({"nome": nome, "tipo": tipo, "local": local, "obrigatorio": bool(p.get("obrigatorio")),
                           "descricao": " ".join((p.get("descricao") or "").split())[:300]})
    faltam = [n for n in re.findall(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}", url) if n not in nomes]
    if faltam:
        _erro(f"O endereço usa {', '.join(faltam)}, que não está nos parâmetros.")
    cabecalhos = []
    for c in config.get("cabecalhos") or []:
        nome, valor = (c.get("nome") or "").strip(), (c.get("valor") or "").strip()
        if not re.match(r"^[A-Za-z0-9-]{1,60}$", nome) or nome.lower() in ("authorization", "cookie"):
            _erro(f'Cabeçalho inválido: "{nome}". Chave de acesso vai em "chave", nunca no cabeçalho fixo.')
        cabecalhos.append({"nome": nome, "valor": valor[:300]})
    timeout = min(max(int(config.get("timeout_s") or 15), 3), 30)
    return {"metodo": metodo, "url": url, "parametros": parametros, "cabecalhos": cabecalhos,
            "segredo": _conferir_segredo(config.get("segredo")), "timeout_s": timeout}


def _ferramenta_dict(linha: dict) -> dict:
    return {"id": linha["id"], "tipo": linha["tipo"], "nome": linha["nome"], "descricao": linha["descricao"],
            "config": linha["config"], "ativa": linha["ativa"], **_meta(linha)}


def listar_ferramentas() -> list[dict]:
    return [_ferramenta_dict(l) for l in sorted(_linhas("ferramentas"), key=lambda l: l["nome"].lower())]


def obter_ferramenta(ferramenta_id: str) -> dict:
    achada = _linhas("ferramentas", _t("ferramentas").c.id == ferramenta_id)
    if not achada:
        _erro(f"Ferramenta desconhecida: {ferramenta_id}.", 404)
    return _ferramenta_dict(achada[0])


def salvar_ferramenta(ferramenta_id: str, dados: dict, autor: str, criando: bool) -> dict:
    if not ID_VALIDO.match(ferramenta_id or ""):
        _erro("O identificador tem de 3 a 40 caracteres: letras minúsculas, números e hífen.")
    tipo = dados.get("tipo") or "http"
    if tipo != "http":
        _erro("Por enquanto, as ferramentas do painel são do tipo http.")
    nome = (dados.get("nome") or "").strip()
    descricao = " ".join((dados.get("descricao") or "").split())
    if not nome or len(nome) > 80:
        _erro("O nome é obrigatório e tem até 80 caracteres.")
    if len(descricao) < 20 or len(descricao) > 1500:
        _erro("A descrição tem de 20 a 1.500 caracteres: é por ela que o agente decide quando usar a ferramenta.")
    config = _validar_http(dados.get("config") or {})
    valores = {"tipo": tipo, "nome": nome, "descricao": descricao, "config": config, "ativa": bool(dados.get("ativa", True))}
    with _trava:
        existe = bool(_linhas("ferramentas", _t("ferramentas").c.id == ferramenta_id))
        if criando and existe:
            _erro(f"Já existe uma ferramenta com o identificador {ferramenta_id}.", 409)
        if not criando and not existe:
            _erro(f"Ferramenta desconhecida: {ferramenta_id}.", 404)
        _gravar("ferramentas", ferramenta_id, {"id": ferramenta_id, **valores} if criando else valores, autor, criando)
    return obter_ferramenta(ferramenta_id)


def excluir_ferramenta(ferramenta_id: str, usada_por: list[str]) -> None:
    if usada_por:
        _erro(f"A ferramenta está ligada a: {', '.join(usada_por)}. Tire dos agentes antes de excluir.", 409)
    with _estado["engine"].begin() as conexao:
        conexao.execute(delete(_t("ferramentas")).where(_t("ferramentas").c.id == ferramenta_id))


def _cabecalhos(config: dict) -> dict:
    cabecalhos = {c["nome"]: c["valor"] for c in config.get("cabecalhos") or []}
    segredo = config.get("segredo")
    if segredo:
        valor = _no_cofre("ler", segredo["chave"])
        if not valor:
            raise RuntimeError(f"A chave {segredo['chave']} não está no cofre.")
        cabecalhos[segredo["cabecalho"]] = segredo["prefixo"] + valor
    return cabecalhos


def _resposta(texto: str) -> str:
    from agente.guardrails import mascarar_texto  # CPF e cartão não voltam ao modelo nem ao rastro

    texto = mascarar_texto(texto or "")
    return texto if len(texto) <= MAX_RESPOSTA else texto[:MAX_RESPOSTA] + "\n…(resposta cortada)"


def chamar_http(config: dict, argumentos: dict) -> str:
    """Executa a ferramenta HTTP com os argumentos do modelo, só nos parâmetros declarados."""
    url = config["url"]
    consulta, corpo = {}, {}
    for p in config["parametros"]:
        if p["nome"] not in argumentos or argumentos[p["nome"]] in (None, ""):
            if p["obrigatorio"]:
                return json.dumps({"erro": f"Falta o parâmetro obrigatório {p['nome']}."}, ensure_ascii=False)
            continue
        valor = argumentos[p["nome"]]
        if p["local"] == "path":
            url = url.replace("{" + p["nome"] + "}", quote(str(valor), safe=""))
        elif p["local"] == "query":
            consulta[p["nome"]] = valor
        else:
            corpo[p["nome"]] = valor
    try:
        _conferir_url(url)  # a lista de hosts pode ter mudado depois de a ferramenta ser salva
        _bloquear_rede_interna(_host_da_url(url))
        cabecalhos = _cabecalhos(config)
    except ErroRecurso as erro:
        return json.dumps({"erro": erro.detalhe}, ensure_ascii=False)
    except Exception as erro:
        return json.dumps({"erro": f"A ferramenta não está pronta: {erro}"}, ensure_ascii=False)
    try:
        resposta = httpx.request(config["metodo"], url, params=consulta or None, json=corpo or None,
                                 headers=cabecalhos, timeout=config["timeout_s"], follow_redirects=False)
    except Exception as erro:
        return json.dumps({"erro": f"A API não respondeu: {type(erro).__name__}."}, ensure_ascii=False)
    if resposta.status_code >= 400:
        return json.dumps({"erro": f"A API respondeu {resposta.status_code}.", "detalhe": _resposta(resposta.text[:500])},
                          ensure_ascii=False)
    return _resposta(resposta.text)


def _nome_funcao(texto: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", texto)[:60]


def funcoes(ids: list[str] | tuple[str, ...]) -> list[Function]:
    """As ferramentas do painel ligadas a um agente, prontas para o Agno. Ferramenta desligada não entra."""
    if not ids or "engine" not in _estado:
        return []
    saida: list[Function] = []
    for linha in _linhas("ferramentas", _t("ferramentas").c.id.in_(list(ids))):
        if not linha["ativa"]:
            continue
        if linha["tipo"] != "http":
            continue
        config = linha["config"]
        propriedades = {p["nome"]: {"type": p["tipo"], "description": p["descricao"]} for p in config["parametros"]}
        saida.append(Function(
            name=_nome_funcao(linha["id"]), description=linha["descricao"],
            parameters={"type": "object", "properties": propriedades,
                        "required": [p["nome"] for p in config["parametros"] if p["obrigatorio"]]},
            entrypoint=(lambda c: lambda **argumentos: chamar_http(c, argumentos))(config),
            skip_entrypoint_processing=True))
    return saida


def testar_ferramenta(dados: dict, argumentos: dict) -> dict:
    """Chama a ferramenta (salva ou ainda em edição) com argumentos de teste, sem passar pelo agente."""
    if (dados.get("tipo") or "http") != "http":
        _erro("Por enquanto, as ferramentas do painel são do tipo http.")
    return {"resultado": chamar_http(_validar_http(dados.get("config") or {}), argumentos or {})}


# ───────── Casos de teste ─────────

def _caso_dict(linha: dict) -> dict:
    return {"id": linha["id"], "agente": linha["agente"], "titulo": linha["titulo"], "mensagem": linha["mensagem"],
            "contexto": linha["contexto"] or {}, "esperado": linha["esperado"] or {}, "ativo": linha["ativo"], **_meta(linha)}


def listar_casos(agente_id: str) -> list[dict]:
    return [_caso_dict(l) for l in sorted(_linhas("casos", _t("casos").c.agente == agente_id), key=lambda l: l["id"])]


def _validar_caso(dados: dict, categorias: dict[str, str], agentes_validos: list[str] | None = None) -> dict:
    titulo = " ".join((dados.get("titulo") or "").split())
    mensagem = (dados.get("mensagem") or "").strip()
    if not titulo or len(titulo) > 120:
        _erro("O título do caso é obrigatório e tem até 120 caracteres.")
    if not mensagem or len(mensagem) > 2000:
        _erro("A mensagem do caso é obrigatória e tem até 2.000 caracteres.")
    esperado = dados.get("esperado") or {}
    acao = esperado.get("acao") or "qualquer"
    if acao not in ACOES:
        _erro(f"Ação esperada inválida. Opções: {', '.join(ACOES)}.")
    categoria = esperado.get("categoria") or None
    if categoria and (acao != "transferir" or categoria not in categorias):
        _erro("O motivo esperado só vale para transferência e precisa ser um dos motivos do agente.")
    # Nos casos de uma equipe: o agente que a recepção deve escolher (vazio = qualquer um).
    agente_esperado = (esperado.get("agente") or "").strip() or None
    if agente_esperado and agentes_validos is not None and agente_esperado not in agentes_validos:
        _erro(f"O agente esperado precisa ser um membro da equipe: {', '.join(agentes_validos)}.")
    lista = lambda chave: [t.strip() for t in esperado.get(chave) or [] if t and t.strip()][:10]  # noqa: E731
    contexto = dados.get("contexto") or {}
    return {"titulo": titulo, "mensagem": mensagem, "ativo": bool(dados.get("ativo", True)),
            "contexto": {"nome_contato": (contexto.get("nome_contato") or "")[:80], "telefone": re.sub(r"\D", "", contexto.get("telefone") or "")[:20]},
            "esperado": {"acao": acao, "categoria": categoria, "mencionar": lista("mencionar"), "proibido": lista("proibido"),
                         "agente": agente_esperado}}


def salvar_caso(agente_id: str, caso_id: int | None, dados: dict, categorias: dict[str, str], autor: str,
                agentes_validos: list[str] | None = None) -> dict:
    valores = _validar_caso(dados, categorias, agentes_validos)
    tabela = _t("casos")
    agora = _agora()
    with _estado["engine"].begin() as conexao:
        if caso_id is None:
            caso_id = conexao.execute(insert(tabela).values(agente=agente_id, **valores, criado_em=agora, criado_por=autor,
                                                            atualizado_em=agora, atualizado_por=autor)).inserted_primary_key[0]
        else:
            feito = conexao.execute(update(tabela).where(tabela.c.id == caso_id, tabela.c.agente == agente_id)
                                    .values(**valores, atualizado_em=agora, atualizado_por=autor))
            if not feito.rowcount:
                _erro(f"Caso {caso_id} não existe neste agente.", 404)
    return _caso_dict(_linhas("casos", tabela.c.id == caso_id)[0])


def excluir_caso(agente_id: str, caso_id: int) -> None:
    with _estado["engine"].begin() as conexao:
        feito = conexao.execute(delete(_t("casos")).where(_t("casos").c.id == caso_id, _t("casos").c.agente == agente_id))
    if not feito.rowcount:
        _erro(f"Caso {caso_id} não existe neste agente.", 404)


def _sem_acento(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", (texto or "").lower()) if unicodedata.category(c) != "Mn")


def conferir(caso: dict, resposta: str, acao: str, categoria: str | None, agente: str | None = None) -> list[str]:
    """Os motivos de reprovação de um caso (vazio: passou). `agente`: quem respondeu (numa equipe)."""
    esperado, motivos = caso["esperado"], []
    if esperado.get("agente") and agente != esperado["agente"]:
        motivos.append(f"esperava que {esperado['agente']} respondesse, respondeu {agente or 'ninguém'}")
    if esperado["acao"] != "qualquer" and acao != esperado["acao"]:
        motivos.append(f"esperava {esperado['acao']}, o agente fez {acao}")
    if esperado.get("categoria") and categoria != esperado["categoria"]:
        motivos.append(f"esperava o motivo {esperado['categoria']}, veio {categoria or 'nenhum'}")
    texto = _sem_acento(resposta)
    motivos += [f'não mencionou "{t}"' for t in esperado.get("mencionar") or [] if _sem_acento(t) not in texto]
    motivos += [f'disse "{t}", que é proibido' for t in esperado.get("proibido") or [] if _sem_acento(t) in texto]
    return motivos


def casos_da_calibracao(agente_id: str) -> list[dict]:
    """O gold e o bad dataset do agente (avaliações aprovadas na Calibração, agente/datasets.py), no formato
    que a execução roda. Só leitura aqui: quem cria e aprova é a tela Calibração."""
    from agente import datasets

    saida = []
    for c in datasets.casos(_estado["engine"], _estado.get("schema"), agente=agente_id):
        tipo = "gold+bad" if c["resposta_ruim"] else "gold"
        saida.append({"id": f"calibracao-{c['id']}", "origem": "calibracao", "avaliacao": c["id"],
                      "titulo": f"Calibração #{c['id']} ({tipo}): {c['mensagens'][-1][:60]}", "mensagens": c["mensagens"],
                      "esperado_texto": datasets.esperado_do_caso(c), "ferramentas_exigidas": c["ferramentas_exigidas"],
                      "ferramentas_proibidas": c["ferramentas_proibidas"], "telefone": c.get("telefone") or ""})
    return saida


def _preparar_execucao(agente, autor: str) -> tuple[list[dict], int] | None:
    """Os casos do agente (os da fábrica e os da Calibração) e a linha da execução; None sem casos."""
    casos = ([{**c, "origem": "fabrica"} for c in listar_casos(agente.id) if c["ativo"]] + casos_da_calibracao(agente.id))
    casos = casos[:MAX_CASOS_POR_EXECUCAO]
    if not casos:
        return None
    tabela = _t("execucoes")
    with _estado["engine"].begin() as conexao:
        if conexao.execute(select(tabela.c.id).where(tabela.c.agente == agente.id, tabela.c.situacao == "rodando")).first():
            _erro("Já há uma execução de testes rodando para este agente.", 409)
        execucao_id = conexao.execute(insert(tabela).values(agente=agente.id, situacao="rodando", iniciada_em=_agora(),
                                                            iniciada_por=autor)).inserted_primary_key[0]
    return casos, execucao_id


def iniciar_execucao(agente, autor: str) -> dict:
    """Roda em segundo plano os casos de teste do agente e o dataset dele na Calibração (um caso por vez,
    para não estourar a cota do modelo). Cada caso usa uma conversa nova, que é apagada no fim."""
    preparada = _preparar_execucao(agente, autor)
    if preparada is None:
        _erro("O agente não tem casos de teste ativos nem avaliações aprovadas na Calibração.")
    threading.Thread(target=_executar, args=(agente, *preparada), daemon=True).start()
    return obter_execucao(preparada[1])


def avaliar_em_fila(agentes: list, autor: str) -> dict:
    """A rotina diária: um agente depois do outro, numa tarefa só. Agente sem casos fica de fora."""
    fila, fora = [], []
    for agente in agentes:
        try:
            preparada = _preparar_execucao(agente, autor)
        except ErroRecurso:  # já rodando
            preparada = None
        (fila if preparada else fora).append((agente, preparada) if preparada else agente.id)

    def rodar_todos():
        for agente, (casos, execucao_id) in fila:
            _executar(agente, casos, execucao_id)

    threading.Thread(target=rodar_todos, daemon=True).start()
    return {"agentes": [a.id for a, _ in fila], "sem_casos": fora}


def _rodar_caso(agente, caso: dict, avaliador) -> dict:
    """Um caso, numa conversa nova. Os da fábrica são conferidos pelas regras do caso; os da Calibração,
    pelas ferramentas exigidas ou proibidas e pela nota do juiz (a mesma régua da madrugada)."""
    from agente import datasets
    from agente.atendimento import responder

    session_id = f"aval-fabrica-{uuid.uuid4().hex[:10]}"
    base_resultado = {"caso": caso["id"], "origem": caso["origem"], "titulo": caso["titulo"]}
    try:
        if caso["origem"] == "fabrica":
            mensagens, nome, telefone = [caso["mensagem"]], caso["contexto"].get("nome_contato") or "", caso["contexto"].get("telefone") or ""
        else:
            mensagens, nome, telefone = caso["mensagens"], "", caso["telefone"]
        ferramentas, saida = [], {}
        for mensagem in mensagens:
            saida = responder(agente, session_id, mensagem, nome_contato=nome, telefone=telefone)
            ferramentas += list(saida.get("ferramentas") or [])
        acoes = saida.get("acoes") or []
        transferencia = next((a for a in reversed(acoes) if a.get("tipo") == "transferencia"), None)
        acao = {"transferido": "transferir", "encerrado": "encerrar"}.get(saida.get("status"), "responder")
        resposta = saida.get("resposta") or ""
        categoria = (transferencia or {}).get("categoria")
        nota = None
        if caso["origem"] == "fabrica":
            motivos = conferir(caso, resposta, acao, categoria, saida.get("agente"))
        else:
            from agno.eval.accuracy import AccuracyEval

            motivos = [f"não chamou {f}" for f in caso["ferramentas_exigidas"] if f not in ferramentas]
            motivos += [f"chamou {f} sem poder" for f in caso["ferramentas_proibidas"] if f in ferramentas]
            resultado = AccuracyEval(
                name=caso["titulo"], input=" / ".join(mensagens), expected_output=caso["esperado_texto"], agent=agente,
                model=avaliador, additional_guidelines=datasets.DIRETRIZES, num_iterations=1, db=agente.db,
            ).run_with_output(output=resposta, print_summary=False, print_results=False)
            nota = resultado.avg_score if resultado else None
            if nota is None or nota < datasets.NOTA_MINIMA:
                motivos.append(f"nota {nota} (mínimo {datasets.NOTA_MINIMA})")
        return {**base_resultado, "passou": not motivos, "motivos": motivos, "acao": acao, "categoria": categoria,
                "agente": saida.get("agente"),
                "nota": nota, "resposta": resposta[:1500], "ferramentas": ferramentas}
    except Exception as erro:
        return {**base_resultado, "passou": False, "motivos": [f"falhou ao responder: {type(erro).__name__}: {erro}"]}
    finally:
        try:
            agente.db.delete_session(session_id)
        except Exception as erro:
            log_warning(f"Fábrica: conversa de teste {session_id} não apagada: {erro}")


def _executar(agente, casos: list[dict], execucao_id: int) -> None:
    from agno.models.google import Gemini

    resultados, situacao = [], "concluida"
    try:
        avaliador = Gemini(id=agente.model.id, thinking_level="medium")
        for caso in casos:
            resultados.append(_rodar_caso(agente, caso, avaliador))
    except Exception as erro:
        situacao = "falhou"
        log_warning(f"Fábrica: execução {execucao_id} falhou: {type(erro).__name__}: {erro}")
    passou = sum(r["passou"] for r in resultados)
    with _estado["engine"].begin() as conexao:
        conexao.execute(update(_t("execucoes")).where(_t("execucoes").c.id == execucao_id).values(
            situacao=situacao, concluida_em=_agora(),
            resultado={"total": len(resultados), "passou": passou, "casos": resultados}))


def _execucao_dict(linha: dict) -> dict:
    return {"id": linha["id"], "agente": linha["agente"], "situacao": linha["situacao"], "resultado": linha["resultado"],
            "iniciada_em": _iso(linha["iniciada_em"]), "iniciada_por": linha["iniciada_por"],
            "concluida_em": _iso(linha["concluida_em"])}


def obter_execucao(execucao_id: int) -> dict:
    achada = _linhas("execucoes", _t("execucoes").c.id == execucao_id)
    if not achada:
        _erro(f"Execução {execucao_id} não existe.", 404)
    return _execucao_dict(achada[0])


def execucoes(agente_id: str, limite: int = 10) -> list[dict]:
    linhas = sorted(_linhas("execucoes", _t("execucoes").c.agente == agente_id), key=lambda l: l["id"], reverse=True)
    return [_execucao_dict(l) for l in linhas[:limite]]
