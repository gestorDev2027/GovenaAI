"""Dados do aluno para o agente, sempre por funções dedicadas (nunca leitura de tabela).

Compras (nexa-DB / Data Gateway) — a primeira fonte configurada:
  1. API do Data Gateway: GET {DATAG_BASE_URL}/v1/recursos/agente_aluno_compras, X-API-Key: DATAG_API_KEY
  2. REST do Supabase:    POST {SUPABASE_NEXA_URL}/rest/v1/rpc/agente_aluno_compras (SUPABASE_NEXA_SERVICE_ROLE_KEY)

Área do aluno e busca de aulas (acesso-unico), com SUPABASE_ACESSO_URL + SUPABASE_ACESSO_SERVICE_ROLE_KEY:
  POST /rest/v1/rpc/agente_aluno            -> conta, cursos, acesso até quando, contrato, turma da pós
  POST /rest/v1/rpc/agente_buscar_conteudo  -> aulas mais próximas do assunto

As funções estão em supabase/: devolvem só o necessário (sem CPF, RG, endereço, valores).

E-mail de outra pessoa: no WhatsApp o telefone é conferido. Se o e-mail informado é de um cadastro com
outro telefone, a consulta não devolve compras, cursos nem datas (telefone_confere = false).
"""

import math
import os
import re
from datetime import date, datetime
from functools import lru_cache
from zoneinfo import ZoneInfo

import httpx
from agno.utils.log import log_warning

RECURSO_COMPRAS = os.getenv("DATAG_RECURSO_ALUNO", "agente_aluno_compras")
STATUS_PENDENTE = {"waiting_payment", "billet_printed"}
STATUS_REVERTIDO = {"refunded", "chargeback", "dispute"}
# Tentativas que não viraram compra. No Guru, cartão recusado chega como "canceled" (2.361 dos
# pedidos de cartão dos 30 dias até 23/10/2026, contra nenhum "failed").
STATUS_RECUSADO = {"canceled", "failed"}
STATUS_EXPIRADO = {"expired"}
STATUS_ABANDONADO = {"abandoned"}
DIAS_TENTATIVAS = 30  # tentativas não concluídas mais antigas que isso não vão ao agente
MAX_TENTATIVAS = 5
MEIOS_PAGAMENTO = {"credit_card": "cartao", "pix": "pix", "billet": "boleto", "boleto": "boleto"}
FUSO = ZoneInfo("America/Sao_Paulo")  # as datas das vendas estão nesse fuso

ORIENTACAO_OUTRO_TELEFONE = (
    "Este e-mail é de um cadastro com outro telefone. Não cite compras, cursos, datas nem situação. Pode orientar "
    "o cadastro de senha pelo link, com esse e-mail (só quem tem acesso ao e-mail consegue usar). Para detalhes da "
    "matrícula ou da compra, ofereça passar para a equipe, que confirma a identidade."
)
# Da área do aluno achada só pelo e-mail, sai o que basta para orientar o acesso.
CAMPOS_SEM_TELEFONE = ("email_mascarado", "encontrado_por", "email_informado_e_o_atual", "tem_conta", "email_confirmado")

# Mesmo espaço vetorial do corpus do acesso-unico: gemini-embedding-2, 1536, normalizado.
MODELO_EMBEDDING = "gemini-embedding-2"
DIMENSOES = 1536


def _env(nome: str) -> str:
    return os.getenv(nome, "").strip()


# ───────── Disponibilidade das fontes ─────────

def _usa_gateway() -> bool:
    return bool(_env("DATAG_BASE_URL") and _env("DATAG_API_KEY"))


def compras_disponivel() -> bool:
    return _usa_gateway() or bool(_env("SUPABASE_NEXA_URL") and _env("SUPABASE_NEXA_SERVICE_ROLE_KEY"))


def area_disponivel() -> bool:
    return bool(_env("SUPABASE_ACESSO_URL") and _env("SUPABASE_ACESSO_SERVICE_ROLE_KEY"))


def disponivel() -> bool:
    return compras_disponivel() or area_disponivel()


def aulas_disponivel() -> bool:
    return area_disponivel()


# ───────── Utilitários ─────────

def chave_telefone(telefone: str | None) -> str | None:
    """DDD + 8 últimos dígitos (10 dígitos), o formato de telefone das vendas."""
    d = re.sub(r"\D", "", telefone or "")
    if len(d) in (12, 13) and d.startswith("55"):
        d = d[2:]
    return d[:2] + d[-8:] if len(d) in (10, 11) else None


def mascarar_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    usuario, dominio = email.split("@", 1)
    return f"{usuario[:2]}***@{dominio}"


def _rpc(projeto: str, funcao: str, corpo: dict):
    url, chave = _env(f"SUPABASE_{projeto}_URL"), _env(f"SUPABASE_{projeto}_SERVICE_ROLE_KEY")
    # Chave nova do Supabase (sb_secret_...) não é JWT: vai só no apikey (como Bearer, o Supabase pode
    # recusar com "Invalid JWT"). A service_role antiga é JWT e vai nos dois.
    cabecalhos = {"apikey": chave} if chave.startswith("sb_") else {"apikey": chave, "Authorization": f"Bearer {chave}"}
    resposta = httpx.post(f"{url.rstrip('/')}/rest/v1/rpc/{funcao}", json=corpo, headers=cabecalhos, timeout=20)
    resposta.raise_for_status()
    return resposta.json()


# ───────── Compras ─────────

def _buscar(filtro: str, valor: str) -> list[dict]:
    """Linhas de compra por um filtro ('email' ou 'telefone')."""
    if _usa_gateway():
        resposta = httpx.get(
            f"{_env('DATAG_BASE_URL').rstrip('/')}/v1/recursos/{RECURSO_COMPRAS}",
            params={filtro: valor, "limit": 100},
            headers={"X-API-Key": _env("DATAG_API_KEY")},
            timeout=15,
        )
        resposta.raise_for_status()
        corpo = resposta.json()
        if isinstance(corpo, list):
            return corpo
        return corpo.get("items") or corpo.get("itens") or corpo.get("data") or []
    return _rpc("NEXA", "agente_aluno_compras", {f"p_{filtro}": valor}) or []


def _situacao(linha: dict) -> str:
    status = linha.get("status")
    if linha.get("eh_receita"):
        return "aprovada"
    if status in STATUS_PENDENTE:
        return "pagamento_pendente"
    if status in STATUS_REVERTIDO:
        return "estornada_ou_contestada"
    if status in STATUS_RECUSADO:
        return "recusada_ou_cancelada"
    if status in STATUS_EXPIRADO:
        return "expirada_sem_pagamento"
    if status in STATUS_ABANDONADO:
        return "checkout_nao_finalizado"
    return "nao_concluida"


def _meio_pagamento(linha: dict) -> str | None:
    """cartao, pix, boleto ou boleto_parcelado (TMB); None quando o checkout não chegou a escolher."""
    if linha.get("platform") == "tmb":
        return "boleto_parcelado"
    return MEIOS_PAGAMENTO.get(linha.get("payment_method") or "")


def _tmb(linha: dict) -> dict | None:
    """Situação do contrato do boleto parcelado (TMB), do último aviso do Financeiro do TMB. Só nas
    compras do TMB. Campos vazios = sem aviso recente (contrato antigo), o que NÃO quer dizer em dia."""
    if linha.get("platform") != "tmb":
        return None
    situacao = {
        "situacao": linha.get("tmb_situacao"),  # Adimplente, Inadimplente ou Quitado
        "situacao_em": linha.get("tmb_situacao_em"),
        "parcelas_em_atraso": linha.get("tmb_parcelas_em_atraso"),
        "atraso_desde": linha.get("tmb_atraso_desde"),  # vencimento da parcela mais antiga em aberto
    }
    return situacao if any(v is not None for v in situacao.values()) else {"sem_informacao_recente": True}


def _recente(dia, hoje: date) -> bool:
    try:
        return (hoje - date.fromisoformat(str(dia)[:10])).days <= DIAS_TENTATIVAS
    except ValueError:
        return False


def _resumo_compras(telefone: str | None, email: str | None) -> dict:
    chave = chave_telefone(telefone)
    linhas, encontrado_por = [], None
    if email:
        linhas, encontrado_por = _buscar("email", email), "email"
    if not linhas and chave:
        linhas, encontrado_por = _buscar("telefone", chave), "telefone"
    if not linhas:
        return {"encontrado": False, "pessoas": 0}
    if encontrado_por == "email" and chave and not any(l.get("telefone") == chave for l in linhas):
        return {"encontrado": True, "encontrado_por": "email", "telefone_confere": False,
                "emails_das_compras": [mascarar_email(email)], "orientacao": ORIENTACAO_OUTRO_TELEFONE}

    emails = sorted({(l.get("email") or "").lower() for l in linhas if l.get("email")})
    if len(emails) > 1 and encontrado_por == "telefone":
        # Telefone compartilhado: nenhum dado sai até o aluno dizer qual e-mail é o dele.
        return {"encontrado": True, "encontrado_por": "telefone", "pessoas": len(emails)}
    compras = sorted(
        (
            {
                "produto": l.get("produto"),
                "grupo": l.get("grupo"),
                "situacao": _situacao(l),
                "meio_pagamento": _meio_pagamento(l),
                "data_pedido": l.get("data_pedido_dia"),
                "data_confirmacao": l.get("confirmed_date"),  # pagamento confirmado (só na aprovada)
                "data_desfecho": l.get("desfecho_dia"),  # estorno, recusa, expiração ou abandono
                "renovacao_automatica": str(l.get("installments_cycle") or "") not in ("", "1"),
                "email_da_compra": mascarar_email(l.get("email")),
                # Anotação do time na Guru ao estornar, já mascarada na fonte: para entender o caso e
                # levar à transferência, nunca para ler ao aluno.
                "motivo_estorno_interno": l.get("motivo_estorno"),
                "tmb": _tmb(l),
            }
            for l in linhas
        ),
        key=lambda c: str(c["data_confirmacao"] or c["data_pedido"] or ""),
        reverse=True,
    )
    concluidas = {"aprovada", "pagamento_pendente", "estornada_ou_contestada"}
    hoje = datetime.now(FUSO).date()
    # "Paguei e não liberou": a tentativa recusada, expirada ou não finalizada explica o caso, em vez
    # de a compra simplesmente não aparecer. Só as recentes, e nunca as de um produto aprovado depois.
    aprovadas_em = {c["grupo"]: str(c["data_confirmacao"] or "") for c in compras if c["situacao"] == "aprovada"}
    tentativas = [
        c for c in compras
        if c["situacao"] not in concluidas and _recente(c["data_pedido"], hoje)
        and str(c["data_pedido"] or "") > aprovadas_em.get(c["grupo"], "")
    ][:MAX_TENTATIVAS]
    # Campos que só existem em parte das compras (estorno, TMB) não vão vazios ao agente.
    opcionais = ("motivo_estorno_interno", "tmb")
    compras = [{k: v for k, v in c.items() if not (k in opcionais and v is None)} for c in compras]
    tentativas = [{k: v for k, v in c.items() if not (k in opcionais and v is None)} for c in tentativas]
    nomes = sorted({l.get("primeiro_nome") for l in linhas if l.get("primeiro_nome")})
    return {
        "encontrado": True,
        "encontrado_por": encontrado_por,
        "pessoas": len(emails) or 1,
        "primeiro_nome": nomes[0] if len(nomes) == 1 else None,
        # None quando o aluno não informou e-mail (não há o que comparar).
        "email_informado_e_o_da_compra": (email in emails) if email else None,
        "emails_das_compras": [mascarar_email(e) for e in emails],
        "compras": [c for c in compras if c["situacao"] in concluidas][:15],
        "tentativas_nao_concluidas": tentativas,
    }


# ───────── Área do aluno ─────────

def _area(telefone: str | None, email: str | None) -> dict:
    resultado = _rpc("ACESSO", "agente_aluno", {"p_telefone": telefone or None, "p_email": email or None}) or {}
    if (resultado.get("encontrados") or 0) > 1 and not email:
        # Mais de um cadastro no telefone: nenhum dado sai até o aluno dizer qual e-mail é o dele.
        return {"encontrados": resultado["encontrados"]}
    return resultado


def _proteger_area(resultado: dict | None, telefone: str | None) -> dict | None:
    """Cadastro achado só pelo e-mail, com o telefone do WhatsApp conhecido: só o necessário para o acesso."""
    if not resultado or not chave_telefone(telefone) or "alunos" not in resultado:
        return resultado
    alunos = [
        aluno if "telefone" in (aluno.get("encontrado_por") or [])
        else {**{c: aluno.get(c) for c in CAMPOS_SEM_TELEFONE}, "telefone_confere": False,
              "orientacao": ORIENTACAO_OUTRO_TELEFONE}
        for aluno in resultado["alunos"] or []
    ]
    return {**resultado, "alunos": alunos}


def consultar(telefone: str | None = None, email: str | None = None, compras: bool = True, area: bool = True) -> dict:
    """Junta as fontes configuradas e escolhidas para o agente (compras e/ou área do aluno). Cada bloco é None
    quando a fonte não está configurada ou o agente não a usa."""
    email = (email or "").strip().lower() or None
    saida: dict = {"compras": None, "area_do_aluno": None}
    if compras and compras_disponivel():
        saida["compras"] = _resumo_compras(telefone, email)
    if area and area_disponivel():
        saida["area_do_aluno"] = _proteger_area(_area(telefone, email), telefone)
    return saida


# ───────── Busca de aulas ─────────

@lru_cache(maxsize=1)
def _cliente_genai():
    from google import genai

    return genai.Client()


def _embedding(texto: str) -> list[float]:
    from google.genai import types

    resposta = _cliente_genai().models.embed_content(
        model=MODELO_EMBEDDING,
        contents=texto,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY", output_dimensionality=DIMENSOES),
    )
    vetor = list(resposta.embeddings[0].values)
    norma = math.sqrt(sum(x * x for x in vetor)) or 1.0
    return [x / norma for x in vetor]


def buscar_conteudo(pergunta: str, curso_slug: str | None = None, limite: int = 5) -> list[dict]:
    vetor = "[" + ",".join(f"{x:.7f}" for x in _embedding(pergunta)) + "]"
    linhas = _rpc(
        "ACESSO", "agente_buscar_conteudo", {"p_embedding": vetor, "p_curso": curso_slug or None, "p_limite": limite}
    ) or []
    return [{**l, "distancia": round(l.get("distancia") or 0, 3)} for l in linhas]


def aviso_indisponivel(erro: Exception) -> str:
    log_warning(f"Consulta de dados do aluno falhou: {type(erro).__name__}: {erro}")
    return "A consulta não está disponível agora. Siga sem esses dados e, se o caso depender deles, transfira."
