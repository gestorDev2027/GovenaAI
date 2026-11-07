"""Rotas da fábrica de agentes (/painel/api/fabrica): criar agentes e ajustar os atuais pelo painel.

As regras e o banco ficam em agente/fabrica.py; aqui, a autenticação do painel, a permissão de escrita
(só curadores, PAINEL_CURADORES, como na Calibração) e a remontagem do Agent depois de cada gravação,
para a mudança valer na mensagem seguinte sem reiniciar o servidor.

Também aqui: o canal WhatsApp (/canal: quem atende pela Unnichat, a porta do lead e as tags que calam o
agente; agente/canal.py), skills, ferramentas HTTP do painel, casos de teste e o assistente de IA que
escreve rascunhos (agente/fabrica_recursos.py e agente/assistente_fabrica.py). Editar uma skill ou uma
ferramenta remonta os agentes que a usam.

A base de conhecimento de cada agente continua em /painel/api/base?agente=<id>, os documentos em
/painel/api/conhecimento/documentos?agente=<id> e o teste em /painel/api/chat com agente=<id>.
"""

from typing import Any, Callable, Literal

from agno.agent import Agent
from fastapi import APIRouter, Cookie, Depends, HTTPException
from pydantic import BaseModel, Field

from agente import assistente_fabrica, base, canal, equipes, fabrica, fabrica_recursos, perfis
from agente.agente import _indexar_em_segundo_plano, montar_agente
from agente.perfil import Perfil
from calibracao_api import _negado, _pode, _quem
from painel_api import exigir_chave


class CamposAgente(BaseModel):
    nome: str = Field(max_length=200)
    area: str = Field(max_length=200)
    cargo: str = Field(default="", max_length=200)
    descricao: str = Field(max_length=500)
    cor: str = Field(default="", max_length=20)
    modelo: str | None = Field(default=None, max_length=100)
    raciocinio: str | None = Field(default=None, max_length=20)
    ferramentas: list[str] = Field(default_factory=list, max_length=30)
    skills: list[str] = Field(default_factory=list, max_length=30)
    categorias: dict[str, str] = Field(default_factory=dict)
    minutos_inatividade: int
    quando_transferir: str = Field(default="", max_length=3000)
    memoria: str = Field(default="", max_length=4000)


class AgenteNovo(CamposAgente):
    id: str = Field(max_length=60)


class Duplicacao(BaseModel):
    """O que muda na cópia; o resto vem do agente original."""
    id: str = Field(max_length=60)
    nome: str = Field(max_length=200)
    descricao: str = Field(default="", max_length=500)
    cor: str = Field(default="", max_length=20)
    copiar_documentos: bool = True


class Publicacao(BaseModel):
    publicado: bool


class EquipeCampos(BaseModel):
    nome: str = Field(max_length=200)
    descricao: str = Field(default="", max_length=600)
    membros: list[str] = Field(max_length=20)
    padrao: str | None = Field(default=None, max_length=60)
    orientacoes: str = Field(default="", max_length=8000)


class EquipeNova(EquipeCampos):
    id: str = Field(max_length=60)


class CanalCampos(BaseModel):
    atendente: str = Field(max_length=60)
    leads: str = Field(default="", max_length=60)
    tags_sem_agente: list[str] = Field(default_factory=list, max_length=100)
    horas_pessoa: int = Field(default=24, ge=0, le=168)
    somente_pipeline: bool = True
    dias_comercial: int = Field(default=7, ge=0, le=60)
    pela_tag: bool = False


class TextoInstrucoes(BaseModel):
    texto: str = Field(max_length=60000)
    observacao: str | None = Field(default=None, max_length=300)


class Referencia(BaseModel):
    nome: str = Field(max_length=200)
    conteudo: str = Field(max_length=60000)


class SkillCampos(BaseModel):
    nome: str = Field(max_length=200)
    descricao: str = Field(max_length=1000)
    instrucoes: str = Field(max_length=40000)
    referencias: list[Referencia] = Field(default_factory=list, max_length=30)


class SkillNova(SkillCampos):
    id: str = Field(max_length=60)


class FerramentaCampos(BaseModel):
    tipo: Literal["http"] = "http"
    nome: str = Field(max_length=200)
    descricao: str = Field(max_length=3000)
    config: dict[str, Any]
    ativa: bool = True


class FerramentaNova(FerramentaCampos):
    id: str = Field(max_length=60)


class TesteFerramenta(BaseModel):
    ferramenta: FerramentaCampos
    argumentos: dict[str, Any] = Field(default_factory=dict)


class ChaveValor(BaseModel):
    valor: str = Field(max_length=4000)
    descricao: str = Field(default="", max_length=300)


class HostNovo(BaseModel):
    host: str = Field(max_length=253)
    descricao: str = Field(default="", max_length=300)


class CasoCampos(BaseModel):
    titulo: str = Field(max_length=300)
    mensagem: str = Field(max_length=4000)
    contexto: dict[str, Any] = Field(default_factory=dict)
    esperado: dict[str, Any] = Field(default_factory=dict)
    ativo: bool = True


class PedidoAssistente(BaseModel):
    tipo: Literal["agente", "instrucoes", "skill", "ferramenta_http", "casos"]
    pedido: str = Field(default="", max_length=30000)
    agente: str | None = Field(default=None, max_length=60)
    atual: dict[str, Any] | None = None


def criar_rotas_fabrica(agentes: dict[str, Agent], ao_mudar: Callable[[Agent], None] | None = None,
                        ao_mudar_equipe: Callable | None = None) -> APIRouter:
    """`agentes` é o dicionário do servidor (o mesmo que o painel e a Unnichat usam): a fábrica troca
    nele o Agent remontado. As equipes ficam em equipes.EQUIPES. `ao_mudar` e `ao_mudar_equipe` avisam
    quem mais guarda agentes e equipes (as listas do AgentOS)."""
    banco = next(iter(agentes.values())).db
    rotas = APIRouter(prefix="/painel/api/fabrica", tags=["Fábrica de agentes"], dependencies=[Depends(exigir_chave)])

    def _curador(painel_sessao: str | None, permissao: str = "editar_agentes") -> str:
        """Quem pede, se tiver a permissão (agente/usuarios.py; a chave de acesso pode tudo)."""
        quem = _quem(painel_sessao)
        if not _pode(quem, permissao):
            raise _negado(permissao)
        return quem

    def _executar(acao: Callable[[], object]):
        try:
            return acao()
        except (fabrica.ErroFabrica, fabrica_recursos.ErroRecurso, equipes.ErroEquipe, canal.ErroCanal) as erro:
            raise HTTPException(status_code=erro.status, detail=erro.detalhe) from erro

    def _remontar_quem_usa(campo: str, recurso_id: str) -> list[str]:
        """Skill ou ferramenta alterada: os agentes que a usam são remontados com a versão nova."""
        ids = fabrica.usam(campo, recurso_id)
        for agente_id in ids:
            _remontar(perfis.PERFIS[agente_id])
        return ids

    def _agente(agente_id: str):
        """Um agente ou uma equipe (os casos de teste valem para os dois)."""
        atendente = (agentes.get(agente_id) if perfis.existe(agente_id) else None) or equipes.EQUIPES.get(agente_id)
        if atendente is None:
            raise HTTPException(status_code=404, detail=f"Agente ou equipe desconhecida: {agente_id}.")
        return atendente

    def _categorias(agente_id: str) -> dict[str, str]:
        """Os motivos de transferência: os do agente ou, numa equipe, os de todos os membros."""
        atendente = _agente(agente_id)
        if equipes.eh_equipe(atendente):
            motivos: dict[str, str] = {}
            for membro in equipes.obter(agente_id)["membros"]:
                motivos.update(perfis.obter(membro).categorias_transferencia)
            return motivos
        return perfis.PERFIS[agente_id].categorias_transferencia

    def _membros(agente_id: str) -> list[str] | None:
        return equipes.obter(agente_id)["membros"] if agente_id in equipes.EQUIPES else None

    def _remontar_equipe(equipe_id: str) -> None:
        nova = equipes.montar(equipes._estado["config"][equipe_id], banco)
        equipes.EQUIPES[equipe_id] = nova
        if ao_mudar_equipe:
            ao_mudar_equipe(nova)

    def _remontar(perfil: Perfil) -> dict:
        novo = montar_agente(perfil, banco)
        agentes[perfil.id] = novo
        if ao_mudar:
            ao_mudar(novo)
        for equipe_id in equipes.com_agente(perfil.id):  # as equipes têm Agents próprios
            _remontar_equipe(equipe_id)
        return fabrica.obter(perfil.id)

    @rotas.get("/opcoes")
    def opcoes() -> dict:
        return fabrica.opcoes()

    @rotas.get("/agentes")
    def listar() -> dict:
        return {"agentes": fabrica.listar()}

    @rotas.get("/agentes/{agente_id}")
    def obter(agente_id: str) -> dict:
        return _executar(lambda: fabrica.obter(agente_id))

    @rotas.post("/agentes", status_code=201)
    def criar(pedido: AgenteNovo, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Cria em rascunho: já dá para testar no chat (agente=<id>), mas só aparece na Central depois de publicado."""
        quem = _curador(painel_sessao)
        perfil = _executar(lambda: fabrica.criar(pedido.id, pedido.model_dump(exclude={"id"}), quem))
        _indexar_em_segundo_plano(perfil.id, base.obter(perfil.id).texto())
        return _remontar(perfil)

    @rotas.post("/agentes/{agente_id}/duplicar", status_code=201)
    def duplicar(agente_id: str, pedido: Duplicacao, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Cópia em rascunho de um agente (fabrica.duplicar): configuração, instruções vigentes, roteiro e, com
        `copiar_documentos`, os documentos em uso. O roteiro copiado é indexado ao ser salvo (base.ao_salvar)."""
        from agente import conhecimento

        quem = _curador(painel_sessao)
        perfil = _executar(lambda: fabrica.duplicar(agente_id, pedido.id, pedido.model_dump(include={"nome", "descricao", "cor"}), quem))
        documentos = None
        if pedido.copiar_documentos and conhecimento.disponivel():
            documentos = conhecimento.copiar_documentos(agente_id, perfil.id, quem)
        return {**_remontar(perfil), "documentos_copiados": documentos}

    @rotas.put("/agentes/{agente_id}")
    def alterar(agente_id: str, pedido: CamposAgente, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao)
        return _remontar(_executar(lambda: fabrica.alterar(agente_id, pedido.model_dump(), quem)))

    @rotas.post("/agentes/{agente_id}/publicacao")
    def publicar(agente_id: str, pedido: Publicacao, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao, "publicar")
        return _remontar(_executar(lambda: fabrica.publicar(agente_id, pedido.publicado, quem)))

    @rotas.delete("/agentes/{agente_id}", status_code=204)
    def excluir(agente_id: str, painel_sessao: str | None = Cookie(default=None)) -> None:
        """Exclusão lógica (agente do painel e inativo): sai das equipes, que são remontadas na hora."""
        quem = _curador(painel_sessao, "excluir")
        perfil, equipes_alteradas = _executar(lambda: fabrica.excluir(agente_id, quem))
        novo = montar_agente(perfil, banco)  # fica no registro só para as conversas antigas
        agentes[perfil.id] = novo
        if ao_mudar:
            ao_mudar(novo)
        for equipe_id in equipes_alteradas:
            _remontar_equipe(equipe_id)

    @rotas.get("/agentes/{agente_id}/instrucoes")
    def instrucoes(agente_id: str) -> dict:
        return _executar(lambda: fabrica.instrucoes(agente_id))

    @rotas.get("/agentes/{agente_id}/instrucoes/{versao}")
    def versao(agente_id: str, versao: int) -> dict:
        return _executar(lambda: fabrica.versao_instrucoes(agente_id, versao))

    @rotas.put("/agentes/{agente_id}/instrucoes")
    def salvar_instrucoes(agente_id: str, pedido: TextoInstrucoes, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao)
        _remontar(_executar(lambda: fabrica.salvar_instrucoes(agente_id, pedido.texto, pedido.observacao, quem)))
        return fabrica.instrucoes(agente_id)

    @rotas.post("/agentes/{agente_id}/instrucoes/{versao}/restaurar")
    def restaurar(agente_id: str, versao: int, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao)
        _remontar(_executar(lambda: fabrica.restaurar_instrucoes(agente_id, versao, quem)))
        return fabrica.instrucoes(agente_id)

    # ───────── Skills ─────────

    @rotas.get("/skills")
    def listar_skills() -> dict:
        return {"skills": [{**s, "agentes": fabrica.usam("skills", s["id"])} for s in fabrica_recursos.listar_skills()]}

    @rotas.get("/skills/{skill_id}")
    def obter_skill(skill_id: str) -> dict:
        skill = _executar(lambda: fabrica_recursos.obter_skill(skill_id))
        return {**skill, "agentes": fabrica.usam("skills", skill_id)}

    @rotas.post("/skills", status_code=201)
    def criar_skill(pedido: SkillNova, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao)
        return _executar(lambda: fabrica_recursos.salvar_skill(pedido.id, pedido.model_dump(exclude={"id"}), quem, True))

    @rotas.put("/skills/{skill_id}")
    def alterar_skill(skill_id: str, pedido: SkillCampos, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao)
        skill = _executar(lambda: fabrica_recursos.salvar_skill(skill_id, pedido.model_dump(), quem, False))
        return {**skill, "agentes": _remontar_quem_usa("skills", skill_id)}

    @rotas.delete("/skills/{skill_id}", status_code=204)
    def excluir_skill(skill_id: str, painel_sessao: str | None = Cookie(default=None)) -> None:
        _curador(painel_sessao, "excluir")
        _executar(lambda: fabrica_recursos.excluir_skill(skill_id, fabrica.usam("skills", skill_id)))

    # ───────── Ferramentas HTTP do painel ─────────

    @rotas.get("/ferramentas")
    def listar_ferramentas() -> dict:
        return {"ferramentas": [{**f, "agentes": fabrica.usam("ferramentas", f["id"])} for f in fabrica_recursos.listar_ferramentas()],
                "hosts_permitidos": fabrica_recursos.hosts_permitidos(), "chaves": fabrica_recursos.listar_chaves()}

    @rotas.get("/ferramentas/{ferramenta_id}")
    def obter_ferramenta(ferramenta_id: str) -> dict:
        ferramenta = _executar(lambda: fabrica_recursos.obter_ferramenta(ferramenta_id))
        return {**ferramenta, "agentes": fabrica.usam("ferramentas", ferramenta_id)}

    @rotas.post("/ferramentas", status_code=201)
    def criar_ferramenta(pedido: FerramentaNova, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao, "ferramentas_e_chaves")
        return _executar(lambda: fabrica_recursos.salvar_ferramenta(pedido.id, pedido.model_dump(exclude={"id"}), quem, True))

    @rotas.put("/ferramentas/{ferramenta_id}")
    def alterar_ferramenta(ferramenta_id: str, pedido: FerramentaCampos, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao, "ferramentas_e_chaves")
        ferramenta = _executar(lambda: fabrica_recursos.salvar_ferramenta(ferramenta_id, pedido.model_dump(), quem, False))
        return {**ferramenta, "agentes": _remontar_quem_usa("ferramentas", ferramenta_id)}

    @rotas.delete("/ferramentas/{ferramenta_id}", status_code=204)
    def excluir_ferramenta(ferramenta_id: str, painel_sessao: str | None = Cookie(default=None)) -> None:
        _curador(painel_sessao, "excluir")
        _executar(lambda: fabrica_recursos.excluir_ferramenta(ferramenta_id, fabrica.usam("ferramentas", ferramenta_id)))

    @rotas.post("/ferramentas/testar")
    def testar_ferramenta(pedido: TesteFerramenta, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Chama a ferramenta, salva ou ainda em edição, com argumentos de teste (sem o agente)."""
        _curador(painel_sessao, "ferramentas_e_chaves")
        return _executar(lambda: fabrica_recursos.testar_ferramenta(pedido.ferramenta.model_dump(), dict(pedido.argumentos)))

    # ───────── Chaves de API (valor no cofre, nunca devolvido) e hosts liberados ─────────

    @rotas.get("/chaves")
    def listar_chaves() -> dict:
        return {"chaves": fabrica_recursos.listar_chaves()}

    @rotas.put("/chaves/{nome}")
    def salvar_chave(nome: str, pedido: ChaveValor, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Cria ou troca a chave. A resposta traz só nome, descrição e os 4 últimos caracteres."""
        quem = _curador(painel_sessao, "ferramentas_e_chaves")
        return _executar(lambda: fabrica_recursos.salvar_chave(nome, pedido.valor, pedido.descricao, quem))

    @rotas.delete("/chaves/{nome}", status_code=204)
    def apagar_chave(nome: str, painel_sessao: str | None = Cookie(default=None)) -> None:
        _curador(painel_sessao, "ferramentas_e_chaves")
        _executar(lambda: fabrica_recursos.apagar_chave(nome))

    @rotas.get("/hosts")
    def listar_hosts() -> dict:
        return {"hosts": fabrica_recursos.listar_hosts()}

    @rotas.post("/hosts", status_code=201)
    def liberar_host(pedido: HostNovo, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao, "ferramentas_e_chaves")
        return _executar(lambda: fabrica_recursos.liberar_host(pedido.host, pedido.descricao, quem))

    @rotas.delete("/hosts/{host}", status_code=204)
    def remover_host(host: str, painel_sessao: str | None = Cookie(default=None)) -> None:
        _curador(painel_sessao, "ferramentas_e_chaves")
        _executar(lambda: fabrica_recursos.remover_host(host))

    # ───────── Casos de teste ─────────

    @rotas.get("/agentes/{agente_id}/casos")
    def listar_casos(agente_id: str) -> dict:
        """Os casos da fábrica (editáveis aqui) e os do dataset da Calibração (só leitura): a execução roda os dois."""
        _agente(agente_id)
        return {"casos": fabrica_recursos.listar_casos(agente_id), "calibracao": fabrica_recursos.casos_da_calibracao(agente_id),
                "execucoes": fabrica_recursos.execucoes(agente_id, 5)}

    @rotas.post("/agentes/{agente_id}/casos", status_code=201)
    def criar_caso(agente_id: str, pedido: CasoCampos, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao)
        categorias = _categorias(agente_id)
        return _executar(lambda: fabrica_recursos.salvar_caso(agente_id, None, pedido.model_dump(), categorias, quem,
                                                              _membros(agente_id)))

    @rotas.put("/agentes/{agente_id}/casos/{caso_id}")
    def alterar_caso(agente_id: str, caso_id: int, pedido: CasoCampos, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao)
        categorias = _categorias(agente_id)
        return _executar(lambda: fabrica_recursos.salvar_caso(agente_id, caso_id, pedido.model_dump(), categorias, quem,
                                                              _membros(agente_id)))

    @rotas.delete("/agentes/{agente_id}/casos/{caso_id}", status_code=204)
    def excluir_caso(agente_id: str, caso_id: int, painel_sessao: str | None = Cookie(default=None)) -> None:
        _curador(painel_sessao, "excluir")
        _executar(lambda: fabrica_recursos.excluir_caso(agente_id, caso_id))

    @rotas.post("/agentes/{agente_id}/casos/executar", status_code=202)
    def executar_casos(agente_id: str, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Roda os casos ativos em segundo plano; acompanhe em GET /fabrica/execucoes/{id}."""
        quem = _curador(painel_sessao)
        return _executar(lambda: fabrica_recursos.iniciar_execucao(_agente(agente_id), quem))

    @rotas.get("/execucoes/{execucao_id}")
    def obter_execucao(execucao_id: int) -> dict:
        return _executar(lambda: fabrica_recursos.obter_execucao(execucao_id))

    # ───────── Equipes (vários agentes no mesmo canal, com recepção) ─────────

    @rotas.get("/equipes")
    def listar_equipes() -> dict:
        return {"equipes": equipes.listar()}

    @rotas.get("/equipes/{equipe_id}")
    def obter_equipe(equipe_id: str) -> dict:
        return _executar(lambda: equipes.obter(equipe_id))

    @rotas.post("/equipes", status_code=201)
    def criar_equipe(pedido: EquipeNova, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Cria em rascunho: já dá para testar no chat (agente=<id da equipe>)."""
        quem = _curador(painel_sessao)
        equipe = _executar(lambda: equipes.criar(pedido.id, pedido.model_dump(exclude={"id"}), quem))
        _remontar_equipe(equipe["id"])
        return equipe

    @rotas.put("/equipes/{equipe_id}")
    def alterar_equipe(equipe_id: str, pedido: EquipeCampos, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao)
        equipe = _executar(lambda: equipes.alterar(equipe_id, pedido.model_dump(), quem))
        _remontar_equipe(equipe_id)
        return equipe

    @rotas.delete("/equipes/{equipe_id}", status_code=204)
    def excluir_equipe(equipe_id: str, painel_sessao: str | None = Cookie(default=None)) -> None:
        """Exclusão lógica (equipe inativa e fora do Canal WhatsApp): sai da Unnichat e das listas na hora."""
        quem = _curador(painel_sessao, "excluir")
        _executar(lambda: equipes.excluir(equipe_id, quem))

    @rotas.post("/equipes/{equipe_id}/publicacao")
    def publicar_equipe(equipe_id: str, pedido: Publicacao, painel_sessao: str | None = Cookie(default=None)) -> dict:
        quem = _curador(painel_sessao, "publicar")
        equipe = _executar(lambda: equipes.publicar(equipe_id, pedido.publicado, quem))
        _remontar_equipe(equipe_id)  # publicada, a recepção passa a escolher só entre os agentes publicados
        return equipe

    # ───────── Canal WhatsApp (quem atende pela Unnichat) ─────────

    @rotas.get("/canal")
    def obter_canal() -> dict:
        return canal.obter()

    @rotas.get("/canal/historico")
    def historico_canal() -> dict:
        return {"versoes": canal.historico()}

    @rotas.put("/canal")
    def alterar_canal(pedido: CanalCampos, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Vale na mensagem seguinte. Trocar quem atende é pôr no ar: pede a permissão de publicar."""
        quem = _curador(painel_sessao, "publicar")
        return _executar(lambda: canal.alterar(pedido.model_dump(), quem))

    # ───────── Assistente de IA ─────────

    @rotas.post("/assistente")
    def assistente(pedido: PedidoAssistente, painel_sessao: str | None = Cookie(default=None)) -> dict:
        """Um rascunho para o formulário (nada é salvo): agente, instrucoes, skill, ferramenta_http ou casos."""
        _curador(painel_sessao)
        try:
            return {"tipo": pedido.tipo, "rascunho": _executar(
                lambda: assistente_fabrica.rascunho(pedido.tipo, pedido.pedido, pedido.agente, pedido.atual))}
        except HTTPException:
            raise
        except Exception as erro:
            raise HTTPException(status_code=502, detail=f"O assistente não conseguiu responder: {type(erro).__name__}.") from erro

    return rotas
