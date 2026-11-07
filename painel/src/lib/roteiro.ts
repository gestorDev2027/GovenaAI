/*
 * O roteiro de atendimento (a base de conhecimento do agente) é um Markdown dividido em seções "## ".
 * O painel mostra cada seção numa linha da tabela e edita uma de cada vez; `juntar(dividir(t))` devolve
 * exatamente o texto `t`, para que editar uma seção não mexa em nenhuma outra.
 */

export interface SecaoRoteiro {
  titulo: string;
  /** O texto da seção, sem a linha do título. */
  corpo: string;
}

export interface RoteiroDividido {
  /** O que vem antes da primeira seção (título geral, explicações); null quando o texto começa numa seção. */
  abertura: string | null;
  secoes: SecaoRoteiro[];
}

const TITULO = /^##\s+/;

export function dividir(texto: string): RoteiroDividido {
  const blocos: { titulo: string | null; linhas: string[] }[] = [{ titulo: null, linhas: [] }];
  for (const linha of texto.split("\n")) {
    // "##" abre seção; "###" é subtópico dentro dela.
    if (TITULO.test(linha) && !linha.startsWith("###")) blocos.push({ titulo: linha.replace(TITULO, ""), linhas: [] });
    else blocos[blocos.length - 1].linhas.push(linha);
  }
  const [primeiro, ...resto] = blocos;
  return {
    // Texto que começa numa seção não tem abertura (o bloco inicial fica vazio).
    abertura: primeiro.linhas.length ? primeiro.linhas.join("\n") : null,
    secoes: resto.map((b) => ({ titulo: b.titulo ?? "", corpo: b.linhas.join("\n") })),
  };
}

export function juntar({ abertura, secoes }: RoteiroDividido): string {
  const partes = secoes.map((s) => `## ${s.titulo}\n${s.corpo}`);
  return (abertura === null ? partes : [abertura, ...partes]).join("\n");
}

/** O corpo como entra no texto: sem espaços sobrando no fim. Com o "\n" final, `juntar` deixa uma linha em
 * branco antes da próxima seção, como no resto do roteiro. */
export const corpoArrumado = (corpo: string) => corpo.replace(/\s+$/, "") + "\n";

export type TipoSecao = "mensagem" | "regra" | "conteudo";

const normalizar = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Seções que o sistema envia exatamente como estão escritas (com [NOME DO CONTATO] trocado pelo primeiro nome). */
const MENSAGENS = ["boas-vindas", "encerramento por inatividade", "pedido fora do atendimento", "transferencia para a equipe"];

export function tipoDaSecao(titulo: string): TipoSecao {
  const t = normalizar(titulo);
  if (MENSAGENS.some((m) => t.startsWith(m))) return "mensagem";
  if (t.startsWith("sempre transferir")) return "regra";
  return "conteudo";
}

export const TIPO_SECAO: Record<TipoSecao, { rotulo: string; tom: "primario" | "alerta" | "neutro"; ajuda: string }> = {
  mensagem: {
    rotulo: "Mensagem automática",
    tom: "primario",
    ajuda:
      "O sistema envia esta seção como está escrita, com [NOME DO CONTATO] trocado pelo primeiro nome. Sem a seção, a mensagem não é enviada.",
  },
  regra: {
    rotulo: "Regra de transferência",
    tom: "alerta",
    ajuda: "Define o que o agente nunca resolve sozinho: nesses assuntos ele passa a conversa para a equipe.",
  },
  conteudo: {
    rotulo: "Conteúdo",
    tom: "neutro",
    ajuda: "Vale para os servidores na próxima mensagem. Links, prazos e valores são repetidos exatamente como estão escritos.",
  },
};

/** Uma mudança escolhida para aplicar no roteiro (vinda das sugestões da IA, já revisada). */
export interface MudancaRoteiro {
  tipo: "alterar" | "nova" | "remover";
  titulo: string;
  /** Só em nova: a seção depois da qual ela entra; sem ela, antes de "Sempre transferir" ou no fim. */
  depoisDe: string | null;
  texto: string;
}

/** O roteiro com as mudanças aplicadas, sem mexer nas outras seções. A seção é achada pelo título, sem diferença de
 * acento e maiúsculas, como no servidor (agente/sugestoes_roteiro.py). */
export function aplicarMudancas(roteiro: RoteiroDividido, mudancas: MudancaRoteiro[]): RoteiroDividido {
  let secoes = roteiro.secoes.map((s) => ({ ...s }));
  const indice = (titulo: string) => secoes.findIndex((s) => normalizar(s.titulo) === normalizar(titulo));
  for (const m of mudancas) {
    if (m.tipo === "remover") {
      const i = indice(m.titulo);
      secoes = secoes.filter((_, k) => k !== i);
    } else if (m.tipo === "alterar") {
      const i = indice(m.titulo);
      if (i >= 0) secoes[i] = { ...secoes[i], corpo: m.texto };
    } else {
      const depois = m.depoisDe ? indice(m.depoisDe) : -1;
      const regra = secoes.findIndex((s) => tipoDaSecao(s.titulo) === "regra");
      const posicao = depois >= 0 ? depois + 1 : regra >= 0 ? regra : secoes.length;
      secoes.splice(posicao, 0, { titulo: m.titulo.trim(), corpo: m.texto });
    }
  }
  // Uma linha em branco entre as seções, inclusive na que deixou de ser a última.
  return { ...roteiro, secoes: secoes.map((s) => ({ ...s, corpo: corpoArrumado(s.corpo) })) };
}

export type LinhaDiff = { tipo: "igual" | "mais" | "menos"; texto: string };

/** Diferença linha a linha entre dois textos (maior subsequência comum), para mostrar o que a sugestão muda. */
export function diferenca(antes: string, depois: string): LinhaDiff[] {
  const a = antes ? antes.split("\n") : [];
  const b = depois ? depois.split("\n") : [];
  const tabela = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      tabela[i][j] = a[i] === b[j] ? tabela[i + 1][j + 1] + 1 : Math.max(tabela[i + 1][j], tabela[i][j + 1]);
  const saida: LinhaDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      saida.push({ tipo: "igual", texto: a[i] });
      i++;
      j++;
    } else if (tabela[i + 1][j] >= tabela[i][j + 1]) saida.push({ tipo: "menos", texto: a[i++] });
    else saida.push({ tipo: "mais", texto: b[j++] });
  }
  while (i < a.length) saida.push({ tipo: "menos", texto: a[i++] });
  while (j < b.length) saida.push({ tipo: "mais", texto: b[j++] });
  return saida;
}

/** Quantos subtópicos ("###") a seção tem. */
export const subtopicos = (corpo: string) => corpo.split("\n").filter((l) => l.startsWith("### ")).length;

/** A primeira linha com texto, para a prévia na tabela. */
export const previa = (corpo: string) =>
  corpo
    .split("\n")
    .find((l) => l.trim() && !l.startsWith("#"))
    ?.trim() ?? "";
