"""Conversa com um agente do GestorGov pelo terminal (padrão: o assistente de implantação).

Uso: python chat.py [id-do-agente]   (ex.: python chat.py regulacao)

Comandos:
  /inatividade  simula o prazo sem resposta do aluno (INATIVIDADE_MINUTOS)
  /estado       mostra o status e as ações registradas
  /novo         inicia uma nova conversa
  /sair         encerra
"""

import sys
import uuid

from agente import perfis
from agente.agente import criar_agente
from agente.atendimento import rodar
from agente.ferramentas import STATUS_EM_ATENDIMENTO, STATUS_TRANSFERIDO

PERFIL = perfis.obter(sys.argv[1] if len(sys.argv) > 1 else perfis.PADRAO)
boas_vindas, encerramento = PERFIL.boas_vindas, PERFIL.encerramento_inatividade


def mostrar(remetente: str, texto: str) -> None:
    print(f"\n[{remetente}]\n{texto}\n")


def nova_conversa() -> tuple[str, str]:
    sessao = f"teste-{uuid.uuid4().hex[:8]}"
    print(f"\n=== Nova conversa (sessão {sessao}) ===")
    nome = input("Seu nome (Enter para deixar em branco): ").strip()
    mostrar("Assistente", boas_vindas(nome))
    return sessao, nome


def main() -> None:
    agente = criar_agente(perfil_id=PERFIL.id)
    sessao, nome = nova_conversa()

    while True:
        try:
            texto = input("[Você] > ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not texto:
            continue

        estado = agente.get_session_state(session_id=sessao) or {}
        status = estado.get("status", STATUS_EM_ATENDIMENTO)

        if texto == "/sair":
            break
        if texto == "/novo":
            sessao, nome = nova_conversa()
            continue
        if texto == "/estado":
            print(estado)
            continue
        if texto == "/inatividade":
            if status == STATUS_TRANSFERIDO:
                print("(conversa transferida para humano: não se encerra por inatividade)")
            elif status == STATUS_EM_ATENDIMENTO:
                mostrar("Assistente", encerramento())
                print("(atendimento encerrado por inatividade)")
                sessao, nome = nova_conversa()
            continue

        if status != STATUS_EM_ATENDIMENTO:
            print(f"(status '{status}': o agente não responde mais nesta conversa; use /novo)")
            continue

        resposta, _ = rodar(agente, sessao, texto, sessao, {"nome_aluno": nome})
        mostrar("Assistente", resposta.content or "")

        estado = agente.get_session_state(session_id=sessao) or {}
        if estado.get("status") != STATUS_EM_ATENDIMENTO:
            print(f"(ação registrada: {estado.get('acoes', [])[-1]})")


if __name__ == "__main__":
    main()
