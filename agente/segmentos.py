"""Os segmentos que o GestorGov atende: Saúde pública e Empresa.

O motor é o mesmo (organização → áreas → atividades → agentes → pessoa que aprova); o que muda por segmento:
- os nomes de tela (setor ou departamento, servidor ou funcionário, Secretaria virtual ou Escritório virtual);
- os campos do cadastro da organização (os obrigatórios para a fase 1 da implantação);
- os modelos (tipos de área, de unidade, atividades, cargos e indicadores), que ficam nas migrations com o
  segmento_id (tabela `segmentos`);
- as fontes externas (na saúde, o CNES e o IBGE).

Campos do cadastro: a chave é uma coluna de `organizacoes` ou, com o prefixo "dados.", uma chave de
`organizacoes.dados_segmento` (o que é só do segmento: na saúde, a prefeitura, o Fundo e o prefeito).
"""

from dataclasses import dataclass, field

TIPOS_CAMPO = ("texto", "cnpj", "cep", "telefone", "email", "inteiro", "uf", "site")


@dataclass(frozen=True)
class Campo:
    chave: str          # coluna de organizacoes ou "dados.<chave>" (dados_segmento)
    rotulo: str
    tipo: str = "texto"
    obrigatorio: bool = True
    grupo: str = ""     # para a tela e para o assistente agruparem (ex.: "Prefeitura", "Secretaria")


@dataclass(frozen=True)
class Segmento:
    id: str
    nome: str
    rotulos: dict[str, str]
    campos: tuple[Campo, ...]
    usa_cnes: bool = False          # importa as unidades do CNES (dados abertos do Ministério da Saúde)
    um_por_municipio: bool = False  # uma organização por município (a Secretaria de Saúde)
    exemplos_unidade: str = ""
    extras: dict = field(default_factory=dict)

    def campo(self, chave: str) -> Campo | None:
        return next((c for c in self.campos if c.chave == chave or c.chave == f"dados.{chave}"), None)

    def para_tela(self) -> dict:
        return {"id": self.id, "nome": self.nome, "rotulos": self.rotulos, "usa_cnes": self.usa_cnes,
                "campos": [{"chave": c.chave, "rotulo": c.rotulo, "tipo": c.tipo, "obrigatorio": c.obrigatorio,
                            "grupo": c.grupo} for c in self.campos]}


SAUDE = Segmento(
    id="saude_publica",
    nome="Saúde pública",
    usa_cnes=True,
    um_por_municipio=True,
    exemplos_unidade="UBS, UPA, CAPS, hospital, farmácia, SAMU",
    rotulos={
        "organizacao": "Secretaria de Saúde",
        "organizacao_curta": "secretaria",
        "area": "setor", "areas": "setores", "Area": "Setor", "Areas": "Setores",
        "unidade": "unidade de saúde", "unidades": "unidades de saúde",
        "Unidade": "Unidade de saúde", "Unidades": "Unidades de saúde",
        "pessoa": "servidor", "pessoas": "servidores", "Pessoas": "Servidores",
        "responsavel": "secretário(a) de saúde",
        "predio": "Secretaria virtual",
        "mapa": "Cidade",
        "centro": "CCO",  # o centro do prédio: Centro de Comando e Operações
    },
    campos=(
        Campo("dados.prefeitura_cnpj", "CNPJ da prefeitura", "cnpj", grupo="Prefeitura"),
        Campo("dados.prefeitura_cep", "CEP da prefeitura", "cep", grupo="Prefeitura"),
        Campo("dados.prefeitura_logradouro", "Rua da prefeitura", grupo="Prefeitura"),
        Campo("dados.prefeitura_numero", "Número da prefeitura", grupo="Prefeitura"),
        Campo("dados.prefeitura_bairro", "Bairro da prefeitura", grupo="Prefeitura"),
        Campo("dados.prefeitura_telefone", "Telefone da prefeitura", "telefone", grupo="Prefeitura"),
        Campo("dados.prefeitura_email", "E-mail da prefeitura", "email", obrigatorio=False, grupo="Prefeitura"),
        Campo("dados.prefeitura_site", "Site da prefeitura", "site", obrigatorio=False, grupo="Prefeitura"),
        Campo("dados.prefeito_nome", "Nome do(a) prefeito(a)", grupo="Prefeitura"),
        Campo("populacao", "População", "inteiro", obrigatorio=False, grupo="Prefeitura"),
        Campo("nome", "Nome oficial da Secretaria de Saúde", grupo="Secretaria"),
        Campo("sigla", "Sigla da secretaria", obrigatorio=False, grupo="Secretaria"),
        Campo("dados.fundo_cnpj", "CNPJ do Fundo Municipal de Saúde", "cnpj", grupo="Secretaria"),
        Campo("cnpj", "CNPJ da secretaria (se tiver um próprio)", "cnpj", obrigatorio=False, grupo="Secretaria"),
        Campo("cep", "CEP da secretaria", "cep", grupo="Secretaria"),
        Campo("logradouro", "Rua da secretaria", grupo="Secretaria"),
        Campo("numero", "Número da secretaria", grupo="Secretaria"),
        Campo("complemento", "Complemento", obrigatorio=False, grupo="Secretaria"),
        Campo("bairro", "Bairro da secretaria", grupo="Secretaria"),
        Campo("telefone", "Telefone da secretaria", "telefone", grupo="Secretaria"),
        Campo("email", "E-mail institucional da secretaria", "email", grupo="Secretaria"),
        Campo("site", "Site da secretaria", "site", obrigatorio=False, grupo="Secretaria"),
        Campo("responsavel_nome", "Nome do(a) secretário(a) de saúde", grupo="Secretário(a)"),
        Campo("responsavel_email", "E-mail do(a) secretário(a)", "email", grupo="Secretário(a)"),
        Campo("responsavel_telefone", "Telefone do(a) secretário(a)", "telefone", grupo="Secretário(a)"),
    ),
)

EMPRESA = Segmento(
    id="empresa",
    nome="Empresa",
    exemplos_unidade="matriz, filial, loja, depósito, fábrica",
    rotulos={
        "organizacao": "Empresa",
        "organizacao_curta": "empresa",
        "area": "departamento", "areas": "departamentos", "Area": "Departamento", "Areas": "Departamentos",
        "unidade": "unidade", "unidades": "unidades", "Unidade": "Unidade", "Unidades": "Unidades",
        "pessoa": "funcionário", "pessoas": "funcionários", "Pessoas": "Funcionários",
        "responsavel": "diretor(a)",
        "predio": "Escritório virtual",
        "mapa": "Mapa",
        "centro": "Sala de comando",
    },
    campos=(
        Campo("nome", "Razão social", grupo="Empresa"),
        Campo("sigla", "Nome fantasia", obrigatorio=False, grupo="Empresa"),
        Campo("cnpj", "CNPJ", "cnpj", grupo="Empresa"),
        Campo("dados.ramo", "Ramo de atividade", grupo="Empresa"),
        Campo("dados.funcionarios", "Número de funcionários", "inteiro", obrigatorio=False, grupo="Empresa"),
        Campo("cep", "CEP da sede", "cep", grupo="Sede"),
        Campo("logradouro", "Rua da sede", grupo="Sede"),
        Campo("numero", "Número da sede", grupo="Sede"),
        Campo("complemento", "Complemento", obrigatorio=False, grupo="Sede"),
        Campo("bairro", "Bairro da sede", grupo="Sede"),
        Campo("cidade", "Cidade da sede", grupo="Sede"),
        Campo("uf", "UF da sede", "uf", grupo="Sede"),
        Campo("telefone", "Telefone da empresa", "telefone", grupo="Empresa"),
        Campo("email", "E-mail da empresa", "email", grupo="Empresa"),
        Campo("site", "Site da empresa", "site", obrigatorio=False, grupo="Empresa"),
        Campo("responsavel_nome", "Nome do(a) diretor(a) responsável", grupo="Diretor(a)"),
        Campo("responsavel_cargo", "Cargo do(a) responsável", obrigatorio=False, grupo="Diretor(a)"),
        Campo("responsavel_email", "E-mail do(a) responsável", "email", grupo="Diretor(a)"),
        Campo("responsavel_telefone", "Telefone do(a) responsável", "telefone", grupo="Diretor(a)"),
    ),
)

SEGMENTOS: dict[str, Segmento] = {s.id: s for s in (SAUDE, EMPRESA)}
PADRAO = SAUDE.id


def segmento(segmento_id: str | None) -> Segmento:
    """O segmento pelo id (o padrão, Saúde pública, se vier vazio ou desconhecido)."""
    return SEGMENTOS.get(segmento_id or "", SEGMENTOS[PADRAO])


def de(organizacao: dict | None) -> Segmento:
    return segmento((organizacao or {}).get("segmento_id"))


def rotulo(organizacao: dict | None, chave: str) -> str:
    return de(organizacao).rotulos.get(chave, chave)
