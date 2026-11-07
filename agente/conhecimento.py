"""Documentos de referência e exemplos aprovados, vetorizados, para o contexto de cada resposta.

- Documentos: enviados pelo painel (PDF, Word, Markdown ou texto), guardados no bucket privado do
  Storage e divididos em trechos com embedding. Cada envio com o mesmo nome é uma VERSÃO nova; só
  uma versão por documento fica ativa, e voltar para uma anterior é reativá-la.
- Exemplos: cada avaliação APROVADA na Calibração vira um exemplo (mensagem do contato + resposta
  aprovada), com os dados pessoais mascarados. Aprovar de novo a mesma situação cria uma versão
  nova do exemplo; desativar tira do contexto sem apagar.
- Contexto: a cada mensagem, um embedding da mensagem do contato busca os exemplos e os trechos mais
  parecidos do agente da conversa. Eles entram nas instruções só daquela resposta (não no histórico),
  e os ids usados ficam no metadata da resposta, para saber de onde veio cada decisão.

- Bases compartilhadas (conhecimento_bases): conjuntos de documentos que valem para vários agentes, para
  todos ("geral") ou para os escolhidos. O documento de uma base tem como dono "base_<id>" (na coluna
  `agente`, que os agentes não usam: id de agente não tem "_"); a busca de cada agente olha os documentos
  dele e os das bases que valem para ele. O roteiro e os exemplos continuam só do agente.

O roteiro principal do atendimento (base_conhecimento.md) continua inteiro nas instruções: os
documentos aqui complementam. Passar o roteiro também para a busca é uma etapa à parte, medida
pelas avaliações.
"""

import hashlib
import io
import os
import re
import unicodedata
from datetime import datetime, timezone

from agno.utils.log import log_info, log_warning
from sqlalchemy import JSON, Boolean, Column, DateTime, Integer, MetaData, String, Table, Text, delete, func, insert, select, update
from sqlalchemy.engine import Engine

from agente import armazenamento, leitura_arquivos, vetores

TIPOS_ACEITOS = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/markdown": ".md",
    "text/plain": ".txt",
    # Planilhas, apresentações, OpenDocument, RTF, HTML, JSON e imagens: agente/leitura_arquivos.py
    **leitura_arquivos.TIPOS,
}
# PDF com menos que isto de texto por página é digitalizado (imagem): o Gemini transcreve.
MINIMO_TEXTO_POR_PAGINA = 40
TAMANHO_TRECHO = 1400  # caracteres por trecho (cerca de 350 tokens)
SOBREPOSICAO = 200
# Distância do cosseno máxima para entrar no contexto (0 = idêntico). Medido em 20/10/2026: pergunta
# relacionada ~0,38 do trecho certo; sem relação ~0,50. Ajustável pelo ambiente.
# Exemplos, medido em 21/10/2026 com os exemplos de produção: a mesma dúvida fica entre 0,11 e 0,17;
# assuntos sem relação ("horário da live", "quero um atendente") entre 0,25 e 0,40. Com 0,40, todo
# exemplo entrava em toda resposta. Juntar a pergunta anterior do agente à busca piorou a separação
# (o texto das boas-vindas aproxima tudo), por isso a busca usa só a mensagem do contato.
MAX_EXEMPLOS = 3
DISTANCIA_EXEMPLOS = float(os.getenv("CONHECIMENTO_DISTANCIA_EXEMPLOS", "0.24"))
MAX_TRECHOS = 4
DISTANCIA_TRECHOS = float(os.getenv("CONHECIMENTO_DISTANCIA_TRECHOS", "0.45"))

_estado: dict = {}


def iniciar(engine: Engine, schema: str | None) -> None:
    """Cria as tabelas (no Postgres, `vector` do pgvector; no SQLite local, JSON)."""
    metadados = MetaData(schema=schema)
    vetor = vetores.tipo_coluna(engine)
    _estado["documentos"] = Table(
        "conhecimento_documentos", metadados,
        Column("id", Integer, primary_key=True, autoincrement=True),
        Column("agente", String(60), nullable=False, index=True),
        Column("nome", String(200), nullable=False),  # o nome do arquivo identifica o documento entre versões
        Column("versao", Integer, nullable=False),
        Column("caminho", String(500), nullable=False),  # no bucket
        Column("tipo_mime", String(120), nullable=False),
        Column("tamanho", Integer, nullable=False),
        Column("hash", String(64), nullable=False),
        Column("status", String(20), nullable=False),  # processando, pronto, erro
        Column("ativo", Boolean, nullable=False, default=False),
        Column("trechos", Integer, nullable=False, default=0),
        Column("erro", Text, nullable=True),
        Column("enviado_por", String(200), nullable=False),
        Column("enviado_em", DateTime(timezone=True), nullable=False),
        Column("processado_em", DateTime(timezone=True), nullable=True),
    )
    _estado["trechos"] = Table(
        "conhecimento_trechos", metadados,
        Column("id", Integer, primary_key=True, autoincrement=True),
        Column("documento_id", Integer, nullable=False, index=True),
        Column("agente", String(60), nullable=False, index=True),
        Column("ordem", Integer, nullable=False),
        Column("secao", String(300), nullable=True),
        Column("conteudo", Text, nullable=False),
        Column("ativo", Boolean, nullable=False, default=False),
        Column("embedding", vetor, nullable=False),
    )
    _estado["exemplos"] = Table(
        "calibracao_exemplos", metadados,
        Column("id", Integer, primary_key=True, autoincrement=True),
        Column("agente", String(60), nullable=False, index=True),
        Column("avaliacao_id", Integer, nullable=False, index=True),
        Column("versao", Integer, nullable=False),
        Column("contexto", Text, nullable=True),  # a resposta anterior do agente, se houver
        Column("mensagem", Text, nullable=False),
        Column("resposta_ideal", Text, nullable=False),
        Column("observacao", Text, nullable=True),
        Column("ativo", Boolean, nullable=False, default=True),
        Column("aprovado_por", String(200), nullable=False),
        Column("criado_em", DateTime(timezone=True), nullable=False),
        Column("embedding", vetor, nullable=False),
    )
    _estado["bases"] = Table(
        "conhecimento_bases", metadados,
        Column("id", String(40), primary_key=True),
        Column("nome", String(80), nullable=False),
        Column("descricao", String(300), nullable=False),
        Column("geral", Boolean, nullable=False, default=False),  # vale para todos os agentes
        Column("agentes", JSON, nullable=False),  # quando não é geral: os agentes que a usam
        Column("criado_em", DateTime(timezone=True), nullable=False),
        Column("criado_por", String(200), nullable=False),
        Column("atualizado_em", DateTime(timezone=True), nullable=False),
        Column("atualizado_por", String(200), nullable=False),
    )
    metadados.create_all(engine, tables=[_estado["documentos"], _estado["trechos"], _estado["exemplos"], _estado["bases"]])
    _estado["engine"] = engine


def disponivel() -> bool:
    return "engine" in _estado


# ───────── Bases compartilhadas ─────────

PREFIXO_BASE = "base_"
ID_BASE = re.compile(r"^[a-z0-9-]{3,30}$")


def dono_da_base(base_id: str) -> str:
    return f"{PREFIXO_BASE}{base_id}"


def eh_base(dono: str) -> bool:
    return (dono or "").startswith(PREFIXO_BASE)


def listar_bases() -> list[dict]:
    bases, documentos = _t("bases"), _t("documentos")
    with _engine().connect() as conexao:
        linhas = [dict(l) for l in conexao.execute(select(bases).order_by(bases.c.nome)).mappings().all()]
        contagem = dict(conexao.execute(
            select(documentos.c.agente, func.count(func.distinct(documentos.c.nome)))
            .where(documentos.c.agente.like(f"{PREFIXO_BASE}%")).group_by(documentos.c.agente)).all())
    for linha in linhas:
        linha["documentos"] = contagem.get(dono_da_base(linha["id"]), 0)
        linha["dono"] = dono_da_base(linha["id"])
    return linhas


def base(base_id: str) -> dict | None:
    return next((b for b in listar_bases() if b["id"] == base_id), None)


def bases_do_agente(agente_id: str) -> list[str]:
    """Os donos ("base_<id>") das bases que valem para o agente: as gerais e as que o incluem."""
    if not disponivel() or "bases" not in _estado:
        return []
    with _engine().connect() as conexao:
        linhas = conexao.execute(select(_t("bases").c.id, _t("bases").c.geral, _t("bases").c.agentes)).all()
    return [dono_da_base(i) for i, geral, agentes in linhas if geral or agente_id in (agentes or [])]


def salvar_base(base_id: str, dados: dict, autor: str, criando: bool) -> dict:
    if not ID_BASE.match(base_id or ""):
        raise ValueError("O identificador da base tem de 3 a 30 caracteres: letras minúsculas, números e hífen.")
    nome = " ".join((dados.get("nome") or "").split())
    if not nome or len(nome) > 80:
        raise ValueError("O nome da base é obrigatório e tem até 80 caracteres.")
    descricao = " ".join((dados.get("descricao") or "").split())[:300]
    geral = bool(dados.get("geral"))
    agentes = [] if geral else list(dict.fromkeys(dados.get("agentes") or []))
    bases, agora = _t("bases"), _agora()
    with _engine().begin() as conexao:
        existe = conexao.execute(select(bases.c.id).where(bases.c.id == base_id)).first()
        if criando and existe:
            raise FileExistsError(f"Já existe uma base com o identificador {base_id}.")
        if not criando and not existe:
            raise LookupError(f"Base desconhecida: {base_id}.")
        valores = {"nome": nome, "descricao": descricao, "geral": geral, "agentes": agentes,
                   "atualizado_em": agora, "atualizado_por": autor}
        if criando:
            conexao.execute(insert(bases).values(id=base_id, criado_em=agora, criado_por=autor, **valores))
        else:
            conexao.execute(update(bases).where(bases.c.id == base_id).values(**valores))
    return base(base_id)


def excluir_base(base_id: str) -> None:
    if base(base_id) is None:
        raise LookupError(f"Base desconhecida: {base_id}.")
    if listar_documentos(dono_da_base(base_id)):
        raise FileExistsError("A base ainda tem documentos: exclua-os antes de excluir a base.")
    with _engine().begin() as conexao:
        conexao.execute(delete(_t("bases")).where(_t("bases").c.id == base_id))


def _t(nome: str) -> Table:
    return _estado[nome]


def _engine() -> Engine:
    return _estado["engine"]


def _agora() -> datetime:
    return datetime.now(timezone.utc)


# ───────── Dados pessoais ─────────

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
_CPF = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
_TELEFONE = re.compile(r"(\+?55[\s-]?)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}\b")


def mascarar(texto: str | None, nomes: list[str] | tuple = ()) -> str:
    """Tira e-mail, CPF, telefone e os nomes informados antes de um texto virar exemplo."""
    if not texto:
        return ""
    texto = _EMAIL.sub("[e-mail do contato]", texto)
    texto = _CPF.sub("[CPF]", texto)
    texto = _TELEFONE.sub("[telefone]", texto)
    for nome in nomes:
        for parte in {p for p in (nome or "").split() if len(p) >= 3}:
            texto = re.sub(rf"\b{re.escape(parte)}\b", "[nome do contato]", texto, flags=re.IGNORECASE)
    return texto


# ───────── Documentos ─────────

def _juntar_palavras_soltas(texto: str) -> str:
    """Alguns PDFs (os exportados do Word com caixas de texto) saem do pypdf com uma palavra por linha,
    separadas por "\\n \\n". Quando a maioria das linhas tem uma ou duas palavras, elas voltam a ser frases."""
    linhas = [l for l in texto.split("\n") if l.strip()]
    if len(linhas) < 20 or sum(len(l.split()) <= 2 for l in linhas) / len(linhas) < 0.6:
        return texto
    texto = re.sub(r"[ \t]*\n[ \t]+\n[ \t]*", " ", texto)  # o separador entre palavras
    return re.sub(r"[ \t]{2,}", " ", texto)


def extrair_texto(conteudo: bytes, tipo_mime: str) -> str:
    if tipo_mime == "application/pdf":
        from pypdf import PdfReader

        paginas = [_juntar_palavras_soltas(pagina.extract_text() or "") for pagina in PdfReader(io.BytesIO(conteudo)).pages]
        texto = "\n\n".join(paginas)
        if paginas and len(texto.strip()) < MINIMO_TEXTO_POR_PAGINA * len(paginas):
            return leitura_arquivos.transcrever(conteudo, tipo_mime) or texto
        return texto
    if tipo_mime.endswith("wordprocessingml.document"):
        import docx

        documento = docx.Document(io.BytesIO(conteudo))
        linhas = []
        for p in documento.paragraphs:
            if not p.text.strip():
                continue
            titulo = (p.style.name or "").lower().startswith(("heading", "título", "titulo"))
            linhas.append(f"## {p.text.strip()}" if titulo else p.text)
        return "\n\n".join(linhas)
    if tipo_mime in leitura_arquivos.TIPOS:
        return leitura_arquivos.extrair(conteudo, tipo_mime)
    return leitura_arquivos.decodificar(conteudo)


def dividir(texto: str) -> list[tuple[str | None, str]]:
    """Trechos de até TAMANHO_TRECHO caracteres, respeitando títulos (#) e parágrafos, com sobreposição."""
    texto = re.sub(r"\n{3,}", "\n\n", texto.replace("\r\n", "\n")).strip()
    trechos: list[tuple[str | None, str]] = []
    secao, atual = None, ""

    def fechar():
        nonlocal atual
        if atual.strip():
            trechos.append((secao, atual.strip()))
        atual = atual[-SOBREPOSICAO:] if len(atual) > SOBREPOSICAO else ""

    # Títulos (#) viram seção mesmo colados ao texto da linha de baixo, como é comum em Markdown.
    blocos: list[tuple[str, str]] = []
    for paragrafo in texto.split("\n\n"):
        linhas: list[str] = []
        for linha in paragrafo.split("\n"):
            titulo = re.match(r"^\s*(#{1,6})\s+(.+)", linha)
            if titulo:
                if linhas:
                    blocos.append(("texto", "\n".join(linhas)))
                    linhas = []
                blocos.append(("titulo", f"{len(titulo.group(1))}|{titulo.group(2).strip()[:200]}"))
            else:
                linhas.append(linha)
        if "\n".join(linhas).strip():
            blocos.append(("texto", "\n".join(linhas).strip()))

    pilha: list[tuple[int, str]] = []  # (nível, título) dos títulos abertos
    for tipo, paragrafo in blocos:
        if tipo == "titulo":
            if atual.strip():
                fechar()
            atual = ""
            nivel, nome = paragrafo.split("|", 1)
            pilha = [(n, s) for n, s in pilha if n < int(nivel)] + [(int(nivel), nome)]
            # O título do documento inteiro (nível 1) não entra: o nome do documento já identifica.
            secao = " › ".join(s for n, s in pilha if n > 1 or len(pilha) == 1)[:300]
            continue
        while len(paragrafo) > TAMANHO_TRECHO:  # parágrafo enorme (PDF sem quebras)
            corte = paragrafo.rfind(" ", 0, TAMANHO_TRECHO)
            corte = corte if corte > 0 else TAMANHO_TRECHO
            atual += paragrafo[:corte]
            fechar()
            paragrafo = paragrafo[corte:].strip()
        if len(atual) + len(paragrafo) > TAMANHO_TRECHO:
            fechar()
        atual += ("\n\n" if atual else "") + paragrafo
    if atual.strip():
        trechos.append((secao, atual.strip()))
    return trechos


def nome_no_bucket(nome: str) -> str:
    """O nome do arquivo no caminho do bucket: sem acento e só com letras, números, ponto, hífen e sublinhado. O
    Storage recusa (HTTP 400) caminho com acento ou "ç": em 03/11, "Atualização - Base de conhecimento.pdf" não subia.
    O nome do documento no painel continua o original."""
    sem_acento = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9._-]+", "_", sem_acento).strip("_")[:150] or "documento"


def registrar_documento(agente: str, nome: str, conteudo: bytes, tipo_mime: str, enviado_por: str,
                        guardar_no_bucket: bool = True) -> dict:
    """Guarda o arquivo no bucket e cria a versão (status "processando"); `processar` faz o resto.
    `guardar_no_bucket=False` só para o roteiro em banco local (testes): o texto já está no banco."""
    if tipo_mime not in TIPOS_ACEITOS:
        raise ValueError("Tipo de arquivo não aceito. Aceitos: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), "
                         "LibreOffice (.odt, .ods, .odp), texto, Markdown, CSV, RTF, HTML, JSON e imagens (PNG, JPG, WebP).")
    if guardar_no_bucket and not armazenamento.disponivel():
        raise RuntimeError("Storage do Supabase não configurado (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY).")
    documentos = _t("documentos")
    resumo = hashlib.sha256(conteudo).hexdigest()
    with _engine().connect() as conexao:
        ultima = conexao.execute(
            select(documentos.c.versao, documentos.c.hash).where(documentos.c.agente == agente, documentos.c.nome == nome)
            .order_by(documentos.c.versao.desc()).limit(1)
        ).first()
    if ultima and ultima.hash == resumo:
        raise ValueError(f"Este arquivo é igual à versão {ultima.versao} de {nome}.")
    versao = (ultima.versao if ultima else 0) + 1
    seguro = nome_no_bucket(nome)
    caminho = f"conhecimento/{agente}/{seguro}/v{versao}/{seguro}"
    if guardar_no_bucket:
        armazenamento.enviar(caminho, conteudo, tipo_mime)
    else:
        caminho = f"(sem bucket) {caminho}"
    with _engine().begin() as conexao:
        documento_id = conexao.execute(insert(documentos).values(
            agente=agente, nome=nome, versao=versao, caminho=caminho, tipo_mime=tipo_mime, tamanho=len(conteudo),
            hash=resumo, status="processando", ativo=False, trechos=0, enviado_por=enviado_por, enviado_em=_agora(),
        )).inserted_primary_key[0]
    return {"id": documento_id, "versao": versao, "caminho": caminho}


def processar(documento_id: int, conteudo: bytes | None = None) -> None:
    """Extrai o texto, divide, gera os embeddings e ativa esta versão (desativando as outras do documento)."""
    documentos, trechos = _t("documentos"), _t("trechos")
    with _engine().connect() as conexao:
        doc = conexao.execute(select(documentos).where(documentos.c.id == documento_id)).mappings().first()
    try:
        conteudo = conteudo if conteudo is not None else armazenamento.baixar(doc["caminho"])
        partes = dividir(extrair_texto(conteudo, doc["tipo_mime"]))
        if not partes:
            raise ValueError("Não foi possível extrair texto do arquivo: ele parece vazio ou só com imagens sem texto.")
        textos = [f"{doc['nome']} — {s}\n{c}" if s else f"{doc['nome']}\n{c}" for s, c in partes]
        vetores_trechos = vetores.embeddings(textos, "RETRIEVAL_DOCUMENT")
        with _engine().begin() as conexao:
            conexao.execute(insert(trechos), [
                {"documento_id": documento_id, "agente": doc["agente"], "ordem": i, "secao": s, "conteudo": c,
                 "ativo": False, "embedding": v}
                for i, ((s, c), v) in enumerate(zip(partes, vetores_trechos))
            ])
            conexao.execute(update(documentos).where(documentos.c.id == documento_id).values(
                status="pronto", trechos=len(partes), processado_em=_agora(), erro=None))
        ativar(documento_id)
        log_info(f"Conhecimento: {doc['nome']} v{doc['versao']} processado ({len(partes)} trechos).")
    except Exception as erro:
        log_warning(f"Conhecimento: falhou o processamento do documento {documento_id}: {erro}")
        with _engine().begin() as conexao:
            conexao.execute(update(documentos).where(documentos.c.id == documento_id).values(
                status="erro", erro=str(erro)[:1000], processado_em=_agora()))


def ativar(documento_id: int) -> None:
    """Esta versão passa a valer; as demais versões do mesmo documento saem do contexto."""
    documentos, trechos = _t("documentos"), _t("trechos")
    with _engine().begin() as conexao:
        doc = conexao.execute(select(documentos).where(documentos.c.id == documento_id)).mappings().first()
        if doc is None or doc["status"] != "pronto":
            raise ValueError("Só uma versão processada pode ser ativada.")
        irmas = select(documentos.c.id).where(documentos.c.agente == doc["agente"], documentos.c.nome == doc["nome"])
        conexao.execute(update(documentos).where(documentos.c.id.in_(irmas)).values(ativo=False))
        conexao.execute(update(trechos).where(trechos.c.documento_id.in_(irmas)).values(ativo=False))
        conexao.execute(update(documentos).where(documentos.c.id == documento_id).values(ativo=True))
        conexao.execute(update(trechos).where(trechos.c.documento_id == documento_id).values(ativo=True))


def desativar(documento_id: int) -> None:
    documentos, trechos = _t("documentos"), _t("trechos")
    with _engine().begin() as conexao:
        conexao.execute(update(documentos).where(documentos.c.id == documento_id).values(ativo=False))
        conexao.execute(update(trechos).where(trechos.c.documento_id == documento_id).values(ativo=False))


def copiar_documentos(origem: str, destino: str, enviado_por: str) -> dict:
    """Os documentos em uso de um agente (a versão ativa de cada um, menos o roteiro, que vem da base) para outro
    agente, como versão 1, com os trechos e os vetores, sem processar de novo. O arquivo é copiado no bucket, no
    caminho do novo dono: excluir o documento de um agente apaga só o arquivo dele. Cada documento falha sozinho."""
    documentos, trechos = _t("documentos"), _t("trechos")
    with _engine().connect() as conexao:
        ativos = conexao.execute(select(documentos).where(
            documentos.c.agente == origem, documentos.c.ativo, documentos.c.status == "pronto",
            documentos.c.nome != ROTEIRO).order_by(documentos.c.nome)).mappings().all()
    resultado: dict = {"copiados": [], "falhas": []}
    for doc in ativos:
        try:
            seguro = nome_no_bucket(doc["nome"])
            caminho = f"conhecimento/{destino}/{seguro}/v1/{seguro}"
            if doc["caminho"].startswith("(sem bucket)"):
                caminho = f"(sem bucket) {caminho}"
            else:
                armazenamento.enviar(caminho, armazenamento.baixar(doc["caminho"]), doc["tipo_mime"])
            with _engine().begin() as conexao:
                linhas = conexao.execute(select(trechos).where(trechos.c.documento_id == doc["id"])
                                         .order_by(trechos.c.ordem)).mappings().all()
                novo = conexao.execute(insert(documentos).values(
                    agente=destino, nome=doc["nome"], versao=1, caminho=caminho, tipo_mime=doc["tipo_mime"],
                    tamanho=doc["tamanho"], hash=doc["hash"], status="pronto", ativo=True, trechos=len(linhas),
                    enviado_por=enviado_por, enviado_em=_agora(), processado_em=_agora(),
                )).inserted_primary_key[0]
                if linhas:
                    conexao.execute(insert(trechos), [
                        {"documento_id": novo, "agente": destino, "ordem": t["ordem"], "secao": t["secao"],
                         "conteudo": t["conteudo"], "ativo": True, "embedding": t["embedding"]}
                        for t in linhas
                    ])
            resultado["copiados"].append(doc["nome"])
        except Exception as erro:
            log_warning(f"Conhecimento: {doc['nome']} não foi copiado de {origem} para {destino}: {type(erro).__name__}: {erro}")
            resultado["falhas"].append({"nome": doc["nome"], "erro": str(erro)[:200]})
    log_info(f"Conhecimento: documentos de {origem} copiados para {destino}: {len(resultado['copiados'])}, "
             f"{len(resultado['falhas'])} falha(s).")
    return resultado


def excluir_documento(agente: str, nome: str) -> dict:
    """Apaga o documento inteiro: todas as versões, os trechos com os vetores e os arquivos no bucket.
    O banco vem primeiro (o agente para de usar na hora); arquivo que já não estava no bucket é ignorado.
    O roteiro não se exclui por aqui: ele nasce da base de conhecimento (editor do painel)."""
    if nome == ROTEIRO:
        raise ValueError("O roteiro é gerado pela base de conhecimento: edite-o no editor, em vez de excluir.")
    documentos, trechos = _t("documentos"), _t("trechos")
    with _engine().begin() as conexao:
        versoes = conexao.execute(select(documentos.c.id, documentos.c.caminho).where(
            documentos.c.agente == agente, documentos.c.nome == nome)).all()
        if not versoes:
            raise LookupError("Documento não encontrado.")
        ids = [v.id for v in versoes]
        apagados_trechos = conexao.execute(delete(trechos).where(trechos.c.documento_id.in_(ids))).rowcount
        conexao.execute(delete(documentos).where(documentos.c.id.in_(ids)))
    caminhos = [v.caminho for v in versoes if not v.caminho.startswith("(sem bucket)")]
    resultado = {"versoes": len(ids), "trechos": apagados_trechos, "arquivos": 0}
    if caminhos and armazenamento.disponivel():
        try:
            resultado["arquivos"] = armazenamento.apagar(caminhos)
        except Exception as erro:  # o documento já saiu do banco; o arquivo órfão não é usado pelo agente
            log_warning(f"Documento {nome}: excluído do banco, mas não do bucket: {erro}")
            resultado["erro_bucket"] = str(erro)[:200]
    log_info(f"Documento {nome} ({agente}) excluído: {resultado}")
    return resultado


def listar_documentos(agente: str) -> list[dict]:
    documentos = _t("documentos")
    with _engine().connect() as conexao:
        linhas = conexao.execute(select(documentos).where(documentos.c.agente == agente)
                                 .order_by(documentos.c.nome, documentos.c.versao.desc())).mappings().all()
    return [dict(l) for l in linhas]


def documento(documento_id: int) -> dict | None:
    documentos = _t("documentos")
    with _engine().connect() as conexao:
        linha = conexao.execute(select(documentos).where(documentos.c.id == documento_id)).mappings().first()
    return dict(linha) if linha else None


def trechos_do_documento(documento_id: int) -> list[dict]:
    trechos = _t("trechos")
    with _engine().connect() as conexao:
        linhas = conexao.execute(select(trechos.c.ordem, trechos.c.secao, trechos.c.conteudo)
                                 .where(trechos.c.documento_id == documento_id).order_by(trechos.c.ordem)).mappings().all()
    return [dict(l) for l in linhas]


# ───────── Roteiro do atendimento (base de conhecimento editável) ─────────

ROTEIRO = "roteiro-atendimento.md"  # o roteiro vira um documento com este nome, com as versões do painel
MODOS_ROTEIRO = ("inteiro", "busca")
MAX_TRECHOS_ROTEIRO = int(os.getenv("ROTEIRO_TRECHOS", "6"))
DISTANCIA_ROTEIRO = float(os.getenv("ROTEIRO_DISTANCIA", "0.55"))


def modo_roteiro() -> str:
    """inteiro (padrão): o roteiro vai inteiro nas instruções. busca: vai só o essencial, e as seções
    relevantes chegam pela busca vetorial a cada mensagem."""
    modo = os.getenv("ROTEIRO_MODO", "inteiro").strip().lower()
    return modo if modo in MODOS_ROTEIRO else "inteiro"


def roteiro_essencial(texto: str) -> str:
    """O que nunca pode faltar: a introdução (antes do primeiro ##) e a seção "Sempre transferir"."""
    secoes = re.split(r"(?m)^(?=## )", texto)
    partes = [secoes[0].strip()] + [s.strip() for s in secoes[1:] if "sempre transferir" in s.split("\n", 1)[0].lower()]
    return "\n\n".join(p for p in partes if p)


def indexar_roteiro(agente: str, texto: str, enviado_por: str) -> int | None:
    """Vetoriza a versão vigente do roteiro (e guarda a cópia no bucket, no banco de produção).

    Não faz nada se ela já estiver indexada (mesmo conteúdo). Devolve o id do documento novo.
    """
    if not disponivel():
        return None
    documentos = _t("documentos")
    conteudo = texto.encode("utf-8")
    resumo = hashlib.sha256(conteudo).hexdigest()
    with _engine().connect() as conexao:
        vigente = conexao.execute(select(documentos.c.id, documentos.c.hash, documentos.c.status).where(
            documentos.c.agente == agente, documentos.c.nome == ROTEIRO, documentos.c.ativo)).first()
        igual = conexao.execute(select(documentos.c.id).where(
            documentos.c.agente == agente, documentos.c.nome == ROTEIRO, documentos.c.hash == resumo,
            documentos.c.status == "pronto")).first()
    if vigente and vigente.hash == resumo:
        return None
    if igual:  # voltou a um texto já indexado (ex.: "Restaurar texto padrão"): só reativa
        ativar(igual.id)
        return igual.id
    no_bucket = vetores.eh_postgres(_engine()) and armazenamento.disponivel()
    try:
        registro = registrar_documento(agente, ROTEIRO, conteudo, "text/markdown", enviado_por, guardar_no_bucket=no_bucket)
    except ValueError:  # mesmo hash da última versão, mas com erro no processamento: tenta de novo
        with _engine().connect() as conexao:
            ultima = conexao.execute(select(documentos.c.id).where(
                documentos.c.agente == agente, documentos.c.nome == ROTEIRO).order_by(documentos.c.versao.desc()).limit(1)).first()
        registro = {"id": ultima.id}
    processar(registro["id"], conteudo)
    return registro["id"]


# ───────── Exemplos aprovados ─────────

def criar_exemplo(avaliacao: dict, aprovado_por: str, nomes: list[str]) -> int:
    """Uma avaliação aprovada vira exemplo (dados pessoais mascarados). Versão nova a cada aprovação."""
    exemplos = _t("exemplos")
    historico = avaliacao["historico"]
    contexto = historico[-3]["texto"] if len(historico) >= 3 else None
    mensagem = mascarar(avaliacao["mensagem_contato"], nomes)
    resposta = mascarar(avaliacao.get("resposta_ideal") or avaliacao["resposta_agente"], nomes)
    vetor = vetores.embedding(mensagem if not contexto else f"{mascarar(contexto, nomes)}\n{mensagem}", "RETRIEVAL_DOCUMENT")
    with _engine().begin() as conexao:
        versao = (conexao.execute(select(func.max(exemplos.c.versao)).where(
            exemplos.c.avaliacao_id == avaliacao["id"])).scalar() or 0) + 1
        conexao.execute(update(exemplos).where(exemplos.c.avaliacao_id == avaliacao["id"]).values(ativo=False))
        return conexao.execute(insert(exemplos).values(
            agente=avaliacao["agente"], avaliacao_id=avaliacao["id"], versao=versao,
            contexto=mascarar(contexto, nomes) or None, mensagem=mensagem, resposta_ideal=resposta,
            observacao=mascarar(avaliacao.get("comentario"), nomes) or None, ativo=True,
            aprovado_por=aprovado_por, criado_em=_agora(), embedding=vetor,
        )).inserted_primary_key[0]


def listar_exemplos(agente: str) -> list[dict]:
    exemplos = _t("exemplos")
    colunas = [c for c in exemplos.c if c.name != "embedding"]
    with _engine().connect() as conexao:
        linhas = conexao.execute(select(*colunas).where(exemplos.c.agente == agente)
                                 .order_by(exemplos.c.id.desc())).mappings().all()
    return [dict(l) for l in linhas]


def definir_exemplo_ativo(exemplo_id: int, ativo: bool) -> None:
    exemplos = _t("exemplos")
    with _engine().begin() as conexao:
        conexao.execute(update(exemplos).where(exemplos.c.id == exemplo_id).values(ativo=ativo))


# ───────── Contexto de cada resposta ─────────

def contexto(agente: str, mensagem: str) -> dict | None:
    """Exemplos aprovados e trechos de documentos mais parecidos com a mensagem do contato."""
    if not disponivel() or not mensagem.strip():
        return None
    exemplos, trechos, documentos = _t("exemplos"), _t("trechos"), _t("documentos")
    do_roteiro = trechos.c.documento_id.in_(select(documentos.c.id).where(documentos.c.nome == ROTEIRO))
    com_roteiro = modo_roteiro() == "busca"
    base_tr = [trechos.c.agente == agente, trechos.c.ativo]
    # Documentos: os do agente e os das bases compartilhadas que valem para ele.
    docs_tr = [trechos.c.agente.in_([agente, *bases_do_agente(agente)]), trechos.c.ativo]
    with _engine().connect() as conexao:
        ha_exemplos = conexao.execute(select(exemplos.c.id).where(exemplos.c.agente == agente, exemplos.c.ativo).limit(1)).first()
        ha_trechos = conexao.execute(select(trechos.c.id).where(*docs_tr, ~do_roteiro).limit(1)).first()
        ha_roteiro = com_roteiro and conexao.execute(select(trechos.c.id).where(*base_tr, do_roteiro).limit(1)).first()
    if not ha_exemplos and not ha_trechos and not ha_roteiro:
        return None  # sem nada para buscar, nem gera o embedding
    vetor = vetores.embedding(mensagem, "RETRIEVAL_QUERY")
    achados_ex = vetores.buscar(_engine(), exemplos, vetor, [exemplos.c.agente == agente, exemplos.c.ativo],
                                MAX_EXEMPLOS, DISTANCIA_EXEMPLOS) if ha_exemplos else []
    achados_tr = vetores.buscar(_engine(), trechos, vetor, [*docs_tr, ~do_roteiro],
                                MAX_TRECHOS, DISTANCIA_TRECHOS) if ha_trechos else []
    achados_ro = vetores.buscar(_engine(), trechos, vetor, [*base_tr, do_roteiro],
                                MAX_TRECHOS_ROTEIRO, DISTANCIA_ROTEIRO) if ha_roteiro else []
    if not achados_ex and not achados_tr and not achados_ro:
        return None
    if achados_tr:
        with _engine().connect() as conexao:
            nomes = dict(conexao.execute(select(documentos.c.id, documentos.c.nome).where(
                documentos.c.id.in_({t["documento_id"] for t in achados_tr}))).all())
        nomes_bases = {b["dono"]: b["nome"] for b in listar_bases()} if any(eh_base(t["agente"]) for t in achados_tr) else {}
        for t in achados_tr:
            t["documento"] = nomes.get(t["documento_id"], "")
            if eh_base(t["agente"]):  # de uma base compartilhada: o nome dela vai junto
                t["documento"] += f" (base {nomes_bases.get(t['agente'], t['agente'])})"
            t["base"] = t["agente"] if eh_base(t["agente"]) else None
    return {
        "exemplos": [{k: e[k] for k in ("id", "versao", "contexto", "mensagem", "resposta_ideal", "observacao", "distancia")}
                     for e in achados_ex],
        "trechos": [{k: t[k] for k in ("id", "documento_id", "documento", "base", "secao", "conteudo", "distancia")} for t in achados_tr],
        "roteiro": [{k: t[k] for k in ("id", "secao", "conteudo", "distancia")} for t in achados_ro],
    }


def formatar(ctx: dict | None) -> str:
    """Seções extras das instruções, só para a resposta atual."""
    if not ctx:
        return ""
    partes = []
    if ctx.get("roteiro"):
        blocos = "\n\n".join(f"[{t['secao'] or 'Roteiro'}]\n{t['conteudo']}" for t in ctx["roteiro"])
        partes.append(
            "<roteiro_relevante>\nAs seções do roteiro de atendimento mais relacionadas à mensagem do contato (o resto do "
            "roteiro não está aqui). Siga-as como a base de conhecimento acima: links, prazos e passos exatamente como "
            "estão. Se o assunto não estiver em nenhuma delas, não invente: diga o que souber com segurança ou transfira.\n\n"
            f"{blocos}\n</roteiro_relevante>"
        )
    if ctx.get("trechos"):
        blocos = "\n\n".join(f"[{t['documento']}{' — ' + t['secao'] if t.get('secao') else ''}]\n{t['conteudo']}"
                             for t in ctx["trechos"])
        partes.append(
            "<trechos_de_documentos>\nTrechos dos documentos de referência mais relacionados à mensagem do contato. "
            "Podem não ser relevantes: use só o que responde ao que ele perguntou, sem inventar, e mantenha links, "
            "prazos e valores exatamente como estão. Se um trecho contradizer o roteiro principal, siga o roteiro.\n\n"
            f"{blocos}\n</trechos_de_documentos>"
        )
    if ctx.get("exemplos"):
        blocos = "\n\n".join(
            (f"Contexto: {e['contexto']}\n" if e.get("contexto") else "")
            + f"Contato: {e['mensagem']}\nResposta aprovada: {e['resposta_ideal']}"
            + (f"\nObservação da equipe: {e['observacao']}" if e.get("observacao") else "")
            for e in ctx["exemplos"]
        )
        partes.append(
            "<exemplos_aprovados>\nSituações parecidas que a equipe avaliou e aprovou. Siga o conteúdo "
            "e as decisões (orientar, consultar o cadastro, transferir ou não), adaptando ao que o contato disse agora. "
            "Os dados entre colchetes foram retirados: use os do contato atual.\n\n"
            f"{blocos}\n</exemplos_aprovados>"
        )
    return "\n\n" + "\n\n".join(partes)


def ids_usados(ctx: dict | None) -> dict:
    """O que entrou numa resposta, gravado nos metadados dela. `distancias` (e<id>/t<id> → distância do
    cosseno) mostra no painel o quanto cada item era parecido com a mensagem."""
    if not ctx:
        return {}
    distancias = {f"e{e['id']}": round(e["distancia"], 4) for e in ctx.get("exemplos", []) if e.get("distancia") is not None}
    distancias |= {f"t{t['id']}": round(t["distancia"], 4)
                   for t in [*ctx.get("trechos", []), *ctx.get("roteiro", [])] if t.get("distancia") is not None}
    return {"exemplos": [(e["id"], e["versao"]) for e in ctx.get("exemplos", [])],
            "trechos": [t["id"] for t in ctx.get("trechos", [])],
            "roteiro": [t["id"] for t in ctx.get("roteiro", [])],
            "distancias": distancias}


def detalhes_usados(exemplos_ids: list[int], trechos_ids: list[int]) -> dict:
    """O conteúdo dos exemplos e trechos que uma resposta usou (o painel abre a partir do selo "usou...").
    Lê pelo id, mesmo que hoje estejam inativos: mostra o que o agente viu naquela resposta."""
    exemplos, trechos, documentos = _t("exemplos"), _t("trechos"), _t("documentos")
    with _engine().connect() as conexao:
        linhas_tr = conexao.execute(
            select(trechos.c.id, trechos.c.documento_id, trechos.c.ordem, trechos.c.secao, trechos.c.conteudo,
                   trechos.c.ativo, documentos.c.nome.label("documento"), documentos.c.versao)
            .join(documentos, documentos.c.id == trechos.c.documento_id)
            .where(trechos.c.id.in_(trechos_ids or [-1]))
        ).mappings().all() if trechos_ids else []
        linhas_ex = conexao.execute(
            select(exemplos.c.id, exemplos.c.versao, exemplos.c.contexto, exemplos.c.mensagem, exemplos.c.resposta_ideal,
                   exemplos.c.observacao, exemplos.c.ativo, exemplos.c.aprovado_por, exemplos.c.criado_em)
            .where(exemplos.c.id.in_(exemplos_ids))
        ).mappings().all() if exemplos_ids else []
    ordem_tr = {i: n for n, i in enumerate(trechos_ids)}
    ordem_ex = {i: n for n, i in enumerate(exemplos_ids)}
    trechos_saida = sorted((dict(l) | {"roteiro": l["documento"] == ROTEIRO} for l in linhas_tr), key=lambda t: ordem_tr[t["id"]])
    return {
        "trechos": trechos_saida,
        "exemplos": sorted((dict(l) for l in linhas_ex), key=lambda e: ordem_ex[e["id"]]),
    }
