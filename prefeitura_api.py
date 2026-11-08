"""Rotas da prefeitura de quem está logado (agente/acessos.py): o contexto, o panorama, os cargos com as
permissões, a equipe e os convites. Tudo fica restrito à prefeitura da pessoa; o que ela pode fazer vem do
cargo (o dono pode tudo).

- GET  /painel/api/prefeitura/contexto            a prefeitura e as permissões de quem está logado
- GET  /painel/api/prefeitura/permissoes          o catálogo de permissões e os níveis
- GET  /painel/api/prefeitura/panorama            o município, as unidades e os setores
- GET  /painel/api/prefeitura/cep/{cep}           o endereço do CEP (ViaCEP) e o ponto no mapa
- POST /painel/api/prefeitura/unidades            cadastra uma unidade de saúde
- PUT  /painel/api/prefeitura/unidades/{id}       altera a unidade e marca como conferida
- GET  /painel/api/prefeitura/unidades/{id}/fotos as fotos da unidade
- POST /painel/api/prefeitura/unidades/{id}/fotos envia uma foto (fachada, interior...)
- GET  /painel/api/prefeitura/fotos/{id}          a imagem
- POST /painel/api/prefeitura/fotos/{id}/principal  a foto que aparece na ficha
- DELETE /painel/api/prefeitura/fotos/{id}        apaga a foto
- GET  /painel/api/prefeitura/cargos              o organograma (cargos, hierarquia, permissões, ocupantes)
- POST /painel/api/prefeitura/cargos/padrao       monta o organograma padrão do catálogo
- POST /painel/api/prefeitura/cargos              cria um cargo
- PUT  /painel/api/prefeitura/cargos/{id}         altera nome, superior, atribuições, permissões ou situação
- GET  /painel/api/prefeitura/equipe              membros e convites pendentes
- POST /painel/api/prefeitura/convites            convida (devolve o link)
- DELETE /painel/api/prefeitura/convites/{id}     cancela um convite
- PUT  /painel/api/prefeitura/membros/{email}     muda o cargo ou bloqueia/desbloqueia
- GET  /painel/api/convite/{token}                (aberta) os dados do convite
- POST /painel/api/convite/{token}                (aberta) aceita: cria a conta com a senha e entra
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from agente import acessos, gestao, usuarios
from painel_api import _chave, _email_permitido, _gravar_sessao, exigir_sessao


class PedidoCargo(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=120)
    nivel: str | None = Field(default=None, max_length=20)
    superior_id: str | None = Field(default=None, max_length=40)
    atribuicoes: str | None = Field(default=None, max_length=2000)
    permissoes: list[str] | None = Field(default=None, max_length=30)
    ativo: bool | None = None


class PedidoConvite(BaseModel):
    email: str = Field(min_length=5, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    nome: str = Field(default="", max_length=120)
    cargo_id: str | None = Field(default=None, max_length=40)


class PedidoMembro(BaseModel):
    cargo_id: str | None = Field(default=None, max_length=40)
    ativo: bool | None = None


class PedidoUnidade(BaseModel):
    """Os campos da unidade; na alteração, só os que vierem mudam. `conferida` marca (ou desmarca) a conferência."""
    nome: str | None = Field(default=None, min_length=2, max_length=200)
    tipo_id: str | None = Field(default=None, max_length=40)
    cnes: str | None = Field(default=None, max_length=10)
    cep: str | None = Field(default=None, max_length=10)
    endereco: str | None = Field(default=None, max_length=300)
    numero: str | None = Field(default=None, max_length=20)
    complemento: str | None = Field(default=None, max_length=120)
    bairro: str | None = Field(default=None, max_length=120)
    telefone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=200)
    latitude: float | None = Field(default=None, ge=-34, le=6)  # o Brasil
    longitude: float | None = Field(default=None, ge=-74, le=-28)
    coordenadas_origem: str | None = Field(default=None, pattern=r"^(cnes|endereco|cep|mapa|manual)$")
    situacao: str | None = Field(default=None, max_length=20)
    conferida: bool | None = None


class PedidoAceite(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    senha: str = Field(min_length=8, max_length=200)


def _erro(erro: acessos.ErroAcesso) -> HTTPException:
    return HTTPException(status_code=erro.status, detail=erro.detalhe)


def _precisa(permissao: str):
    """Dependência: pessoa logada, membro ativo de uma prefeitura, com a permissão. Devolve (e-mail, contexto)."""
    def conferir(sessao: dict = Depends(exigir_sessao)) -> tuple[str, dict]:
        try:
            return sessao["email"], acessos.pode(sessao["email"], permissao)
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro
    return conferir


def criar_rotas_prefeitura() -> APIRouter:
    rotas = APIRouter(prefix="/painel/api", tags=["GestorGov · Prefeitura"])

    def disponivel() -> None:
        if not gestao.disponivel():
            raise HTTPException(status_code=503, detail="O cadastro da prefeitura não está disponível neste servidor.")

    @rotas.get("/prefeitura/contexto")
    def contexto(sessao: dict = Depends(exigir_sessao)) -> dict:
        disponivel()
        return {"prefeitura": acessos.contexto(sessao["email"])}

    @rotas.get("/prefeitura/permissoes")
    def permissoes(_: dict = Depends(exigir_sessao)) -> dict:
        return {"permissoes": [{"id": k, "rotulo": r, "descricao": d} for k, (r, d) in acessos.PERMISSOES.items()],
                "niveis": list(acessos.NIVEIS), "padrao_por_nivel": acessos.PADRAO_POR_NIVEL}

    @rotas.get("/prefeitura/panorama")
    def panorama(quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        return gestao.panorama(quem[1]["municipio_id"]) or {"municipio": None}

    # ───────── Unidades de saúde ─────────

    @rotas.get("/prefeitura/cep/{cep}")
    async def cep(cep: str, numero: str = Query(default="", max_length=20),
                  quem: tuple = Depends(_precisa("gerenciar_unidades"))) -> dict:
        """O endereço do CEP e o ponto no mapa. `do_municipio` diz se o CEP é do município de quem pede."""
        achado = await run_in_threadpool(gestao.endereco_por_cep, cep, numero)
        if not achado:
            raise HTTPException(status_code=404, detail="CEP não encontrado no ViaCEP. Confira os 8 dígitos.")
        mun = gestao.municipio(quem[1]["municipio_id"]) or {}
        return {**achado, "do_municipio": str(achado.get("codigo_ibge") or "") == str(mun.get("codigo_ibge") or "")}

    def _unidade_ou_404(acao):
        try:
            return acao()
        except LookupError as erro:
            raise HTTPException(status_code=404, detail=str(erro)) from erro
        except ValueError as erro:
            raise HTTPException(status_code=422, detail=str(erro)) from erro

    @rotas.post("/prefeitura/unidades", status_code=201)
    def criar_unidade(pedido: PedidoUnidade, quem: tuple = Depends(_precisa("gerenciar_unidades"))) -> dict:
        dados = pedido.model_dump(exclude_none=True)
        if not dados.get("nome") or not dados.get("tipo_id"):
            raise HTTPException(status_code=422, detail="Informe o nome e o tipo da unidade.")
        if dados["tipo_id"] not in {t["id"] for t in gestao.tipos_unidade()}:
            raise HTTPException(status_code=422, detail="Tipo de unidade inválido.")
        conferida = dados.pop("conferida", True)
        dados.pop("situacao", None)
        return gestao.salvar_unidade(quem[1]["municipio_id"], quem=quem[0], origem="manual", confirmada=conferida,
                                     origem_auditoria="painel", **dados)

    @rotas.put("/prefeitura/unidades/{unidade_id}")
    def alterar_unidade(unidade_id: str, pedido: PedidoUnidade, quem: tuple = Depends(_precisa("gerenciar_unidades"))) -> dict:
        dados = pedido.model_dump(exclude_unset=True)
        conferida = dados.pop("conferida", None)
        return _unidade_ou_404(lambda: gestao.alterar_unidade(quem[1]["municipio_id"], unidade_id, dados, quem[0], conferida))

    @rotas.get("/prefeitura/unidades/{unidade_id}/fotos")
    def fotos(unidade_id: str, quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        return {"fotos": gestao._json(gestao.fotos(quem[1]["municipio_id"], unidade_id))}

    @rotas.post("/prefeitura/unidades/{unidade_id}/fotos", status_code=201)
    async def enviar_foto(unidade_id: str, arquivo: UploadFile = File(...), tipo: str = Form(default="fachada"),
                          legenda: str = Form(default="", max_length=200),
                          quem: tuple = Depends(_precisa("gerenciar_unidades"))) -> dict:
        conteudo = await arquivo.read(gestao.MAX_BYTES_FOTO + 1)
        return await run_in_threadpool(_unidade_ou_404, lambda: gestao.salvar_foto(
            quem[1]["municipio_id"], unidade_id, conteudo, quem[0], tipo, legenda))

    @rotas.get("/prefeitura/fotos/{foto_id}")
    async def ver_foto(foto_id: str, quem: tuple = Depends(_precisa("ver_painel"))) -> Response:
        conteudo = await run_in_threadpool(_unidade_ou_404, lambda: gestao.conteudo_foto(quem[1]["municipio_id"], foto_id))
        # A foto não muda (uma foto nova tem outro id): pode ficar no navegador.
        return Response(conteudo, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})

    @rotas.post("/prefeitura/fotos/{foto_id}/principal", status_code=204)
    def foto_principal(foto_id: str, quem: tuple = Depends(_precisa("gerenciar_unidades"))) -> None:
        _unidade_ou_404(lambda: gestao.tornar_principal(quem[1]["municipio_id"], foto_id, quem[0]))

    @rotas.delete("/prefeitura/fotos/{foto_id}", status_code=204)
    def apagar_foto(foto_id: str, quem: tuple = Depends(_precisa("gerenciar_unidades"))) -> None:
        _unidade_ou_404(lambda: gestao.apagar_foto(quem[1]["municipio_id"], foto_id, quem[0]))

    # ───────── Organograma ─────────

    @rotas.get("/prefeitura/cargos")
    def listar_cargos(quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        return {"cargos": acessos.cargos(quem[1]["municipio_id"])}

    @rotas.post("/prefeitura/cargos/padrao")
    async def organograma_padrao(quem: tuple = Depends(_precisa("gerenciar_cargos"))) -> dict:
        criados = await run_in_threadpool(acessos.montar_organograma_padrao, quem[1]["municipio_id"], quem[0])
        return {"criados": criados, "cargos": acessos.cargos(quem[1]["municipio_id"])}

    @rotas.post("/prefeitura/cargos")
    def criar_cargo(pedido: PedidoCargo, quem: tuple = Depends(_precisa("gerenciar_cargos"))) -> dict:
        if not pedido.nome:
            raise HTTPException(status_code=422, detail="Dê um nome ao cargo.")
        try:
            return acessos.criar_cargo(quem[1]["municipio_id"], pedido.model_dump(exclude_unset=True), quem[0])
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro

    @rotas.put("/prefeitura/cargos/{cargo_id}")
    def alterar_cargo(cargo_id: str, pedido: PedidoCargo, quem: tuple = Depends(_precisa("gerenciar_cargos"))) -> dict:
        try:
            return acessos.alterar_cargo(quem[1]["municipio_id"], cargo_id, pedido.model_dump(exclude_unset=True), quem[0])
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro

    @rotas.get("/prefeitura/equipe")
    def equipe(quem: tuple = Depends(_precisa("gerenciar_equipe"))) -> dict:
        return acessos.equipe(quem[1]["municipio_id"])

    @rotas.post("/prefeitura/convites")
    def convidar(pedido: PedidoConvite, pedido_http: Request, quem: tuple = Depends(_precisa("gerenciar_equipe"))) -> dict:
        try:
            token = acessos.convidar(quem[1]["municipio_id"], pedido.email, pedido.nome, pedido.cargo_id, quem[0])
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro
        base = str(pedido_http.base_url).rstrip("/")
        return {"link": f"{base}/painel/convite/{token}", "validade_dias": acessos.VALIDADE_CONVITE.days}

    @rotas.delete("/prefeitura/convites/{convite_id}", status_code=204)
    def cancelar_convite(convite_id: str, quem: tuple = Depends(_precisa("gerenciar_equipe"))) -> None:
        try:
            acessos.cancelar_convite(quem[1]["municipio_id"], convite_id, quem[0])
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro

    @rotas.put("/prefeitura/membros/{email}")
    def alterar_membro(email: str, pedido: PedidoMembro, quem: tuple = Depends(_precisa("gerenciar_equipe"))) -> dict:
        if email.strip().lower() == quem[0]:
            raise HTTPException(status_code=403, detail="Você não pode alterar o próprio acesso.")
        try:
            acessos.alterar_membro(quem[1]["municipio_id"], email, pedido.model_dump(exclude_unset=True), quem[0])
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro
        return acessos.equipe(quem[1]["municipio_id"])

    # ───────── Convite (aberto: quem recebeu o link ainda não tem conta) ─────────

    @rotas.get("/convite/{token}")
    def ver_convite(token: str) -> dict:
        disponivel()
        try:
            dados = acessos.ler_convite(token)
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro
        return {k: dados[k] for k in ("email", "nome", "municipio", "cargo")}

    @rotas.post("/convite/{token}")
    async def aceitar_convite(token: str, pedido: PedidoAceite, resposta: Response) -> dict:
        disponivel()
        if not _chave() or not usuarios.disponivel():
            raise HTTPException(status_code=503, detail="O login não está ligado neste servidor (falta OS_SECURITY_KEY).")
        try:
            convite = acessos.ler_convite(token)
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro
        email = convite["email"]
        if not _email_permitido(email):
            raise HTTPException(status_code=403, detail=f"O e-mail {email} não pode entrar neste servidor.")
        # Conta nova: a senha escolhida agora. Conta que já existe: a senha precisa conferir.
        try:
            await run_in_threadpool(usuarios.criar_conta, email, pedido.nome, pedido.senha)
        except usuarios.ErroUsuario as erro:
            if erro.status != 409:
                raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro
            if not await run_in_threadpool(usuarios.entrar_com_senha, email, pedido.senha):
                raise HTTPException(status_code=401, detail="Este e-mail já tem conta: use a senha dela para aceitar.") from erro
        await run_in_threadpool(acessos.aceitar_convite, token, pedido.nome)
        _gravar_sessao(resposta, email, pedido.nome.strip())
        return {"email": email, "municipio": convite["municipio"], "cargo": convite["cargo"]}

    return rotas
