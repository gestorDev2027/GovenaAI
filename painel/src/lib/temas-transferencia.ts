/**
 * Temas das transferências: o agente escolhe uma categoria e escreve o motivo ao transferir, mas a categoria
 * sozinha esconde o problema ("Outro assunto" era quase tudo pedido de apostila física). O tema sai do motivo,
 * por palavras-chave, na ordem da lista (o primeiro que casa vence).
 *
 * tipo: evitavel = o agente resolveria com uma ferramenta ou conteúdo novo; correta = precisa de humano;
 * produto = defeito da plataforma, não do agente; revisar = não se encaixou em nenhum tema.
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
    id: "brinde",
    rotulo: "Apostila física, brinde ou sorteio",
    tipo: "evitavel",
    acao: "Ferramenta consultar_brindes: confirme se o agente a usa antes de transferir. Vale criar a categoria própria (hoje cai em “Outro assunto”).",
    padrao: /apostila|livro f[ií]sico|brinde|material f[ií]sico|500 primeiros|sorteio/i,
  },
  {
    id: "video",
    rotulo: "Vídeo não abre (iPhone, tela preta)",
    tipo: "produto",
    acao: "Defeito da plataforma, não do agente: levar ao time de produto com a lista de casos.",
    padrao: /iphone|tela (preta|em branco|branca)|v[ií]deo ?aula/i,
  },
  {
    id: "termos",
    rotulo: "Termos de uso pendentes",
    tipo: "produto",
    acao: "Falha de integração (assinatura não reconhecida): levar ao time de produto.",
    padrao: /termo|zapsign/i,
  },
  {
    id: "bloqueado",
    rotulo: "Conteúdo bloqueado após a compra",
    tipo: "evitavel",
    acao: "Dar ao agente a consulta de liberação do Acesso Único: hoje ele só vê o cadastro e precisa transferir.",
    padrao: /cadeado|trancad|bloquead|liberar|libera[çc][ãa]o/i,
  },
  {
    id: "email",
    rotulo: "E-mail do cadastro não encontrado",
    tipo: "evitavel",
    acao: "Buscar também por telefone e CPF antes de transferir.",
    padrao: /e-?mail/i,
  },
  {
    id: "compra",
    rotulo: "Interesse em compra ou preço",
    tipo: "correta",
    acao: "Transferência correta: é oportunidade de venda. Vale medir quantas viraram compra em 7 dias.",
    padrao: /pre[çc]o|valor|condi[çc]|desconto|adquirir|comprar|interesse/i,
  },
  {
    id: "pagamento",
    rotulo: "Pagamento e comprovante",
    tipo: "evitavel",
    acao: "Avaliar uma ferramenta de segunda via e comprovante.",
    padrao: /pagamento|cart[ãa]o|boleto|comprovante|cobran/i,
  },
  {
    id: "cancelamento",
    rotulo: "Cancelamento ou reembolso",
    tipo: "correta",
    acao: "Transferência correta: exige decisão humana.",
    padrao: /cancel|estorno|reembolso/i,
  },
  {
    id: "atendente",
    rotulo: "Pediu atendente",
    tipo: "correta",
    acao: "Transferência correta: escolha do aluno.",
    padrao: /atendente|humano|suporte humano/i,
  },
  {
    id: "ementa",
    rotulo: "Ementa ou matriz curricular",
    tipo: "evitavel",
    acao: "Pôr as ementas na base de conhecimento: o agente passa a enviar sozinho.",
    padrao: /ementa|matriz|projeto pedag/i,
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
  produto: { rotulo: "Produto", ajuda: "defeito da plataforma, não do agente" },
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
