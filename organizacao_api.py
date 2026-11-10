"""Rotas da organização de quem está logado (agente/acessos.py): o contexto, o panorama, os cargos com as
permissões, a equipe e os convites. Tudo fica restrito à organização da pessoa; o que ela pode fazer vem do
cargo (o dono pode tudo).

- GET  /painel/api/organizacao/contexto           a organização e as permissões de quem está logado
- GET  /painel/api/organizacao/permissoes          o catálogo de permissões e os níveis
- GET  /painel/api/organizacao/panorama           a organização (com o segmento), as áreas e as unidades
- GET  /painel/api/organizacao/cep/{cep}           o endereço do CEP (ViaCEP) e o ponto no mapa
- POST /painel/api/organizacao/unidades            cadastra uma unidade
- PUT  /painel/api/organizacao/unidades/{id}       altera a unidade e marca como conferida
- GET  /painel/api/organizacao/unidades/{id}/fotos as fotos da unidade
- POST /painel/api/organizacao/unidades/{id}/fotos envia uma foto (fachada, interior...)
- GET  /painel/api/organizacao/fotos/{id}          a imagem
- POST /painel/api/organizacao/fotos/{id}/principal  a foto que aparece na ficha
- DELETE /painel/api/organizacao/fotos/{id}        apaga a foto
- GET  /painel/api/organizacao/agentes             os agentes da organização, com a ficha e o catálogo de dados
- PUT  /painel/api/organizacao/agentes/{id}/ficha  altera a ficha (características, memória, dados, escopo)
- GET  /painel/api/organizacao/cargos              o organograma (cargos, hierarquia, permissões, ocupantes)
- POST /painel/api/organizacao/cargos/padrao       monta o organograma padrão do catálogo
- POST /painel/api/organizacao/cargos              cria um cargo
- PUT  /painel/api/organizacao/cargos/{id}         altera nome, superior, atribuições, permissões ou situação
- GET  /painel/api/organizacao/equipe              membros e convites pendentes
- POST /painel/api/organizacao/convites            convida (devolve o link)
- DELETE /painel/api/organizacao/convites/{id}     cancela um convite
- POST /painel/api/organizacao/convites/{id}/aprovar  aprova o acesso que o assistente cadastrou (devolve o link)
- POST /painel/api/organizacao/implantacao/link    compartilha a implantação: link + código de segurança (uma vez)
- GET  /painel/api/implantacao/link/{token}       (aberta) de que organização é o link
- POST /painel/api/implantacao/link/{token}       (aberta) entra com o código: cria a conta (ou confere a senha),
                                                  vira membro da organização e continua a implantação
- PUT  /painel/api/organizacao/membros/{email}     muda o cargo ou bloqueia/desbloqueia
- GET  /painel/api/convite/{token}                (aberta) os dados do convite
- POST /painel/api/convite/{token}                (aberta) aceita: cria a conta com a senha e entra
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from agente import acessos, gestao, usuarios
from painel_api import PedidoImplantacao, _chave, _email_permitido, _gravar_sessao, _sessao, _texto_entrada, exigir_sessao


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


class PedidoLinkImplantacao(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    senha: str = Field(min_length=8, max_length=200)
    codigo: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class PedidoFicha(BaseModel):
    caracteristicas: dict | None = None
    memoria: dict | None = None
    permissoes: dict[str, list[str]] | None = None
    escopo: str | None = Field(default=None, max_length=20)
    integracoes: list[str] | None = Field(default=None, max_length=50)


class PedidoRecusa(BaseModel):
    motivo: str = Field(min_length=3, max_length=1000)


class PedidoAcoes(BaseModel):
    aprovar: bool
    motivo: str = Field(default="", max_length=1000)


class PedidoRevisao(BaseModel):
    aprovar: bool
    ajustes: str = Field(default="", max_length=4000)


class PedidoAceite(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    senha: str = Field(min_length=8, max_length=200)


def _erro(erro: acessos.ErroAcesso) -> HTTPException:
    return HTTPException(status_code=erro.status, detail=erro.detalhe)


def _precisa(permissao: str):
    """Dependência: pessoa logada, membro ativo de uma organização, com a permissão. Devolve (e-mail, contexto)."""
    def conferir(sessao: dict = Depends(exigir_sessao)) -> tuple[str, dict]:
        try:
            return sessao["email"], acessos.pode(sessao["email"], permissao)
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro
    return conferir


def criar_rotas_organizacao() -> APIRouter:
    rotas = APIRouter(prefix="/painel/api", tags=["GestorGov · Organização"])

    def disponivel() -> None:
        if not gestao.disponivel():
            raise HTTPException(status_code=503, detail="O cadastro das organizações não está disponível neste servidor.")

    @rotas.get("/organizacao/contexto")
    def contexto(sessao: dict = Depends(exigir_sessao)) -> dict:
        disponivel()
        return {"organizacao": acessos.contexto(sessao["email"])}

    @rotas.get("/organizacao/permissoes")
    def permissoes(_: dict = Depends(exigir_sessao)) -> dict:
        return {"permissoes": [{"id": k, "rotulo": r, "descricao": d} for k, (r, d) in acessos.PERMISSOES.items()],
                "niveis": list(acessos.NIVEIS), "padrao_por_nivel": acessos.PADRAO_POR_NIVEL}

    @rotas.get("/organizacao/panorama")
    def panorama(quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        return gestao.panorama(quem[1]["organizacao_id"]) or {"organizacao": None}

    # ───────── Unidades ─────────

    @rotas.get("/organizacao/cep/{cep}")
    async def cep(cep: str, numero: str = Query(default="", max_length=20),
                  quem: tuple = Depends(_precisa("gerenciar_unidades"))) -> dict:
        """O endereço do CEP e o ponto no mapa. `da_cidade` diz se o CEP é da cidade da organização de quem pede."""
        achado = await run_in_threadpool(gestao.endereco_por_cep, cep, numero)
        if not achado:
            raise HTTPException(status_code=404, detail="CEP não encontrado no ViaCEP. Confira os 8 dígitos.")
        org = gestao.organizacao(quem[1]["organizacao_id"]) or {}
        # Sem código IBGE na organização (ainda sem a cidade cadastrada), não há com o que comparar: null.
        da_cidade = (str(achado.get("codigo_ibge") or "") == str(org["codigo_ibge"])) if org.get("codigo_ibge") else None
        return {**achado, "da_cidade": da_cidade}

    def _unidade_ou_404(acao):
        try:
            return acao()
        except LookupError as erro:
            raise HTTPException(status_code=404, detail=str(erro)) from erro
        except ValueError as erro:
            raise HTTPException(status_code=422, detail=str(erro)) from erro

    @rotas.post("/organizacao/unidades", status_code=201)
    def criar_unidade(pedido: PedidoUnidade, quem: tuple = Depends(_precisa("gerenciar_unidades"))) -> dict:
        dados = pedido.model_dump(exclude_none=True)
        if not dados.get("nome") or not dados.get("tipo_id"):
            raise HTTPException(status_code=422, detail="Informe o nome e o tipo da unidade.")
        if dados["tipo_id"] not in {t["id"] for t in gestao.tipos_unidade(quem[1].get("segmento_id"))}:
            raise HTTPException(status_code=422, detail="Tipo de unidade inválido.")
        conferida = dados.pop("conferida", True)
        dados.pop("situacao", None)
        return gestao.salvar_unidade(quem[1]["organizacao_id"], quem=quem[0], origem="manual", confirmada=conferida,
                                     origem_auditoria="pessoa", **dados)

    @rotas.put("/organizacao/unidades/{unidade_id}")
    def alterar_unidade(unidade_id: str, pedido: PedidoUnidade, quem: tuple = Depends(_precisa("gerenciar_unidades"))) -> dict:
        dados = pedido.model_dump(exclude_unset=True)
        conferida = dados.pop("conferida", None)
        return _unidade_ou_404(lambda: gestao.alterar_unidade(quem[1]["organizacao_id"], unidade_id, dados, quem[0], conferida))

    @rotas.get("/organizacao/unidades/{unidade_id}/fotos")
    def fotos(unidade_id: str, quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        return {"fotos": gestao._json(gestao.fotos(quem[1]["organizacao_id"], unidade_id))}

    @rotas.post("/organizacao/unidades/{unidade_id}/fotos", status_code=201)
    async def enviar_foto(unidade_id: str, arquivo: UploadFile = File(...), tipo: str = Form(default="fachada"),
                          legenda: str = Form(default="", max_length=200),
                          quem: tuple = Depends(_precisa("gerenciar_unidades"))) -> dict:
        conteudo = await arquivo.read(gestao.MAX_BYTES_FOTO + 1)
        return await run_in_threadpool(_unidade_ou_404, lambda: gestao.salvar_foto(
            quem[1]["organizacao_id"], unidade_id, conteudo, quem[0], tipo, legenda))

    @rotas.get("/organizacao/fotos/{foto_id}")
    async def ver_foto(foto_id: str, quem: tuple = Depends(_precisa("ver_painel"))) -> Response:
        conteudo = await run_in_threadpool(_unidade_ou_404, lambda: gestao.conteudo_foto(quem[1]["organizacao_id"], foto_id))
        # A foto não muda (uma foto nova tem outro id): pode ficar no navegador.
        return Response(conteudo, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})

    @rotas.post("/organizacao/fotos/{foto_id}/principal", status_code=204)
    def foto_principal(foto_id: str, quem: tuple = Depends(_precisa("gerenciar_unidades"))) -> None:
        _unidade_ou_404(lambda: gestao.tornar_principal(quem[1]["organizacao_id"], foto_id, quem[0]))

    @rotas.delete("/organizacao/fotos/{foto_id}", status_code=204)
    def apagar_foto(foto_id: str, quem: tuple = Depends(_precisa("gerenciar_unidades"))) -> None:
        _unidade_ou_404(lambda: gestao.apagar_foto(quem[1]["organizacao_id"], foto_id, quem[0]))

    # ───────── Agentes da organização: a ficha ─────────

    def _dados_erro(acao):
        from agente import dados_agente

        try:
            return acao()
        except dados_agente.ErroDados as erro:
            raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro

    @rotas.get("/organizacao/agentes")
    def agentes_da_organizacao(quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        from agente import dados_agente, fabrica, perfis

        oid = quem[1]["organizacao_id"]
        nomes = {str(s["id"]): s["nome"] for s in gestao.areas(oid)}
        areas_de: dict[str, list[str]] = {}
        for a in gestao.agentes_area(oid):
            areas_de.setdefault(a["agente_id"], []).append(nomes.get(str(a["area_id"]), ""))
        lista = [{"id": aid, **perfis.identidade(aid), "areas": areas_de.get(aid, []), "ficha": dados_agente.ficha(aid)}
                 for aid in fabrica.agentes_da_organizacao(oid) if perfis.existe(aid)]
        return {"agentes": lista,
                "dominios": [{"id": k, "nome": n, "descricao": d, "operacoes": list(o)} for k, (n, d, o) in dados_agente.DOMINIOS.items()],
                "autonomias": [{"id": k, "nome": n} for k, n in dados_agente.AUTONOMIAS.items()], "tons": list(dados_agente.TONS)}

    @rotas.put("/organizacao/agentes/{agente_id}/ficha")
    def salvar_ficha(agente_id: str, pedido: PedidoFicha, quem: tuple = Depends(_precisa("criar_agentes"))) -> dict:
        from agente import dados_agente, fabrica

        oid = quem[1]["organizacao_id"]
        if agente_id not in fabrica.agentes_da_organizacao(oid):
            raise HTTPException(status_code=404, detail="Agente não encontrado nesta organização.")
        return _dados_erro(lambda: dados_agente.salvar_ficha(oid, agente_id, pedido.model_dump(exclude_none=True), quem[0]))

    # ───────── Trabalho dos agentes: tarefas, atividades e processos (agente/trabalho.py) ─────────

    def _trabalho(acao):
        from agente import trabalho

        try:
            return acao()
        except trabalho.ErroTrabalho as erro:
            raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro
        except ValueError as erro:
            raise HTTPException(status_code=422, detail=str(erro)) from erro

    @rotas.get("/organizacao/tarefas")
    def listar_tarefas(situacao: str = Query(default="abertas", pattern=r"^(abertas|todas|backlog|ready|in_progress|in_review|done|cancelled)$"),
                       quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        from agente import trabalho

        return {"tarefas": trabalho.tarefas(quem[1]["organizacao_id"], quem[0], situacao)}

    @rotas.post("/organizacao/tarefas/{tarefa_id}/aceitar")
    def aceitar_tarefa(tarefa_id: str, quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        from agente import trabalho

        _trabalho(lambda: trabalho.aceitar(quem[1]["organizacao_id"], tarefa_id, quem[0]))
        return {"ok": True}

    @rotas.post("/organizacao/tarefas/{tarefa_id}/recusar")
    def recusar_tarefa(tarefa_id: str, pedido: PedidoRecusa, quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        from agente import trabalho

        _trabalho(lambda: trabalho.recusar(quem[1]["organizacao_id"], tarefa_id, quem[0], pedido.motivo))
        return {"ok": True}

    @rotas.post("/organizacao/tarefas/{tarefa_id}/acoes")
    def decidir_acoes(tarefa_id: str, pedido: PedidoAcoes, quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        from agente import trabalho

        _trabalho(lambda: trabalho.decidir_acoes(quem[1]["organizacao_id"], tarefa_id, quem[0], pedido.aprovar, pedido.motivo))
        return {"ok": True}

    @rotas.post("/organizacao/tarefas/{tarefa_id}/revisao")
    def revisar_tarefa(tarefa_id: str, pedido: PedidoRevisao, quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        from agente import trabalho

        _trabalho(lambda: trabalho.revisar(quem[1]["organizacao_id"], tarefa_id, quem[0], pedido.aprovar, pedido.ajustes))
        return {"ok": True}

    @rotas.get("/organizacao/atencao")
    def atencao(quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        from agente import trabalho

        return {"areas": trabalho.atencao(quem[1]["organizacao_id"])}

    @rotas.get("/organizacao/atividades")
    def listar_atividades(quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        from agente import perfis, trabalho

        oid = quem[1]["organizacao_id"]
        nomes = {str(a["id"]): a["nome"] for a in gestao.areas(oid)}
        saida = []
        for a in gestao.atividades(oid):
            proc = trabalho.processo(oid, str(a["id"])) if trabalho.disponivel() else None
            saida.append(gestao._json({
                "id": a["id"], "nome": a["nome"], "descricao": a["descricao"], "tipo": a["tipo"], "frequencia": a["frequencia"],
                "entregavel": a.get("entregavel"), "ativa": a.get("ativa", True), "area_id": a["area_id"],
                "area": nomes.get(str(a["area_id"])), "agente_id": (ag := trabalho.agente_da_area(oid, str(a["area_id"]))),
                "agente": perfis.identidade(ag)["nome"] if ag and perfis.existe(ag) else None,
                "processo": {"versao": proc["versao"], "passos": proc["passos"]} if proc else None,
            }))
        return {"atividades": saida}

    # ───────── Assistente de Processos (agente/perfis/processos.py): desenhar os processos em conversa ─────────

    def _conversa_processos(email: str) -> str:
        import hashlib

        return "processos-" + hashlib.sha256(email.encode()).hexdigest()[:16]

    @rotas.get("/organizacao/processos/conversa")
    def conversa_processos(quem: tuple = Depends(_precisa("gerenciar_fluxos"))) -> dict:
        from agente import perfis, registro

        assistente = (registro.agentes or {}).get("processos")
        historico = []
        conversa = _sessao(assistente.db, _conversa_processos(quem[0])) if assistente else None
        for run in (getattr(conversa, "runs", None) or []):
            if getattr(run, "parent_run_id", None):
                continue
            historico.append({"papel": "contato", "texto": _texto_entrada(run)})
            if isinstance(run.content, str) and run.content.strip():
                historico.append({"papel": "agente", "texto": run.content})
        nome = (quem[1].get("nome") or "").split(" ")[0] if quem[1].get("nome") else ""
        return {"boas_vindas": perfis.obter("processos").boas_vindas(nome), "historico": historico}

    @rotas.post("/organizacao/processos/mensagem")
    async def mensagem_processos(pedido: PedidoImplantacao, quem: tuple = Depends(_precisa("gerenciar_fluxos"))) -> dict:
        from agente import registro
        from agente.atendimento import responder

        assistente = (registro.agentes or {}).get("processos")
        if not assistente:
            raise HTTPException(status_code=503, detail="O Assistente de Processos não está no ar neste servidor.")
        return await run_in_threadpool(
            responder, assistente, _conversa_processos(quem[0]), pedido.mensagem.strip(), "", quem[0], "", None,
            {"conta_email": quem[0], "organizacao_id": quem[1]["organizacao_id"]})

    @rotas.post("/organizacao/atividades/{atividade_id}/rodar")
    def rodar_atividade(atividade_id: str, quem: tuple = Depends(_precisa("gerenciar_fluxos"))) -> dict:
        from agente import rotinas

        return _trabalho(lambda: rotinas.rodar_agora(quem[1]["organizacao_id"], atividade_id, quem[0]))

    # ───────── Organograma ─────────

    @rotas.get("/organizacao/cargos")
    def listar_cargos(quem: tuple = Depends(_precisa("ver_painel"))) -> dict:
        return {"cargos": acessos.cargos(quem[1]["organizacao_id"])}

    @rotas.post("/organizacao/cargos/padrao")
    async def organograma_padrao(quem: tuple = Depends(_precisa("gerenciar_cargos"))) -> dict:
        criados = await run_in_threadpool(acessos.montar_organograma_padrao, quem[1]["organizacao_id"], quem[0])
        return {"criados": criados, "cargos": acessos.cargos(quem[1]["organizacao_id"])}

    @rotas.post("/organizacao/cargos")
    def criar_cargo(pedido: PedidoCargo, quem: tuple = Depends(_precisa("gerenciar_cargos"))) -> dict:
        if not pedido.nome:
            raise HTTPException(status_code=422, detail="Dê um nome ao cargo.")
        try:
            return acessos.criar_cargo(quem[1]["organizacao_id"], pedido.model_dump(exclude_unset=True), quem[0])
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro

    @rotas.put("/organizacao/cargos/{cargo_id}")
    def alterar_cargo(cargo_id: str, pedido: PedidoCargo, quem: tuple = Depends(_precisa("gerenciar_cargos"))) -> dict:
        try:
            return acessos.alterar_cargo(quem[1]["organizacao_id"], cargo_id, pedido.model_dump(exclude_unset=True), quem[0])
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro

    @rotas.get("/organizacao/equipe")
    def equipe(quem: tuple = Depends(_precisa("gerenciar_equipe"))) -> dict:
        return acessos.equipe(quem[1]["organizacao_id"])

    @rotas.post("/organizacao/convites")
    def convidar(pedido: PedidoConvite, pedido_http: Request, quem: tuple = Depends(_precisa("gerenciar_equipe"))) -> dict:
        try:
            token = acessos.convidar(quem[1]["organizacao_id"], pedido.email, pedido.nome, pedido.cargo_id, quem[0])
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro
        base = str(pedido_http.base_url).rstrip("/")
        return {"link": f"{base}/painel/convite/{token}", "validade_dias": acessos.VALIDADE_CONVITE.days}

    @rotas.post("/organizacao/convites/{convite_id}/aprovar")
    def aprovar_convite(convite_id: str, pedido_http: Request, quem: tuple = Depends(_precisa("gerenciar_equipe"))) -> dict:
        """O acesso que o Assistente de Implantação cadastrou passa a valer: devolve o link de entrada da pessoa."""
        try:
            token = acessos.aprovar_convite(quem[1]["organizacao_id"], convite_id, quem[0])
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro
        base = str(pedido_http.base_url).rstrip("/")
        return {"link": f"{base}/painel/convite/{token}", "validade_dias": acessos.VALIDADE_CONVITE.days}

    @rotas.post("/organizacao/implantacao/link")
    def compartilhar_implantacao(pedido_http: Request, quem: tuple = Depends(_precisa("gerenciar_equipe"))) -> dict:
        """Um link para outro colaborador da organização continuar a implantação, com o código de segurança. Os dois só
        aparecem agora: mande o link e o código por canais diferentes (ex.: e-mail e telefone)."""
        token, codigo = acessos.criar_link_implantacao(quem[1]["organizacao_id"], quem[0])
        base = str(pedido_http.base_url).rstrip("/")
        return {"link": f"{base}/painel/colaborar/{token}", "codigo": codigo, "validade_dias": acessos.VALIDADE_LINK.days}

    @rotas.get("/implantacao/link/{token}")
    def ver_link_implantacao(token: str) -> dict:
        disponivel()
        try:
            return acessos.ler_link_implantacao(token)
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro

    @rotas.post("/implantacao/link/{token}")
    async def entrar_pela_implantacao(token: str, pedido: PedidoLinkImplantacao, resposta: Response) -> dict:
        disponivel()
        if not _chave() or not usuarios.disponivel():
            raise HTTPException(status_code=503, detail="O login não está ligado neste servidor (falta OS_SECURITY_KEY).")
        email = pedido.email.strip().lower()
        if not _email_permitido(email):
            raise HTTPException(status_code=403, detail=f"O e-mail {email} não pode entrar neste servidor.")
        try:
            acessos.ler_link_implantacao(token)
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro
        # Conta nova: a senha escolhida agora. Conta que já existe: a senha precisa conferir.
        try:
            await run_in_threadpool(usuarios.criar_conta, email, pedido.nome, pedido.senha)
        except usuarios.ErroUsuario as erro:
            if erro.status != 409:
                raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro
            if not await run_in_threadpool(usuarios.entrar_com_senha, email, pedido.senha):
                raise HTTPException(status_code=401, detail="Este e-mail já tem conta: use a senha dela.") from erro
        try:
            dados = await run_in_threadpool(acessos.entrar_pelo_link, token, pedido.codigo, email, pedido.nome)
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro
        _gravar_sessao(resposta, email, pedido.nome.strip())
        return {"organizacao": dados["organizacao"]}

    @rotas.delete("/organizacao/convites/{convite_id}", status_code=204)
    def cancelar_convite(convite_id: str, quem: tuple = Depends(_precisa("gerenciar_equipe"))) -> None:
        try:
            acessos.cancelar_convite(quem[1]["organizacao_id"], convite_id, quem[0])
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro

    @rotas.put("/organizacao/membros/{email}")
    def alterar_membro(email: str, pedido: PedidoMembro, quem: tuple = Depends(_precisa("gerenciar_equipe"))) -> dict:
        if email.strip().lower() == quem[0]:
            raise HTTPException(status_code=403, detail="Você não pode alterar o próprio acesso.")
        try:
            acessos.alterar_membro(quem[1]["organizacao_id"], email, pedido.model_dump(exclude_unset=True), quem[0])
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro
        return acessos.equipe(quem[1]["organizacao_id"])

    # ───────── Convite (aberto: quem recebeu o link ainda não tem conta) ─────────

    @rotas.get("/convite/{token}")
    def ver_convite(token: str) -> dict:
        disponivel()
        try:
            dados = acessos.ler_convite(token)
        except acessos.ErroAcesso as erro:
            raise _erro(erro) from erro
        return {k: dados[k] for k in ("email", "nome", "organizacao", "cargo")}

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
        return {"email": email, "organizacao": convite["organizacao"], "cargo": convite["cargo"]}

    return rotas
