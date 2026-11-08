import type { FaseImplantacao, Rotulos } from "@/lib/api";

/*
 * Os nomes de tela de cada segmento (os mesmos de agente/segmentos.py). O servidor manda os rótulos no panorama
 * (`segmento.rotulos`); esta tabela é a reserva para quando ainda não chegaram (o contexto de acesso só traz o
 * `segmento_id`) ou quando ainda não há organização (vale o padrão, a Saúde pública).
 */

export const ROTULOS_SAUDE: Rotulos = {
  organizacao: "Secretaria de Saúde",
  organizacao_curta: "secretaria",
  area: "setor",
  areas: "setores",
  Area: "Setor",
  Areas: "Setores",
  unidade: "unidade de saúde",
  unidades: "unidades de saúde",
  Unidade: "Unidade de saúde",
  Unidades: "Unidades de saúde",
  pessoa: "servidor",
  pessoas: "servidores",
  Pessoas: "Servidores",
  responsavel: "secretário(a) de saúde",
  predio: "Secretaria virtual",
  mapa: "Cidade",
  centro: "CCO",
};

export const ROTULOS_EMPRESA: Rotulos = {
  organizacao: "Empresa",
  organizacao_curta: "empresa",
  area: "departamento",
  areas: "departamentos",
  Area: "Departamento",
  Areas: "Departamentos",
  unidade: "unidade",
  unidades: "unidades",
  Unidade: "Unidade",
  Unidades: "Unidades",
  pessoa: "funcionário",
  pessoas: "funcionários",
  Pessoas: "Funcionários",
  responsavel: "diretor(a)",
  predio: "Escritório virtual",
  mapa: "Mapa",
  centro: "Sala de comando",
};

const POR_SEGMENTO: Record<string, Rotulos> = { saude_publica: ROTULOS_SAUDE, empresa: ROTULOS_EMPRESA };

/** Os rótulos do segmento (os do servidor por cima da tabela; o padrão é a Saúde pública). */
export function rotulosDe(segmentoId?: string | null, doServidor?: Partial<Rotulos> | null): Rotulos {
  return { ...(POR_SEGMENTO[segmentoId ?? ""] ?? ROTULOS_SAUDE), ...(doServidor ?? {}) };
}

/** As fases da implantação, na ordem, com o nome de tela do segmento (gestao.fase_atual). */
export function fasesDaImplantacao(r: Rotulos): [FaseImplantacao, string][] {
  return [
    ["organizacao", r.organizacao],
    ["areas", r.Areas],
    ["atividades", "Atividades"],
    ["cargos", "Cargos"],
    ["responsaveis", "Responsáveis"],
    ["agentes", "Agentes"],
    ["equipe", "Pessoas com acesso"],
    ["unidades", r.Unidades],
    ["revisao", "Revisão"],
  ];
}

/** As linhas do totem da entrada do prédio: "Secretaria" / "de Saúde" ou "Empresa". */
export function totemDe(r: Rotulos): string[] {
  const [primeira, ...resto] = r.organizacao.split(" ");
  return [primeira, resto.join(" ")].filter(Boolean);
}
