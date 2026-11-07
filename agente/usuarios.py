"""Usuários do painel e o que cada um pode fazer, no banco (painel_usuarios), geridos pelo próprio painel.

O login é o do Google, só com contas do domínio da empresa (painel_api.py). Quem entra pela primeira vez
fica PENDENTE até o dono (ou um administrador) aprovar e escolher o papel. O papel é um conjunto pronto
de permissões; o dono pode ligar ou desligar permissões de cada pessoa. Mesmo modelo do nexaBI
(cf-analytics: papéis no banco, o primeiro administrador definido na instalação, gestão pelo painel).

O dono: o e-mail de PAINEL_DONO, se definido; senão, o primeiro a entrar com o Google. Ele tem todas as
permissões, não pode ser bloqueado nem rebaixado por outra pessoa e é o único que mexe em administradores.

A chave de acesso (OS_SECURITY_KEY) continua valendo para as rotinas internas e o AgentOS, com todas as
permissões; para pessoas, o caminho é o Google.
"""

import os
import threading
from datetime import datetime, timezone

from sqlalchemy import JSON, Column, DateTime, MetaData, String, Table, delete, insert, select, update
from sqlalchemy.engine import Engine

PERMISSOES: dict[str, tuple[str, str]] = {
    "ver_painel": ("Ver o painel", "Visão geral, Conversas e Central ao vivo."),
    "tratar_alertas": ("Tratar alertas", "Dar baixa nos alertas da Central (equipe assumiu, resolvido)."),
    "usar_chat": ("Usar o chat de teste", "Conversar com agentes e equipes pelo painel."),
    "avaliar": ("Avaliar respostas", "Dar 👍 ou 👎 nas respostas, na Calibração."),
    "aprovar_calibracao": ("Aprovar na Calibração", "Aprovar ou recusar avaliações, exemplos e frases do guardrail."),
    "editar_conhecimento": ("Editar conhecimento", "Roteiros, documentos e bases compartilhadas."),
    "editar_agentes": ("Editar agentes", "Criar e alterar agentes, instruções, skills, casos de teste e equipes; usar o assistente de IA."),
    "publicar": ("Publicar", "Colocar no ar ou tirar do ar agentes e equipes."),
    "excluir": ("Excluir", "Apagar skills, ferramentas, casos de teste e bases."),
    "ferramentas_e_chaves": ("Ferramentas e chaves", "Ferramentas HTTP, chaves de API e hosts liberados."),
    "ver_banco": ("Ver o banco", "A tela de consulta ao banco."),
    "gerenciar_usuarios": ("Gerenciar usuários", "Aprovar, bloquear e definir o que cada pessoa pode fazer."),
}
TODAS = tuple(PERMISSOES)

PAPEIS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "dono": ("Dono", "Tudo, inclusive administradores. Um só.", TODAS),
    "administrador": ("Administrador", "Tudo, menos mexer no dono e em outros administradores.", TODAS),
    "editor": ("Editor", "Cria e ajusta agentes e conhecimento; não publica nem exclui.",
               ("ver_painel", "tratar_alertas", "usar_chat", "avaliar", "editar_conhecimento", "editar_agentes")),
    "curador": ("Curador", "Avalia e aprova na Calibração e cuida do conhecimento.",
                ("ver_painel", "tratar_alertas", "usar_chat", "avaliar", "aprovar_calibracao", "editar_conhecimento")),
    "leitor": ("Leitor", "Só acompanha: painel e conversas.", ("ver_painel",)),
}
SITUACOES = ("pendente", "ativo", "bloqueado")
SISTEMA = "chave de acesso"  # quem usa a OS_SECURITY_KEY (rotinas internas, AgentOS)

_estado: dict = {}
_trava = threading.Lock()


class ErroUsuario(Exception):
    def __init__(self, status: int, detalhe: str):
        super().__init__(detalhe)
        self.status, self.detalhe = status, detalhe


def _agora() -> datetime:
    return datetime.now(timezone.utc)


def _iso(momento) -> str | None:
    return momento.isoformat() if momento else None


def iniciar(engine: Engine, schema: str | None = None) -> None:
    tabela = Table(
        "painel_usuarios", MetaData(schema=schema),
        Column("email", String(200), primary_key=True),
        Column("nome", String(200), nullable=False),
        Column("papel", String(20), nullable=True),  # vazio enquanto pendente
        Column("permissoes", JSON, nullable=False),
        Column("situacao", String(12), nullable=False),
        Column("criado_em", DateTime(timezone=True), nullable=False),
        Column("ultimo_acesso", DateTime(timezone=True), nullable=True),
        Column("atualizado_em", DateTime(timezone=True), nullable=True),
        Column("atualizado_por", String(200), nullable=True),
    )
    tabela.metadata.create_all(engine, tables=[tabela])
    _estado.update(engine=engine, tabela=tabela)


def disponivel() -> bool:
    return "engine" in _estado


def _linha(email: str) -> dict | None:
    tabela = _estado["tabela"]
    with _estado["engine"].connect() as conexao:
        linha = conexao.execute(select(tabela).where(tabela.c.email == email)).mappings().first()
    return dict(linha) if linha else None


def _dono_atual() -> str | None:
    tabela = _estado["tabela"]
    with _estado["engine"].connect() as conexao:
        return conexao.execute(select(tabela.c.email).where(tabela.c.papel == "dono")).scalar()


def _como_dict(linha: dict) -> dict:
    return {
        "email": linha["email"], "nome": linha["nome"], "papel": linha["papel"], "situacao": linha["situacao"],
        "permissoes": list(TODAS) if linha["papel"] == "dono" else list(linha["permissoes"] or []),
        "criado_em": _iso(linha["criado_em"]), "ultimo_acesso": _iso(linha["ultimo_acesso"]),
        "atualizado_em": _iso(linha["atualizado_em"]), "atualizado_por": linha["atualizado_por"],
    }


def registrar_acesso(email: str, nome: str) -> dict:
    """Chamado a cada login com o Google: cria o usuário (pendente, ou dono se for o caso) e marca o acesso."""
    email = email.strip().lower()
    with _trava:
        linha = _linha(email)
        agora = _agora()
        tabela = _estado["tabela"]
        with _estado["engine"].begin() as conexao:
            if linha is None:
                dono_definido = os.getenv("PAINEL_DONO", "").strip().lower()
                # Sem PAINEL_DONO, o primeiro a entrar só vira dono se o login estiver restrito (PAINEL_DOMINIOS ou
                # PAINEL_EMAILS): com o login aberto a qualquer e-mail, um estranho poderia ser o primeiro.
                restrito = bool(os.getenv("PAINEL_DOMINIOS", "").strip() or os.getenv("PAINEL_EMAILS", "").strip())
                vira_dono = _dono_atual() is None and (dono_definido == email or (not dono_definido and restrito))
                conexao.execute(insert(tabela).values(
                    email=email, nome=nome or email, papel="dono" if vira_dono else None,
                    permissoes=list(TODAS) if vira_dono else [], situacao="ativo" if vira_dono else "pendente",
                    criado_em=agora, ultimo_acesso=agora, atualizado_por="primeiro acesso" if vira_dono else None,
                ))
            else:
                conexao.execute(update(tabela).where(tabela.c.email == email).values(
                    ultimo_acesso=agora, nome=nome or linha["nome"]))
    return usuario(email)


def usuario(email: str) -> dict | None:
    linha = _linha(email.strip().lower()) if disponivel() else None
    return _como_dict(linha) if linha else None


def pode(email: str, permissao: str) -> bool:
    """O usuário ativo tem a permissão? A chave de acesso (sistema) pode tudo."""
    if email == SISTEMA:
        return True
    dele = usuario(email)
    return bool(dele and dele["situacao"] == "ativo" and permissao in dele["permissoes"])


def listar() -> list[dict]:
    tabela = _estado["tabela"]
    with _estado["engine"].connect() as conexao:
        linhas = [dict(l) for l in conexao.execute(select(tabela)).mappings().all()]
    ordem = {"pendente": 0, "ativo": 1, "bloqueado": 2}
    return [_como_dict(l) for l in sorted(linhas, key=lambda l: (ordem.get(l["situacao"], 3), l["email"]))]


def opcoes() -> dict:
    return {
        "permissoes": [{"id": i, "nome": n, "descricao": d} for i, (n, d) in PERMISSOES.items()],
        "papeis": [{"id": i, "nome": n, "descricao": d, "permissoes": list(p)} for i, (n, d, p) in PAPEIS.items() if i != "dono"],
        "situacoes": list(SITUACOES),
    }


def alterar(email: str, dados: dict, por: str) -> dict:
    """Aprova, bloqueia, troca o papel ou ajusta as permissões de alguém. Regras: ninguém mexe no dono;
    só o dono mexe em administradores (e promove alguém a administrador); ninguém altera a si mesmo."""
    email = email.strip().lower()
    alvo = usuario(email)
    if alvo is None:
        raise ErroUsuario(404, f"Usuário desconhecido: {email}. Ele aparece aqui depois do primeiro login.")
    eu = usuario(por) if por != SISTEMA else {"papel": "dono"}
    eu_dono = (eu or {}).get("papel") == "dono"
    if email == por:
        raise ErroUsuario(422, "Você não pode alterar o próprio acesso.")
    if alvo["papel"] == "dono":
        raise ErroUsuario(403, "O acesso do dono não pode ser alterado.")
    papel = dados.get("papel", alvo["papel"])
    if papel is not None and papel not in PAPEIS or papel == "dono":
        raise ErroUsuario(422, f"Papel inválido. Opções: {', '.join(p for p in PAPEIS if p != 'dono')}.")
    if (alvo["papel"] == "administrador" or papel == "administrador") and not eu_dono:
        raise ErroUsuario(403, "Só o dono define ou altera administradores.")
    situacao = dados.get("situacao", alvo["situacao"])
    if situacao not in SITUACOES:
        raise ErroUsuario(422, f"Situação inválida. Opções: {', '.join(SITUACOES)}.")
    if situacao == "ativo" and not papel:
        raise ErroUsuario(422, "Escolha um papel para aprovar o acesso.")
    if "permissoes" in dados and dados["permissoes"] is not None:
        permissoes = [p for p in dict.fromkeys(dados["permissoes"]) if p in PERMISSOES]
    elif papel != alvo["papel"]:
        permissoes = list(PAPEIS[papel][2]) if papel else []  # papel novo: as permissões dele
    else:
        permissoes = alvo["permissoes"]
    if "gerenciar_usuarios" in permissoes and papel != "administrador" and not eu_dono:
        raise ErroUsuario(403, "Só o dono dá a permissão de gerenciar usuários.")
    tabela = _estado["tabela"]
    with _estado["engine"].begin() as conexao:
        conexao.execute(update(tabela).where(tabela.c.email == email).values(
            papel=papel, permissoes=permissoes, situacao=situacao, atualizado_em=_agora(), atualizado_por=por))
    return usuario(email)


def remover(email: str, por: str) -> None:
    """Tira o usuário da lista; se ele entrar de novo, volta como pendente."""
    alvo = usuario(email)
    if alvo is None:
        raise ErroUsuario(404, f"Usuário desconhecido: {email}.")
    if alvo["papel"] == "dono":
        raise ErroUsuario(403, "O dono não pode ser removido.")
    if alvo["papel"] == "administrador" and (usuario(por) or {}).get("papel") != "dono" and por != SISTEMA:
        raise ErroUsuario(403, "Só o dono remove administradores.")
    with _estado["engine"].begin() as conexao:
        conexao.execute(delete(_estado["tabela"]).where(_estado["tabela"].c.email == email.strip().lower()))
