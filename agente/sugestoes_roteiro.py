"""Sugestões de atualização do roteiro a partir de um documento da base de conhecimento.

Quem sobe um documento novo (uma política, uma campanha) pede aqui o que ele muda no roteiro do agente. A IA compara o
documento com o roteiro em uso e devolve as mudanças propostas: alterar uma seção, criar uma seção nova ou tirar uma
seção, cada uma com o motivo e o trecho do documento que a justifica. Nada é gravado aqui: o painel mostra as
sugestões, a pessoa escolhe, edita e aplica, e só então o roteiro ganha uma versão nova (agente/base.py), com o
histórico para voltar atrás.

Em duas etapas, cada uma com resposta curta:
1. Plano: com o documento e o roteiro inteiro, a lista das seções afetadas (título, o que fazer, motivo). Pedir tudo
   numa resposta só (as seções reescritas junto) falhava em parte das vezes em 03/11: o modelo se perdia no meio de
   um JSON longo, repetia texto por minutos e não fechava a resposta.
2. Texto: para cada seção afetada, em paralelo, as edições daquela seção (alterar) ou o texto dela (nova).
   Junto, os exemplos aprovados na Calibração que contradizem o documento: eles não mudam com o roteiro e, numa
   pergunta parecida, puxariam o agente para a resposta antiga (em 03/11, três da Luna sobre a Black).

Na alteração, a IA não reescreve a seção: devolve só as edições ("trocar este trecho por este") e o servidor as
aplica sobre o texto original. Reescrita inteira mudava o que não devia (um caractere de um link do e-MEC numa seção
de 3.500 caracteres). Link que não está no documento nem no roteiro vira aviso na sugestão.

"Atualizar com IA" (sugerir_de_texto): o mesmo caminho a partir de uma frase escrita no painel, sem documento, para a
correção pequena (ex.: "o prazo do pedido de compra agora é de 15 dias"): a pessoa não procura a seção nem o lugar.
"""

import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from agno.agent import Agent
from agno.utils.log import log_warning
from pydantic import BaseModel, Field

from agente import armazenamento, base, conhecimento

MAX_DOCUMENTO = 60_000  # caracteres do documento que vão para a comparação
MAX_SECOES = 8  # seções afetadas tratadas por pedido
MENSAGENS_AUTOMATICAS = tuple(t.lower() for t in base.SECOES_DE_MENSAGEM)

CONTEXTO = """Você ajuda a equipe do GestorGov a manter a base de conhecimento de um agente de setor da Secretaria de Saúde.
Uma pessoa da equipe revisa cada sugestão antes de aplicar.

Regras do que muda:
- O documento é a informação mais recente. Quando o roteiro contradiz o documento, a correção é do roteiro.
- Só o que o documento cobre. Seções sem relação com ele não mudam, e nada se reescreve por estilo.
- O que o documento marca como uso interno não vira texto para o contato: vira instrução explícita para o agente não
  informar (ex.: "Não informe as datas da campanha ao contato.").
- O que o documento manda levar à equipe (consultar o suporte, encaminhar para análise, confirmar direito a benefício)
  vira regra de transferência, na seção de "Sempre transferir" do roteiro, se existir.
- Se o roteiro manda transferir algo que o documento agora explica (ex.: como emitir um certificado), sai da regra de
  transferência e a explicação entra na seção do assunto.
- As seções de mensagem automática (Boas-vindas, Encerramento por inatividade, Transferência para a equipe, Pedido fora
  do atendimento) não mudam, a menos que o documento trate exatamente delas."""

INSTRUCOES_PLANO = CONTEXTO + """

Agora: compare o <documento> com o <roteiro> e liste as seções do roteiro que precisam mudar. Não escreva o texto
novo; só o plano.
- acao "alterar" para uma seção existente; "nova" para um assunto que o roteiro não tem (prefira alterar); "remover"
  só quando a seção inteira ficou errada ou sem uso.
- Em titulo e depois_de, o título exatamente como aparece no roteiro, depois de "## ". Em nova, titulo é um nome curto
  do assunto, sem número; depois_de é a seção de conteúdo existente depois da qual a nova entra (vazio: antes da seção
  de "Sempre transferir").
- motivo: o que muda e por quê, em uma ou duas frases que a equipe entende.
- trecho_documento: a frase curta do documento que justifica.
- Se o documento não muda nada, devolva a lista vazia e explique no resumo.
- alertas: contradições que você não soube resolver, informação que faltou no documento e pontos que a pessoa decide."""

INSTRUCOES_EDICOES = CONTEXTO + """

Agora: escreva as edições de UMA seção do roteiro, a <secao>, conforme o <motivo>, usando o <documento>.
- Não reescreva a seção. Liste só o que muda: em trecho_atual, copie EXATAMENTE (letra por letra, com a pontuação) a
  frase ou linha da seção que muda; em texto_novo, o texto que entra no lugar (vazio para tirar a frase).
- Para acrescentar ao fim da seção, deixe trecho_atual vazio.
- Escreva como a seção já escreve: português do Brasil, frases curtas de WhatsApp, os mesmos marcadores ([NOME DO CONTATO]),
  "### " para subtópicos. Copie links, prazos, nomes de produtos e passos exatamente como no documento. Não invente link,
  prazo, preço ou nome."""

INSTRUCOES_NOVA = CONTEXTO + """

Agora: escreva o texto de uma seção NOVA do roteiro, conforme o <motivo>, usando o <documento>.
- Só o texto, sem a linha do título. Use "### " para subtópicos, como o roteiro.
- Escreva como o roteiro escreve (veja o <exemplo_de_secao>): português do Brasil, frases curtas de WhatsApp, os mesmos
  marcadores ([NOME DO CONTATO]). Copie links, prazos, nomes de produtos e passos exatamente como no documento. Não
  invente link, prazo, preço ou nome."""


INSTRUCOES_EXEMPLOS = """Você ajuda a equipe do GestorGov a manter os exemplos de um agente de setor da Secretaria de Saúde.
Cada <exemplo> é uma resposta aprovada que o agente imita quando o servidor pergunta algo parecido.
Liste os exemplos cuja resposta CONTRADIZ o <documento> novo: diz algo que o documento desmente, manda transferir o que o
documento agora explica, ou diz não ter uma informação que o documento traz. Não liste exemplo só porque é do mesmo assunto,
nem os que continuam certos. Em motivo, diga em uma frase o que a resposta diz e o que o documento diz."""


class Conflito(BaseModel):
    id: int = Field(description="O id do exemplo.")
    motivo: str


class Conflitos(BaseModel):
    exemplos: list[Conflito]


class Afetada(BaseModel):
    acao: Literal["alterar", "nova", "remover"]
    titulo: str = Field(description="O título da seção, exatamente como no roteiro (ou o da seção nova).")
    depois_de: str = Field(default="", description="Só em nova: o título da seção existente depois da qual ela entra.")
    motivo: str
    trecho_documento: str = Field(default="")


class Plano(BaseModel):
    resumo: str = Field(description="O que o documento muda no roteiro, em até 3 frases.")
    secoes: list[Afetada]
    alertas: list[str] = Field(default_factory=list)


class Edicao(BaseModel):
    trecho_atual: str = Field(default="", description="Cópia exata do trecho da seção que muda; vazio para acrescentar ao fim.")
    texto_novo: str = Field(default="", description="O que entra no lugar do trecho; vazio para tirar o trecho.")


class Edicoes(BaseModel):
    edicoes: list[Edicao]


class TextoSecao(BaseModel):
    texto: str = Field(description="O texto completo da seção nova, sem a linha do título.")


def _normalizar(titulo: str) -> str:
    sem_acento = unicodedata.normalize("NFD", titulo or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", sem_acento).strip().lower()


def secoes(texto: str) -> list[tuple[str, str]]:
    """As seções "## " do roteiro como (título, corpo), na mesma divisão do painel (painel/src/lib/roteiro.ts)."""
    saida: list[tuple[str, list[str]]] = []
    for linha in texto.split("\n"):
        if re.match(r"^##\s+", linha) and not linha.startswith("###"):
            saida.append((re.sub(r"^##\s+", "", linha), []))
        elif saida:
            saida[-1][1].append(linha)
    return [(titulo, "\n".join(linhas)) for titulo, linhas in saida]


def texto_do_documento(documento: dict) -> str:
    """O texto da versão: do arquivo original no bucket ou, sem ele (banco local), dos trechos em ordem."""
    caminho = documento.get("caminho") or ""
    if not caminho.startswith("(sem bucket)") and armazenamento.disponivel():
        try:
            return conhecimento.extrair_texto(armazenamento.baixar(caminho), documento["tipo_mime"]).strip()
        except Exception as erro:  # arquivo fora do bucket: os trechos ainda têm o texto
            log_warning(f"Sugestões do roteiro: arquivo de {documento['nome']} indisponível ({erro}); usando os trechos.")
    return juntar_trechos([(t["secao"], t["conteudo"]) for t in conhecimento.trechos_do_documento(documento["id"])])


def juntar_trechos(trechos: list[tuple[str | None, str]]) -> str:
    """O texto dos trechos em ordem, com o título de cada seção de volta (os trechos guardam a seção à parte) e sem a
    sobreposição (cada trecho começa com o fim do anterior da mesma seção, conhecimento.SOBREPOSICAO)."""
    partes: list[str] = []
    secao_atual, anterior = None, ""
    for secao, trecho in trechos:
        if secao != secao_atual:
            if secao:
                partes.append(f"## {secao}")
            secao_atual, anterior = secao, ""
        elif anterior:
            for tamanho in range(min(len(anterior), len(trecho), conhecimento.SOBREPOSICAO * 2), 19, -1):
                if trecho.startswith(anterior[-tamanho:]):
                    trecho = trecho[tamanho:].lstrip()
                    break
        if trecho:
            partes.append(trecho)
            anterior = trecho
    return "\n\n".join(partes).strip()


LINK = re.compile(r"https?://[^\s)\]\"'<>]+")


def _links(texto: str) -> set[str]:
    return {l.rstrip(".,;:!?") for l in LINK.findall(texto or "")}


def aplicar_edicoes(corpo: str, edicoes: list[Edicao]) -> tuple[str, list[str]]:
    """O corpo com as edições aplicadas sobre o texto original, e as que não acharam o trecho (ficam de fora)."""
    falhas: list[str] = []
    for edicao in edicoes:
        trecho, novo = edicao.trecho_atual.strip(), edicao.texto_novo.strip()
        if not trecho:
            if novo:
                corpo = corpo.rstrip() + "\n\n" + novo
            continue
        if trecho not in corpo:
            falhas.append(trecho[:120])
            continue
        corpo = corpo.replace(trecho, novo, 1)
    return re.sub(r"\n{3,}", "\n\n", corpo).strip(), falhas


TENTATIVAS = 3
# Uma resposta normal leva de 10 a 40 s. Se o modelo se perder (repetindo texto), o limite corta e a próxima
# tentativa costuma vir certa. Teto de tokens não serve: o raciocínio conta nele e cortava respostas normais.
SEGUNDOS_POR_TENTATIVA = 90


def _rodar(esquema: type[BaseModel], instrucoes: str, pedido: str):
    from agente.agente import _modelo

    for _ in range(TENTATIVAS):
        modelo = _modelo()
        modelo.timeout = SEGUNDOS_POR_TENTATIVA
        assistente = Agent(model=modelo, instructions=[instrucoes], output_schema=esquema, markdown=False, telemetry=False)
        try:
            resultado = assistente.run(pedido).content
        except Exception as erro:  # tempo esgotado ou falha da API
            log_warning(f"Sugestões do roteiro: {type(erro).__name__}: {str(erro)[:200]}; tentando de novo.")
            continue
        if isinstance(resultado, esquema):
            return resultado
        log_warning("Sugestões do roteiro: a IA não devolveu o formato esperado; tentando de novo.")
    raise RuntimeError("A IA não devolveu as sugestões no formato esperado. Tente de novo.")


def sugerir(documento_id: int, agente_id: str, nome_agente: str = "") -> dict:
    """As mudanças que o documento sugere no roteiro do agente. Levanta LookupError (documento) e ValueError."""
    documento = conhecimento.documento(documento_id)
    if not documento:
        raise LookupError("Documento não encontrado.")
    if documento["nome"] == conhecimento.ROTEIRO:
        raise ValueError("Este documento é o próprio roteiro.")
    if documento["status"] != "pronto":
        raise ValueError("O documento ainda não terminou de processar.")
    texto = texto_do_documento(documento)
    if not texto:
        raise ValueError("Não foi possível ler o texto do documento.")
    return _comparar(texto, documento["nome"], agente_id, nome_agente,
                     {"id": documento["id"], "nome": documento["nome"], "versao": documento["versao"]})


MAX_AJUSTE = 4000  # caracteres do ajuste escrito no painel


def sugerir_de_texto(texto: str, agente_id: str, nome_agente: str = "") -> dict:
    """O mesmo que `sugerir`, a partir de uma informação nova escrita no painel ("Atualizar com IA"), sem documento:
    quem atualiza escreve a frase e a IA acha onde ela entra no roteiro."""
    texto = (texto or "").strip()
    if len(texto) < 10:
        raise ValueError("Escreva a informação nova ou a correção (pelo menos uma frase).")
    if len(texto) > MAX_AJUSTE:
        raise ValueError(f"O ajuste passa de {MAX_AJUSTE:,} caracteres: para textos longos, envie um documento.".replace(",", "."))
    return _comparar(texto, "Ajuste escrito no painel", agente_id, nome_agente, {"id": None, "nome": "Ajuste escrito no painel", "versao": None})


def _comparar(texto: str, nome: str, agente_id: str, nome_agente: str, origem: dict) -> dict:
    alertas: list[str] = []
    if len(texto) > MAX_DOCUMENTO:
        texto = texto[:MAX_DOCUMENTO]
        alertas.append(f"O documento é longo: só os primeiros {MAX_DOCUMENTO:,} caracteres foram comparados.".replace(",", "."))
    documento = {"nome": nome}

    vigente = base.obter(agente_id).atual()
    roteiro = vigente["conteudo"]
    por_titulo = {_normalizar(t): (t, corpo) for t, corpo in secoes(roteiro)}
    bloco_documento = f"<documento nome=\"{documento['nome']}\">\n{texto}\n</documento>"

    plano = _rodar(Plano, INSTRUCOES_PLANO,
                   f"Agente: {nome_agente or agente_id}\n\n{bloco_documento}\n\n<roteiro>\n{roteiro}\n</roteiro>")
    alertas += [a for a in plano.alertas if a.strip()]

    # Cada seção afetada só uma vez; nova com título que já existe vira alteração dela.
    afetadas: list[tuple[Afetada, tuple[str, str] | None]] = []
    vistas: set[str] = set()
    for item in plano.secoes:
        existente = por_titulo.get(_normalizar(item.titulo))
        if item.acao == "nova" and existente:
            item.acao = "alterar"
        if item.acao in ("alterar", "remover") and not existente:
            alertas.append(f'A IA sugeriu {"mudar" if item.acao == "alterar" else "tirar"} a seção "{item.titulo}", '
                           "que não existe no roteiro.")
            continue
        chave = _normalizar(existente[0] if existente else item.titulo)
        if chave in vistas:
            continue
        vistas.add(chave)
        afetadas.append((item, existente))
    if len(afetadas) > MAX_SECOES:
        alertas.append(f"O documento afeta {len(afetadas)} seções: vieram as {MAX_SECOES} primeiras. Peça de novo depois de aplicar.")
        afetadas = afetadas[:MAX_SECOES]

    exemplo = next((corpo for t, corpo in por_titulo.values() if _normalizar(t) not in MENSAGENS_AUTOMATICAS and len(corpo) > 400), "")

    def escrever(par: tuple[Afetada, tuple[str, str] | None]) -> dict | None:
        item, existente = par
        titulo = existente[0] if existente else item.titulo.strip().lstrip("#").strip()
        atual = existente[1].strip() if existente else ""
        avisos: list[str] = []
        if item.acao == "remover":
            novo = ""
        elif item.acao == "alterar":
            resposta = _rodar(Edicoes, INSTRUCOES_EDICOES,
                              f"{bloco_documento}\n\n<motivo>\n{item.motivo}\n</motivo>\n\n<secao titulo=\"{titulo}\">\n{atual}\n</secao>")
            novo, falhas = aplicar_edicoes(atual, resposta.edicoes)
            if falhas:
                avisos.append(f"{len(falhas)} edição(ões) não acharam o trecho no roteiro e ficaram de fora: "
                              + "; ".join(f'"{f}"' for f in falhas))
            if novo == atual:
                alertas.append(f'Seção "{titulo}": a IA indicou mudança, mas não escreveu nenhuma edição aplicável.'
                               + (f" {avisos[0]}" if avisos else ""))
                return None
        else:
            resposta = _rodar(TextoSecao, INSTRUCOES_NOVA,
                              f"{bloco_documento}\n\n<motivo>\n{item.motivo}\n</motivo>\n\n<titulo>{titulo}</titulo>\n\n"
                              f"<exemplo_de_secao>\n{exemplo[:3000]}\n</exemplo_de_secao>")
            novo = resposta.texto.strip()
            if not novo:
                alertas.append(f'Seção nova "{titulo}": a IA não escreveu o texto.')
                return None
        # Link que não estava em lugar nenhum: a IA pode ter errado ao copiar.
        inventados = sorted(_links(novo) - _links(roteiro) - _links(texto))
        if inventados:
            avisos.append("Link que não está no documento nem no roteiro (confira antes de aplicar): " + ", ".join(inventados))
        depois = por_titulo.get(_normalizar(item.depois_de)) if item.acao == "nova" else None
        if depois and _normalizar(depois[0]).lstrip("0123456789. ").startswith("sempre transferir"):
            depois = None  # seção nova não fica depois das regras de transferência: entra antes delas
        if item.acao == "nova":
            titulo = re.sub(r"^\d+\.\s*", "", titulo)  # sem número: a numeração do roteiro não se repete
        return {
            "tipo": item.acao,
            "titulo": titulo,
            "depois_de": depois[0] if depois else None,
            "texto_atual": atual,
            "texto_novo": novo,
            "motivo": item.motivo.strip(),
            "trecho_documento": item.trecho_documento.strip(),
            "mensagem_automatica": _normalizar(titulo) in MENSAGENS_AUTOMATICAS,
            "avisos": avisos,
        }

    def escrever_com_falha(par):
        try:
            return escrever(par)
        except Exception as erro:  # uma seção que falhou não derruba as outras
            alertas.append(f'Seção "{par[0].titulo}": a IA não conseguiu escrever a sugestão ({erro}).')
            return None

    exemplos = {e["id"]: e for e in conhecimento.listar_exemplos(agente_id) if e.get("ativo")} if conhecimento.disponivel() else {}

    def conflitos() -> list[dict]:
        if not exemplos:
            return []
        lista = "\n\n".join(
            f"<exemplo id=\"{i}\">\nContato: {e['mensagem'][:400]}\nResposta aprovada: {e['resposta_ideal'][:600]}\n</exemplo>"
            for i, e in exemplos.items())
        try:
            resposta = _rodar(Conflitos, INSTRUCOES_EXEMPLOS, f"{bloco_documento}\n\n{lista}")
        except Exception as erro:
            alertas.append(f"Não foi possível conferir os exemplos da Calibração ({erro}).")
            return []
        vistos: set[int] = set()
        saida = []
        for c in resposta.exemplos:
            if c.id in exemplos and c.id not in vistos:
                vistos.add(c.id)
                e = exemplos[c.id]
                saida.append({"id": c.id, "mensagem": e["mensagem"], "resposta": e["resposta_ideal"], "motivo": c.motivo.strip()})
        return saida

    with ThreadPoolExecutor(max_workers=5) as execucao:
        exemplos_conflitantes = execucao.submit(conflitos)
        escritas = [s for s in execucao.map(escrever_com_falha, afetadas) if s]
        exemplos_conflitantes = exemplos_conflitantes.result()
    return {
        "documento": origem,
        "agente": agente_id,
        "versao_roteiro": vigente["versao"],
        "resumo": plano.resumo.strip(),
        "sugestoes": [{"id": i, **s} for i, s in enumerate(escritas, start=1)],
        # Exemplos aprovados que contradizem o documento: o painel oferece tirar de uso (não apaga).
        "exemplos_conflitantes": exemplos_conflitantes,
        "alertas": alertas,
    }
