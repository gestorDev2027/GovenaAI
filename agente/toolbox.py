"""O MCP Toolbox for Databases (github.com/googleapis/mcp-toolbox) no mesmo container do servidor.

Só com GESTORGOV_TOOLBOX=sim. O servidor:
1. monta a configuração (`kind: source | tool | toolset`, um documento YAML por item) a partir das integrações
   ativas de todas as organizações. Os segredos NÃO vão para o arquivo: ele traz ${GG_SEGREDO_<id>} e o valor, lido do
   Vault na hora, entra só no ambiente do processo do Toolbox;
2. roda o binário (`toolbox --config <arquivo> --address 127.0.0.1 --port <porta> --enable-api --disable-reload`),
   ouvindo só na máquina, e o reinicia quando uma integração muda (o ambiente com os segredos só muda reiniciando);
3. chama as ferramentas pela API do Toolbox (`POST /api/tool/<nome>/invoke`, o corpo é o JSON dos parâmetros), sempre
   por agente/integracoes.py, que confere limite, aprovação e auditoria antes. O agente nunca fala com o Toolbox.

Toolsets: um por organização (`org_<id>`) e um por integração (`int_<id>`), para quem quiser carregar pelo SDK.
Nas fontes do nosso banco, o organizacao_id é o $1 das consultas e o servidor o preenche em toda chamada (o
"bound param" de verdade: o modelo nem vê o parâmetro). Fontes http do Toolbox já recusam rede interna.

Binário: GESTORGOV_TOOLBOX_BIN (padrão: `toolbox` no PATH; no Dockerfile, /usr/local/bin/toolbox). Porta:
GESTORGOV_TOOLBOX_PORTA (padrão 5005).
"""

import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import httpx
import yaml
from agno.utils.log import log_info, log_warning

_estado: dict = {"processo": None, "arquivo": None, "erro": None, "ferramentas": 0, "iniciado_em": None}
_trava = threading.Lock()
_timer: threading.Timer | None = None


def pedido() -> bool:
    return os.getenv("GESTORGOV_TOOLBOX", "").strip().lower() in ("sim", "1", "true")


def porta() -> int:
    return int(os.getenv("GESTORGOV_TOOLBOX_PORTA") or "5005")


def url() -> str:
    return f"http://127.0.0.1:{porta()}"


def ligado() -> bool:
    processo = _estado.get("processo")
    return pedido() and processo is not None and processo.poll() is None


def situacao() -> dict:
    if not pedido():
        return {"ligado": False, "texto": "Toolbox desligado (GESTORGOV_TOOLBOX): as APIs HTTP rodam direto no servidor; "
                                          "bancos externos esperam o Toolbox."}
    if ligado():
        return {"ligado": True, "texto": f"Toolbox no ar com {_estado['ferramentas']} ferramenta(s)."}
    return {"ligado": False, "texto": f"Toolbox pedido, mas fora do ar: {_estado.get('erro') or 'subindo'}."}


def nome_fonte(integracao_id) -> str:
    return "s_" + str(integracao_id).replace("-", "")


def nome_ferramenta(ferramenta_id) -> str:
    return "t_" + str(ferramenta_id).replace("-", "")


def _variavel(integracao_id) -> str:
    return "GG_SEGREDO_" + str(integracao_id).replace("-", "").upper()


def _parametros(lista: list[dict], local: str | None = None) -> list[dict]:
    tipos = {"string": "string", "integer": "integer", "float": "float", "boolean": "boolean"}
    return [{"name": p["nome"], "type": tipos[p["tipo"]], "description": p["descricao"],
             **({} if p.get("obrigatorio", True) else {"required": False})}
            for p in lista if local is None or p.get("local", "query") == local]


def montar_configuracao() -> tuple[str, dict[str, str], int]:
    """(o YAML, o ambiente com os segredos, quantas ferramentas). Integração sem segredo no cofre fica de fora."""
    from sqlalchemy import select

    from agente import integracoes

    ti, tf = integracoes._t("integracoes"), integracoes._t("ferramentas")
    docs: list[dict] = []
    ambiente: dict[str, str] = {}
    por_org: dict[str, list[str]] = {}
    total = 0
    ativas = integracoes._linhas(select(ti).where(ti.c.situacao == "ativa", ti.c.tipo.in_(("postgres", "mysql", "http"))))
    for integ in ativas:
        try:
            segredo = integracoes.ler_segredo(integ)
        except Exception as erro:
            log_warning(f"Toolbox: segredo da integração {integ['id']} não foi lido ({type(erro).__name__}); fica de fora.")
            continue
        variavel = _variavel(integ["id"])
        fonte = nome_fonte(integ["id"])
        config = integ.get("config") or {}
        if integ["tipo"] == "http":
            cabecalhos = dict(config.get("cabecalhos") or {})
            if segredo:
                ambiente[variavel] = segredo
                cabecalhos[config.get("cabecalho_segredo") or "Authorization"] = (config.get("prefixo_segredo") or "") + "${" + variavel + "}"
            docs.append({"kind": "source", "name": fonte, "type": "http", "baseUrl": integ["endereco"],
                         "timeout": f"{config.get('timeout_s', 15)}s", "headers": cabecalhos})
        elif integ.get("nosso_banco"):
            dados = integracoes._url_nosso_banco()
            if not dados:
                continue
            ambiente[variavel] = dados.password or ""
            docs.append({"kind": "source", "name": fonte, "type": "postgres", "host": dados.host, "port": str(dados.port or 5432),
                         "database": dados.database, "user": dados.username, "password": "${" + variavel + "}",
                         # Só leitura: a transação padrão da conexão não grava.
                         "queryParams": {"sslmode": "require", "default_transaction_read_only": "on"},
                         "queryExecMode": "simple_protocol"})  # o pooler do Supabase não guarda prepared statements
        else:
            if not segredo:
                continue
            ambiente[variavel] = segredo
            docs.append({"kind": "source", "name": fonte, "type": integ["tipo"], "host": integ["endereco"],
                         "port": str(integ["porta"]), "database": integ["banco"], "user": integ["usuario"],
                         "password": "${" + variavel + "}",
                         **({"queryParams": {"sslmode": config.get("sslmode", "require")}} if integ["tipo"] == "postgres" else {})})
        nomes = []
        for f in integracoes._linhas(select(tf).where(tf.c.integracao_id == integ["id"], tf.c.ativa.is_(True))):
            nome = nome_ferramenta(f["id"])
            base = {"kind": "tool", "name": nome, "source": fonte, "description": f["descricao"]}
            if integ["tipo"] == "http":
                corpo = f.get("corpo")
                do_corpo = [p for p in f["parametros"] or [] if p.get("local") == "body"]
                if do_corpo and not corpo:  # o mesmo corpo JSON que a chamada direta monta
                    corpo = "{" + ", ".join(f'"{p["nome"]}": ' + ('"{{.' + p["nome"] + '}}"' if p["tipo"] == "string" else "{{." + p["nome"] + "}}")
                                            for p in do_corpo) + "}"
                docs.append({**base, "type": "http", "method": f["metodo"], "path": f["caminho"],
                             **({"queryParams": _parametros(f["parametros"] or [], "query")} if _parametros(f["parametros"] or [], "query") else {}),
                             **({"bodyParams": _parametros(do_corpo), "requestBody": corpo} if do_corpo or corpo else {})})
            else:
                parametros = _parametros(f["parametros"] or [])
                if integ.get("nosso_banco"):
                    parametros = [{"name": "organizacao_id", "type": "string", "description": "A organização (posta pelo servidor)."}] + parametros
                docs.append({**base, "type": f"{integ['tipo']}-sql", "statement": f["sql"], "parameters": parametros})
            nomes.append(nome)
            total += 1
        if nomes:
            docs.append({"kind": "toolset", "name": "int_" + str(integ["id"]).replace("-", ""), "tools": nomes})
            por_org.setdefault(str(integ["organizacao_id"]), []).extend(nomes)
    for org, nomes in por_org.items():
        docs.append({"kind": "toolset", "name": "org_" + org.replace("-", ""), "tools": nomes})
    return yaml.safe_dump_all(docs, allow_unicode=True, sort_keys=False), ambiente, total


def _parar() -> None:
    processo = _estado.get("processo")
    if processo is not None and processo.poll() is None:
        processo.terminate()
        try:
            processo.wait(timeout=10)
        except subprocess.TimeoutExpired:
            processo.kill()
    _estado["processo"] = None


def reiniciar() -> None:
    """Monta a configuração e (re)inicia o Toolbox. Sem integração com ferramenta, fica parado."""
    if not pedido():
        return
    with _trava:
        _parar()
        try:
            texto, ambiente, total = montar_configuracao()
        except Exception as erro:
            _estado["erro"] = f"configuração: {type(erro).__name__}"
            log_warning(f"Toolbox: a configuração não foi montada: {erro}")
            return
        _estado["ferramentas"] = total
        if not total:
            _estado["erro"] = "nenhuma ferramenta de banco ou API cadastrada"
            return
        pasta = Path(tempfile.gettempdir()) / "gestorgov-toolbox"
        pasta.mkdir(exist_ok=True)
        arquivo = pasta / "tools.yaml"
        arquivo.write_text(texto, encoding="utf-8")  # sem segredos: só ${GG_SEGREDO_...}
        try:
            arquivo.chmod(0o600)
        except OSError:
            pass
        binario = os.getenv("GESTORGOV_TOOLBOX_BIN") or "toolbox"
        # Ambiente mínimo: os segredos das integrações e nada do servidor (sem GOOGLE_API_KEY, DATABASE_URL...).
        env = {k: v for k, v in os.environ.items() if k in ("PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "TZ")}
        env.update(ambiente)
        try:
            _estado["processo"] = subprocess.Popen(
                [binario, "--config", str(arquivo), "--address", "127.0.0.1", "--port", str(porta()), "--enable-api",
                 "--disable-reload", "--log-level", "WARN"],
                env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as erro:
            _estado["erro"] = f"binário não encontrado ({binario}): {type(erro).__name__}"
            log_warning(f"Toolbox: {_estado['erro']}")
            return
        _estado.update(arquivo=str(arquivo), erro=None, iniciado_em=time.time())
    if not esperar_pronto():
        _estado["erro"] = "não respondeu (confira as integrações: senha, host e a consulta)"
    else:
        log_info(f"Toolbox no ar em {url()} com {total} ferramenta(s).")


def esperar_pronto(segundos: float = 20) -> bool:
    limite = time.time() + segundos
    while time.time() < limite:
        if not ligado():
            return False
        try:
            if httpx.get(f"{url()}/api/toolset", timeout=2).status_code == 200:
                return True
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    return False


def agendar_reinicio(atraso: float = 2.0) -> None:
    """Várias mudanças seguidas (a integração e as ferramentas dela) viram um reinício só."""
    global _timer
    if not pedido():
        return
    if _timer is not None:
        _timer.cancel()
    _timer = threading.Timer(atraso, reiniciar)
    _timer.daemon = True
    _timer.start()


def iniciar() -> None:
    """Ao subir o servidor, em segundo plano."""
    if pedido():
        threading.Thread(target=reiniciar, daemon=True).start()


def invocar(nome: str, argumentos: dict) -> str:
    if not ligado():
        raise RuntimeError("O Toolbox não está no ar.")
    resposta = httpx.post(f"{url()}/api/tool/{nome}/invoke", json=argumentos, timeout=45)
    if resposta.status_code >= 400:
        try:
            motivo = resposta.json().get("error") or resposta.json().get("status")
        except ValueError:
            motivo = resposta.text
        raise RuntimeError(f"Toolbox {resposta.status_code}: {str(motivo)[:200]}")
    return str(resposta.json().get("result", ""))
