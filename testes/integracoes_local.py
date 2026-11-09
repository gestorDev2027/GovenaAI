"""Teste local da Central de integrações (SQLite, sem DATABASE_URL e sem o Toolbox).

    .venv\\Scripts\\python -m testes.integracoes_local

Confere: o cadastro com o segredo no cofre (e nunca de volta), a ficha (só integrações da organização), a montagem
das ferramentas (só no agente liberado), a chamada auditada sem dados, o limite por minuto, o pedido de aprovação
das ferramentas que alteram dados e a configuração do Toolbox sem o segredo no arquivo. A chamada HTTP de verdade
usa https://httpbin.org (precisa de internet; sem ela, a chamada fica registrada como erro e o resto passa).
"""

import json
import os
import tempfile
from pathlib import Path

os.environ.pop("DATABASE_URL", None)
os.environ.setdefault("GOOGLE_API_KEY", "teste-sem-chamada")

SEGREDO = "chave-secreta-de-teste-1234"


def main() -> None:
    from agente import agente as nucleo
    from agente import dados_agente, fabrica, gestao, integracoes, perfis, toolbox

    banco = Path(tempfile.mkdtemp()) / "teste.db"
    nucleo.criar_agentes(arquivo_banco=str(banco))

    org = gestao.registrar_organizacao(segmento_id="empresa", nome="Empresa Teste", quem="dono@teste.gov.br", cnpj="")
    outra = gestao.registrar_organizacao(segmento_id="empresa", nome="Outra Empresa", quem="dono@outra.gov.br", cnpj="")
    oid, oid2 = str(org["id"]), str(outra["id"])
    modelo = {"nome": "Agente Teste", "area": "Financeiro", "descricao": "Agente de teste da Central.",
              "ferramentas": ["consultar_organizacao"], "minutos_inatividade": 60, "categorias": {}}
    for aid in ("agente-liberado", "agente-sem"):
        fabrica.criar(aid, modelo, "teste")
        fabrica.definir_organizacao(aid, oid)

    # 1. Cadastro: o segredo vai para o cofre e não volta.
    integ = integracoes.salvar(oid, None, {"tipo": "http", "nome": "API de teste", "endereco": "https://httpbin.org",
                                           "config": {"cabecalho_segredo": "X-Api-Key"}, "limite_por_minuto": 3,
                                           "segredo": SEGREDO}, "dono@teste.gov.br")
    assert SEGREDO not in json.dumps(integracoes.integracoes(oid)), "o segredo voltou na lista"
    assert integ["tem_segredo"] and integ["hosts_liberados"] == ["httpbin.org"]
    assert integracoes.ler_segredo(integracoes._integracao(oid, integ["id"])) == SEGREDO
    integracoes.salvar_ferramenta(oid, integ["id"], None, {
        "nome": "consultar_eco", "descricao": "Devolve os parâmetros enviados (teste de leitura da Central).",
        "metodo": "GET", "caminho": "/get", "parametros": [{"nome": "termo", "tipo": "string", "descricao": "O termo", "local": "query"}]},
        "dono@teste.gov.br")
    escrita = integracoes.salvar_ferramenta(oid, integ["id"], None, {
        "nome": "gravar_eco", "descricao": "Envia um registro para o outro sistema (teste de escrita da Central).",
        "metodo": "PUT", "caminho": "/put", "parametros": [{"nome": "valor", "tipo": "integer", "descricao": "O valor", "local": "body"}]},
        "dono@teste.gov.br")
    assert escrita["altera_dados"], "PUT precisa ser marcado como altera dados"
    print("ok  cadastro, segredo no cofre e ferramentas")

    # 2. Ficha: integração de outra organização é recusada.
    de_fora = integracoes.salvar(oid2, None, {"tipo": "http", "nome": "Outra API", "endereco": "https://httpbin.org"}, "dono@outra.gov.br")
    try:
        dados_agente.salvar_ficha(oid, "agente-liberado", {"integracoes": [de_fora["id"]]}, "dono@teste.gov.br")
        raise AssertionError("a ficha aceitou integração de outra organização")
    except dados_agente.ErroDados:
        pass
    dados_agente.salvar_ficha(oid, "agente-liberado", {"integracoes": [integ["id"]]}, "dono@teste.gov.br")
    fabrica._recompor("agente-liberado")
    print("ok  ficha só com integrações da organização")

    # 3. Só o agente liberado recebe as ferramentas; nenhum texto leva o segredo.
    def nomes(aid):
        return {getattr(f, "name", None): f for f in perfis.PERFIS[aid].ferramentas()}

    liberado, sem = nomes("agente-liberado"), nomes("agente-sem")
    eco, gravar = liberado.get("api_de_teste__consultar_eco"), liberado.get("api_de_teste__gravar_eco")
    assert eco and gravar, f"ferramentas não montadas: {list(liberado)}"
    assert not [n for n in sem if n and n.startswith("api_de_teste")], "o agente sem a ficha recebeu a integração"
    assert "termo" in eco.parameters["properties"] and SEGREDO not in json.dumps(eco.parameters) + eco.description
    assert "ALTERA DADOS" in gravar.description
    print("ok  ferramentas só no agente liberado")

    # 4. Chamada auditada (sem dados), aprovação e limite.
    resposta = eco.entrypoint(termo="saude")
    rede = '"termo"' in resposta
    print(f"{'ok ' if rede else 'aviso'} chamada HTTP {'respondeu' if rede else 'sem rede: ' + resposta[:120]}")
    if rede:
        assert SEGREDO in resposta, "a chave não foi no cabeçalho (httpbin devolve os cabeçalhos)"  # só o eco do httpbin
    pedido = json.loads(gravar.entrypoint(valor=7))
    assert pedido["situacao"] == "aguardando_aprovacao"
    assert [p for p in integracoes.pedidos(oid) if p["id"] == pedido["pedido"]][0]["argumentos"] == {"valor": 7}
    decisao = integracoes.decidir(oid, pedido["pedido"], True, "aprovador@teste.gov.br")
    assert decisao["situacao"] in ("ok", "erro") and not integracoes.pedidos(oid)
    for _ in range(4):
        eco.entrypoint(termo="x")
    situacoes = [c["situacao"] for c in integracoes.chamadas(oid)]
    assert "recusada" in situacoes, "o limite por minuto não segurou"
    auditoria = json.dumps(integracoes.chamadas(oid))
    assert SEGREDO not in auditoria and "saude" not in auditoria, "a auditoria guardou dado"
    print(f"ok  auditoria ({len(situacoes)} chamadas: {sorted(set(situacoes))}), aprovação e limite")

    # 5. Configuração do Toolbox: o segredo só no ambiente do processo.
    yaml_texto, ambiente, total = toolbox.montar_configuracao()
    assert total == 2 and SEGREDO not in yaml_texto and SEGREDO in ambiente.values()
    assert "${GG_SEGREDO_" in yaml_texto and "kind: toolset" in yaml_texto
    print("ok  tools.yaml sem segredo (vai só no ambiente do Toolbox)")
    # 6. Com o binário (GESTORGOV_TOOLBOX_BIN), o Toolbox real: a mesma ferramenta passa por ele.
    if os.getenv("GESTORGOV_TOOLBOX_BIN"):
        os.environ["GESTORGOV_TOOLBOX"] = "sim"
        toolbox.reiniciar()
        assert toolbox.ligado(), toolbox.situacao()["texto"]
        try:
            import psutil

            memoria = psutil.Process(toolbox._estado["processo"].pid).memory_info().rss // 2**20
        except ImportError:
            memoria = "?"
        resposta = eco.entrypoint(termo="pelo-toolbox")
        assert "pelo-toolbox" in resposta, resposta[:300]
        print(f"ok  Toolbox real respondeu ({toolbox.situacao()['texto']} Memória do processo: {memoria} MB)")
        toolbox._parar()


if __name__ == "__main__":
    main()
