"""Importação das unidades de saúde do CNES (dados abertos do Ministério da Saúde) para o cadastro do município.

As páginas da API vêm em paralelo (gestao.unidades_cnes) e cada unidade é gravada "a conferir", pelo código CNES:
repetir a importação atualiza as mesmas unidades, sem duplicar. O agente das unidades é criado depois, pelo servidor
web (agente/ferramentas_gestao.py), porque ele entra no AgentOS que está rodando lá.
"""

from agente import gestao, segundo_plano


def importar_cnes(execucao_id: str, municipio_id: str) -> dict:
    ctx = (segundo_plano.andamento(execucao_id) or {}).get("contexto") or {}
    quem, sessao = ctx.get("quem") or "onboarding", ctx.get("session_id")
    mun = gestao.municipio(municipio_id)
    if not mun:
        raise LookupError(f"Município {municipio_id} não existe.")
    brutas = gestao.unidades_cnes(mun["codigo_ibge"])  # um erro de rede sobe: a tarefa tenta de novo
    if not brutas:
        return {"importadas": 0, "por_tipo": {}, "particulares_fora": 0, "motivo": "sem resultados"}
    por_codigo = {}
    for tipo in gestao.tipos_unidade():
        for codigo in tipo.get("codigos_cnes") or []:
            por_codigo[str(codigo).zfill(2)] = tipo["id"]
    # Só as unidades públicas e as conveniadas ao SUS: consultórios e clínicas particulares ficam de fora.
    particulares = sum(1 for u in brutas if gestao.vinculo_cnes(u) is None)
    brutas = [u for u in brutas if gestao.vinculo_cnes(u) is not None]
    contagem: dict[str, int] = {}
    for posicao, u in enumerate(brutas, start=1):
        codigo_tipo = str(u.get("codigo_tipo_unidade") or u.get("tipo_unidade") or "").zfill(2)
        tipo_id = por_codigo.get(codigo_tipo, "outro")
        lat = u.get("latitude_estabelecimento_decimo_grau") or u.get("latitude")
        lng = u.get("longitude_estabelecimento_decimo_grau") or u.get("longitude")
        endereco = " ".join(str(x) for x in (u.get("endereco_estabelecimento"), u.get("numero_estabelecimento")) if x)
        gestao.salvar_unidade(
            municipio_id, nome=u.get("nome_fantasia") or u.get("nome_razao_social") or "Unidade sem nome",
            tipo_id=tipo_id, cnes=str(u.get("codigo_cnes") or ""), endereco=endereco,
            bairro=u.get("bairro_estabelecimento") or "", cep=str(u.get("codigo_cep_estabelecimento") or ""),
            latitude=float(lat) if lat not in (None, "") else None,
            longitude=float(lng) if lng not in (None, "") else None,
            origem="cnes", dados_cnes=u, confirmada=False, gestao=gestao.vinculo_cnes(u), quem=quem,
            session_id=sessao)
        contagem[tipo_id] = contagem.get(tipo_id, 0) + 1
        if posicao % 10 == 0:
            segundo_plano.progresso(execucao_id, {"gravadas": posicao, "total": len(brutas)})
    return {"importadas": len(brutas), "por_tipo": contagem, "particulares_fora": particulares}
