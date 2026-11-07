"""Apostilas e brindes físicos: o que o Hub de apostilas (projeto cf-apostilas do Supabase) sabe das compras do aluno.

O Hub recebe as compras da Guru e decide, pelas regras e cotas das campanhas, quem tem direito à apostila do
Exame CFC ou ao livro Guia Prático da Reforma Tributária; depois acompanha o envio até a entrega. O agente lê
por uma função só de leitura, `agente_brindes` (supabase/cf-apostilas/20261104_agente_brindes.sql), com a
service role do projeto (SUPABASE_APOSTILAS_URL e SUPABASE_APOSTILAS_SERVICE_ROLE_KEY), como o cadastro lê o
acesso-unico. Sem as duas variáveis, a ferramenta não entra em nenhum agente.

Volta, por compra: o direito ao brinde, o material e a situação do envio (código e link de rastreio só quando o
telefone do WhatsApp é o da compra: a página do link mostra o endereço). Nada de CPF, nome ou endereço.
"""

import os

from agente import cadastro

ORIENTACAO_OUTRO_TELEFONE = (
    "Este e-mail é de compras com outro telefone. Pode dizer se tem direito ao brinde e em que etapa está o envio, "
    "mas não informe código nem link de rastreio: para isso, ofereça passar para a equipe, que confirma a identidade."
)
ORIENTACAO_VARIAS_PESSOAS = (
    "Este telefone tem compras de mais de uma pessoa. Peça o e-mail usado na compra e consulte de novo com ele."
)
ORIENTACAO_SEM_REGISTRO = (
    "\"sem registro\" não quer dizer que não tem direito: a compra pode ainda não ter sido analisada pela equipe. "
    "Se o produto e a data se encaixam na regra da campanha, diga que a confirmação é feita pela equipe."
)


def disponivel() -> bool:
    return bool(os.getenv("SUPABASE_APOSTILAS_URL", "").strip() and os.getenv("SUPABASE_APOSTILAS_SERVICE_ROLE_KEY", "").strip())


def consultar(telefone: str | None = None, email: str | None = None) -> dict:
    """As compras do aluno no Hub, com o direito ao brinde e o envio de cada uma, e a orientação do caso."""
    email = (email or "").strip().lower() or None
    resultado = cadastro._rpc("APOSTILAS", "agente_brindes", {"p_telefone": telefone or None, "p_email": email}) or {}
    if resultado.get("pessoas", 0) > 1 and not resultado.get("compras"):
        resultado["orientacao"] = ORIENTACAO_VARIAS_PESSOAS
    elif resultado.get("telefone_confere") is False:
        resultado["orientacao"] = ORIENTACAO_OUTRO_TELEFONE
    if any(str(c.get("brinde", "")).startswith("sem registro") for c in resultado.get("compras") or []):
        resultado["sobre_sem_registro"] = ORIENTACAO_SEM_REGISTRO
    return resultado
