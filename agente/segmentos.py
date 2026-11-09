"""Os segmentos que o GestorGov atende. Nesta versão, só a Saúde pública (setor público).

O motor é o mesmo (organização → áreas → atividades → agentes → pessoa que aprova); o que muda por segmento:
- os nomes de tela (setor, servidor, Secretaria virtual);
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

# Segmentos novos entram aqui (um Segmento com os nomes de tela e os campos) e em SEGMENTOS, com o catálogo
# dele numa migration (segmento_id). O segmento Empresa saiu em 13/11/2026: o foco é o setor público.

SEGMENTOS: dict[str, Segmento] = {s.id: s for s in (SAUDE,)}
PADRAO = SAUDE.id


def segmento(segmento_id: str | None) -> Segmento:
    """O segmento pelo id (o padrão, Saúde pública, se vier vazio ou desconhecido)."""
    return SEGMENTOS.get(segmento_id or "", SEGMENTOS[PADRAO])


def de(organizacao: dict | None) -> Segmento:
    return segmento((organizacao or {}).get("segmento_id"))


def rotulo(organizacao: dict | None, chave: str) -> str:
    return de(organizacao).rotulos.get(chave, chave)
