"""Ferramentas dos agentes do GestorGov sobre o cadastro da organização (agente/gestao.py).

Dois grupos:
- implantação (a conversa com o responsável pela organização): o segmento e o cadastro, as áreas, as atividades,
  os cargos, os responsáveis, os agentes, os acessos e as unidades. Cada passo grava no banco, e a tela da
  implantação redesenha o prédio e o mapa a partir do que foi gravado (rota /painel/api/gestao/panorama).
- consulta (agentes das áreas): o que a organização tem, quem aprova e o que cada área faz.

A organização da conversa fica em session_state["organizacao_id"]. Sem ela, vale o padrão do servidor
(GESTORGOV_ORGANIZACAO ou a única organização cadastrada). Os nomes de tela de cada segmento (setor ou
departamento, secretário ou diretor) estão em agente/segmentos.py.
"""

import json
import re

from agno.run import RunContext

from agente import gestao, segmentos, segundo_plano

FREQUENCIAS = ("a_cada_hora", "diaria", "semanal", "mensal", "sob_demanda")
CRON_PADRAO = {"a_cada_hora": "0 * * * *", "diaria": "0 7 * * 1-5", "semanal": "0 7 * * 1", "mensal": "0 7 1 * *"}


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


def _organizacao(run_context: RunContext | None) -> str | None:
    estado = (run_context.session_state or {}) if run_context else {}
    # Implantação de uma conta (tela de implantação): só a organização dela, nunca o padrão do servidor.
    if estado.get("conta_email"):
        return estado.get("organizacao_id")
    if estado.get("organizacao_id"):
        return estado["organizacao_id"]
    from agente import fabrica

    return fabrica.organizacao_do_agente(getattr(run_context, "agent_id", None)) or gestao.organizacao_padrao()


def _sem_banco() -> str | None:
    if not gestao.disponivel():
        return "O cadastro das organizações não está disponível neste servidor (banco não iniciado)."
    return None


def _sem_organizacao() -> str:
    return ("Nenhuma organização nesta conversa. Pergunte primeiro o segmento (Secretaria de Saúde ou empresa) e use "
            "registrar_organizacao.")


# Conversas dos casos de teste da Fábrica (agente/fabrica_recursos.py): as ferramentas que gravam não gravam.
PREFIXO_TESTE = "aval-"


def _simulado(run_context: RunContext | None) -> str | None:
    if (_sessao(run_context) or "").startswith(PREFIXO_TESTE):
        return ("(Caso de teste da Fábrica: nada foi gravado no cadastro.) Siga a conversa como se a gravação "
                "tivesse dado certo.")
    return None


def _area(oid: str, chave: str) -> tuple[dict | None, str]:
    """A área pelo tipo ou nome, e a mensagem para o assistente quando ela não existe."""
    alvo = gestao.area_por_tipo_ou_nome(oid, chave)
    rotulo = gestao.segmento_de(oid).rotulos["area"]
    return alvo, f"O {rotulo} '{chave}' ainda não existe. Crie com salvar_areas."


# ───────────────────────── Implantação ─────────────────────────

def _bloqueada(run_context: RunContext, oid: str, fase: str) -> str | None:
    """Mensagem para o assistente quando ainda falta algo nas fases antes de `fase` (cada fase é obrigatória), ou
    quando `fase` vem depois da fase em que esta mensagem começou: uma fase por resposta (o responsável confirma
    antes de a próxima ser gravada)."""
    if aviso := _simulado(run_context):
        return aviso
    da_vez =(_estado(run_context).get("fase_da_vez") or "") if run_context else ""
    if da_vez in gestao.FASES and gestao.FASES.index(fase) > gestao.FASES.index(da_vez):
        return (f"Pare aqui: a fase '{da_vez}' acabou de ser concluída nesta resposta. Apresente a próxima fase "
                f"('{fase}') e ESPERE a resposta antes de gravar qualquer coisa dela.")
    falta = gestao.bloqueio(oid, fase)
    if not falta:
        return None
    return ("Ainda não dá para fazer isto: a implantação segue fase por fase e falta completar antes:\n- "
            + "\n- ".join(falta[:12]) + "\nPeça o que falta, um item por vez.")


def _feito(oid: str, dados: dict) -> str:
    """A resposta da ferramenta com a fase atual e o que falta nela (o assistente guia a conversa por isso)."""
    fase = gestao.sincronizar_etapa(oid)
    return _json({**dados, "fase_atual": fase, "falta_nesta_fase": gestao.pendencias(oid).get(fase, [])})


def _segmento_errado(oid: str, esperado: str) -> str | None:
    seg = gestao.segmento_de(oid)
    if seg.id != esperado:
        return (f"Esta ferramenta é do segmento {segmentos.segmento(esperado).nome}; esta organização é do segmento "
                f"{seg.nome}. Use a ferramenta de cadastro do segmento dela.")
    return None


def buscar_municipio(cep: str = "", nome: str = "", uf: str = "") -> str:
    """Encontra o município pelo CEP (preferível) ou pelo nome e a UF. Devolve o código IBGE, o nome, a UF e as
    coordenadas para centralizar o mapa. Use antes de registrar_organizacao e confirme com quem conversa.

    Args:
        cep: CEP de qualquer endereço da cidade (ex.: o da prefeitura ou da sede da empresa).
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


def registrar_organizacao(run_context: RunContext, segmento: str, nome: str = "", codigo_ibge: str = "",
                          cidade: str = "", uf: str = "", cep: str = "", cnpj: str = "",
                          latitude: float | None = None, longitude: float | None = None) -> str:
    """Registra a organização e abre a implantação. É o primeiro passo, depois de saber o segmento e confirmar a
    cidade (buscar_municipio).
    - saude_publica: a Secretaria Municipal de Saúde de uma cidade (codigo_ibge, cidade, uf e as coordenadas vêm
      de buscar_municipio; o nome padrão é "Secretaria Municipal de Saúde de <cidade>").
    - empresa: a empresa (nome = razão social; o CEP da sede traz a cidade; o CNPJ, se ele já disser).

    Args:
        segmento: saude_publica ou empresa.
        nome: nome oficial (na empresa, a razão social; na saúde, pode ficar vazio).
        codigo_ibge: código IBGE de 7 dígitos do município (de buscar_municipio).
        cidade: nome do município.
        uf: sigla do estado.
        cep: CEP da sede (na empresa, o jeito preferido de achar a cidade).
        cnpj: CNPJ da empresa, se informado.
        latitude: latitude do centro da cidade (de buscar_municipio).
        longitude: longitude do centro da cidade (de buscar_municipio).
    """
    if erro := _sem_banco() or _simulado(run_context):
        return erro
    if segmento not in segmentos.SEGMENTOS:
        return f"Segmento inválido. Use: {', '.join(segmentos.SEGMENTOS)}."
    seg = segmentos.segmento(segmento)
    estado = _estado(run_context)
    conta = (estado.get("conta_email") or "").strip().lower()
    if conta and estado.get("organizacao_id") and gestao.organizacao(estado["organizacao_id"]):
        atual = gestao.organizacao(estado["organizacao_id"])
        return (f"A organização desta implantação já está registrada ({atual['nome']}). Para completar ou corrigir o "
                "cadastro, use a ferramenta de dados do segmento dela.")
    if cep and not (codigo_ibge and cidade):  # a cidade pelo CEP (ViaCEP)
        achado = gestao.buscar_cep(cep)
        if not achado:
            return "CEP não encontrado no ViaCEP. Confira os 8 dígitos."
        codigo_ibge, cidade, uf = codigo_ibge or achado.get("codigo_ibge") or "", cidade or achado.get("municipio") or "", uf or achado.get("uf") or ""
    if seg.um_por_municipio and (not (codigo_ibge or "").isdigit() or len(codigo_ibge) != 7):
        return "O código IBGE precisa ter 7 dígitos. Use o que veio de buscar_municipio."
    if not seg.um_por_municipio and not (nome or "").strip():
        return "Falta o nome da empresa (a razão social)."
    if latitude is None and cidade:
        coordenadas = gestao.geocodificar(f"{cidade}, {uf}, Brasil")
        if coordenadas:
            latitude, longitude = coordenadas
    if not (nome or "").strip():
        nome = f"Secretaria Municipal de Saúde de {cidade}"
    if conta:
        cnpj_limpo = re.sub(r"\D", "", cnpj or "")
        existente = next((o for o in gestao.organizacoes() if o.get("segmento_id") == seg.id and (
            (seg.um_por_municipio and o.get("codigo_ibge") == codigo_ibge) or (cnpj_limpo and o.get("cnpj") == cnpj_limpo))), None)
        if existente:
            donos = {m["email"] for m in gestao.membros(str(existente["id"]))}
            if donos and conta not in donos:
                return ("Esta organização já foi cadastrada por outra conta no GestorGov. Diga que peça acesso a quem "
                        "fez a implantação, e não registre de novo.")
    try:
        org = gestao.registrar_organizacao(segmento_id=seg.id, nome=nome, codigo_ibge=codigo_ibge, cidade=cidade, uf=uf,
                                           cep=cep, cnpj=cnpj, latitude=latitude, longitude=longitude,
                                           responsavel_nome=estado.get("conta_nome") or "" if conta else "",
                                           responsavel_email=conta, quem=_quem(run_context), session_id=_sessao(run_context))
    except ValueError as erro:
        return str(erro)
    estado["organizacao_id"] = str(org["id"])
    if conta:  # quem cadastra a organização é o dono dela: convida a equipe e define os cargos e as permissões
        gestao.adicionar_membro(str(org["id"]), conta, "dono", conta, nome=estado.get("conta_nome") or "")
    return _feito(str(org["id"]), {"registrada": True, "segmento": seg.nome,
                                   "organizacao": {k: org.get(k) for k in ("nome", "cidade", "uf", "codigo_ibge")},
                                   "orientacao": "Agora o cadastro detalhado: peça cada dado que falta (falta_nesta_fase)."})


def _salvar(run_context: RunContext, oid: str, campos: dict) -> str:
    r = gestao.salvar_cadastro(oid, campos, _quem(run_context), _sessao(run_context))
    return _feito(oid, r)


def _ponto_da_sede(oid: str, rua: str, numero: str, bairro: str, cep: str) -> dict:
    if not (rua and numero):
        return {}
    org = gestao.organizacao(oid) or {}
    ponto = gestao.localizar(logradouro=rua, numero=numero, bairro=bairro, municipio=org.get("cidade") or "",
                             uf=org.get("uf") or "", cep=cep)
    return {"sede_latitude": ponto[0], "sede_longitude": ponto[1]} if ponto else {}


def salvar_dados_prefeitura(run_context: RunContext, cnpj: str = "", cep: str = "", rua: str = "", numero: str = "",
                            bairro: str = "", telefone: str = "", prefeito: str = "", email: str = "", site: str = "",
                            populacao: str = "") -> str:
    """(Saúde pública) Grava os dados da PREFEITURA que foram confirmados (só os que vierem preenchidos).
    Obrigatórios: CNPJ, CEP, rua, número, bairro, telefone e prefeito(a). Confere o CNPJ (dígitos), o CEP e o
    telefone (com DDD).

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
        populacao: população do município (opcional).
    """
    if erro := _sem_banco() or _simulado(run_context):
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _segmento_errado(oid, "saude_publica"):
        return erro
    return _salvar(run_context, oid, {
        "prefeitura_cnpj": cnpj, "prefeitura_cep": cep, "prefeitura_logradouro": rua, "prefeitura_numero": numero,
        "prefeitura_bairro": bairro, "prefeitura_telefone": telefone, "prefeito_nome": prefeito,
        "prefeitura_email": email, "prefeitura_site": site, "populacao": populacao})


def salvar_dados_secretaria(run_context: RunContext, nome: str = "", cnpj_fundo: str = "", cnpj: str = "", sigla: str = "",
                            cep: str = "", rua: str = "", numero: str = "", bairro: str = "", telefone: str = "",
                            email: str = "", secretario_nome: str = "", secretario_email: str = "",
                            secretario_telefone: str = "") -> str:
    """(Saúde pública) Grava os dados da SECRETARIA MUNICIPAL DE SAÚDE que foram confirmados (só os que vierem
    preenchidos). Obrigatórios: nome oficial, CNPJ do Fundo Municipal de Saúde, endereço (CEP, rua, número, bairro),
    telefone, e-mail institucional e o(a) secretário(a) (nome, e-mail e telefone). O endereço vira o ponto do prédio.

    Args:
        nome: nome oficial (ex.: Secretaria Municipal de Saúde de Itatiaia).
        cnpj_fundo: CNPJ do Fundo Municipal de Saúde.
        cnpj: CNPJ próprio da secretaria, se tiver (opcional).
        sigla: sigla da secretaria (opcional).
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
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _segmento_errado(oid, "saude_publica"):
        return erro
    return _salvar(run_context, oid, {
        "nome": nome, "fundo_cnpj": cnpj_fundo, "cnpj": cnpj, "sigla": sigla, "cep": cep, "logradouro": rua,
        "numero": numero, "bairro": bairro, "telefone": telefone, "email": email, "responsavel_nome": secretario_nome,
        "responsavel_email": secretario_email, "responsavel_telefone": secretario_telefone,
        **_ponto_da_sede(oid, rua, numero, bairro, cep)})


def salvar_dados_empresa(run_context: RunContext, razao_social: str = "", nome_fantasia: str = "", cnpj: str = "",
                         ramo: str = "", funcionarios: str = "", cep: str = "", rua: str = "", numero: str = "",
                         complemento: str = "", bairro: str = "", cidade: str = "", uf: str = "", telefone: str = "",
                         email: str = "", site: str = "", responsavel_nome: str = "", responsavel_cargo: str = "",
                         responsavel_email: str = "", responsavel_telefone: str = "") -> str:
    """(Empresa) Grava os dados da EMPRESA que foram confirmados (só os que vierem preenchidos). Obrigatórios: razão
    social, CNPJ, ramo de atividade, endereço da sede (CEP, rua, número, bairro, cidade, UF), telefone, e-mail e o(a)
    diretor(a) responsável (nome, e-mail e telefone). O endereço vira o ponto do prédio.

    Args:
        razao_social: razão social.
        nome_fantasia: nome fantasia (opcional).
        cnpj: CNPJ da empresa.
        ramo: ramo de atividade (ex.: distribuição de alimentos).
        funcionarios: número de funcionários (opcional).
        cep: CEP da sede.
        rua: logradouro da sede.
        numero: número da sede.
        complemento: complemento (opcional).
        bairro: bairro da sede.
        cidade: cidade da sede.
        uf: UF da sede.
        telefone: telefone com DDD.
        email: e-mail da empresa.
        site: site da empresa (opcional).
        responsavel_nome: nome do(a) diretor(a) responsável.
        responsavel_cargo: cargo do(a) responsável (opcional).
        responsavel_email: e-mail do(a) responsável.
        responsavel_telefone: telefone do(a) responsável, com DDD.
    """
    if erro := _sem_banco() or _simulado(run_context):
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _segmento_errado(oid, "empresa"):
        return erro
    return _salvar(run_context, oid, {
        "nome": razao_social, "sigla": nome_fantasia, "cnpj": cnpj, "ramo": ramo, "funcionarios": funcionarios,
        "cep": cep, "logradouro": rua, "numero": numero, "complemento": complemento, "bairro": bairro, "cidade": cidade,
        "uf": uf, "telefone": telefone, "email": email, "site": site, "responsavel_nome": responsavel_nome,
        "responsavel_cargo": responsavel_cargo, "responsavel_email": responsavel_email,
        "responsavel_telefone": responsavel_telefone, **_ponto_da_sede(oid, rua, numero, bairro, cep)})


def buscar_endereco(texto: str) -> str:
    """Procura um endereço na base de endereços (Mapbox e, com um CEP de 8 dígitos, o ViaCEP): devolve rua, número,
    bairro, CEP e o ponto no mapa. Use para completar e conferir o endereço da sede ou de uma unidade. Mostre o que
    achou e só grave o que for confirmado.

    Args:
        texto: o endereço como a pessoa disser (ex.: "Rua Prefeito Assumpção 51, Itatiaia RJ") ou um CEP.
    """
    numeros = re.sub(r"\D", "", texto or "")
    if len(numeros) == 8 and len(texto.strip()) <= 10:
        achado = gestao.endereco_por_cep(numeros)
        return _json({"fonte": "ViaCEP", "enderecos": [achado] if achado else []})
    return _json({"fonte": "Mapbox", "enderecos": gestao.buscar_endereco_mapbox(texto)})


def pesquisar_na_web(pergunta: str) -> str:
    """Pesquisa na web (Google) dados públicos: CNPJ, endereço e telefone da organização, nome do prefeito ou dos
    diretores, unidades. Mostre o que achou COM a fonte e peça a confirmação antes de gravar: dado da web nunca vai
    direto para o cadastro.

    Args:
        pergunta: o que procurar (ex.: "CNPJ do Fundo Municipal de Saúde de Itatiaia RJ").
    """
    from agente import pesquisa

    return _json(pesquisa.pesquisar(pergunta))


def listar_tipos_area(run_context: RunContext) -> str:
    """As áreas que uma organização do segmento costuma ter (na saúde, os setores da secretaria; numa empresa, os
    departamentos), com as sugeridas (padrao=true). Use para propor a estrutura."""
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    seg = gestao.segmento_de(oid)
    return _json([{k: t[k] for k in ("id", "nome", "descricao", "padrao")} for t in gestao.tipos_area(seg.id)])


def salvar_areas(run_context: RunContext, tipos: list[str], outras: list[str] | None = None) -> str:
    """Cria as áreas (setores, departamentos) que foram confirmadas. Cada uma vira uma sala do prédio.

    Args:
        tipos: ids de listar_tipos_area (ex.: ["compras", "atencao_primaria"] ou ["emp_financeiro", "emp_comercial"]).
        outras: nomes de áreas que não estão na lista (ex.: ["Núcleo de Educação Permanente"]).
    """
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _bloqueada(run_context, oid, "areas"):
        return erro
    catalogo = {t["id"]: t for t in gestao.tipos_area(gestao.segmento_de(oid).id)}
    criadas, ignorados = [], []
    for tipo in tipos or []:
        if tipo not in catalogo:
            ignorados.append(tipo)
            continue
        criadas.append(gestao.salvar_area(oid, nome=catalogo[tipo]["nome"], tipo_id=tipo,
                                          descricao=catalogo[tipo]["descricao"] or "", quem=_quem(run_context),
                                          session_id=_sessao(run_context)))
    for nome in outras or []:
        if nome.strip():
            criadas.append(gestao.salvar_area(oid, nome=nome, tipo_id=None, quem=_quem(run_context),
                                              session_id=_sessao(run_context)))
    return _feito(oid, {"areas": [{"nome": s["nome"], "tipo_id": s.get("tipo_id")} for s in criadas],
                        "tipos_invalidos": ignorados})


def sugerir_atividades(run_context: RunContext, area: str) -> str:
    """As atividades que a área costuma ter (rotinas que o agente faz sozinho e pedidos sob demanda), para confirmar,
    tirar ou acrescentar.

    Args:
        area: id do tipo de área (ex.: compras, emp_financeiro) ou o nome da área criada.
    """
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    alvo = gestao.area_por_tipo_ou_nome(oid, area) if oid else None
    tipo = (alvo or {}).get("tipo_id") or area
    modelos = gestao.modelos_atividade(tipo)
    if not modelos:
        return "Não há atividades sugeridas para essa área. Pergunte o que a área faz no dia a dia (nova_atividade)."
    return _json([{k: m[k] for k in ("id", "nome", "descricao", "tipo", "frequencia", "entregavel", "padrao")}
                  for m in modelos])


def salvar_atividades(run_context: RunContext, area: str, modelos: list[str]) -> str:
    """Grava na área as atividades do catálogo que foram confirmadas.

    Args:
        area: id do tipo de área ou o nome da área.
        modelos: ids de sugerir_atividades (ex.: ["compras_termo_referencia", "compras_contratos_vencendo"]).
    """
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _bloqueada(run_context, oid, "atividades"):
        return erro
    alvo, nao_existe = _area(oid, area)
    if not alvo:
        return nao_existe
    catalogo = {m["id"]: m for m in gestao.modelos_atividade(alvo.get("tipo_id")) if alvo.get("tipo_id")}
    salvas = []
    for id_modelo in modelos or []:
        m = catalogo.get(id_modelo)
        if not m:
            continue
        salvas.append(gestao.salvar_atividade(
            oid, str(alvo["id"]), nome=m["nome"], descricao=m["descricao"], tipo=m["tipo"], frequencia=m["frequencia"],
            cron=m["cron"], entregavel=m["entregavel"], modelo_id=m["id"], quem=_quem(run_context),
            session_id=_sessao(run_context)))
    return _feito(oid, {"area": alvo["nome"], "atividades": [a["nome"] for a in salvas]})


def nova_atividade(run_context: RunContext, area: str, nome: str, descricao: str, tipo: str,
                   frequencia: str = "sob_demanda", entregavel: str = "") -> str:
    """Cria uma atividade que não está no catálogo, do jeito que foi descrita.

    Args:
        area: id do tipo de área ou o nome da área.
        nome: nome curto (ex.: "Controle de diárias de motoristas").
        descricao: o que o agente faz, em uma ou duas frases.
        tipo: "rotina" (o agente procura o trabalho sozinho, num horário) ou "sob_demanda" (alguém pede).
        frequencia: a_cada_hora, diaria, semanal, mensal ou sob_demanda.
        entregavel: o que volta para a pessoa aprovar (ex.: "Relatório semanal").
    """
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _bloqueada(run_context, oid, "atividades"):
        return erro
    alvo, nao_existe = _area(oid, area)
    if not alvo:
        return nao_existe
    if tipo not in ("rotina", "sob_demanda"):
        return 'O tipo precisa ser "rotina" ou "sob_demanda".'
    if frequencia not in FREQUENCIAS:
        return f"Frequência inválida. Use: {', '.join(FREQUENCIAS)}."
    if tipo == "sob_demanda":
        frequencia = "sob_demanda"
    elif frequencia == "sob_demanda":
        frequencia = "diaria"
    atividade = gestao.salvar_atividade(oid, str(alvo["id"]), nome=nome, descricao=descricao, tipo=tipo,
                                        frequencia=frequencia, cron=CRON_PADRAO.get(frequencia),
                                        entregavel=entregavel or None, quem=_quem(run_context),
                                        session_id=_sessao(run_context))
    return _feito(oid, {"salva": True, "atividade": atividade.get("nome")})


def cadastrar_responsavel(run_context: RunContext, area: str, nome: str, email: str, cargo: str = "") -> str:
    """Cadastra quem coordena a área. Essa pessoa aprova o que os agentes da área propõem e entregam.

    Args:
        area: id do tipo de área ou o nome da área.
        nome: nome completo.
        email: e-mail institucional ou corporativo (é o login no GestorGov).
        cargo: cargo da pessoa, se disser.
    """
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _bloqueada(run_context, oid, "responsaveis"):
        return erro
    alvo, nao_existe = _area(oid, area)
    if not alvo:
        return nao_existe
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email or ""):
        return "E-mail inválido. Peça o e-mail da pessoa."
    pessoa = gestao.salvar_pessoa(oid, nome=nome, email=email, cargo=cargo, area_id=str(alvo["id"]),
                                  papel="coordenador", aprova_tarefas=True, responsavel_da_area=True,
                                  quem=_quem(run_context), session_id=_sessao(run_context))
    return _feito(oid, {"salvo": True, "area": alvo["nome"], "responsavel": {k: pessoa.get(k) for k in ("nome", "email", "cargo")}})


def sugerir_cargos(run_context: RunContext) -> str:
    """Os cargos do catálogo do segmento que cabem nas áreas da organização (na saúde: secretário, adjunto,
    superintendências, coordenações...; numa empresa: diretoria e gerências), com a área e a quem respondem. Só
    SUGESTÃO: nada é gravado. Mostre por área e grave só os que forem confirmados, com salvar_cargos."""
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    from agente import acessos

    por_area: dict[str, list[dict]] = {}
    for c in acessos.cargos_sugeridos(oid):
        por_area.setdefault(c["area"] or "Direção e apoio", []).append(
            {k: c[k] for k in ("id", "nome", "nivel", "superior", "ja_criado")})
    return _json({"sugeridos_por_area": por_area})


def salvar_cargos(run_context: RunContext, cargos: list[str]) -> str:
    """Grava os cargos do catálogo que foram CONFIRMADOS (ids de sugerir_cargos), com a hierarquia, os indicadores e
    as permissões sugeridas. Cargo fora do catálogo: criar_cargo.

    Args:
        cargos: ids de sugerir_cargos (ex.: ["secretario", "sup_regulacao"]).
    """
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _bloqueada(run_context, oid, "cargos"):
        return erro
    from agente import acessos

    validos = {c["id"] for c in acessos.cargos_sugeridos(oid)}
    escolhidos = [c for c in cargos or [] if c in validos]
    criados = acessos.montar_organograma_padrao(oid, _quem(run_context), escolhidos)
    por_area: dict[str, list[str]] = {}
    nomes = {str(s["id"]): s["nome"] for s in gestao.areas(oid)}
    for c in acessos.cargos(oid):
        por_area.setdefault(nomes.get(str(c.get("area_id")), "Direção e apoio"), []).append(c["nome"])
    return _feito(oid, {"criados_agora": criados, "ids_invalidos": [c for c in cargos or [] if c not in validos],
                        "cargos_por_area": por_area})


def criar_cargo(run_context: RunContext, nome: str, area: str, nivel: str = "coordenacao", superior: str = "") -> str:
    """Cria um cargo que o organograma padrão não tem, na sala de uma área.

    Args:
        nome: nome do cargo (ex.: Coordenador de Saúde Bucal, Gerente de Vendas).
        area: a área (sala) do cargo, pelo nome ou tipo.
        nivel: direcao, superintendencia, coordenacao, unidade ou controle.
        superior: nome do cargo a quem ele responde (opcional).
    """
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _bloqueada(run_context, oid, "cargos"):
        return erro
    from agente import acessos

    alvo, nao_existe = _area(oid, area)
    if not alvo:
        return nao_existe
    chefe = next((c for c in acessos.cargos(oid) if superior and c["nome"].lower() == superior.lower()), None)
    try:
        cargo = acessos.criar_cargo(oid, {"nome": nome, "nivel": nivel, "superior_id": chefe["id"] if chefe else None,
                                          "area_id": str(alvo["id"]),
                                          "permissoes": list(acessos.PADRAO_POR_NIVEL.get(nivel, ()))}, _quem(run_context))
    except acessos.ErroAcesso as erro:
        return erro.detalhe
    return _feito(oid, {"criado": cargo.get("nome"), "area": alvo["nome"]})


def dar_acesso(run_context: RunContext, nome: str, email: str, cargo: str = "") -> str:
    """Cadastra uma pessoa que vai usar o GestorGov (conversar com os agentes, ver e registrar dados), no cargo dela.
    O acesso fica AGUARDANDO A APROVAÇÃO do dono da organização no painel (Equipe e acessos), que gera o link de
    entrada. Cadastre pelo menos os responsáveis de cada área.

    Args:
        nome: nome completo.
        email: e-mail institucional ou corporativo (é o login).
        cargo: nome do cargo no organograma (ex.: Superintendente de Atenção Primária, Gerente Financeiro).
    """
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _bloqueada(run_context, oid, "equipe"):
        return erro
    from agente import acessos

    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email or ""):
        return "E-mail inválido. Peça o e-mail da pessoa."
    lista = acessos.cargos(oid)
    escolhido = next((c for c in lista if cargo and c["nome"].lower() == cargo.lower()), None)
    if cargo and not escolhido:
        return f"O cargo '{cargo}' não existe. Cargos: {', '.join(c['nome'] for c in lista[:40])}."
    try:
        acessos.convidar(oid, email, nome, escolhido["id"] if escolhido else None, _quem(run_context), origem="assistente")
    except acessos.ErroAcesso as erro:
        return erro.detalhe
    return _feito(oid, {"cadastrado": nome, "email": email.lower(), "cargo": escolhido["nome"] if escolhido else None,
                        "situacao": "aguardando a aprovação do dono no painel (Equipe e acessos)"})


def montar_agentes(run_context: RunContext) -> str:
    """Cria o agente de IA de cada área (os robôs que sentam nas salas do prédio), da organização, e liga a ele as
    atividades da área. Pode rodar de novo: só cria o que falta."""
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _bloqueada(run_context, oid, "agentes"):
        return erro
    from agente import agentes_organizacao

    resultado = agentes_organizacao.criar_agentes_das_areas(oid, _quem(run_context))
    _sincronizar_trabalho(oid, _quem(run_context))
    return _feito(oid, {**resultado, "orientacao": "Conte quantos agentes sentaram nas salas."})


def _sincronizar_trabalho(oid: str, quem: str) -> None:
    """Cada área vira um Product no CompanyOS, cada atividade um Project com o processo padrão (agente/trabalho.py)."""
    from agente import trabalho

    try:
        trabalho.sincronizar(oid, quem)
    except Exception as erro:  # o cadastro já está gravado; o CompanyOS é montado de novo na conclusão
        from agno.utils.log import log_warning

        log_warning(f"CompanyOS: não deu para montar a organização {oid}: {type(erro).__name__}: {erro}")


def _agente_das_unidades(run_context: RunContext, oid: str) -> str | None:
    """O agente das unidades da organização (criado na primeira unidade) passa a cuidar das unidades novas."""
    from agente import agentes_organizacao

    agente_id = agentes_organizacao.agente_das_unidades(oid, _quem(run_context))
    gestao.sincronizar_etapa(oid)
    return agente_id


# Quanto a ferramenta espera a importação do CNES terminar antes de responder "ainda importando".
ESPERA_CNES_SEGUNDOS = 45


def _resultado_cnes(run_context: RunContext, oid: str, execucao: dict | None) -> str:
    """A resposta das ferramentas do CNES conforme a situação da importação (agente/segundo_plano.py)."""
    if execucao is None:
        return "Nenhuma importação do CNES nesta implantação. Use importar_unidades_cnes."
    if execucao["situacao"] in segundo_plano.ATIVAS:
        feitas = (execucao.get("progresso") or {}).get("gravadas")
        return _json({"importacao": "em andamento", "unidades_gravadas_ate_agora": feitas or 0,
                      "orientacao": "Diga que a importação do CNES está rodando e que os pinos aparecem no mapa conforme "
                                    "chegam. Na próxima mensagem, use acompanhar_importacao (nunca importe de novo)."})
    resultado = execucao.get("resultado") or {}
    if execucao["situacao"] == "erro" or not resultado.get("importadas"):
        motivo = "erro na fonte" if execucao["situacao"] == "erro" else resultado.get("motivo") or "sem resultados"
        return (f"O CNES não respondeu ({motivo}). Pergunte quantas e quais unidades a rede tem "
                "(UBS, UPA, CAPS, hospital...) e cadastre com cadastrar_unidade.")
    agente_unidades = _agente_das_unidades(run_context, oid)
    return _feito(oid, {"importadas": resultado["importadas"], "por_tipo": resultado.get("por_tipo") or {},
                        "particulares_fora": resultado.get("particulares_fora") or 0,
                        "agente_das_unidades": agente_unidades,
                        "orientacao": "Mostre o resumo por tipo (são as unidades públicas e as conveniadas ao SUS; os "
                                      "consultórios particulares ficaram de fora) e pergunte se está certo e se falta "
                                      "alguma."})


def importar_unidades_cnes(run_context: RunContext) -> str:
    """(Saúde pública) Traz do CNES (dados abertos do Ministério da Saúde) as unidades públicas e as conveniadas ao SUS
    do município e grava como "a conferir". Mostre o resumo por tipo e peça para conferir. Se a importação ainda
    estiver rodando, avise e use acompanhar_importacao na próxima mensagem. Se a fonte não responder, siga com
    cadastrar_unidade, uma por uma."""
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if not gestao.segmento_de(oid).usa_cnes:
        return "O CNES é só das unidades de saúde. Cadastre as unidades com cadastrar_unidade (pelo CEP)."
    if erro := _bloqueada(run_context, oid, "unidades"):
        return erro
    atual = segundo_plano.ultima("importar_cnes", organizacao_id=oid)
    if atual and atual["situacao"] in segundo_plano.ATIVAS:  # já há uma rodando: acompanha a mesma
        return _resultado_cnes(run_context, oid, segundo_plano.esperar(atual["id"], ESPERA_CNES_SEGUNDOS))
    from tarefas import cnes

    execucao_id = segundo_plano.disparar(
        "importar_cnes", [oid], organizacao_id=oid, referencia=f"cnes:{oid}", criado_por=_quem(run_context),
        contexto={"quem": _quem(run_context), "session_id": _sessao(run_context)},
        local=lambda eid: cnes.importar_cnes(eid, oid))
    return _resultado_cnes(run_context, oid, segundo_plano.esperar(execucao_id, ESPERA_CNES_SEGUNDOS))


def acompanhar_importacao(run_context: RunContext) -> str:
    """(Saúde pública) A situação da importação do CNES que está rodando (ou da última): quantas unidades já chegaram
    e, no fim, o resumo por tipo para conferir."""
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _bloqueada(run_context, oid, "unidades"):
        return erro
    atual = segundo_plano.ultima("importar_cnes", organizacao_id=oid)
    return _resultado_cnes(run_context, oid, segundo_plano.esperar(atual["id"], 10) if atual else None)


def cadastrar_unidade(run_context: RunContext, nome: str, tipo: str, cep: str = "", numero: str = "",
                      endereco: str = "", bairro: str = "", cnes: str = "") -> str:
    """Cadastra (ou corrige) uma unidade da organização (na saúde: UBS, UPA...; numa empresa: matriz, filial, loja,
    depósito...). Com o CEP, o endereço vem do ViaCEP e o número põe o pino no lugar certo do mapa. Sem CEP, use a
    rua e o bairro.

    Args:
        nome: nome da unidade (ex.: UBS Jardim Primavera, Loja Centro).
        tipo: o id do tipo de unidade do segmento (a lista vem na recusa, se o tipo não existir).
        cep: CEP da unidade (8 dígitos). O jeito preferido: peça sempre.
        numero: número do prédio na rua.
        endereco: rua, só se não houver CEP (ou se o CEP for de uma cidade inteira, sem rua).
        bairro: bairro, só se não houver CEP.
        cnes: código CNES da unidade de saúde, se souber.
    """
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _bloqueada(run_context, oid, "unidades"):
        return erro
    org = gestao.organizacao(oid)
    seg = segmentos.de(org)
    tipos = {t["id"] for t in gestao.tipos_unidade(seg.id)}
    if tipo not in tipos:
        return f"Tipo inválido. Use um destes: {', '.join(sorted(tipos))}."
    achado = gestao.endereco_por_cep(cep, numero) if cep else None
    if cep and not achado:
        return "CEP não encontrado no ViaCEP. Confira os 8 dígitos ou cadastre pela rua e bairro."
    # Na saúde, as unidades são do município da secretaria; uma empresa pode ter unidades em outras cidades.
    if achado and seg.um_por_municipio and str(achado.get("codigo_ibge") or "") != str(org.get("codigo_ibge") or ""):
        return (f"Esse CEP é de {achado.get('municipio')}-{achado.get('uf')}, não de {org.get('cidade')}-{org.get('uf')}. "
                "Confira o CEP.")
    if achado:
        rua, bairro_final = (achado.get("logradouro") or endereco), (achado.get("bairro") or bairro)
        ponto = (achado["latitude"], achado["longitude"], achado["coordenadas_origem"]) if achado.get("latitude") else None
    else:
        rua, bairro_final = endereco, bairro
        ponto = gestao.localizar(logradouro=endereco, numero=numero, bairro=bairro, municipio=org.get("cidade") or "",
                                 uf=org.get("uf") or "") if (endereco or bairro) else None
    unidade = gestao.salvar_unidade(oid, nome=nome, tipo_id=tipo, endereco=rua, numero=numero, bairro=bairro_final,
                                    cep=cep, cnes=cnes if seg.usa_cnes else "", latitude=ponto[0] if ponto else None,
                                    longitude=ponto[1] if ponto else None, coordenadas_origem=ponto[2] if ponto else None,
                                    quem=_quem(run_context), session_id=_sessao(run_context))
    _agente_das_unidades(run_context, oid)
    return _feito(oid, {"salva": True, "unidade": {k: unidade.get(k) for k in ("id", "nome", "tipo_id", "endereco", "numero",
                                                                               "bairro", "cep")},
                        "no_mapa": bool(ponto), "ponto_pelo": ponto[2] if ponto else None})


def situacao_implantacao(run_context: RunContext, ir_para_revisao: bool = False) -> str:
    """O que já foi cadastrado nesta organização: áreas, atividades, responsáveis, agentes e unidades. Use para
    resumir e decidir a próxima etapa.

    Args:
        ir_para_revisao: true quando disserem que as unidades estão completas OU que vão cadastrá-las depois (as
            unidades podem ser cadastradas pelo assistente depois da implantação).
    """
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if ir_para_revisao:
        gestao.marcar_unidades_confirmadas(oid)
    fase = gestao.sincronizar_etapa(oid)
    p = gestao.panorama(oid)
    unidades = p.get("unidades", [])
    por_tipo: dict[str, int] = {}
    for u in unidades:
        por_tipo[u["tipo_id"]] = por_tipo.get(u["tipo_id"], 0) + 1
    return _json({
        "organizacao": {k: p["organizacao"].get(k) for k in ("nome", "cidade", "uf", "situacao")},
        "segmento": p["segmento"]["nome"],
        "fase_atual": fase,
        "pendencias_por_fase": {f: itens for f, itens in gestao.pendencias(oid).items() if itens},
        "unidades": {"total": len(unidades), "por_tipo": por_tipo,
                     "a_conferir": sum(1 for u in unidades if not u.get("confirmada"))},
        "areas": [{"nome": s["nome"], "atividades": len(s["atividades"]),
                   "responsavel": (s.get("responsavel") or {}).get("nome"),
                   "agentes": [a["agente_id"] for a in s["agentes"]]} for s in p.get("areas", [])],
    })


def concluir_implantacao(run_context: RunContext) -> str:
    """Encerra a implantação: a organização passa a ativa. Só funciona com todas as fases completas (inclusive os
    acessos aprovados no painel) e depois de confirmado o resumo final."""
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return _sem_organizacao()
    if erro := _bloqueada(run_context, oid, "revisao"):
        return erro
    gestao.concluir_onboarding(oid, quem=_quem(run_context), session_id=_sessao(run_context))
    _sincronizar_trabalho(oid, _quem(run_context))
    return "Implantação concluída. A organização está ativa; os agentes começam as rotinas no próximo horário."


FERRAMENTAS_IMPLANTACAO = [
    buscar_municipio, registrar_organizacao, salvar_dados_prefeitura, salvar_dados_secretaria, salvar_dados_empresa,
    buscar_endereco, pesquisar_na_web, listar_tipos_area, salvar_areas, sugerir_atividades, salvar_atividades,
    nova_atividade, sugerir_cargos, salvar_cargos, criar_cargo, cadastrar_responsavel, montar_agentes, dar_acesso,
    importar_unidades_cnes, acompanhar_importacao, cadastrar_unidade, situacao_implantacao, concluir_implantacao,
]


# ───────────────────────── Consulta (agentes das áreas) ─────────────────────────

def consultar_organizacao(run_context: RunContext, area: str = "") -> str:
    """O que a organização tem: as áreas, os responsáveis (quem aprova) e as atividades de cada área. Com `area`,
    só ela.

    Args:
        area: id do tipo de área (ex.: regulacao) ou nome; vazio traz todas.
    """
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return "Nenhuma organização cadastrada ainda: a implantação não foi feita."
    p = gestao.panorama(oid)
    lista = p.get("areas", [])
    if area:
        alvo = gestao.area_por_tipo_ou_nome(oid, area)
        lista = [s for s in lista if alvo and s["id"] == str(alvo["id"])]
    return _json({
        "organizacao": p["organizacao"]["nome"],
        "areas": [{"nome": s["nome"], "responsavel": (s.get("responsavel") or {}).get("nome"),
                   "atividades": [{k: a[k] for k in ("nome", "descricao", "tipo", "frequencia", "entregavel")}
                                  for a in s["atividades"] if a.get("ativa", True)]} for s in lista],
    })


def listar_unidades(run_context: RunContext, tipo: str = "") -> str:
    """As unidades da organização, com tipo, endereço e (na saúde) o CNES.

    Args:
        tipo: filtra pelo id do tipo de unidade; vazio traz todas.
    """
    if erro := _sem_banco():
        return erro
    oid = _organizacao(run_context)
    if not oid:
        return "Nenhuma organização cadastrada ainda: a implantação não foi feita."
    return _json([{k: u.get(k) for k in ("nome", "tipo_id", "cnes", "endereco", "bairro", "telefone", "situacao")}
                  for u in gestao.unidades(oid, tipo or None)])


# ───────────────────────── Dados pela ficha do agente (agente/dados_agente.py) ─────────────────────────

def _do_agente(run_context: RunContext) -> tuple[str | None, str | None]:
    """O agente que chamou e a organização dele (só os agentes de uma organização leem os dados dela)."""
    from agente import fabrica

    agente_id = getattr(run_context, "agent_id", None)
    return agente_id, fabrica.organizacao_do_agente(agente_id)


def consultar_dados(run_context: RunContext, dominio: str, filtro: str = "") -> str:
    """Consulta os dados da organização que a sua ficha libera, no seu escopo (a sua área ou a organização).

    Args:
        dominio: unidades, atividades, indicadores, entregas ou equipe.
        filtro: um trecho do nome para filtrar (opcional).
    """
    from agente import dados_agente

    agente_id, oid = _do_agente(run_context)
    if not oid:
        return "Este agente não é de uma organização: não há dados para consultar."
    try:
        return _json({"dominio": dominio, "registros": dados_agente.ler(oid, agente_id, dominio, filtro)})
    except dados_agente.ErroDados as erro:
        return erro.detalhe


def propor_tarefa(run_context: RunContext, titulo: str, o_que_fazer: str, evidencia: str = "", atividade: str = "") -> str:
    """Propõe uma tarefa da sua área. Ela NÃO começa sozinha: espera o aceite do responsável (no painel, em
    Aprovações). Use quando a análise mostrar algo que precisa de atenção, ou quando alguém pedir um trabalho.

    Args:
        titulo: título curto (ex.: "14 pacientes há mais de 90 dias na fila de cardiologia").
        o_que_fazer: o que precisa ser feito, em uma a três frases.
        evidencia: de onde veio a informação (documento, indicador, data), para quem aceita conferir.
        atividade: o nome da atividade da sua área (na rotina, vazio: a atividade da rotina).
    """
    from agente import trabalho

    agente_id, oid = _do_agente(run_context)
    if not oid:
        return "Este agente não é de uma organização: não há onde propor a tarefa."
    estado = run_context.session_state or {}
    atividade_id = estado.get("atividade_id")
    if not atividade_id:
        areas = {a["area_id"] for a in gestao.agentes_area(oid) if a["agente_id"] == agente_id}
        minhas = [a for a in gestao.atividades(oid) if a["area_id"] in areas]
        alvo = gestao._sem_acento(atividade)
        escolhida = next((a for a in minhas if alvo and gestao._sem_acento(a["nome"]) == alvo), None) or \
            next((a for a in minhas if alvo and alvo in gestao._sem_acento(a["nome"])), None)
        if not escolhida:
            return ("Diga a atividade da sua área (no campo atividade). As atividades: "
                    + ", ".join(a["nome"] for a in minhas[:20]) + ".")
        atividade_id = str(escolhida["id"])
    try:
        tarefa = trabalho.propor(oid, atividade_id, titulo, o_que_fazer, evidencia,
                                 origem="agent" if estado.get("rotina") else "human",
                                 quem=agente_id or "agente", session_id=_sessao(run_context))
    except trabalho.ErroTrabalho as erro:
        return erro.detalhe
    return _json({"tarefa": tarefa["id"], "situacao": "esperando aceite",
                  "orientacao": "Diga que a tarefa foi proposta e espera o aceite do responsável, em Aprovações."})


FERRAMENTAS_DADOS = [consultar_dados, propor_tarefa]
FERRAMENTAS_CONSULTA = [consultar_organizacao, listar_unidades, *FERRAMENTAS_DADOS]
