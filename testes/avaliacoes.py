"""Avaliações do agente com o Agno (tela Evaluation do AgentOS).

Grupos:
- script:   respostas do script de atendimento (Accuracy) e ferramenta certa (Reliability).
- cadastro: alunos FICTÍCIOS em situações reais (não encontrado, e-mail diferente do da compra,
            aluno da pós, pagamento pendente, aprovado, cartão recusado, pix vencido, estorno, dois
            e-mails no telefone, aula não encontrada).
            A resposta do Data Gateway é simulada; o resumo das compras roda o código de verdade.
- fluidez:  conversas de várias mensagens, avaliadas inteiras (saudação só no começo, sem repetir
            orientação, mensagens curtas, uso do contexto).
- limites e intencao: fora do atendimento, guardrails e transferência só quando o aluno quer.
- humanas:  o gold e o bad dataset do agente (agente/datasets.py): avaliações da equipe APROVADAS na
            Calibração do painel. A conversa é refeita até a resposta avaliada; o gabarito é a resposta
            aprovada e, num 👎, a resposta original é o erro que não pode voltar. Os problemas marcados
            viram regra de ferramenta (deveria / não deveria transferir). Vale para qualquer agente
            (--agente <id>); os casos escritos neste arquivo valem só para o onboarding. Limite: o
            cadastro aqui é simulado, então casos que dependiam dos dados reais do aluno podem divergir.

Os resultados vão para o banco do AgentOS (tela Evaluation). As conversas geradas aqui ficam num
banco à parte (dados/avaliacoes_sessoes.db), fora dos indicadores do painel. A base de conhecimento
usada é a vigente (a mesma editada no painel).

Uso (na pasta do projeto):
  .venv\\Scripts\\python -m testes.avaliacoes                 (todos os grupos)
  .venv\\Scripts\\python -m testes.avaliacoes cadastro fluidez
  .venv\\Scripts\\python -m testes.avaliacoes humanas --agente onboarding
  .venv\\Scripts\\python -m testes.avaliacoes --sem-humanas   (o que a rotina diária roda)

Na rotina diária, o dataset da Calibração de cada agente publicado roda pela fábrica de agentes
(agente/fabrica_recursos.py), junto dos casos de teste do agente: uma avaliação só, com o cadastro real.
"""

import sys
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta

from agno.eval.accuracy import AccuracyEval
from agno.eval.reliability import ReliabilityEval
from agno.models.google import Gemini

from agente import base, cadastro, conhecimento, datasets, perfis
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
    sem_ferramentas: list[str] = field(default_factory=list)  # chamadas proibidas (ex.: transferir sem o aluno querer)
    telefone: str = ""
    nome_aluno: str = ""
    conversa_inteira: bool = False  # avalia a conversa toda, e não só a última resposta


# ───────── Alunos fictícios (linhas como o Data Gateway devolveria) ─────────

def _compra(email, telefone, nome, produto, grupo, status="approved", eh_receita=True, dia="2026-10-10", ciclo=None,
            meio="credit_card", plataforma="guru", desfecho=None, **extra):
    return {"id": f"{email}-{produto}-{dia}", "email": email, "telefone": telefone, "primeiro_nome": nome,
            "produto": produto, "grupo": grupo, "status": status, "eh_receita": eh_receita,
            "data_pedido_dia": dia, "confirmed_date": dia if eh_receita else None, "desfecho_dia": desfecho,
            "platform": plataforma, "payment_method": meio, "installments_cycle": ciclo,
            "motivo_estorno": None, "tmb_situacao": None, "tmb_situacao_em": None,
            "tmb_parcelas_em_atraso": None, "tmb_atraso_desde": None, **extra}


def _dias_atras(n: int) -> str:
    """Datas relativas a hoje: as tentativas não concluídas só valem nos últimos 30 dias."""
    return (date.today() - timedelta(days=n)).isoformat()


ESCOLA = ("Escola Contábil PRO", "Escola Contábil")
POS_RT = ("Pós-Graduação em Reforma Tributária e Prática Fiscal", "Pós RT")
LINHAS_DG = {
    ("telefone", "1100000003"): [_compra("carlos.teste@gmail.com", "1100000003", "Carlos", *POS_RT, dia="2026-10-01")],
    ("telefone", "1100000002"): [_compra("joana.nova@outlook.com", "1100000002", "Joana", *ESCOLA)],
    ("email", "joana.nova@outlook.com"): [_compra("joana.nova@outlook.com", "1100000002", "Joana", *ESCOLA)],
    ("telefone", "1100000004"): [_compra("bruna.teste@gmail.com", "1100000004", "Bruna", *POS_RT, status="billet_printed", eh_receita=False, dia="2026-10-18", meio="billet")],
    ("telefone", "1100000005"): [_compra("paulo.teste@gmail.com", "1100000005", "Paulo", *ESCOLA, status="refunded", eh_receita=False, dia="2026-09-02",
                                         desfecho="2026-09-05",
                                         motivo_estorno="ARREPENDIMENTO | Aluno desistiu dentro dos 7 dias")],
    ("telefone", "1100000006"): [_compra("ana.teste@gmail.com", "1100000006", "Ana", *ESCOLA),
                                 _compra("marcos.teste@gmail.com", "1100000006", "Marcos", *POS_RT)],
    # Pagamento: cartão recusado ontem (no Guru chega como "canceled"); pix vencido; pix aprovado.
    ("telefone", "1100000011"): [_compra("caio.teste@gmail.com", "1100000011", "Caio", *ESCOLA, status="canceled",
                                         eh_receita=False, dia=_dias_atras(1), desfecho=_dias_atras(1))],
    ("telefone", "1100000012"): [_compra("vera.teste@gmail.com", "1100000012", "Vera", *POS_RT, status="expired",
                                         eh_receita=False, dia=_dias_atras(3), meio="pix", desfecho=_dias_atras(2))],
    ("telefone", "1100000013"): [_compra("davi.teste@gmail.com", "1100000013", "Davi", *ESCOLA, dia=_dias_atras(2),
                                         meio="pix"),
                                 # tentativa recusada ANTES da aprovação do mesmo produto: não deve aparecer
                                 _compra("davi.teste@gmail.com", "1100000013", "Davi", *ESCOLA, status="canceled",
                                         eh_receita=False, dia=_dias_atras(3), desfecho=_dias_atras(3))],
    # Boleto parcelado (TMB) com duas parcelas em aberto, ainda "Adimplente" (o TMB só marca perto de 30 dias).
    ("telefone", "1100000014"): [_compra("rui.teste@gmail.com", "1100000014", "Rui", *POS_RT, dia="2026-05-10",
                                         meio="boleto", plataforma="tmb", tmb_situacao="Adimplente",
                                         tmb_situacao_em=_dias_atras(2), tmb_parcelas_em_atraso=2,
                                         tmb_atraso_desde=_dias_atras(20))],
}

AULAS = [{"curso_slug": "escola-contabil", "documento": "20.01 Reforma Tributária: análise da LC 227/2026",
          "aula": "Reforma Tributária: Análise dos Principais Pontos da Lei Complementar N° 227/2026",
          "trecho": "Estrutura de arrecadação, obrigações e penalidades do IBS e da CBS…", "distancia": 0.21}]


def _area(**dados) -> dict:
    padrao = {"nome": "Aluno Teste", "email_mascarado": "al***@gmail.com", "encontrado_por": ["telefone"],
              "email_informado_e_o_atual": False, "tem_conta": True, "email_confirmado": True,
              "ultimo_acesso": "2026-10-15", "senha_sincronizada_memberkit": True, "email_divergente_no_login": False,
              "cursos": [], "matriculas": [], "falhas_memberkit_30d": []}
    padrao.update(dados)
    return {"encontrados": 1, "alunos": [padrao]}


# Área do aluno (o que public.agente_aluno devolveria), pela chave do telefone.
AREA = {
    "1100000007": _area(nome="Lia Teste", tem_conta=False, email_confirmado=False, ultimo_acesso=None,
                        cursos=[{"curso_slug": "escola-contabil", "curso": "Escola Contábil", "acesso_ate": "2027-10-10",
                                 "vitalicio": False, "contrato_pendente": False, "trancado": False}]),
    "1100000008": _area(nome="Bruno Teste",
                        cursos=[{"curso_slug": "pos-dp", "curso": "Pós em Departamento Pessoal", "acesso_ate": "2028-10-01",
                                 "vitalicio": False, "contrato_pendente": True, "trancado": True}]),
    "1100000010": _area(nome="Rita Teste",
                        cursos=[{"curso_slug": "escola-contabil", "curso": "Escola Contábil", "acesso_ate": "2026-08-01",
                                 "vitalicio": False, "contrato_pendente": False, "trancado": False}]),
}


def _simular_fontes() -> None:
    """Simula as respostas das fontes (o resumo das compras roda o código de verdade) e a busca de aulas.
    A área do aluno só "existe" para os telefones de AREA; nos demais o bloco vem null, como sem a fonte."""
    cadastro.disponivel = lambda: True
    cadastro.compras_disponivel = lambda: True
    cadastro.area_disponivel = lambda: True
    cadastro.aulas_disponivel = lambda: True
    cadastro._buscar = lambda filtro, valor: LINHAS_DG.get((filtro, valor), [])
    cadastro._area = lambda telefone, email: AREA.get(cadastro.chave_telefone(telefone) or "")
    cadastro.buscar_conteudo = lambda pergunta, curso_slug=None, limite=5: AULAS


# ───────── Casos ─────────

# Casos escritos à mão para o agente padrão (o assistente de implantação). Os do projeto base (alunos do
# Contabilidade Facilitada) saíram; os do GestorGov entram aqui conforme forem escritos. As avaliações
# aprovadas na Calibração (grupo "humanas") continuam valendo para qualquer agente.
CASOS: list[Caso] = []

def _casos_humanos(banco, agente_id: str) -> list[Caso]:
    """Gold e bad dataset do agente (avaliações aprovadas na Calibração; agente/datasets.py) como casos do
    grupo "humanas". O gabarito é a resposta aprovada; num 👎, a resposta original é o erro que não pode voltar."""
    casos = []
    for c in datasets.casos(banco.db_engine, schema_banco(), agente=agente_id):
        esperado = datasets.esperado_do_caso(c)
        tipo = "gold+bad" if c["resposta_ruim"] else "gold"
        casos.append(Caso(
            "humanas", f"Calibração #{c['id']} ({tipo}): {c['mensagens'][-1][:50]}", c["mensagens"], esperado,
            ferramentas=c["ferramentas_exigidas"], sem_ferramentas=c["ferramentas_proibidas"],
            telefone=c.get("telefone") or "",
        ))
    return casos


DIRETRIZES = datasets.DIRETRIZES


def _transcricao(caso: Caso, respostas: list[str]) -> str:
    linhas = []
    for mensagem, resposta in zip(caso.mensagens, respostas):
        linhas += [f"ALUNO: {mensagem}", f"ASSISTENTE: {resposta}"]
    return "\n".join(linhas)


def main(grupos: list[str], agente_id: str = perfis.PADRAO) -> int:
    _simular_fontes()  # antes de criar o agente: as ferramentas entram conforme as fontes disponíveis
    banco = criar_banco()
    agente = criar_agente(arquivo_banco=str(PASTA_DADOS / "avaliacoes_sessoes.db"), perfil_id=agente_id)
    base.iniciar(banco.db_engine, schema_banco())
    if conhecimento.modo_roteiro() == "busca":
        # O roteiro indexado tem de ser o vigente (o editado no painel), não o arquivo padrão.
        conhecimento.indexar_roteiro(agente_id, base.obter(agente_id).texto(), "avaliações")
    avaliador = Gemini(id=agente.model.id, thinking_level="medium")

    # Os casos escritos aqui usam o cadastro simulado da Luna: valem só para o onboarding. Os demais
    # agentes são medidos pelo gold e bad dataset da Calibração.
    selecionados = [c for c in CASOS if (not grupos or c.grupo in grupos) and agente_id == perfis.PADRAO]
    if not grupos or "humanas" in grupos:
        selecionados += _casos_humanos(banco, agente_id)
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
            ultima, _ = rodar(agente, sessao, mensagem, sessao, {"nome_aluno": caso.nome_aluno, "telefone": caso.telefone})
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
    if "--sem-humanas" in argumentos:
        # A madrugada: só os casos escritos aqui; o dataset da Calibração roda pela fábrica, para todos os agentes.
        argumentos.remove("--sem-humanas")
        argumentos = argumentos or sorted({c.grupo for c in CASOS})
    if agente_escolhido not in perfis.PERFIS:
        sys.exit(f"Agente desconhecido: {agente_escolhido}. Existem: {', '.join(perfis.PERFIS)}.")
    sys.exit(main(argumentos, agente_escolhido))
