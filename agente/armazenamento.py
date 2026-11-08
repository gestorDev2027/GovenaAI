"""Storage do Supabase do GestorGov: os buckets privados dos documentos dos agentes e dos arquivos das organizações.

O bucket `agentes` é privado e só o servidor o acessa, com a service role do projeto
(SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY). Migration: supabase/gestorgov/20261106_gestorgov_inicial.sql.
"""

import os
from pathlib import Path
from urllib.parse import quote

import httpx

BUCKET = os.getenv("SUPABASE_BUCKET_AGENTES", "agentes")


def _env(nome: str) -> str:
    return (os.getenv(nome) or "").strip()


def disponivel() -> bool:
    return bool(_env("SUPABASE_URL") and _env("SUPABASE_SERVICE_ROLE_KEY"))


def _base() -> str:
    return f"{_env('SUPABASE_URL').rstrip('/')}/storage/v1/object"


def _cabecalhos() -> dict:
    chave = _env("SUPABASE_SERVICE_ROLE_KEY")
    return {"Authorization": f"Bearer {chave}", "apikey": chave}


def enviar(caminho: str, conteudo: bytes, tipo_mime: str) -> None:
    resposta = httpx.post(
        f"{_base()}/{BUCKET}/{quote(caminho)}",
        content=conteudo,
        headers={**_cabecalhos(), "Content-Type": tipo_mime, "x-upsert": "false"},
        timeout=60,
    )
    if resposta.status_code >= 400:
        raise RuntimeError(f"Storage: envio de {caminho} falhou (HTTP {resposta.status_code}): {resposta.text[:200]}")


def baixar(caminho: str) -> bytes:
    resposta = httpx.get(f"{_base()}/{BUCKET}/{quote(caminho)}", headers=_cabecalhos(), timeout=60)
    if resposta.status_code >= 400:
        raise RuntimeError(f"Storage: download de {caminho} falhou (HTTP {resposta.status_code})")
    return resposta.content


def apagar(caminhos: list[str]) -> int:
    """Apaga os arquivos do bucket; os que já não existem são ignorados. Devolve quantos apagou."""
    if not caminhos:
        return 0
    resposta = httpx.request("DELETE", f"{_base()}/{BUCKET}", json={"prefixes": caminhos}, headers=_cabecalhos(), timeout=60)
    if resposta.status_code >= 400:
        raise RuntimeError(f"Storage: exclusão falhou (HTTP {resposta.status_code}): {resposta.text[:200]}")
    apagados = resposta.json() if resposta.content else []
    return len(apagados) if isinstance(apagados, list) else 0


# ───────── Arquivos das organizações (fotos das unidades) ─────────
# Bucket privado `organizacoes` (migration 20261111_gestorgov_1_base.sql). Sem o Supabase configurado (teste
# local), os arquivos ficam em dados/arquivos/, fora do Git.

BUCKET_ORGANIZACOES = os.getenv("SUPABASE_BUCKET_ORGANIZACOES", "organizacoes")
PASTA_LOCAL = Path(__file__).resolve().parent.parent / "dados" / "arquivos"


def _local(caminho: str) -> Path:
    destino = (PASTA_LOCAL / caminho).resolve()
    if PASTA_LOCAL.resolve() not in destino.parents:
        raise ValueError("Caminho de arquivo inválido.")
    return destino


def guardar(caminho: str, conteudo: bytes, tipo_mime: str) -> None:
    if not disponivel():
        destino = _local(caminho)
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(conteudo)
        return
    resposta = httpx.post(f"{_base()}/{BUCKET_ORGANIZACOES}/{quote(caminho)}", content=conteudo,
                          headers={**_cabecalhos(), "Content-Type": tipo_mime, "x-upsert": "true"}, timeout=60)
    if resposta.status_code >= 400:
        raise RuntimeError(f"Storage: envio de {caminho} falhou (HTTP {resposta.status_code}): {resposta.text[:200]}")


def ler(caminho: str) -> bytes:
    if not disponivel():
        return _local(caminho).read_bytes()
    resposta = httpx.get(f"{_base()}/{BUCKET_ORGANIZACOES}/{quote(caminho)}", headers=_cabecalhos(), timeout=60)
    if resposta.status_code >= 400:
        raise RuntimeError(f"Storage: download de {caminho} falhou (HTTP {resposta.status_code})")
    return resposta.content


def remover(caminho: str) -> None:
    if not disponivel():
        _local(caminho).unlink(missing_ok=True)
        return
    httpx.request("DELETE", f"{_base()}/{BUCKET_ORGANIZACOES}", json={"prefixes": [caminho]}, headers=_cabecalhos(), timeout=60)
