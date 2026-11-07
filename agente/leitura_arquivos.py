"""O texto dos arquivos da base de conhecimento além de PDF, Word (.docx), Markdown e texto (agente/conhecimento.py).

- Planilhas (.xlsx, .csv, .tsv, .ods): uma seção por planilha; cada linha vira "Coluna: valor; Coluna: valor", com o
  cabeçalho da primeira linha, para o trecho fazer sentido sozinho na busca.
- Apresentações (.pptx, .odp): uma seção por slide, com as anotações.
- Texto (.odt, .rtf, .html, .json): o texto, sem a marcação.
- Imagens (.png, .jpg, .webp) e PDF digitalizado (sem texto): o Gemini transcreve. É a única leitura que chama o modelo.

Word, Excel e PowerPoint antigos (.doc, .xls, .ppt) não são lidos: o envio diz para salvar no formato novo ou em PDF.
"""

import csv
import io
import json
import re
import zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree

TIPOS = {
    "text/csv": ".csv",
    "text/tab-separated-values": ".tsv",
    "application/json": ".json",
    "text/html": ".html",
    "application/rtf": ".rtf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.oasis.opendocument.text": ".odt",
    "application/vnd.oasis.opendocument.spreadsheet": ".ods",
    "application/vnd.oasis.opendocument.presentation": ".odp",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
# O tipo pela extensão: navegadores mandam vários destes como application/octet-stream.
POR_EXTENSAO = {
    ".csv": "text/csv", ".tsv": "text/tab-separated-values", ".json": "application/json", ".html": "text/html",
    ".htm": "text/html", ".rtf": "application/rtf", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".odt": "application/vnd.oasis.opendocument.text", ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".odp": "application/vnd.oasis.opendocument.presentation", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".webp": "image/webp",
}
# Outros nomes que os navegadores e sistemas usam para os mesmos tipos.
SINONIMOS = {"text/rtf": "application/rtf", "application/csv": "text/csv", "text/x-csv": "text/csv", "image/jpg": "image/jpeg"}
ANTIGOS = {".doc": "Word", ".xls": "Excel", ".ppt": "PowerPoint"}

MAX_LINHAS_PLANILHA = 5000
MAX_TRANSCRICAO_BYTES = 19 * 1024 * 1024  # o Gemini aceita até 20 MB no corpo do pedido
TRANSCREVER = """Transcreva todo o texto deste arquivo, em português, na ordem de leitura. Mantenha títulos (com "## "), listas
e tabelas (em Markdown). Não resuma, não comente e não invente: se uma parte estiver ilegível, escreva [ilegível]."""


def decodificar(conteudo: bytes) -> str:
    for codificacao in ("utf-8-sig", "cp1252"):
        try:
            return conteudo.decode(codificacao)
        except UnicodeDecodeError:
            continue
    return conteudo.decode("utf-8", "replace")


def _linhas_como_texto(linhas: list[list[str]]) -> str:
    """Primeira linha como cabeçalho; cada linha seguinte vira "Coluna: valor; ..." (sem as células vazias)."""
    linhas = [[str(c).strip() for c in l] for l in linhas if any(str(c).strip() for c in l)][:MAX_LINHAS_PLANILHA]
    if not linhas:
        return ""
    cabecalho, *resto = linhas
    if not resto:
        return " | ".join(cabecalho)
    saida = []
    for linha in resto:
        pares = [f"{cabecalho[i] if i < len(cabecalho) and cabecalho[i] else f'Coluna {i + 1}'}: {valor}"
                 for i, valor in enumerate(linha) if valor]
        saida.append("; ".join(pares))
    return "\n".join(saida)


def _csv(texto: str, separador: str | None) -> str:
    if separador is None:
        try:
            separador = csv.Sniffer().sniff(texto[:5000], delimiters=",;\t|").delimiter
        except csv.Error:
            separador = ","
    return _linhas_como_texto(list(csv.reader(io.StringIO(texto), delimiter=separador)))


def _xlsx(conteudo: bytes) -> str:
    from openpyxl import load_workbook

    livro = load_workbook(io.BytesIO(conteudo), read_only=True, data_only=True)
    partes = []
    for folha in livro.worksheets:
        texto = _linhas_como_texto([["" if c is None else c for c in linha] for linha in folha.iter_rows(values_only=True)])
        if texto:
            partes.append(f"## {folha.title}\n\n{texto}")
    return "\n\n".join(partes)


def _pptx(conteudo: bytes) -> str:
    from pptx import Presentation

    partes = []
    for numero, slide in enumerate(Presentation(io.BytesIO(conteudo)).slides, start=1):
        textos = []
        for forma in slide.shapes:
            if forma.has_text_frame and forma.text_frame.text.strip():
                textos.append(forma.text_frame.text.strip())
            if getattr(forma, "has_table", False) and forma.has_table:
                textos.append(_linhas_como_texto([[c.text for c in linha.cells] for linha in forma.table.rows]))
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame.text.strip():
            textos.append("Anotações: " + slide.notes_slide.notes_text_frame.text.strip())
        if textos:
            partes.append(f"## Slide {numero}\n\n" + "\n\n".join(textos))
    return "\n\n".join(partes)


_ODF = "{urn:oasis:names:tc:opendocument:xmlns:%s:1.0}"


def _odf(conteudo: bytes, tipo: str) -> str:
    """OpenDocument (LibreOffice): o content.xml do pacote, sem biblioteca externa."""
    raiz = ElementTree.fromstring(zipfile.ZipFile(io.BytesIO(conteudo)).read("content.xml"))
    texto, tabela = _ODF % "text", _ODF % "table"

    def plano(elemento) -> str:
        return "".join(elemento.itertext()).strip()

    if tipo.endswith("spreadsheet"):
        partes = []
        for folha in raiz.iter(f"{tabela}table"):
            linhas = [[plano(c) for c in linha.iter(f"{tabela}table-cell")] for linha in folha.iter(f"{tabela}table-row")]
            corpo = _linhas_como_texto(linhas)
            if corpo:
                partes.append(f"## {folha.get(f'{tabela}name') or 'Planilha'}\n\n{corpo}")
        return "\n\n".join(partes)
    if tipo.endswith("presentation"):
        partes = []
        for numero, pagina in enumerate(raiz.iter(f"{_ODF % 'drawing'}page"), start=1):
            textos = [plano(p) for p in pagina.iter(f"{texto}p") if plano(p)]
            if textos:
                partes.append(f"## Slide {numero}\n\n" + "\n".join(textos))
        return "\n\n".join(partes)
    linhas = []
    for elemento in raiz.iter():
        if elemento.tag == f"{texto}h" and plano(elemento):
            linhas.append(f"## {plano(elemento)}")
        elif elemento.tag == f"{texto}p" and plano(elemento):
            linhas.append(plano(elemento))
    return "\n\n".join(linhas)


class _SemTags(HTMLParser):
    BLOCOS = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "table"}

    def __init__(self):
        super().__init__()
        self.partes: list[str] = []
        self._ignorar = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self._ignorar += 1
        elif tag in ("h1", "h2", "h3"):
            self.partes.append("\n\n## ")
        elif tag in self.BLOCOS:
            self.partes.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self._ignorar = max(0, self._ignorar - 1)
        elif tag in self.BLOCOS:
            self.partes.append("\n")

    def handle_data(self, data):
        if not self._ignorar:
            self.partes.append(data)


def _html(texto: str) -> str:
    leitor = _SemTags()
    leitor.feed(texto)
    linhas = [re.sub(r"[ \t]+", " ", l).strip() for l in "".join(leitor.partes).split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(linhas)).strip()


def _rtf(texto: str) -> str:
    from striprtf.striprtf import rtf_to_text

    return rtf_to_text(texto, errors="ignore")


def _json(texto: str) -> str:
    try:
        return json.dumps(json.loads(texto), ensure_ascii=False, indent=2)
    except ValueError:
        return texto


def transcrever(conteudo: bytes, tipo_mime: str) -> str:
    """Imagem ou PDF digitalizado: o Gemini lê e transcreve o texto (o modelo do servidor, AGENTE_MODELO)."""
    import os

    from google.genai import types

    from agente import vetores

    if len(conteudo) > MAX_TRANSCRICAO_BYTES:
        raise ValueError("Arquivo grande demais para ler como imagem (até 19 MB). Envie em partes ou como texto.")
    resposta = vetores._cliente().models.generate_content(
        model=os.getenv("AGENTE_MODELO", "gemini-3.6-flash"),
        contents=[types.Part.from_bytes(data=conteudo, mime_type=tipo_mime), TRANSCREVER],
    )
    return (resposta.text or "").strip()


def extrair(conteudo: bytes, tipo_mime: str) -> str:
    """O texto de um dos TIPOS. ValueError para tipo que não está aqui."""
    if tipo_mime.startswith("image/"):
        return transcrever(conteudo, tipo_mime)
    if tipo_mime.endswith("spreadsheetml.sheet"):
        return _xlsx(conteudo)
    if tipo_mime.endswith("presentationml.presentation"):
        return _pptx(conteudo)
    if tipo_mime.startswith("application/vnd.oasis.opendocument"):
        return _odf(conteudo, tipo_mime)
    texto = decodificar(conteudo)
    if tipo_mime == "text/csv":
        return _csv(texto, None)
    if tipo_mime == "text/tab-separated-values":
        return _csv(texto, "\t")
    if tipo_mime == "text/html":
        return _html(texto)
    if tipo_mime == "application/rtf":
        return _rtf(texto)
    if tipo_mime == "application/json":
        return _json(texto)
    raise ValueError(f"Tipo de arquivo não lido: {tipo_mime}.")


def tipo_do_arquivo(nome: str, tipo_informado: str, aceitos: dict) -> str:
    """O tipo a gravar: o informado pelo navegador quando é um dos aceitos; senão, pela extensão do nome. Levanta
    ValueError com a orientação para os formatos antigos do Office."""
    extensao = "." + (nome or "").rsplit(".", 1)[-1].lower() if "." in (nome or "") else ""
    if extensao in ANTIGOS:
        programa = ANTIGOS[extensao]
        novo = {"Word": ".docx", "Excel": ".xlsx", "PowerPoint": ".pptx"}[programa]
        raise ValueError(f"Arquivo do {programa} antigo ({extensao}): abra no {programa} e salve como {novo} ou PDF.")
    tipo = SINONIMOS.get(tipo_informado, tipo_informado)
    if tipo in aceitos:
        return tipo
    return {".md": "text/markdown", ".markdown": "text/markdown", ".txt": "text/plain", ".pdf": "application/pdf",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", **POR_EXTENSAO}.get(extensao, tipo)
