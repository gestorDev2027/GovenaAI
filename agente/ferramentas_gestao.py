"""Ferramentas dos agentes do GestorGov sobre o cadastro da prefeitura (agente/gestao.py).

Dois grupos:
- implantação (onboarding conversacional com o secretário): município, unidades, setores, atividades,
  responsáveis e agentes. Cada passo grava no banco, e a tela de onboarding redesenha a cidade e o
  prédio a partir do que foi gravado (rota /painel/api/gestao/panorama).
- consulta (agentes dos setores): o que a secretaria tem, quem aprova e o que cada setor faz.

O município da conversa fica em session_state["municipio_id"]. Sem ele, vale o padrão do servidor
(GESTORGOV_MUNICIPIO ou o único município cadastrado).
"""

import json
import re

from agno.run import RunContext

from agente import gestao, segundo_plano

FREQUENCIAS = ("a_cada_hora", "diaria", "semanal", "mensal", "sob_demanda")
CRON_PADRAO = {"a_cada_hora": "0 * * * *", "diaria": "0 7 * * 1-5", "semanal": "0 7 * * 1", "mensal": "0 7 1 * *"}

# Agentes que já existem no código para um tipo de setor (agente/perfis/). Os demais setores ganham o
# agente pela Fábrica de agentes, a partir do modelo de agente de setor.


def _json(dados) -> str:
    return json.dumps(gestao._json(dados), ensure_ascii=False, default=str)


def _quem(run_context: RunContext | None) -> str:
    return getattr(run_context, "agent_id", None) or "onboarding"


def _sessao(run_context: RunContext | None) -> str | None:
    return getattr(run_context, "session_id", None)


def _estado(run_context: RunContext) -> dict:
    if run_context.session_state is None:
        run_context.session_state = {}
    return run_context.session_state


def _municipio(run_context: RunContext | None) -> str | None:
    estado = (run_context.session_state or {}) if run_context else {}
    # Implantação de uma conta (tela de implantação): só o município dela, nunca o padrão do servidor.
    if estado.get("conta_email"):
        return estado.get("municipio_id")
    if estado.get("municipio_id"):
        return estado["municipio_id"]
    from agente import fabrica

    return fabrica.municipio_do_agente(getattr(run_context, "agent_id", None)) or gestao.municipio_padrao()


def _sem_banco() -> str | None:
    if not gestao.disponivel():
        return "O cadastro da prefeitura não está disponível neste servidor (banco não iniciado)."
    return None


def _sem_municipio() -> str:
    return "Nenhum município nesta conversa. Pergunte a cidade (ou o CEP) e use registrar_municipio primeiro."


# Conversas dos casos de teste da Fábrica (agente/fabrica_recursos.py): as ferramentas que gravam não gravam.
PREFIXO_TESTE = "aval-"


def _simulado(run_context: RunContext | None) -> str | None:
    if (_sessao(run_context) or "").startswith(PREFIXO_TESTE):
        return ("(Caso de teste da Fábrica: nada foi gravado no cadastro.) Siga a conversa como se a gravação "
                "tivesse dado certo.")
    return None


# ───────────────────────── Implantação (onboarding) ─────────────────────────

def _bloqueada(run_context: RunContext, mid: str, fase: str) -> str | None:
    """Mensagem para o assistente quando ainda falta algo nas fases antes de `fase` (cada fase é obrigatória), ou
    quando `fase` vem depois da fase em que esta mensagem começou: uma fase por resposta (o secretário confirma
    antes de a próxima ser gravada)."""
    if aviso := _simulado(run_context):
        return aviso
    da_vez = (_estado(run_context).get("fase_da_vez") or "") if run_context else ""
    if da_vez in gestao.FASES and gestao.FASES.index(fase) > gestao.FASES.index(da_vez):
        return (f"Pare aqui: a fase '{da_vez}' acabou de ser concluída nesta resposta. Apresente ao secretário a próxima fase "
                f"('{fase}') e ESPERE a resposta dele antes de gravar qualquer coisa dela.")
    falta = gestao.bloqueio(mid, fase)
    if not falta:
        return None
    return ("Ainda não dá para fazer isto: a implantação segue fase por fase e falta completar antes:\n- "
            + "\n- ".join(falta[:12]) + "\nPeça ao secretário o que falta, um item por vez.")


def _feito(mid: str, dados: dict) -> str:
    """A resposta da ferramenta com a fase atual e o que falta nela (o assistente guia a conversa por isso)."""
    fase = gestao.sincronizar_etapa(mid)
    return _json({**dados, "fase_atual": fase, "falta_nesta_fase": gestao.pendencias(mid).get(fase, [])})


def buscar_municipio(cep: str = "", nome: str = "", uf: str = "") -> str:
    """Encontra o município pelo CEP (preferível) ou pelo nome e a UF. Devolve o código IBGE, o nome, a UF e as
    coordenadas para centralizar o mapa. Use antes de registrar_municipio e confirme com o secretário.

    Args:
        cep: CEP de qualquer endereço da cidade (ex.: o da prefeitura), só números ou com hífen.
        nome: nome do município, se não houver CEP.
        uf: sigla do estado (ex.: SP), junto com o nome.
    """
    try:
        achado = gestao.buscar_cep(cep) if cep else None
        if not achado and nome and uf:
            achado = gestao.buscar_municipio_ibge(nome, uf)
    except Exception as erro:
        return f"Não consegui consultar agora ({type(erro).__name__}). Peça o nome da cidade e a UF e tente de novo."
    if not achado:
        return "Município não encontrado. Confira o CEP, ou peça o nome exato da cidade e a UF."
    coordenadas = gestao.geocodificar(f"{achado['municipio']}, {achado['uf']}, Brasil")
    if coordenadas:
        achado["latitude"], achado["longitude"] = coordenadas
    return _json(achado)


def registrar_municipio(run_context: RunContext, codigo_ibge: str, nome: str, uf: str, cep: str = "",
                        endereco_sede: str = "", latitude: float | None = None, longitude: float | None = None,
                        secretario_nome: str = "", secretario_email: str = "") -> str:
    """Registra o município (e a Secretaria Municipal de Saúde) e abre o onboarding. Só depois de o
    secretário confirmar a cidade encontrada por buscar_municipio.

    Args:
        codigo_ibge: código IBGE de 7 dígitos (de buscar_municipio).
        nome: nome do município.
        uf: sigla do estado.
        cep: CEP da prefeitura ou da secretaria, se informado.
        endereco_sede: endereço da Secretaria de Saúde, se informado.
        latitude: latitude do centro da cidade (de buscar_municipio).
        longitude: longitude do centro da cidade (de buscar_municipio).
        secretario_nome: nome do secretário de saúde, se ele disser.
        secretario_email: e-mail institucional do secretário, se ele disser.
    """
    if erro := _sem_banco() or _simulado(run_context):
        return erro
    if not (codigo_ibge or "").isdigit() or len(codigo_ibge) != 7:
        return "O código IBGE precisa ter 7 dígitos. Use o que veio de buscar_municipio."
    conta = (_estado(run_context).get("conta_email") or "").strip().lower()
    if conta:  # na tela de implantação, quem conversa é o secretário: nome e e-mail vêm da conta
        secretario_email = secretario_email or conta
        secretario_nome = secretario_nome or _estado(run_context).get("conta_nome") or ""
        existente = next((m for m in gestao.municipios() if m.get("codigo_ibge") == codigo_ibge), None)
        if existente:
            donos = {m["email"] for m in gestao.membros(str(existente["id"]))}
            if donos and conta not in donos:
                return ("Este município já foi cadastrado por outra conta no GestorGov. Diga ao secretário que peça "
                        "acesso ao responsável pela implantação, e não registre de novo.")
    mun = gestao.registrar_municipio(codigo_ibge=codigo_ibge, nome=nome, uf=uf, cep=cep, endereco_sede=endereco_sede,
                                     latitude=latitude, longitude=longitude, secretario_nome=secretario_nome,
                                     secretario_email=secretario_email, quem=_quem(run_context),
                                     session_id=_sessao(run_context))
    _estado(run_context)["municipio_id"] = str(mun["id"])
    if conta:  # quem cadastrou a prefeitura é o dono dela: convida a equipe e define os cargos e as permissões
        gestao.adicionar_membro(str(mun["id"]), conta, "dono", conta, nome=_estado(run_context).get("conta_nome") or "")
    return _feito(str(mun["id"]), {"registrado": True, "municipio": {k: mun.get(k) for k in ("nome", "uf", "codigo_ibge")},
                                     "orientacao": "Agora o cadastro detalhado da prefeitura e da secretaria: peça cada dado que falta."})


def _agente_das_unidades(run_context: RunContext, mid: str) -> str | None:
    """O agente das unidades da prefeitura (criado na primeira unidade) passa a cuidar das unidades novas."""
    from agente import agentes_prefeitura

    agente_id = agentes_prefeitura.agente_das_unidades(mid, _quem(run_context))
    gestao.sincronizar_etapa(mid)
    return agente_id


# Quanto a ferramenta espera a importação do CNES terminar antes de responder "ainda importando".
ESPERA_CNES_SEGUNDOS = 45


def _resultado_cnes(run_context: RunContext, mid: str, execucao: dict | None) -> str:
    """A resposta das ferramentas do CNES conforme a situação da importação (agente/segundo_plano.py)."""
    if execucao is None:
        return "Nenhuma importação do CNES nesta implantação. Use importar_unidades_cnes."
    if execucao["situacao"] in segundo_plano.ATIVAS:
        feitas = (execucao.get("progresso") or {}).get("gravadas")
        return _json({"importacao": "em andamento", "unidades_gravadas_ate_agora": feitas or 0,
                      "orientacao": "Diga ao secretário que a importação do CNES está rodando e que os pinos aparecem no "
                                    "mapa conforme chegam. Na próxima mensagem dele, use acompanhar_importacao."})
    resultado = execucao.get("resultado") or {}
    if execucao["situacao"] == "erro" or not resultado.get("importadas"):
        motivo = "erro na fonte" if execucao["situacao"] == "erro" else resultado.get("motivo") or "sem resultados"
        return (f"O CNES não respondeu ({motivo}). Pergunte ao secretário quantas e quais unidades a rede tem "
                "(UBS, UPA, CAPS, hospital...) e cadastre com cadastrar_unidade.")
    agente_unidades = _agente_das_unidades(run_context, mid)
    return _feito(mid, {"importadas": resultado["importadas"], "por_tipo": resultado.get("por_tipo") or {},
                        "particulares_fora": resultado.get("particulares_fora") or 0,
                        "agente_das_unidades": agente_unidades,
                        "orientacao": "Mostre o resumo por tipo (são as unidades públicas e as conveniadas ao SUS; os "
                                      "consultórios particulares ficaram de fora) e pergunte se está certo e se falta "
                                      "alguma."})


def importar_unidades_cnes(run_context: RunContext) -> str:
    """Traz do CNES (dados abertos do Ministério da Saúde) as unidades públicas e as conveniadas ao SUS do município e grava
    como "a confirmar". Mostre ao secretário o resumo por tipo e peça para conferir. Se a importação ainda estiver
    rodando, avise e use acompanhar_importacao na próxima mensagem. Se a fonte não responder, siga com
    cadastrar_unidade, uma por uma."""
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if erro := _bloqueada(run_context, mid, "unidades"):
        return erro
    atual = segundo_plano.ultima("importar_cnes", municipio_id=mid)
    if atual and atual["situacao"] in segundo_plano.ATIVAS:  # já há uma rodando: acompanha a mesma
        return _resultado_cnes(run_context, mid, segundo_plano.esperar(atual["id"], ESPERA_CNES_SEGUNDOS))
    from tarefas import cnes

    execucao_id = segundo_plano.disparar(
        "importar_cnes", [mid], municipio_id=mid, referencia=f"cnes:{mid}", criado_por=_quem(run_context),
        contexto={"quem": _quem(run_context), "session_id": _sessao(run_context)},
        local=lambda eid: cnes.importar_cnes(eid, mid))
    return _resultado_cnes(run_context, mid, segundo_plano.esperar(execucao_id, ESPERA_CNES_SEGUNDOS))


def acompanhar_importacao(run_context: RunContext) -> str:
    """A situação da importação do CNES que está rodando (ou da última): quantas unidades já chegaram e, no fim, o
    resumo por tipo para o secretário conferir."""
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if erro := _bloqueada(run_context, mid, "unidades"):
        return erro
    atual = segundo_plano.ultima("importar_cnes", municipio_id=mid)
    return _resultado_cnes(run_context, mid, segundo_plano.esperar(atual["id"], 10) if atual else None)


def cadastrar_unidade(run_context: RunContext, nome: str, tipo: str, cep: str = "", numero: str = "",
                      endereco: str = "", bairro: str = "", cnes: str = "") -> str:
    """Cadastra (ou corrige) uma unidade de saúde do município. Com o CEP, o endereço vem do ViaCEP e o número põe
    o pino no lugar certo do mapa. Sem CEP, use a rua e o bairro.

    Args:
        nome: nome da unidade (ex.: UBS Jardim Primavera).
        tipo: ubs, upa, pronto_socorro, hospital, policlinica, caps, farmacia, laboratorio, samu, vigilancia,
            imunizacao, academia, gestao, regulacao ou outro.
        cep: CEP da unidade (8 dígitos). O jeito preferido: peça sempre.
        numero: número do prédio na rua.
        endereco: rua, só se não houver CEP (ou se o CEP for de uma cidade inteira, sem rua).
        bairro: bairro, só se não houver CEP.
        cnes: código CNES da unidade, se ele souber.
    """
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if erro := _bloqueada(run_context, mid, "unidades"):
        return erro
    tipos = {t["id"] for t in gestao.tipos_unidade()}
    if tipo not in tipos:
        return f"Tipo inválido. Use um destes: {', '.join(sorted(tipos))}."
    mun = gestao.municipio(mid)
    achado = gestao.endereco_por_cep(cep, numero) if cep else None
    if cep and not achado:
        return "CEP não encontrado no ViaCEP. Confira os 8 dígitos com o secretário ou cadastre pela rua e bairro."
    if achado and str(achado.get("codigo_ibge") or "") != str(mun.get("codigo_ibge") or ""):
        return (f"Esse CEP é de {achado.get('municipio')}-{achado.get('uf')}, não de {mun['nome']}-{mun['uf']}. "
                "Confira o CEP com o secretário.")
    if achado:
        rua, bairro_final = (achado.get("logradouro") or endereco), (achado.get("bairro") or bairro)
        ponto = (achado["latitude"], achado["longitude"], achado["coordenadas_origem"]) if achado.get("latitude") else None
    else:
        rua, bairro_final = endereco, bairro
        ponto = gestao.localizar(logradouro=endereco, numero=numero, bairro=bairro, municipio=mun["nome"], uf=mun["uf"]) \
            if (endereco or bairro) else None
    unidade = gestao.salvar_unidade(mid, nome=nome, tipo_id=tipo, endereco=rua, numero=numero, bairro=bairro_final,
                                    cep=cep, cnes=cnes, latitude=ponto[0] if ponto else None,
                                    longitude=ponto[1] if ponto else None, coordenadas_origem=ponto[2] if ponto else None,
                                    quem=_quem(run_context), session_id=_sessao(run_context))
    _agente_das_unidades(run_context, mid)
    return _feito(mid, {"salva": True, "unidade": {k: unidade.get(k) for k in ("id", "nome", "tipo_id", "endereco", "numero",
                                                                         "bairro", "cep")},
                  "no_mapa": bool(ponto), "ponto_pelo": ponto[2] if ponto else None})


def salvar_dados_prefeitura(run_context: RunContext, cnpj: str = "", cep: str = "", rua: str = "", numero: str = "",
                            bairro: str = "", telefone: str = "", prefeito: str = "", email: str = "", site: str = "") -> str:
    """Grava os dados da PREFEITURA que o secretário confirmou (só os que vierem preenchidos). Obrigatórios: CNPJ, CEP,
    rua, número, bairro, telefone e prefeito(a). Confere o CNPJ (dígitos), o CEP e o telefone (com DDD).

    Args:
        cnpj: CNPJ da prefeitura.
        cep: CEP da sede da prefeitura.
        rua: logradouro da sede.
        numero: número da sede.
        bairro: bairro da sede.
        telefone: telefone com DDD.
        prefeito: nome do(a) prefeito(a).
        email: e-mail da prefeitura (opcional).
        site: site da prefeitura (opcional).
    """
    if erro := _sem_banco() or _simulado(run_context):
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    r = gestao.salvar_cadastro(mid, "municipios", {
        "prefeitura_cnpj": cnpj, "cep": cep, "prefeitura_logradouro": rua, "prefeitura_numero": numero,
        "prefeitura_bairro": bairro, "prefeitura_telefone": telefone, "prefeito_nome": prefeito,
        "prefeitura_email": email, "prefeitura_site": site}, _quem(run_context), _sessao(run_context))
    return _feito(mid, r)


def salvar_dados_secretaria(run_context: RunContext, nome: str = "", cnpj_fundo: str = "", cep: str = "", rua: str = "",
                            numero: str = "", bairro: str = "", telefone: str = "", email: str = "",
                            secretario_nome: str = "", secretario_email: str = "", secretario_telefone: str = "") -> str:
    """Grava os dados da SECRETARIA MUNICIPAL DE SAÚDE que o secretário confirmou (só os que vierem preenchidos).
    Obrigatórios: nome oficial, CNPJ do Fundo Municipal de Saúde, endereço (CEP, rua, número, bairro), telefone,
    e-mail institucional e o(a) secretário(a) (nome, e-mail e telefone). O endereço vira o ponto do prédio no mapa.

    Args:
        nome: nome oficial (ex.: Secretaria Municipal de Saúde de Itatiaia).
        cnpj_fundo: CNPJ do Fundo Municipal de Saúde.
        cep: CEP da secretaria.
        rua: logradouro.
        numero: número.
        bairro: bairro.
        telefone: telefone com DDD.
        email: e-mail institucional da secretaria.
        secretario_nome: nome do(a) secretário(a) de saúde.
        secretario_email: e-mail do(a) secretário(a).
        secretario_telefone: telefone do(a) secretário(a), com DDD.
    """
    if erro := _sem_banco() or _simulado(run_context):
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    campos = {"nome": nome, "fundo_cnpj": cnpj_fundo, "cep": cep, "logradouro": rua, "numero": numero, "bairro": bairro,
              "telefone": telefone, "email": email, "secretario_nome": secretario_nome,
              "secretario_email": secretario_email, "secretario_telefone": secretario_telefone}
    if rua and numero:
        mun = gestao.municipio(mid) or {}
        ponto = gestao.localizar(logradouro=rua, numero=numero, bairro=bairro, municipio=mun.get("nome", ""), uf=mun.get("uf", ""), cep=cep)
        if ponto:
            campos.update(latitude=ponto[0], longitude=ponto[1])
    r = gestao.salvar_cadastro(mid, "secretarias", campos, _quem(run_context), _sessao(run_context))
    return _feito(mid, r)


def buscar_endereco(texto: str) -> str:
    """Procura um endereço na base de endereços (Mapbox e, com um CEP de 8 dígitos, o ViaCEP): devolve rua, número,
    bairro, CEP e o ponto no mapa. Use para completar e conferir o endereço da prefeitura, da secretaria ou de uma
    unidade. Mostre ao secretário e só grave o que ele confirmar.

    Args:
        texto: o endereço como ele disser (ex.: "Rua Prefeito Assumpção 51, Itatiaia RJ") ou um CEP.
    """
    numeros = re.sub(r"\D", "", texto or "")
    if len(numeros) == 8 and len(texto.strip()) <= 10:
        achado = gestao.endereco_por_cep(numeros)
        return _json({"fonte": "ViaCEP", "enderecos": [achado] if achado else []})
    return _json({"fonte": "Mapbox", "enderecos": gestao.buscar_endereco_mapbox(texto)})


def pesquisar_na_web(pergunta: str) -> str:
    """Pesquisa na web (Google) dados públicos: CNPJ da prefeitura ou do Fundo Municipal de Saúde, nome do prefeito,
    telefone e endereço da secretaria, unidades de saúde. Mostre o que achou COM a fonte e peça a confirmação antes de
    gravar: dado da web nunca vai direto para o cadastro.

    Args:
        pergunta: o que procurar (ex.: "CNPJ do Fundo Municipal de Saúde de Itatiaia RJ").
    """
    from agente import pesquisa

    return _json(pesquisa.pesquisar(pergunta))


def listar_tipos_setor() -> str:
    """Os setores que uma Secretaria de Saúde costuma ter, com os sugeridos (padrao=true). Use para propor ao
    secretário a estrutura da secretaria."""
    if erro := _sem_banco():
        return erro
    return _json([{k: t[k] for k in ("id", "nome", "descricao", "padrao")} for t in gestao.tipos_setor()])


def salvar_setores(run_context: RunContext, tipos: list[str], outros: list[str] | None = None) -> str:
    """Cria os setores da Secretaria de Saúde que o secretário confirmou. Cada setor vira um andar ou sala do prédio.

    Args:
        tipos: ids de listar_tipos_setor (ex.: ["compras", "atencao_primaria", "regulacao"]).
        outros: nomes de setores que não estão na lista (ex.: ["Núcleo de Educação Permanente"]).
    """
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if erro := _bloqueada(run_context, mid, "setores"):
        return erro
    catalogo = {t["id"]: t for t in gestao.tipos_setor()}
    criados, ignorados = [], []
    for tipo in tipos or []:
        if tipo not in catalogo:
            ignorados.append(tipo)
            continue
        criados.append(gestao.salvar_setor(mid, nome=catalogo[tipo]["nome"], tipo_id=tipo,
                                           descricao=catalogo[tipo]["descricao"] or "", quem=_quem(run_context),
                                           session_id=_sessao(run_context)))
    for nome in outros or []:
        if nome.strip():
            criados.append(gestao.salvar_setor(mid, nome=nome, tipo_id=None, quem=_quem(run_context),
                                               session_id=_sessao(run_context)))
    return _feito(mid, {"setores": [{"nome": s["nome"], "tipo_id": s.get("tipo_id")} for s in criados],
                        "tipos_invalidos": ignorados})


def sugerir_atividades(run_context: RunContext, setor: str) -> str:
    """As atividades que o setor costuma ter (rotinas que o agente faz sozinho e pedidos sob demanda), para o
    secretário confirmar, tirar ou acrescentar.

    Args:
        setor: id do tipo de setor (ex.: compras) ou o nome do setor criado.
    """
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    alvo = gestao.setor_por_tipo_ou_nome(mid, setor) if mid else None
    tipo = (alvo or {}).get("tipo_id") or setor
    modelos = gestao.modelos_atividade(tipo)
    if not modelos:
        return "Não há atividades sugeridas para esse setor. Pergunte ao secretário o que o setor faz no dia a dia."
    return _json([{k: m[k] for k in ("id", "nome", "descricao", "tipo", "frequencia", "entregavel", "padrao")}
                  for m in modelos])


def salvar_atividades(run_context: RunContext, setor: str, modelos: list[str]) -> str:
    """Grava no setor as atividades do catálogo que o secretário confirmou.

    Args:
        setor: id do tipo de setor ou o nome do setor.
        modelos: ids de sugerir_atividades (ex.: ["compras_termo_referencia", "compras_contratos_vencendo"]).
    """
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if erro := _bloqueada(run_context, mid, "atividades"):
        return erro
    if erro := _bloqueada(run_context, mid, "atividades"):
        return erro
    alvo = gestao.setor_por_tipo_ou_nome(mid, setor)
    if not alvo:
        return f"O setor '{setor}' ainda não existe. Crie com salvar_setores."
    catalogo = {m["id"]: m for m in gestao.modelos_atividade()}
    salvas = []
    for mid_modelo in modelos or []:
        m = catalogo.get(mid_modelo)
        if not m:
            continue
        salvas.append(gestao.salvar_atividade(
            mid, str(alvo["id"]), nome=m["nome"], descricao=m["descricao"], tipo=m["tipo"], frequencia=m["frequencia"],
            cron=m["cron"], entregavel=m["entregavel"], modelo_id=m["id"], quem=_quem(run_context),
            session_id=_sessao(run_context)))
    return _feito(mid, {"setor": alvo["nome"], "atividades": [a["nome"] for a in salvas]})


def nova_atividade(run_context: RunContext, setor: str, nome: str, descricao: str, tipo: str,
                   frequencia: str = "sob_demanda", entregavel: str = "") -> str:
    """Cria uma atividade que não está no catálogo, do jeito que o secretário descreveu.

    Args:
        setor: id do tipo de setor ou o nome do setor.
        nome: nome curto (ex.: "Controle de diárias de motoristas").
        descricao: o que o agente faz, em uma ou duas frases.
        tipo: "rotina" (o agente procura o trabalho sozinho, num horário) ou "sob_demanda" (um servidor pede).
        frequencia: a_cada_hora, diaria, semanal, mensal ou sob_demanda.
        entregavel: o que volta para o servidor aprovar (ex.: "Relatório semanal").
    """
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if erro := _bloqueada(run_context, mid, "atividades"):
        return erro
    alvo = gestao.setor_por_tipo_ou_nome(mid, setor)
    if not alvo:
        return f"O setor '{setor}' ainda não existe. Crie com salvar_setores."
    if tipo not in ("rotina", "sob_demanda"):
        return 'O tipo precisa ser "rotina" ou "sob_demanda".'
    if frequencia not in FREQUENCIAS:
        return f"Frequência inválida. Use: {', '.join(FREQUENCIAS)}."
    if tipo == "sob_demanda":
        frequencia = "sob_demanda"
    elif frequencia == "sob_demanda":
        frequencia = "diaria"
    atividade = gestao.salvar_atividade(mid, str(alvo["id"]), nome=nome, descricao=descricao, tipo=tipo,
                                        frequencia=frequencia, cron=CRON_PADRAO.get(frequencia),
                                        entregavel=entregavel or None, quem=_quem(run_context),
                                        session_id=_sessao(run_context))
    return _feito(mid, {"salva": True, "atividade": atividade.get("nome")})


def cadastrar_responsavel(run_context: RunContext, setor: str, nome: str, email: str, cargo: str = "") -> str:
    """Cadastra quem coordena o setor. Essa pessoa aprova o que os agentes do setor propõem e entregam.

    Args:
        setor: id do tipo de setor ou o nome do setor.
        nome: nome completo.
        email: e-mail institucional (é o login no GestorGov).
        cargo: cargo na secretaria, se ele disser.
    """
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if erro := _bloqueada(run_context, mid, "responsaveis"):
        return erro
    alvo = gestao.setor_por_tipo_ou_nome(mid, setor)
    if not alvo:
        return f"O setor '{setor}' ainda não existe. Crie com salvar_setores."
    if "@" not in (email or ""):
        return "E-mail inválido. Peça o e-mail institucional da pessoa."
    pessoa = gestao.salvar_servidor(mid, nome=nome, email=email, cargo=cargo, setor_id=str(alvo["id"]),
                                    papel="coordenador", aprova_tarefas=True, responsavel_do_setor=True,
                                    quem=_quem(run_context), session_id=_sessao(run_context))
    return _feito(mid, {"salvo": True, "setor": alvo["nome"], "responsavel": {k: pessoa.get(k) for k in ("nome", "email", "cargo")}})


def montar_cargos(run_context: RunContext) -> str:
    """Monta o organograma da secretaria: os cargos do catálogo (Secretário, Adjunto, superintendências, coordenações,
    gerências...) ligados às salas dos setores, com hierarquia, indicadores e permissões sugeridas. Depois mostre ao
    secretário os cargos de cada setor e pergunte se quer acrescentar algum (criar_cargo)."""
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if erro := _bloqueada(run_context, mid, "cargos"):
        return erro
    from agente import acessos

    criados = acessos.montar_organograma_padrao(mid, _quem(run_context))
    por_setor: dict[str, list[str]] = {}
    nomes = {str(s["id"]): s["nome"] for s in gestao.setores(mid)}
    for c in acessos.cargos(mid):
        por_setor.setdefault(nomes.get(str(c.get("setor_id")), "Direção e apoio"), []).append(c["nome"])
    return _feito(mid, {"criados_agora": criados, "cargos_por_setor": por_setor})


def criar_cargo(run_context: RunContext, nome: str, setor: str, nivel: str = "coordenacao", superior: str = "") -> str:
    """Cria um cargo que o organograma padrão não tem, na sala de um setor.

    Args:
        nome: nome do cargo (ex.: Coordenador de Saúde Bucal).
        setor: o setor (sala) do cargo, pelo nome ou tipo.
        nivel: direcao, superintendencia, coordenacao, unidade ou controle.
        superior: nome do cargo a quem ele responde (opcional).
    """
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if erro := _bloqueada(run_context, mid, "cargos"):
        return erro
    from agente import acessos

    alvo = gestao.setor_por_tipo_ou_nome(mid, setor)
    if not alvo:
        return f"O setor '{setor}' não existe."
    chefe = next((c for c in acessos.cargos(mid) if superior and c["nome"].lower() == superior.lower()), None)
    try:
        cargo = acessos.criar_cargo(mid, {"nome": nome, "nivel": nivel, "superior_id": chefe["id"] if chefe else None,
                                          "setor_id": str(alvo["id"]),
                                          "permissoes": list(acessos.PADRAO_POR_NIVEL.get(nivel, ()))}, _quem(run_context))
    except acessos.ErroAcesso as erro:
        return erro.detalhe
    return _feito(mid, {"criado": cargo.get("nome"), "setor": alvo["nome"]})


def dar_acesso(run_context: RunContext, nome: str, email: str, cargo: str = "") -> str:
    """Cadastra uma pessoa que vai usar o GestorGov (conversar com os agentes, ver e registrar dados), no cargo dela.
    O acesso fica AGUARDANDO A APROVAÇÃO do dono da prefeitura no painel (Equipe e acessos), que gera o link de
    entrada. Cadastre pelo menos os responsáveis de cada setor.

    Args:
        nome: nome completo.
        email: e-mail institucional (é o login).
        cargo: nome do cargo no organograma (ex.: Superintendente de Atenção Primária).
    """
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if erro := _bloqueada(run_context, mid, "equipe"):
        return erro
    from agente import acessos

    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email or ""):
        return "E-mail inválido. Peça o e-mail institucional da pessoa."
    lista = acessos.cargos(mid)
    escolhido = next((c for c in lista if cargo and c["nome"].lower() == cargo.lower()), None)
    if cargo and not escolhido:
        return f"O cargo '{cargo}' não existe. Cargos: {', '.join(c['nome'] for c in lista[:40])}."
    try:
        acessos.convidar(mid, email, nome, escolhido["id"] if escolhido else None, _quem(run_context), origem="assistente")
    except acessos.ErroAcesso as erro:
        return erro.detalhe
    return _feito(mid, {"cadastrado": nome, "email": email.lower(), "cargo": escolhido["nome"] if escolhido else None,
                        "situacao": "aguardando a aprovação do dono no painel (Equipe e acessos)"})


def montar_agentes(run_context: RunContext) -> str:
    """Cria o agente de IA de cada setor (os robôs que sentam nas salas do prédio), da prefeitura, e liga a ele as
    atividades do setor. Pode rodar de novo: só cria o que falta. Depois, a etapa das unidades."""
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if erro := _bloqueada(run_context, mid, "agentes"):
        return erro
    from agente import agentes_prefeitura

    resultado = agentes_prefeitura.criar_agentes_dos_setores(mid, _quem(run_context))
    return _feito(mid, {**resultado, "orientacao": "Conte quantos agentes sentaram nas salas."})


def situacao_implantacao(run_context: RunContext, ir_para_revisao: bool = False) -> str:
    """O que já foi cadastrado neste município: setores, atividades, responsáveis, agentes e unidades. Use para
    resumir para o secretário e decidir a próxima etapa.

    Args:
        ir_para_revisao: true quando o secretário disser que as unidades estão completas OU que vai cadastrá-las
            depois (as unidades podem ser cadastradas pelo assistente depois da implantação).
    """
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if ir_para_revisao:
        gestao.marcar_unidades_confirmadas(mid)
    fase = gestao.sincronizar_etapa(mid)
    p = gestao.panorama(mid)
    unidades = p.get("unidades", [])
    por_tipo: dict[str, int] = {}
    for u in unidades:
        por_tipo[u["tipo_id"]] = por_tipo.get(u["tipo_id"], 0) + 1
    return _json({
        "municipio": {k: p["municipio"].get(k) for k in ("nome", "uf", "situacao")},
        "fase_atual": fase,
        "pendencias_por_fase": {f: itens for f, itens in gestao.pendencias(mid).items() if itens},
        "unidades": {"total": len(unidades), "por_tipo": por_tipo,
                     "a_confirmar": sum(1 for u in unidades if not u.get("confirmada"))},
        "setores": [{"nome": s["nome"], "atividades": len(s["atividades"]),
                     "responsavel": (s.get("responsavel") or {}).get("nome"),
                     "agentes": [a["agente_id"] for a in s["agentes"]]} for s in p.get("setores", [])],
    })


def concluir_implantacao(run_context: RunContext) -> str:
    """Encerra a implantação: o município passa a ativo. Só funciona com todas as fases completas (inclusive os acessos
    aprovados no painel) e depois que o secretário confirmar o resumo final."""
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if erro := _bloqueada(run_context, mid, "revisao"):
        return erro
    gestao.concluir_onboarding(mid, quem=_quem(run_context), session_id=_sessao(run_context))
    return "Implantação concluída. O município está ativo; os agentes começam as rotinas no próximo horário."


FERRAMENTAS_IMPLANTACAO = [
    buscar_municipio, registrar_municipio, salvar_dados_prefeitura, salvar_dados_secretaria, buscar_endereco,
    pesquisar_na_web, listar_tipos_setor, salvar_setores, sugerir_atividades, salvar_atividades, nova_atividade,
    montar_cargos, criar_cargo, cadastrar_responsavel, montar_agentes, dar_acesso, importar_unidades_cnes,
    acompanhar_importacao, cadastrar_unidade, situacao_implantacao, concluir_implantacao,
]


# ───────────────────────── Consulta (agentes dos setores) ─────────────────────────

def consultar_secretaria(run_context: RunContext, setor: str = "") -> str:
    """O que a Secretaria de Saúde tem: setores, responsáveis (quem aprova) e as atividades de cada setor. Com
    `setor`, só ele.

    Args:
        setor: id do tipo de setor (ex.: regulacao) ou nome; vazio traz todos.
    """
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return "Nenhum município cadastrado ainda: a implantação não foi feita."
    p = gestao.panorama(mid)
    lista = p.get("setores", [])
    if setor:
        alvo = gestao.setor_por_tipo_ou_nome(mid, setor)
        lista = [s for s in lista if alvo and s["id"] == str(alvo["id"])]
    return _json({
        "municipio": p["municipio"]["nome"],
        "setores": [{"nome": s["nome"], "responsavel": (s.get("responsavel") or {}).get("nome"),
                     "atividades": [{k: a[k] for k in ("nome", "descricao", "tipo", "frequencia", "entregavel")}
                                    for a in s["atividades"] if a.get("ativa", True)]} for s in lista],
    })


def listar_unidades(run_context: RunContext, tipo: str = "") -> str:
    """As unidades de saúde do município, com tipo, endereço e CNES.

    Args:
        tipo: filtra por tipo (ubs, upa, caps, hospital, farmacia...); vazio traz todas.
    """
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return "Nenhum município cadastrado ainda: a implantação não foi feita."
    return _json([{k: u.get(k) for k in ("nome", "tipo_id", "cnes", "endereco", "bairro", "telefone", "situacao")}
                  for u in gestao.unidades(mid, tipo or None)])


FERRAMENTAS_CONSULTA = [consultar_secretaria, listar_unidades]
