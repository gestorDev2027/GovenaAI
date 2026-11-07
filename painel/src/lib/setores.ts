/*
 * Os setores do escritório da Central ao vivo e o que leva um agente até cada um. O agente sai da mesa
 * quando usa uma ferramenta (aviso "ferramenta" do /central/eventos), vai ao setor dela, busca e volta.
 */

export type SetorId = "atendimento" | "recepcao" | "cadastro" | "biblioteca" | "base" | "expedicao" | "financeiro" | "equipe";

export interface Setor {
  nome: string;
  /** O que acontece ali, em uma frase (subtítulo do painel). */
  descricao: string;
  cor: string;
}

export const SETORES: Record<SetorId, Setor> = {
  atendimento: { nome: "Atendimento", descricao: "As mesas dos agentes: cada conversa ativa é um balão sobre quem atende.", cor: "#3b82f6" },
  recepcao: { nome: "Recepção", descricao: "Onde chegam as mensagens do WhatsApp e de onde saem as respostas.", cor: "#22c55e" },
  cadastro: { nome: "Cadastro e matrículas", descricao: "Consultas ao cadastro do aluno: matrícula, acesso e compras.", cor: "#0ea5e9" },
  biblioteca: { nome: "Biblioteca de aulas", descricao: "Buscas de aula para quem não acha o conteúdo na plataforma.", cor: "#a855f7" },
  base: { nome: "Base de conhecimento", descricao: "Roteiro, documentos e exemplos aprovados que os agentes consultam.", cor: "#f59e0b" },
  expedicao: {
    nome: "Expedição de apostilas",
    descricao: "Consultas ao Hub de apostilas: quem tem direito à apostila ou ao livro e em que etapa está o envio.",
    cor: "#ec4899",
  },
  financeiro: { nome: "Financeiro", descricao: "Pagamentos, boletos, parcelas e reembolsos (Vera e Caio).", cor: "#10b981" },
  equipe: { nome: "Equipe humana", descricao: "As conversas transferidas: o agente leva a pasta até a equipe.", cor: "#f7931e" },
};

/** Agentes que tratam de dinheiro: a consulta ao cadastro deles é feita no Financeiro. */
const DO_FINANCEIRO = new Set(["financeiro", "recuperacao"]);

/** Aonde o agente vai quando usa a ferramenta; null = não sai da mesa. */
export function setorDaFerramenta(ferramenta: string, agente: string): SetorId | null {
  switch (ferramenta) {
    case "consultar_cadastro":
      return DO_FINANCEIRO.has(agente) ? "financeiro" : "cadastro";
    case "buscar_aula":
      return "biblioteca";
    case "consultar_brindes":
      return "expedicao";
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
  cadastro: ["consultar_cadastro"],
  financeiro: ["consultar_cadastro"],
  biblioteca: ["buscar_aula"],
  expedicao: ["consultar_brindes"],
  equipe: ["transferir_para_humano"],
  base: ["update_user_memory"],
};
