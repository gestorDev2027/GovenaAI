"""Núcleo dos agentes de atendimento: banco, modelo e montagem de cada Agent a partir do perfil.

O que muda de um agente para outro (instruções, ferramentas, mensagens, categorias) está no perfil
(`agente/perfis/`). Todos os agentes usam o mesmo banco: as conversas, memórias, avaliações e
rastreamentos ficam juntos, separados pelo id do agente.
"""

import os
from pathlib import Path

from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.db.sqlite import SqliteDb
from agno.memory import MemoryManager
from agno.models.google import Gemini
from agno.utils.log import log_warning
from dotenv import load_dotenv

from agente import (alertas, ao_vivo, aprendizado, base, canal, conhecimento, equipes, fabrica, fabrica_recursos, gestao,
                    guardrails, perfis, usuarios)
from agente.ferramentas import STATUS_EM_ATENDIMENTO
from agente.listas import PostgresDbAgente
from agente.perfil import Perfil

load_dotenv()

PASTA_DADOS = Path(__file__).resolve().parent.parent / "dados"

RACIOCINIO_LIVRE = "livre"
NIVEIS_RACIOCINIO = (RACIOCINIO_LIVRE, "minimal", "low", "medium", "high")


def nivel_raciocinio(escolhido: str | None = None) -> str | None:
    """O nível do agente (fábrica de agentes) ou AGENTE_RACIOCINIO. "livre" (padrão) não envia nível: o
    Gemini 3 decide quanto pensar em cada mensagem. Os demais fixam o teto. Um valor inválido cai para
    "livre" em vez de derrubar toda resposta."""
    nivel = (escolhido or os.getenv("AGENTE_RACIOCINIO", RACIOCINIO_LIVRE)).strip().lower() or RACIOCINIO_LIVRE
    if nivel not in NIVEIS_RACIOCINIO:
        log_warning(
            f"AGENTE_RACIOCINIO='{nivel}' é inválido (aceitos: {', '.join(NIVEIS_RACIOCINIO)}). Usando '{RACIOCINIO_LIVRE}'."
        )
        return None
    return None if nivel == RACIOCINIO_LIVRE else nivel


def schema_banco() -> str | None:
    """Schema das tabelas no Postgres (Supabase do GestorGov: gestorgov). None no SQLite."""
    return os.getenv("DATABASE_SCHEMA", "gestorgov") if os.getenv("DATABASE_URL") else None


def criar_banco(arquivo_banco: str | None = None) -> PostgresDb | SqliteDb:
    """Postgres quando DATABASE_URL estiver definida (produção); SQLite local nos demais casos."""
    url = os.getenv("DATABASE_URL")
    if url and not arquivo_banco:
        # O Supabase fornece "postgresql://..."; o SQLAlchemy precisa do driver psycopg explícito.
        url = url.replace("postgres://", "postgresql://", 1).replace("postgresql://", "postgresql+psycopg://", 1)
        # create_schema=False: o schema já existe (migration supabase/gestorgov) e o papel do servidor
        # só tem permissão DENTRO dele, não para criar schemas no banco.
        # PostgresDbAgente: o mesmo do Agno, com as listas de sessões mais leves (agente/listas.py).
        return PostgresDbAgente(db_url=url, db_schema=schema_banco(), create_schema=False)
    PASTA_DADOS.mkdir(exist_ok=True)
    return SqliteDb(db_file=arquivo_banco or str(PASTA_DADOS / "sessoes.db"))


def _pensamentos() -> bool:
    """Guardar o resumo do raciocínio do modelo em cada resposta (AGENTE_PENSAMENTOS, padrão sim): é o porquê
    de cada decisão no rastreamento da conversa do painel. Não aparece para o servidor."""
    return os.getenv("AGENTE_PENSAMENTOS", "sim").strip().lower() in ("sim", "1", "true")


def _modelo(perfil: Perfil | None = None) -> Gemini:
    """O modelo do agente (escolhido na fábrica) ou o padrão do servidor (AGENTE_MODELO). Sem perfil (o do
    Learning), sem o resumo do raciocínio."""
    return Gemini(
        id=(perfil.modelo if perfil else None) or os.getenv("AGENTE_MODELO", "gemini-3.6-flash"),
        # None (raciocínio livre): o modelo escolhe a profundidade conforme a mensagem.
        thinking_level=nivel_raciocinio(perfil.raciocinio if perfil else None),
        include_thoughts=bool(perfil) and _pensamentos(),
    )


def _instrucoes(perfil: Perfil):
    """As instruções do perfil + os exemplos aprovados e trechos de documentos desta resposta.

    O contexto chega em run_context.dependencies["calibracao"] (ver atendimento.responder) e entra só
    nas instruções desta resposta: não fica no histórico nem se repete nas mensagens seguintes.
    """

    def instrucoes(run_context=None) -> str:
        dependencias = (getattr(run_context, "dependencies", None) or {}) if run_context else {}
        # Numa equipe (agente/equipes.py), cada agente recebe o contexto calculado para ele.
        ctx = (dependencias.get("calibracao_por_agente") or {}).get(perfil.id) or dependencias.get("calibracao")
        return perfil.instrucoes() + conhecimento.formatar(ctx)

    return instrucoes


def _aprendizado(perfil: Perfil) -> dict:
    """O que o agente aprende com cada aluno (AGENTE_APRENDIZADO, ver agente/aprendizado.py).

    memoria: memórias automáticas (MemoryManager), em paralelo com a resposta, seguindo as instruções
    do perfil; voltam no contexto quando o mesmo contato conversa de novo. O modo agêntico (o modelo
    decidir chamar a ferramenta) quase nunca gravava: 0 memórias em produção.
    learning: o Learning do Agno (perfil do aluno, memórias e resumo da sessão), no lugar do anterior.
    """
    if aprendizado.modo() == "learning":
        return {"learning": aprendizado.maquina(_modelo(), perfil.memoria_instrucoes), "add_learnings_to_context": True}
    return {
        "memory_manager": MemoryManager(model=_modelo(), memory_capture_instructions=perfil.memoria_instrucoes),
        "update_memory_on_run": True,
        "add_memories_to_context": True,
    }


def montar_agente(perfil: Perfil, banco: PostgresDb | SqliteDb) -> Agent:
    return Agent(
        id=perfil.id,
        name=perfil.nome,
        # O que a recepção de uma equipe (agente/equipes.py) lê para escolher o agente.
        role=f"{perfil.cargo or perfil.nome}: {perfil.descricao}",
        model=_modelo(perfil),
        instructions=_instrucoes(perfil),
        tools=perfil.ferramentas(),
        # Skills do painel: o agente vê nome e descrição e lê o resto quando precisa (fábrica de agentes).
        skills=fabrica_recursos.skills_do_agente(perfil.skills_ids),
        db=banco,
        # nome_aluno: o nome de quem conversa (o servidor, no GestorGov); municipio_id: a prefeitura da conversa.
        session_state={"status": STATUS_EM_ATENDIMENTO, "acoes": [], "nome_aluno": "", "telefone": "", "municipio_id": None},
        **_aprendizado(perfil),
        add_history_to_context=True,
        num_history_runs=20,
        # Data e hora de Brasília em toda mensagem: prazos de contratos, filas e envios dependem dela.
        add_datetime_to_context=True,
        timezone_identifier="America/Sao_Paulo",
        markdown=False,
        # CPF e cartão mascarados antes do modelo; pedido de manipulação interrompe a resposta (agente/guardrails.py).
        pre_hooks=guardrails.guardrails(perfil.id, banco.db_engine, getattr(banco, "db_schema", None)),
        # Cada ferramenta usada vira um evento da Central ao vivo (agente/ao_vivo.py).
        tool_hooks=[ao_vivo.avisar_ferramenta],
    )


def _indexar_roteiro(agente_id: str, texto: str, enviado_por: str = "painel") -> None:
    try:
        conhecimento.indexar_roteiro(agente_id, texto, enviado_por)
    except Exception as erro:  # sem embedding ou sem Storage: o roteiro inteiro continua nas instruções
        log_warning(f"Roteiro de {agente_id} não foi vetorizado: {type(erro).__name__}: {erro}")


def _indexar_em_segundo_plano(agente_id: str, texto: str) -> None:
    import threading

    threading.Thread(target=_indexar_roteiro, args=(agente_id, texto), daemon=True).start()


def _indexar_roteiros(em_segundo_plano: bool) -> None:
    """Vetoriza a versão vigente do roteiro de cada agente (só se mudou) e a cada versão salva no painel."""
    import threading

    def todos():
        for perfil_id in list(perfis.PERFIS):  # cópia: a fábrica de agentes pode criar um no meio
            _indexar_roteiro(perfil_id, base.obter(perfil_id).texto(), "sistema (versão vigente)")

    base.ao_salvar(_indexar_em_segundo_plano)
    if em_segundo_plano:
        threading.Thread(target=todos, daemon=True).start()
    else:
        todos()


def criar_agentes(arquivo_banco: str | None = None) -> dict[str, Agent]:
    """Todos os agentes do ecossistema, no mesmo banco. A base de conhecimento de cada um mora nele."""
    banco = criar_banco(arquivo_banco)
    base.iniciar(banco.db_engine, schema_banco() if not arquivo_banco else None)
    conhecimento.iniciar(banco.db_engine, schema_banco() if not arquivo_banco else None)
    fabrica.iniciar(banco.db_engine, schema_banco() if not arquivo_banco else None)  # o que foi salvo no painel
    equipes.iniciar(banco.db_engine, schema_banco() if not arquivo_banco else None)
    usuarios.iniciar(banco.db_engine, schema_banco() if not arquivo_banco else None)  # quem pode o quê no painel
    canal.iniciar(banco.db_engine, schema_banco() if not arquivo_banco else None)  # quem atende pela Unnichat
    alertas.iniciar(banco.db_engine, schema_banco() if not arquivo_banco else None)  # baixas dos alertas da Central
    gestao.iniciar(banco.db_engine, schema_banco() if not arquivo_banco else None)  # o cadastro da prefeitura
    _indexar_roteiros(em_segundo_plano=True)  # o servidor sobe sem esperar os embeddings
    agentes = {perfil_id: montar_agente(perfil, banco) for perfil_id, perfil in perfis.PERFIS.items()}
    equipes.montar_todas(banco)  # em equipes.EQUIPES (Team do Agno, com Agents próprios)
    return agentes


def criar_agente(arquivo_banco: str | None = None, perfil_id: str = perfis.PADRAO) -> Agent:
    """Um agente só (terminal, testes e avaliações)."""
    banco = criar_banco(arquivo_banco)
    base.iniciar(banco.db_engine, schema_banco() if not arquivo_banco else None)
    conhecimento.iniciar(banco.db_engine, schema_banco() if not arquivo_banco else None)
    fabrica.iniciar(banco.db_engine, schema_banco() if not arquivo_banco else None)
    gestao.iniciar(banco.db_engine, schema_banco() if not arquivo_banco else None)
    if conhecimento.modo_roteiro() == "busca":  # antes da primeira mensagem, o roteiro precisa estar indexado
        _indexar_roteiros(em_segundo_plano=False)
    return montar_agente(perfis.obter(perfil_id), banco)
