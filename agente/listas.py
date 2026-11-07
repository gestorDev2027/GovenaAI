"""Listas de conversas para o painel, sem baixar o que as telas não usam.

Cada resposta gravada (agno_runs.run_data) leva o histórico inteiro que o modelo recebeu (`messages`, com o
roteiro completo), os dados do provedor e os anexos do aluno: em 30 dias, 811 respostas somavam 70 MB, 95%
disso nesses campos. As telas de lista (Visão geral, Conversas, Central) usam só o texto da entrada, a
resposta, as ferramentas, as métricas e o raciocínio. Abrir uma conversa (get_session) e o agente
respondendo continuam lendo a resposta completa.

Antes, cada rota buscava as mesmas conversas uma vez por agente (a busca não filtra por agente no banco):
a Central fazia 8 buscas de até 400 conversas a cada atualização. `sessoes_recentes` busca uma vez e guarda
o resultado por alguns segundos, para os agentes e as telas que carregam juntas reaproveitarem.
"""

import threading
import time

from agno.db.base import SessionType
from agno.db.postgres import PostgresDb
from sqlalchemy import Text, cast, literal, select
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

# Campos da resposta que as listas não leem e pesam quase tudo (ver o docstring).
CAMPOS_FORA_DAS_LISTAS = ("messages", "model_provider_data")
ANEXOS_FORA_DAS_LISTAS = ("images", "audios", "videos", "files")

# Segundos que uma lista buscada fica guardada. Curto: a Central atualiza a cada poucos segundos e uma
# conversa nova aparece na atualização seguinte.
SEGUNDOS_GUARDADA = 5


class PostgresDbAgente(PostgresDb):
    """O PostgresDb do Agno com as listas de sessões (get_sessions) mais leves; o resto é o mesmo."""

    def _get_sessions_runs_data(self, sess, runs_table, session_ids):
        if not session_ids:
            return {}
        leve = cast(runs_table.c.run_data, JSONB)
        for campo in CAMPOS_FORA_DAS_LISTAS:
            leve = leve.op("-", return_type=JSONB)(literal(campo, type_=Text))
        for anexo in ANEXOS_FORA_DAS_LISTAS:
            leve = leve.op("#-", return_type=JSONB)(cast(literal("{input," + anexo + "}"), ARRAY(Text)))
        stmt = (
            select(runs_table.c.session_id, leve.label("run_data"))
            .where(runs_table.c.session_id.in_(session_ids))
            .order_by(runs_table.c.run_index.asc(), runs_table.c.created_at.asc())
        )
        por_sessao: dict[str, list] = {}
        for session_id, run_data in sess.execute(stmt).fetchall():
            por_sessao.setdefault(session_id, []).append(run_data)
        return por_sessao


_guardadas: dict[tuple, tuple[float, list]] = {}
_travas: dict[tuple, threading.Lock] = {}
_trava_geral = threading.Lock()


def sessoes_recentes(db, tipo: SessionType, desde_epoch: int | None, limite: int,
                     ate_epoch: int | None = None, por_atividade: bool = False) -> list:
    """As sessões mais recentes de um tipo (todas as de agente ou todas as de equipe), das mais novas para
    as mais antigas. Quem chama separa as de cada agente. A mesma busca feita ao mesmo tempo por várias
    rotas espera a primeira e usa o resultado dela.

    Por padrão, as criadas desde `desde_epoch`. Com por_atividade, as que tiveram atividade no período
    (última atualização a partir de `desde_epoch` e criadas até `ate_epoch`): uma conversa que começou
    ontem e foi encerrada hoje entra em hoje (a Central conta o que aconteceu no período)."""
    if por_atividade:
        return _guardada((id(db), tipo, desde_epoch, ate_epoch, limite, True),
                         lambda: _por_atividade(db, tipo, desde_epoch, ate_epoch, limite))
    return _guardada((id(db), tipo, desde_epoch, limite),
                     lambda: db.get_sessions(session_type=tipo, start_timestamp=desde_epoch, sort_by="updated_at",
                                             sort_order="desc", limit=limite))


def _por_atividade(db, tipo: SessionType, desde_epoch: int | None, ate_epoch: int | None, limite: int) -> list:
    # O Agno só filtra pela criação: pede as mais recentemente atualizadas e corta pela última atualização.
    sessoes = db.get_sessions(session_type=tipo, end_timestamp=ate_epoch, sort_by="updated_at",
                              sort_order="desc", limit=limite)
    if desde_epoch is None:
        return sessoes
    return [s for s in sessoes if (getattr(s, "updated_at", None) or getattr(s, "created_at", None) or 0) >= desde_epoch]


def _guardada(chave: tuple, buscar) -> list:
    """O resultado de `buscar` guardado por SEGUNDOS_GUARDADA; quem pede a mesma chave ao mesmo tempo espera."""
    with _trava_geral:
        trava = _travas.setdefault(chave, threading.Lock())
    with trava:
        agora = time.monotonic()
        guardada = _guardadas.get(chave)
        if guardada and agora - guardada[0] < SEGUNDOS_GUARDADA:
            return guardada[1]
        sessoes = buscar()
        with _trava_geral:
            for velha in [c for c, (quando, _) in _guardadas.items()
                          if c != chave and agora - quando >= SEGUNDOS_GUARDADA]:
                _guardadas.pop(velha, None)
                _travas.pop(velha, None)
            _guardadas[chave] = (time.monotonic(), sessoes)
        return sessoes
