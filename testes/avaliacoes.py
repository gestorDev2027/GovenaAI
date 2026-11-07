"""Avaliações do agente com o Agno (tela Evaluation do AgentOS).

Grupos:
- script:   respostas do script de atendimento (Accuracy) e ferramenta certa (Reliability).
- fluidez:  conversas de várias mensagens, avaliadas inteiras (saudação só no começo, sem repetir
            orientação, mensagens curtas, uso do contexto).
- limites e intencao: fora do escopo, guardrails e transferência só quando o servidor quer.
Os casos escritos neste arquivo valem só para o onboarding; os demais agentes têm os casos de teste da
fábrica (agente/fabrica_recursos.py).

Os resultados vão para o banco do AgentOS (tela Evaluation). As conversas geradas aqui ficam num
banco à parte (dados/avaliacoes_sessoes.db), fora dos indicadores do painel. A base de conhecimento
usada é a vigente (a mesma editada no painel).

Uso (na pasta do projeto):
  .venv\\Scripts\\python -m testes.avaliacoes                 (todos os grupos)
  .venv\\Scripts\\python -m testes.avaliacoes fluidez limites
"""

import sys
import uuid
from dataclasses import dataclass, field

from agno.eval.accuracy import AccuracyEval
from agno.eval.reliability import ReliabilityEval
from agno.models.google import Gemini

from agente import base, conhecimento, datasets, perfis
from agente.atendimento import rodar
from agente.agente import PASTA_DADOS, criar_agente, criar_banco, schema_banco

NOTA_MINIMA = datasets.NOTA_MINIMA


@dataclass
class Caso:
    grupo: str
    nome: str
    mensagens: list[str]
    esperado: str | None = None  # Accuracy: o que a(s) resposta(s) devem conter
    ferramentas: list[str] = field(default_factory=list)  # Reliability: chamadas obrigatórias
    sem_ferramentas: list[str] = field(default_factory=list)  # chamadas proibidas (ex.: transferir sem o servidor querer)
    telefone: str = ""
    nome_contato: str = ""
    conversa_inteira: bool = False  # avalia a conversa toda, e não só a última resposta


# ───────── Casos ─────────

# Casos escritos à mão para o agente padrão (o assistente de implantação), conforme forem escritos.
CASOS: list[Caso] = []

DIRETRIZES = datasets.DIRETRIZES


def _transcricao(caso: Caso, respostas: list[str]) -> str:
    linhas = []
    for mensagem, resposta in zip(caso.mensagens, respostas):
        linhas += [f"SERVIDOR: {mensagem}", f"ASSISTENTE: {resposta}"]
    return "\n".join(linhas)


def main(grupos: list[str], agente_id: str = perfis.PADRAO) -> int:
    banco = criar_banco()
    agente = criar_agente(arquivo_banco=str(PASTA_DADOS / "avaliacoes_sessoes.db"), perfil_id=agente_id)
    base.iniciar(banco.db_engine, schema_banco())
    if conhecimento.modo_roteiro() == "busca":
        # O roteiro indexado tem de ser o vigente (o editado no painel), não o arquivo padrão.
        conhecimento.indexar_roteiro(agente_id, base.obter(agente_id).texto(), "avaliações")
    avaliador = Gemini(id=agente.model.id, thinking_level="medium")

    # Os casos escritos aqui valem só para o onboarding.
    selecionados = [c for c in CASOS if (not grupos or c.grupo in grupos) and agente_id == perfis.PADRAO]
    print(f"Modelo: {agente.model.id} · raciocínio: {agente.model.thinking_level or 'livre'} · roteiro: {conhecimento.modo_roteiro()}")
    falhas, grupo_atual = 0, None
    tempo_total, tokens_total = 0.0, 0
    for caso in selecionados:
        if caso.grupo != grupo_atual:
            grupo_atual = caso.grupo
            print(f"\n== {grupo_atual} ==")
        sessao = f"aval-{uuid.uuid4().hex[:10]}"
        respostas, chamadas, ultima = [], [], None
        tempo, tokens = 0.0, 0
        for mensagem in caso.mensagens:
            # O mesmo caminho do atendimento real: com exemplos, documentos e (no modo busca) o roteiro.
            ultima, _ = rodar(agente, sessao, mensagem, sessao, {"nome_contato": caso.nome_contato, "telefone": caso.telefone})
            respostas.append(ultima.content or "")
            chamadas += [t.tool_name for t in (ultima.tools or [])]
            if ultima.metrics:
                tempo += ultima.metrics.duration or 0
                tokens += (ultima.metrics.input_tokens or 0) + (ultima.metrics.output_tokens or 0)
        tempo_total += tempo
        tokens_total += tokens

        problemas = []
        faltando = [f for f in caso.ferramentas if f not in chamadas]
        if caso.ferramentas:
            # Registro no AgentOS (última resposta); a checagem vale para a conversa inteira.
            ReliabilityEval(
                name=caso.nome, agent_response=ultima, expected_tool_calls=caso.ferramentas,
                allow_additional_tool_calls=True, db=banco,
            ).run(print_results=False)
            if faltando:
                problemas.append(f"não chamou {faltando}")
        proibidas = sorted({f for f in caso.sem_ferramentas if f in chamadas})
        if proibidas:
            problemas.append(f"chamou {proibidas} sem poder")
        nota = None
        if caso.esperado:
            texto = _transcricao(caso, respostas) if caso.conversa_inteira else respostas[-1]
            resultado = AccuracyEval(
                name=caso.nome, input=" / ".join(caso.mensagens), expected_output=caso.esperado,
                agent=agente, model=avaliador, additional_guidelines=DIRETRIZES, num_iterations=1, db=banco,
            ).run_with_output(output=texto, print_summary=False, print_results=False)
            nota = resultado.avg_score if resultado else None
            if nota is None or nota < NOTA_MINIMA:
                problemas.append(f"nota {nota}")
        falhas += bool(problemas)
        detalhe = f"nota {nota}" if nota is not None else ""
        if chamadas:
            detalhe += f"{' · ' if detalhe else ''}ferramentas: {sorted(set(chamadas))}"
        detalhe += f"{' · ' if detalhe else ''}{tempo:.1f}s · {tokens} tokens"
        print(f"{'FALHOU' if problemas else 'OK    '} {caso.nome} ({'; '.join(problemas) or detalhe})")
        if problemas:
            print("        última resposta:", (respostas[-1] or "")[:300].replace("\n", " "))

    print(f"\n{len(selecionados) - falhas} de {len(selecionados)} avaliações aprovadas. "
          f"Tempo do agente: {tempo_total:.0f}s · {tokens_total} tokens. Detalhes na tela Evaluation do AgentOS.")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    argumentos = sys.argv[1:]
    agente_escolhido = perfis.PADRAO
    if "--agente" in argumentos:
        posicao = argumentos.index("--agente")
        agente_escolhido = argumentos[posicao + 1]
        del argumentos[posicao:posicao + 2]
    if agente_escolhido not in perfis.PERFIS:
        sys.exit(f"Agente desconhecido: {agente_escolhido}. Existem: {', '.join(perfis.PERFIS)}.")
    sys.exit(main(argumentos, agente_escolhido))
