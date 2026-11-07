"""Storage do Supabase do GestorGov: o bucket privado dos documentos dos agentes.

O bucket `agentes` é privado e só o servidor o acessa, com a service role do projeto
(SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY). Migration: supabase/gestorgov/20261106_gestorgov_inicial.sql.
"""

import os
from urllib.parse import quote

import httpx

BUCKET = os.getenv("SUPABASE_BUCKET_AGENTES", "agentes")


def _env(nome: str) -> str:
    # Os nomes antigos do projeto base (SUPABASE_NEXA_*) continuam aceitos.
    return (os.getenv(nome) or os.getenv(nome.replace("SUPABASE_", "SUPABASE_NEXA_", 1)) or "").strip()


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
