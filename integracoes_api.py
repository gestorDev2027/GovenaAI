"""Rotas da Central de integrações (agente/integracoes.py), sempre na organização de quem está logado.

- GET    /painel/api/organizacao/integracoes                         as integrações, as ferramentas, os tipos e o Toolbox
- POST   /painel/api/organizacao/integracoes                         cadastra (o segredo, se vier, vai para o Vault)
- PUT    /painel/api/organizacao/integracoes/{id}                    altera (segredo vazio = mantém o atual)
- DELETE /painel/api/organizacao/integracoes/{id}                    exclui (e apaga o segredo do Vault)
- POST   /painel/api/organizacao/integracoes/{id}/testar             teste de conexão
- POST   /painel/api/organizacao/integracoes/{id}/ferramentas        cria uma ferramenta
- PUT    /painel/api/organizacao/integracoes/{id}/ferramentas/{fid}  altera
- DELETE /painel/api/organizacao/integracoes/{id}/ferramentas/{fid}  exclui
- POST   /painel/api/organizacao/integracoes/{id}/ferramentas/{fid}/testar  roda com argumentos de teste (só leitura)
- GET    /painel/api/organizacao/integracoes-chamadas                a auditoria das chamadas (sem dados)
- GET    /painel/api/organizacao/integracoes-pedidos                 as chamadas que alteram dados e esperam uma pessoa
- POST   /painel/api/organizacao/integracoes-pedidos/{id}            aprova (roda agora) ou nega

O segredo nunca volta: as respostas trazem só `tem_segredo` e os 4 últimos caracteres.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from agente import integracoes, toolbox, usuarios
from organizacao_api import _precisa


class PedidoIntegracao(BaseModel):
    nome: str | None = Field(default=None, max_length=80)
    descricao: str | None = Field(default=None, max_length=500)
    tipo: str | None = Field(default=None, max_length=20)
    endereco: str | None = Field(default=None, max_length=500)
    porta: int | None = Field(default=None, ge=1, le=65535)
    banco: str | None = Field(default=None, max_length=120)
    usuario: str | None = Field(default=None, max_length=120)
    config: dict | None = None
    nosso_banco: bool | None = None
    hosts_liberados: list[str] | None = Field(default=None, max_length=20)
    situacao: str | None = Field(default=None, max_length=20)
    limite_por_minuto: int | None = Field(default=None, ge=1, le=600)
    segredo: str | None = Field(default=None, max_length=8000)


class PedidoFerramenta(BaseModel):
    nome: str = Field(min_length=1, max_length=64)
    descricao: str = Field(min_length=1, max_length=1500)
    sql: str | None = Field(default=None, max_length=8000)
    metodo: str | None = Field(default=None, max_length=10)
    caminho: str | None = Field(default=None, max_length=500)
    corpo: str | None = Field(default=None, max_length=4000)
    parametros: list[dict] = Field(default_factory=list, max_length=20)
    altera_dados: bool = False
    ativa: bool = True


class PedidoTeste(BaseModel):
    argumentos: dict = Field(default_factory=dict)


class PedidoDecisao(BaseModel):
    aprovar: bool
    motivo: str = Field(default="", max_length=300)


def _rodar(acao):
    try:
        return acao()
    except integracoes.ErroIntegracao as erro:
        raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro


def _da_plataforma(email: str) -> bool:
    """Só a equipe GestorGov cadastra fonte no banco do próprio GestorGov."""
    return usuarios.disponivel() and usuarios.pode(email, "editar_agentes")


def criar_rotas_integracoes() -> APIRouter:
    rotas = APIRouter(prefix="/painel/api/organizacao", tags=["GestorGov · Central de integrações"])

    def pronto() -> None:
        if not integracoes.disponivel():
            raise HTTPException(status_code=503, detail="A Central de integrações não está disponível neste servidor.")

    @rotas.get("/integracoes", dependencies=[Depends(pronto)])
    def listar(quem: tuple = Depends(_precisa("gerenciar_integracoes"))) -> dict:
        oid = quem[1]["organizacao_id"]
        return {"integracoes": integracoes.integracoes(oid),
                "tipos": [{"id": k, "nome": n} for k, n in integracoes.TIPOS.items()],
                "toolbox": toolbox.situacao(), "memoria": integracoes.memoria_disponivel(),
                "pode_nosso_banco": _da_plataforma(quem[0]),
                "pedidos": len(integracoes.pedidos(oid))}

    @rotas.post("/integracoes", status_code=201, dependencies=[Depends(pronto)])
    def criar(pedido: PedidoIntegracao, quem: tuple = Depends(_precisa("gerenciar_integracoes"))) -> dict:
        return _rodar(lambda: integracoes.salvar(quem[1]["organizacao_id"], None, pedido.model_dump(exclude_none=True), quem[0],
                                                 pode_nosso_banco=_da_plataforma(quem[0])))

    @rotas.put("/integracoes/{integracao_id}", dependencies=[Depends(pronto)])
    def alterar(integracao_id: str, pedido: PedidoIntegracao, quem: tuple = Depends(_precisa("gerenciar_integracoes"))) -> dict:
        dados = pedido.model_dump(exclude_none=True)
        if not (dados.get("segredo") or "").strip():
            dados.pop("segredo", None)  # vazio: mantém o segredo atual
        return _rodar(lambda: integracoes.salvar(quem[1]["organizacao_id"], integracao_id, dados, quem[0],
                                                 pode_nosso_banco=_da_plataforma(quem[0])))

    @rotas.delete("/integracoes/{integracao_id}", status_code=204, dependencies=[Depends(pronto)])
    def excluir(integracao_id: str, quem: tuple = Depends(_precisa("gerenciar_integracoes"))) -> None:
        _rodar(lambda: integracoes.excluir(quem[1]["organizacao_id"], integracao_id, quem[0]))

    @rotas.post("/integracoes/{integracao_id}/testar", dependencies=[Depends(pronto)])
    async def testar(integracao_id: str, quem: tuple = Depends(_precisa("gerenciar_integracoes"))) -> dict:
        return await run_in_threadpool(lambda: _rodar(lambda: integracoes.testar(quem[1]["organizacao_id"], integracao_id, quem[0])))

    @rotas.post("/integracoes/{integracao_id}/ferramentas", status_code=201, dependencies=[Depends(pronto)])
    def criar_ferramenta(integracao_id: str, pedido: PedidoFerramenta, quem: tuple = Depends(_precisa("gerenciar_integracoes"))) -> dict:
        return _rodar(lambda: integracoes.salvar_ferramenta(quem[1]["organizacao_id"], integracao_id, None, pedido.model_dump(), quem[0]))

    @rotas.put("/integracoes/{integracao_id}/ferramentas/{ferramenta_id}", dependencies=[Depends(pronto)])
    def alterar_ferramenta(integracao_id: str, ferramenta_id: str, pedido: PedidoFerramenta,
                           quem: tuple = Depends(_precisa("gerenciar_integracoes"))) -> dict:
        return _rodar(lambda: integracoes.salvar_ferramenta(quem[1]["organizacao_id"], integracao_id, ferramenta_id,
                                                            pedido.model_dump(), quem[0]))

    @rotas.delete("/integracoes/{integracao_id}/ferramentas/{ferramenta_id}", status_code=204, dependencies=[Depends(pronto)])
    def excluir_ferramenta(integracao_id: str, ferramenta_id: str, quem: tuple = Depends(_precisa("gerenciar_integracoes"))) -> None:
        _rodar(lambda: integracoes.excluir_ferramenta(quem[1]["organizacao_id"], integracao_id, ferramenta_id, quem[0]))

    @rotas.post("/integracoes/{integracao_id}/ferramentas/{ferramenta_id}/testar", dependencies=[Depends(pronto)])
    async def testar_ferramenta(integracao_id: str, ferramenta_id: str, pedido: PedidoTeste,
                                quem: tuple = Depends(_precisa("gerenciar_integracoes"))) -> dict:
        return await run_in_threadpool(lambda: _rodar(lambda: integracoes.testar_ferramenta(
            quem[1]["organizacao_id"], integracao_id, ferramenta_id, pedido.argumentos, quem[0])))

    @rotas.get("/integracoes-chamadas", dependencies=[Depends(pronto)])
    def listar_chamadas(limite: int = Query(default=100, ge=1, le=500),
                        quem: tuple = Depends(_precisa("gerenciar_integracoes"))) -> dict:
        return {"chamadas": integracoes.chamadas(quem[1]["organizacao_id"], limite)}

    @rotas.get("/integracoes-pedidos", dependencies=[Depends(pronto)])
    def listar_pedidos(quem: tuple = Depends(_precisa("aprovar_entregas"))) -> dict:
        return {"pedidos": integracoes.pedidos(quem[1]["organizacao_id"])}

    @rotas.post("/integracoes-pedidos/{pedido_id}", dependencies=[Depends(pronto)])
    async def decidir(pedido_id: int, pedido: PedidoDecisao, quem: tuple = Depends(_precisa("aprovar_entregas"))) -> dict:
        return await run_in_threadpool(lambda: _rodar(lambda: integracoes.decidir(
            quem[1]["organizacao_id"], pedido_id, pedido.aprovar, quem[0], pedido.motivo)))

    return rotas
