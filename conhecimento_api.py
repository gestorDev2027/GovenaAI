"""Documentos de referência e exemplos aprovados dos agentes, pelo painel (/painel/api/conhecimento).

Documentos: o painel envia o arquivo, o servidor guarda no bucket privado do nexa-DB e processa em
segundo plano (texto, trechos, embeddings); a versão nova passa a valer quando fica pronta.
Exemplos: nascem da aprovação na Calibração (calibracao_api.py); aqui só se ativam ou desativam.
Bases compartilhadas (/bases): conjuntos de documentos para vários agentes. Os documentos de uma base usam
as mesmas rotas de documentos, com agente=base_<id da base>.
Sugestões do roteiro (/documentos/{id}/sugestoes-roteiro): o que um documento muda no roteiro do agente, pela IA,
para a pessoa revisar e aplicar no painel (agente/sugestoes_roteiro.py).
Lógica em agente/conhecimento.py.
"""

import asyncio
from urllib.parse import quote

from agno.agent import Agent
from fastapi import APIRouter, Cookie, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from agente import armazenamento, conhecimento, leitura_arquivos, perfis
from agente import sugestoes_roteiro as sugestoes_roteiro_mod
from calibracao_api import _negado, _pode, _quem
from painel_api import exigir_chave

MAX_BYTES = 25 * 1024 * 1024  # o mesmo limite do bucket


class PedidoAtivo(BaseModel):
    ativo: bool


class PedidoSugestoes(BaseModel):
    """O agente cujo roteiro é comparado: obrigatório no documento de uma base compartilhada."""
    agente: str | None = Field(default=None, max_length=60)


class PedidoAjuste(BaseModel):
    """Atualizar com IA: a informação nova escrita no painel e o agente do roteiro."""
    agente: str = Field(max_length=60)
    texto: str = Field(max_length=4000)


class BaseCampos(BaseModel):
    nome: str = Field(max_length=200)
    descricao: str = Field(default="", max_length=600)
    geral: bool = False
    agentes: list[str] = Field(default_factory=list, max_length=50)


class BaseNova(BaseCampos):
    id: str = Field(max_length=60)


def _iso(linha: dict) -> dict:
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in linha.items()}


def criar_rotas_conhecimento(agentes: dict[str, Agent]) -> APIRouter:
    rotas = APIRouter(prefix="/painel/api/conhecimento", tags=["Conhecimento"], dependencies=[Depends(exigir_chave)])
    tarefas: set[asyncio.Task] = set()

    def _agente(agente: str) -> str:
        """O dono dos documentos: um agente ou uma base compartilhada (base_<id>)."""
        if conhecimento.eh_base(agente):
            if conhecimento.base(agente[len(conhecimento.PREFIXO_BASE):]) is None:
                raise HTTPException(status_code=404, detail=f"Base desconhecida: {agente}.")
            return agente
        if agente not in agentes:
            raise HTTPException(status_code=404, detail=f"Agente desconhecido: {agente}.")
        return agente

    def _curador(painel_sessao: str | None, permissao: str = "editar_conhecimento") -> str:
        quem = _quem(painel_sessao)
        if not _pode(quem, permissao):
            raise _negado(permissao)
        return quem

    @rotas.get("/bases")
    def listar_bases(agente: str | None = Query(default=None, max_length=60)) -> dict:
        """As bases compartilhadas. Com ?agente=, cada uma traz "vale" (se vale para esse agente)."""
        bases = [_iso(b) for b in conhecimento.listar_bases()]
        if agente:
            for b in bases:
                b["vale"] = b["geral"] or agente in (b["agentes"] or [])
        return {"bases": bases}

    @rotas.post("/bases", status_code=201)
    def criar_base(pedido: BaseNova, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao)
        desconhecidos = [a for a in pedido.agentes if a not in agentes]
        if desconhecidos:
            raise HTTPException(status_code=422, detail=f"Agente desconhecido: {', '.join(desconhecidos)}.")
        try:
            return _iso(conhecimento.salvar_base(pedido.id, pedido.model_dump(exclude={"id"}), quem, True))
        except ValueError as erro:
            raise HTTPException(status_code=422, detail=str(erro))
        except FileExistsError as erro:
            raise HTTPException(status_code=409, detail=str(erro))

    @rotas.put("/bases/{base_id}")
    def alterar_base(base_id: str, pedido: BaseCampos, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao)
        desconhecidos = [a for a in pedido.agentes if a not in agentes]
        if desconhecidos:
            raise HTTPException(status_code=422, detail=f"Agente desconhecido: {', '.join(desconhecidos)}.")
        try:
            return _iso(conhecimento.salvar_base(base_id, pedido.model_dump(), quem, False))
        except ValueError as erro:
            raise HTTPException(status_code=422, detail=str(erro))
        except LookupError as erro:
            raise HTTPException(status_code=404, detail=str(erro))

    @rotas.delete("/bases/{base_id}", status_code=204)
    def excluir_base(base_id: str, painel_sessao: str | None = Cookie(default=None)) -> None:
        _curador(painel_sessao, "excluir")
        try:
            conhecimento.excluir_base(base_id)
        except LookupError as erro:
            raise HTTPException(status_code=404, detail=str(erro))
        except FileExistsError as erro:
            raise HTTPException(status_code=409, detail=str(erro))

    @rotas.get("/status")
    def status() -> dict:
        return {"documentos": armazenamento.disponivel() and conhecimento.disponivel(), "exemplos": conhecimento.disponivel()}

    @rotas.get("/documentos")
    def documentos(agente: str = Query(default=perfis.PADRAO, max_length=60)) -> dict:
        return {"documentos": [_iso(d) for d in conhecimento.listar_documentos(_agente(agente))]}

    @rotas.post("/documentos")
    async def enviar(
        arquivo: UploadFile = File(...),
        agente: str = Form(default=perfis.PADRAO, max_length=60),
        painel_sessao: str | None = Cookie(default=None),
    ) -> dict:
        _curador(painel_sessao)
        _agente(agente)
        # Navegadores mandam vários tipos como octet-stream (ou .md como text/x-markdown): vale a extensão do nome.
        try:
            tipo = leitura_arquivos.tipo_do_arquivo(
                arquivo.filename or "", (arquivo.content_type or "").split(";")[0].strip().lower(), conhecimento.TIPOS_ACEITOS)
        except ValueError as erro:
            raise HTTPException(status_code=422, detail=str(erro))
        conteudo = await arquivo.read(MAX_BYTES + 1)
        if len(conteudo) > MAX_BYTES:
            raise HTTPException(status_code=422, detail="O arquivo passa de 25 MB.")
        if not conteudo:
            raise HTTPException(status_code=422, detail="O arquivo está vazio.")
        try:
            registro = await run_in_threadpool(
                conhecimento.registrar_documento, agente, arquivo.filename or "documento", conteudo, tipo, _quem(painel_sessao))
        except ValueError as erro:
            raise HTTPException(status_code=422, detail=str(erro))
        except RuntimeError as erro:
            # Storage sem configuração: 503. O Storage recusou ou não respondeu: 502, com o motivo (um 503 chegava ao
            # painel como 504 genérico, sem a mensagem).
            raise HTTPException(status_code=503 if "não configurado" in str(erro) else 502, detail=str(erro))
        # Texto, trechos e embeddings em segundo plano: o painel acompanha o status pela listagem.
        tarefa = asyncio.create_task(run_in_threadpool(conhecimento.processar, registro["id"], conteudo))
        tarefas.add(tarefa)
        tarefa.add_done_callback(tarefas.discard)
        return {**registro, "status": "processando"}

    @rotas.get("/documentos/{documento_id}/trechos")
    def trechos(documento_id: int) -> dict:
        return {"trechos": conhecimento.trechos_do_documento(documento_id)}

    @rotas.get("/documentos/{documento_id}/arquivo")
    def arquivo(documento_id: int) -> Response:
        """O arquivo original da versão, como está guardado no bucket."""
        doc = conhecimento.documento(documento_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Documento não encontrado.")
        if doc["caminho"].startswith("(sem bucket)") or not armazenamento.disponivel():
            raise HTTPException(status_code=404, detail="Esta versão não tem arquivo no bucket (banco local).")
        try:
            conteudo = armazenamento.baixar(doc["caminho"])
        except Exception as erro:  # arquivo apagado do bucket ou Storage fora do ar
            raise HTTPException(status_code=502, detail=f"Não foi possível baixar do bucket: {erro}")
        return Response(content=conteudo, media_type=doc["tipo_mime"], headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(doc['nome'])}"})

    @rotas.delete("/documentos")
    def excluir(
        nome: str = Query(..., min_length=1, max_length=300),
        agente: str = Query(default=perfis.PADRAO, max_length=60),
        painel_sessao: str | None = Cookie(default=None),
    ) -> dict:
        """Exclui o documento inteiro (versões, trechos com vetor e arquivos no bucket). Não tem volta."""
        _curador(painel_sessao, "excluir")
        try:
            return {"nome": nome, **conhecimento.excluir_documento(_agente(agente), nome)}
        except LookupError as erro:
            raise HTTPException(status_code=404, detail=str(erro))
        except ValueError as erro:
            raise HTTPException(status_code=422, detail=str(erro))

    @rotas.post("/documentos/{documento_id}/ativo")
    def documento_ativo(documento_id: int, pedido: PedidoAtivo, painel_sessao: str | None = Cookie(default=None)) -> dict:
        _curador(painel_sessao)
        try:
            conhecimento.ativar(documento_id) if pedido.ativo else conhecimento.desativar(documento_id)
        except ValueError as erro:
            raise HTTPException(status_code=422, detail=str(erro))
        return {"id": documento_id, "ativo": pedido.ativo}

    @rotas.post("/sugestoes-roteiro")
    async def sugestoes_de_ajuste(pedido: PedidoAjuste, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Atualizar com IA: onde a informação escrita entra no roteiro do agente, sugerido pela IA, para a pessoa
        revisar e aplicar como nas sugestões de um documento. Não grava nada."""
        _curador(painel_sessao)
        if pedido.agente not in agentes:
            raise HTTPException(status_code=404, detail=f"Agente desconhecido: {pedido.agente}.")
        try:
            return await run_in_threadpool(sugestoes_roteiro_mod.sugerir_de_texto, pedido.texto, pedido.agente,
                                           perfis.identidade(pedido.agente).get("nome") or pedido.agente)
        except ValueError as erro:
            raise HTTPException(status_code=422, detail=str(erro))
        except Exception as erro:  # o modelo fora do ar ou uma resposta fora do formato
            raise HTTPException(status_code=502, detail=f"A IA não conseguiu sugerir: {type(erro).__name__}: {str(erro)[:200]}") from erro

    @rotas.post("/documentos/{documento_id}/sugestoes-roteiro")
    async def sugestoes_roteiro(
        documento_id: int,
        pedido: PedidoSugestoes,
        painel_sessao: str | None = Cookie(default=None),
    ) -> dict:
        """O que o documento muda no roteiro do agente, sugerido pela IA. Não grava nada: o painel mostra as sugestões
        e a pessoa aplica as que quiser (agente/sugestoes_roteiro.py). O documento de um agente sugere para o roteiro
        dele; o de uma base compartilhada, para um dos agentes em que a base vale."""
        _curador(painel_sessao)
        doc = conhecimento.documento(documento_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Documento não encontrado.")
        if conhecimento.eh_base(doc["agente"]):
            dados = conhecimento.base(doc["agente"][len(conhecimento.PREFIXO_BASE):]) or {}
            alvo = pedido.agente
            if not alvo:
                raise HTTPException(status_code=422, detail="Escolha o agente cujo roteiro vai ser comparado.")
            if alvo not in agentes or not (dados.get("geral") or alvo in (dados.get("agentes") or [])):
                raise HTTPException(status_code=422, detail=f"A base deste documento não vale para {alvo}.")
        else:
            alvo = doc["agente"]
            if pedido.agente and pedido.agente != alvo:
                raise HTTPException(status_code=422, detail="O documento de um agente só sugere para o roteiro dele.")
        try:
            return await run_in_threadpool(
                sugestoes_roteiro_mod.sugerir, documento_id, alvo, perfis.identidade(alvo).get("nome") or alvo)
        except LookupError as erro:
            raise HTTPException(status_code=404, detail=str(erro))
        except ValueError as erro:
            raise HTTPException(status_code=422, detail=str(erro))
        except Exception as erro:  # o modelo fora do ar ou uma resposta fora do formato
            raise HTTPException(status_code=502, detail=f"A IA não conseguiu sugerir: {type(erro).__name__}: {str(erro)[:200]}") from erro

    @rotas.get("/uso")
    def uso(
        exemplos: str = Query(default="", max_length=400, description="ids separados por vírgula"),
        trechos: str = Query(default="", max_length=400, description="ids separados por vírgula (documentos e roteiro)"),
    ) -> dict:
        """O conteúdo do que uma resposta do agente usou (selo "usou N trechos" no chat e nas conversas)."""
        def ids(texto: str) -> list[int]:
            try:
                return [int(i) for i in texto.split(",") if i.strip()][:30]
            except ValueError:
                raise HTTPException(status_code=422, detail="Os ids devem ser números separados por vírgula.")

        if not conhecimento.disponivel():
            raise HTTPException(status_code=503, detail="A base de conhecimento não está disponível.")
        detalhes = conhecimento.detalhes_usados(ids(exemplos), ids(trechos))
        return {"trechos": [_iso(t) for t in detalhes["trechos"]], "exemplos": [_iso(e) for e in detalhes["exemplos"]]}

    @rotas.get("/exemplos")
    def exemplos(agente: str = Query(default=perfis.PADRAO, max_length=60)) -> dict:
        return {"exemplos": [_iso(e) for e in conhecimento.listar_exemplos(_agente(agente))]}

    @rotas.post("/exemplos/{exemplo_id}/ativo")
    def exemplo_ativo(exemplo_id: int, pedido: PedidoAtivo, painel_sessao: str | None = Cookie(default=None)) -> dict:
        _curador(painel_sessao, "aprovar_calibracao")
        conhecimento.definir_exemplo_ativo(exemplo_id, pedido.ativo)
        return {"id": exemplo_id, "ativo": pedido.ativo}

    return rotas
