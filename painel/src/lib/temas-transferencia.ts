/**
 * Temas das transferências: o agente escolhe uma categoria e escreve o motivo ao transferir, mas a categoria
 * sozinha esconde o problema. O tema sai do motivo, por palavras-chave, na ordem da lista (o primeiro que
 * casa vence). A lista é a mesma de painel_api.TEMAS_TRANSFERENCIA (o link da gestão recebe o tema pronto).
 *
 * tipo: evitavel = o agente resolveria com uma ferramenta ou conteúdo novo; correta = precisa de humano;
 * produto = defeito do sistema, não do agente; revisar = não se encaixou em nenhum tema.
 * Mudou um tema ou uma palavra: confira a tela com as transferências reais (Visão geral › Transferências).
 */

export type TipoTransferencia = "evitavel" | "correta" | "produto" | "revisar";

export interface TemaTransferencia {
  id: string;
  rotulo: string;
  tipo: TipoTransferencia;
  /** O que fazer para reter mais (ou por que a transferência está certa). */
  acao: string;
  padrao: RegExp;
}

export const TEMAS: TemaTransferencia[] = [
  {
    id: "pessoa",
    rotulo: "Pediu uma pessoa",
    tipo: "correta",
    acao: "Transferência correta: escolha do servidor.",
    padrao: /atendente|humano|falar com (uma )?pessoa|falar com (o|a) (respons|coorden|secret)/i,
  },
  {
    id: "sistema",
    rotulo: "Falha do sistema ou do painel",
    tipo: "produto",
    acao: "Defeito do sistema, não do agente: levar à equipe técnica com a lista de casos.",
    padrao: /erro|falha|n[ãa]o abre|n[ãa]o carrega|travou|fora do ar/i,
  },
  {
    id: "outro_setor",
    rotulo: "Assunto de outro setor",
    tipo: "correta",
    acao: "Transferência correta: vale dar ao outro setor um agente próprio pela Fábrica.",
    padrao: /outro setor|de outro setor|n[ãa]o [ée] (do|deste) setor|jur[ií]dico|recursos humanos|\bRH\b|tesouraria|contabilidade/i,
  },
  {
    id: "norma",
    rotulo: "Norma ou legislação",
    tipo: "evitavel",
    acao: "Pôr a norma (lei, portaria, decreto) na base de conhecimento ou no Conhecimento do painel: o agente passa a citar sozinho.",
    padrao: /\blei\b|portaria|norma|decreto|resolu[çc][ãa]o|legisla/i,
  },
  {
    id: "cadastro",
    rotulo: "Cadastro da secretaria incompleto",
    tipo: "evitavel",
    acao: "Completar o cadastro na implantação: setores, responsáveis e unidades.",
    padrao: /cadastr|unidade|cnes|setor n[ãa]o|sem respons[áa]vel/i,
  },
  {
    id: "dados",
    rotulo: "Faltam dados do setor",
    tipo: "evitavel",
    acao: "Enviar a planilha ou o documento ao Conhecimento do painel: o agente passa a usar sozinho.",
    padrao: /planilha|dados|n[úu]mero|quantidade|saldo|relat[óo]rio|indicador/i,
  },
  {
    id: "aprovacao",
    rotulo: "Decisão do responsável",
    tipo: "correta",
    acao: "Transferência correta: a decisão é do responsável do setor.",
    padrao: /aprova|decis|autoriz|assinatura|respons[áa]vel/i,
  },
];

export const OUTROS: Omit<TemaTransferencia, "padrao"> = {
  id: "outros",
  rotulo: "Outros",
  tipo: "revisar",
  acao: "Motivos que não se encaixam nos temas: revisar na Calibração.",
};

export const TIPOS: Record<TipoTransferencia, { rotulo: string; ajuda: string }> = {
  evitavel: { rotulo: "Evitável", ajuda: "o agente resolveria com uma ferramenta ou um conteúdo novo" },
  correta: { rotulo: "Correta", ajuda: "precisa mesmo de uma pessoa" },
  produto: { rotulo: "Sistema", ajuda: "defeito do sistema, não do agente" },
  revisar: { rotulo: "Revisar", ajuda: "não se encaixou em nenhum tema" },
};

export interface GrupoTransferencia {
  tema: Omit<TemaTransferencia, "padrao">;
  total: number;
  /** Quantas vieram de cada categoria escolhida pelo agente. */
  categorias: { rotulo: string; total: number }[];
  /** Até 3 motivos, para o exemplo. */
  exemplos: string[];
}

/** Agrupa as transferências por tema, do maior para o menor (Outros sempre por último). */
export function agruparPorTema(transferencias: { rotulo: string; motivo: string; tema?: string }[]): GrupoTransferencia[] {
  type Acumulado = GrupoTransferencia & { _cats: Map<string, number> };
  const grupos = new Map<string, Acumulado>();
  for (const t of transferencias) {
    const texto = `${t.motivo} ${t.rotulo}`;
    // No link da gestão o motivo não vem: o servidor manda o tema já calculado (painel_api.tema_da_transferencia).
    const tema = (t.tema ? TEMAS.find((x) => x.id === t.tema) : TEMAS.find((x) => x.padrao.test(texto))) ?? OUTROS;
    const novo: Acumulado = { tema, total: 0, categorias: [], exemplos: [], _cats: new Map() };
    const grupo = grupos.get(tema.id) ?? novo;
    grupo.total += 1;
    grupo._cats.set(t.rotulo, (grupo._cats.get(t.rotulo) ?? 0) + 1);
    if (t.motivo && grupo.exemplos.length < 3) grupo.exemplos.push(t.motivo);
    grupos.set(tema.id, grupo);
  }
  return [...grupos.values()]
    .map(({ _cats, ...g }) => ({ ...g, categorias: [..._cats].map(([rotulo, total]) => ({ rotulo, total })).sort((a, b) => b.total - a.total) }))
    .sort((a, b) => (a.tema.id === "outros" ? 1 : b.tema.id === "outros" ? -1 : b.total - a.total));
}
