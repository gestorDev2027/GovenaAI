/*
 * As salas do escritório da Central ao vivo (não confundir com as áreas da organização) e o que leva um agente até
 * cada uma. O agente sai da mesa quando usa uma ferramenta (aviso "ferramenta" do /secretaria/eventos), vai à sala
 * dela, busca e volta.
 */

export type SetorId = "atendimento" | "recepcao" | "secretaria" | "fontes" | "base" | "implantacao" | "catalogo" | "equipe";

export interface Setor {
  nome: string;
  /** O que acontece ali, em uma frase (subtítulo do painel). */
  descricao: string;
  cor: string;
}

export const SETORES: Record<SetorId, Setor> = {
  atendimento: { nome: "Atendimento", descricao: "As mesas dos agentes: cada conversa ativa é um balão sobre quem atende.", cor: "#3b82f6" },
  recepcao: { nome: "Recepção", descricao: "Onde chegam os pedidos das pessoas e de onde saem as respostas.", cor: "#22c55e" },
  secretaria: { nome: "Cadastro da organização", descricao: "Consultas ao cadastro da organização: áreas, responsáveis, atividades e unidades.", cor: "#0ea5e9" },
  fontes: { nome: "Fontes públicas", descricao: "Buscas no IBGE, ViaCEP, OpenStreetMap, CNES e na web para montar a organização.", cor: "#a855f7" },
  base: { nome: "Base de conhecimento", descricao: "Roteiro, documentos e exemplos aprovados que os agentes consultam.", cor: "#52A2FF" },
  implantacao: {
    nome: "Implantação",
    descricao: "Onde a organização é montada: cadastro, áreas, atividades, cargos, responsáveis, agentes e unidades.",
    cor: "#ec4899",
  },
  catalogo: { nome: "Catálogo de atividades", descricao: "Os tipos de área e as atividades sugeridas para cada um.", cor: "#10b981" },
  equipe: { nome: "Equipe humana", descricao: "As conversas transferidas: o agente leva a pasta até os responsáveis.", cor: "#F4B800" },
};

const DA_SECRETARIA = new Set(["consultar_organizacao", "listar_unidades", "situacao_implantacao"]);
const DAS_FONTES = new Set(["buscar_municipio", "buscar_endereco", "pesquisar_na_web", "importar_unidades_cnes"]);
const DO_CATALOGO = new Set(["listar_tipos_area", "sugerir_atividades"]);
const DA_IMPLANTACAO = new Set([
  "registrar_organizacao",
  "salvar_dados_prefeitura",
  "salvar_dados_secretaria",
  "salvar_dados_empresa",
  "cadastrar_unidade",
  "salvar_areas",
  "montar_cargos",
  "criar_cargo",
  "dar_acesso",
  "salvar_atividades",
  "nova_atividade",
  "cadastrar_responsavel",
  "montar_agentes",
  "concluir_implantacao",
]);

/** Aonde o agente vai quando usa a ferramenta; null = não sai da mesa. */
export function setorDaFerramenta(ferramenta: string, _agente?: string): SetorId | null {
  if (DA_SECRETARIA.has(ferramenta)) return "secretaria";
  if (DAS_FONTES.has(ferramenta)) return "fontes";
  if (DO_CATALOGO.has(ferramenta)) return "catalogo";
  if (DA_IMPLANTACAO.has(ferramenta)) return "implantacao";
  switch (ferramenta) {
    case "transferir_para_humano":
      return "equipe";
    case "encerrar_atendimento":
      return null;
    default:
      return "base";
  }
}

/** As ferramentas que cada setor atende (para os números do painel do setor). */
export const FERRAMENTAS_DO_SETOR: Partial<Record<SetorId, string[]>> = {
  secretaria: [...DA_SECRETARIA],
  fontes: [...DAS_FONTES],
  catalogo: [...DO_CATALOGO],
  implantacao: [...DA_IMPLANTACAO],
  equipe: ["transferir_para_humano"],
  base: ["update_user_memory"],
};
