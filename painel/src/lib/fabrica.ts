import type { AgenteFabrica } from "@/lib/api";

/*
 * Regras da fábrica de agentes que a tela precisa conhecer antes de falar com o servidor. O servidor
 * confere tudo de novo (e devolve 422 ou 409); aqui elas só evitam o envio que já se sabe inválido.
 */

/** Todo agente precisa de saída para uma pessoa: a transferência fica sempre marcada. */
export const FERRAMENTA_OBRIGATORIA = "transferir_para_humano";

/** O motivo de transferência que entra sempre. */
export const CATEGORIA_FIXA = { chave: "outro", rotulo: "Outro assunto" };

export const INATIVIDADE = { minimo: 5, maximo: 1380 };

// O id vira nome de tabela no Postgres, que corta nomes longos: até 30 caracteres.
export const ID_VALIDO = /^[a-z0-9-]{3,30}$/;

/** Marcadores que o servidor troca a cada mensagem. Sem o obrigatório, as instruções não são gravadas. */
export const MARCADORES = [
  {
    token: "@@BASE_DE_CONHECIMENTO@@",
    obrigatorio: true,
    explicacao: "Onde entra a base de conhecimento do agente, a mesma da tela Base de conhecimento.",
  },
  { token: "@@BOAS_VINDAS@@", obrigatorio: false, explicacao: 'Onde entra a seção "## Boas-vindas" da base.' },
  { token: "{nome_contato}", obrigatorio: false, explicacao: "O nome do contato." },
] as const;

/** Cores sugeridas, enquanto as do servidor (/fabrica/opcoes) não chegam; dá para escolher qualquer outra. */
export const CORES = ["#2f80ff", "#8b5cf6", "#14c4d4", "#f28a1e", "#3ccf5a", "#f2b51e", "#ef3b3b", "#e83e8c"];

/** Texto sem acentos, em minúsculas, com as palavras unidas por `separador`. */
function normalizar(texto: string, separador: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separador)
    .replace(new RegExp(`^\\${separador}+|\\${separador}+$`, "g"), "");
}

/** "Compras e Licitações — Bia" → "compras-e-licitacoes-bia": o id sugerido a partir do nome. */
export const idDoNome = (nome: string) => normalizar(nome, "-").slice(0, 30);

/** "Acesso à plataforma" → "acesso_a_plataforma": a chave de um motivo de transferência. */
export const chaveDoRotulo = (rotulo: string) => normalizar(rotulo, "_").slice(0, 40);

/** "23 h", "1 h 30 min", "10 min". */
export function fmtMinutos(minutos: number) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Os campos que o painel altera (o PUT de /fabrica/agentes/{id}). */
export type RascunhoAgente = Pick<
  AgenteFabrica,
  | "nome"
  | "area"
  | "cargo"
  | "descricao"
  | "cor"
  | "modelo"
  | "raciocinio"
  | "ferramentas"
  | "skills"
  | "categorias"
  | "minutos_inatividade"
  | "quando_transferir"
  | "memoria"
>;

export function rascunhoDe(a: AgenteFabrica): RascunhoAgente {
  return {
    nome: a.nome,
    area: a.area,
    cargo: a.cargo,
    descricao: a.descricao,
    cor: a.cor,
    modelo: a.modelo,
    raciocinio: a.raciocinio,
    ferramentas: a.ferramentas,
    skills: a.skills ?? [],
    categorias: a.categorias,
    minutos_inatividade: a.minutos_inatividade,
    quando_transferir: a.quando_transferir,
    memoria: a.memoria,
  };
}

/** O que impede gravar o rascunho; vazio quando está tudo certo. */
export function problemasDo(r: RascunhoAgente, opcoes?: { limites: { inatividade_min: number; inatividade_max: number } }): string[] {
  const minimo = opcoes?.limites.inatividade_min ?? INATIVIDADE.minimo;
  const maximo = opcoes?.limites.inatividade_max ?? INATIVIDADE.maximo;
  const p: string[] = [];
  if (!r.nome.trim()) p.push("Falta o nome.");
  if (!r.descricao.trim()) p.push("Falta a descrição.");
  if (!r.area.trim()) p.push("Falta a área.");
  if (!Number.isInteger(r.minutos_inatividade) || r.minutos_inatividade < minimo || r.minutos_inatividade > maximo)
    p.push(`A inatividade precisa ficar entre ${minimo} min e ${fmtMinutos(maximo)}.`);
  if (Object.entries(r.categorias).some(([, rotulo]) => !rotulo.trim())) p.push("Há motivo de transferência sem nome.");
  return p;
}
