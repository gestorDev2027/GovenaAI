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

from agno.run import RunContext

from agente import gestao

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


# ───────────────────────── Implantação (onboarding) ─────────────────────────

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
    if erro := _sem_banco():
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
    return _json({"registrado": True, "municipio": mun, "proxima_etapa": "setores"})


def _agente_das_unidades(run_context: RunContext, mid: str) -> str | None:
    """O agente das unidades da prefeitura (criado na primeira unidade) passa a cuidar das unidades novas."""
    from agente import agentes_prefeitura

    agente_id = agentes_prefeitura.agente_das_unidades(mid, _quem(run_context))
    gestao.avancar_etapa(mid, "unidades")
    return agente_id


def importar_unidades_cnes(run_context: RunContext) -> str:
    """Traz do CNES (dados abertos do Ministério da Saúde) as unidades públicas e as conveniadas ao SUS do município e grava
    como "a confirmar". Mostre ao secretário o resumo por tipo e peça para conferir. Se a fonte não responder,
    siga com cadastrar_unidade, uma por uma."""
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    mun = gestao.municipio(mid)
    try:
        brutas = gestao.unidades_cnes(mun["codigo_ibge"])
    except Exception as erro:
        brutas = []
        motivo = type(erro).__name__
    else:
        motivo = "sem resultados"
    if not brutas:
        return (f"O CNES não respondeu ({motivo}). Pergunte ao secretário quantas e quais unidades a rede tem "
                "(UBS, UPA, CAPS, hospital...) e cadastre com cadastrar_unidade.")
    por_codigo = {}
    for tipo in gestao.tipos_unidade():
        for codigo in tipo.get("codigos_cnes") or []:
            por_codigo[str(codigo).zfill(2)] = tipo["id"]
    contagem: dict[str, int] = {}
    # Só as unidades públicas e as conveniadas ao SUS: consultórios e clínicas particulares ficam de fora.
    particulares = sum(1 for u in brutas if gestao.vinculo_cnes(u) is None)
    brutas = [u for u in brutas if gestao.vinculo_cnes(u) is not None]
    for u in brutas:
        codigo_tipo = str(u.get("codigo_tipo_unidade") or u.get("tipo_unidade") or "").zfill(2)
        tipo_id = por_codigo.get(codigo_tipo, "outro")
        lat, lng = u.get("latitude_estabelecimento_decimo_grau") or u.get("latitude"), \
            u.get("longitude_estabelecimento_decimo_grau") or u.get("longitude")
        endereco = " ".join(str(x) for x in (u.get("endereco_estabelecimento"), u.get("numero_estabelecimento")) if x)
        gestao.salvar_unidade(
            mid, nome=u.get("nome_fantasia") or u.get("nome_razao_social") or "Unidade sem nome", tipo_id=tipo_id,
            cnes=str(u.get("codigo_cnes") or ""), endereco=endereco, bairro=u.get("bairro_estabelecimento") or "",
            cep=str(u.get("codigo_cep_estabelecimento") or ""),
            latitude=float(lat) if lat not in (None, "") else None, longitude=float(lng) if lng not in (None, "") else None,
            origem="cnes", dados_cnes=u, confirmada=False, gestao=gestao.vinculo_cnes(u), quem=_quem(run_context),
            session_id=_sessao(run_context))
        contagem[tipo_id] = contagem.get(tipo_id, 0) + 1
    agente_unidades = _agente_das_unidades(run_context, mid)
    return _json({"importadas": len(brutas), "por_tipo": contagem, "particulares_fora": particulares,
                  "agente_das_unidades": agente_unidades,
                  "orientacao": "Mostre o resumo por tipo (são as unidades públicas e as conveniadas ao SUS; os "
                                "consultórios particulares ficaram de fora) e pergunte se está certo e se falta alguma."})


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
    return _json({"salva": True, "unidade": {k: unidade.get(k) for k in ("id", "nome", "tipo_id", "endereco", "numero",
                                                                         "bairro", "cep")},
                  "no_mapa": bool(ponto), "ponto_pelo": ponto[2] if ponto else None})


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
    gestao.avancar_etapa(mid, "atividades")
    return _json({"setores": [{"nome": s["nome"], "tipo_id": s.get("tipo_id"), "andar": s.get("andar")} for s in criados],
                  "tipos_invalidos": ignorados, "proxima_etapa": "atividades"})


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
    return _json({"setor": alvo["nome"], "atividades": [a["nome"] for a in salvas]})


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
    return _json({"salva": True, "atividade": atividade})


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
    alvo = gestao.setor_por_tipo_ou_nome(mid, setor)
    if not alvo:
        return f"O setor '{setor}' ainda não existe. Crie com salvar_setores."
    if "@" not in (email or ""):
        return "E-mail inválido. Peça o e-mail institucional da pessoa."
    pessoa = gestao.salvar_servidor(mid, nome=nome, email=email, cargo=cargo, setor_id=str(alvo["id"]),
                                    papel="coordenador", aprova_tarefas=True, responsavel_do_setor=True,
                                    quem=_quem(run_context), session_id=_sessao(run_context))
    return _json({"salvo": True, "setor": alvo["nome"], "responsavel": pessoa})


def montar_agentes(run_context: RunContext) -> str:
    """Cria o agente de IA de cada setor (os robôs que sentam nas salas do prédio), da prefeitura, e liga a ele as
    atividades do setor. Pode rodar de novo: só cria o que falta. Depois, a etapa das unidades."""
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    from agente import agentes_prefeitura

    resultado = agentes_prefeitura.criar_agentes_dos_setores(mid, _quem(run_context))
    gestao.avancar_etapa(mid, "unidades")
    return _json({**resultado, "proxima_etapa": "unidades",
                  "orientacao": "Conte quantos agentes sentaram nas salas. Depois, passe para as unidades de saúde."})


def situacao_implantacao(run_context: RunContext, ir_para_revisao: bool = False) -> str:
    """O que já foi cadastrado neste município: setores, atividades, responsáveis, agentes e unidades. Use para
    resumir para o secretário e decidir a próxima etapa.

    Args:
        ir_para_revisao: true quando o secretário disser que as unidades estão completas (abre a revisão final).
    """
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    if ir_para_revisao:
        gestao.avancar_etapa(mid, "revisao")
    p = gestao.panorama(mid)
    unidades = p.get("unidades", [])
    por_tipo: dict[str, int] = {}
    for u in unidades:
        por_tipo[u["tipo_id"]] = por_tipo.get(u["tipo_id"], 0) + 1
    return _json({
        "municipio": {k: p["municipio"].get(k) for k in ("nome", "uf", "situacao")},
        "etapa": (p.get("onboarding") or {}).get("etapa"),
        "unidades": {"total": len(unidades), "por_tipo": por_tipo,
                     "a_confirmar": sum(1 for u in unidades if not u.get("confirmada"))},
        "setores": [{"nome": s["nome"], "atividades": len(s["atividades"]),
                     "responsavel": (s.get("responsavel") or {}).get("nome"),
                     "agentes": [a["agente_id"] for a in s["agentes"]]} for s in p.get("setores", [])],
    })


def concluir_implantacao(run_context: RunContext) -> str:
    """Encerra o onboarding: o município passa a ativo. Só quando o secretário confirmar o resumo final."""
    if erro := _sem_banco():
        return erro
    mid = _municipio(run_context)
    if not mid:
        return _sem_municipio()
    gestao.concluir_onboarding(mid, quem=_quem(run_context), session_id=_sessao(run_context))
    return "Implantação concluída. O município está ativo; os agentes começam as rotinas no próximo horário."


FERRAMENTAS_IMPLANTACAO = [
    buscar_municipio, registrar_municipio, importar_unidades_cnes, cadastrar_unidade, listar_tipos_setor,
    salvar_setores, sugerir_atividades, salvar_atividades, nova_atividade, cadastrar_responsavel, montar_agentes,
    situacao_implantacao, concluir_implantacao,
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
