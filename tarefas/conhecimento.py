"""Documentos do Conhecimento: texto, trechos e embeddings fora do servidor web."""

from agente import conhecimento


def processar_documento(execucao_id: str, documento_id: int, conteudo: bytes | None = None) -> dict:
    """Processa a versão do documento. Sem `conteudo`, o arquivo vem do bucket (é o caso no Render).

    `conhecimento.processar` grava o erro no documento em vez de levantar; aqui o erro volta a subir para a tarefa
    tentar de novo (no Render) e ficar como erro no andamento."""
    conhecimento.processar(documento_id, conteudo)
    doc = conhecimento.documento(documento_id) or {}
    if doc.get("status") != "pronto":
        raise RuntimeError(doc.get("erro") or "O documento não foi processado.")
    return {"documento_id": documento_id, "trechos": doc.get("trechos") or 0}
