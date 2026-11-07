/*
 * O período da Central ao vivo: o mesmo para os números do topo, o escritório e as abas (conversas, alertas,
 * agentes, acontecimentos). O servidor considera as conversas com atividade no período e conta as
 * transferidas e encerradas pela hora em que isso aconteceu (ver /central em painel_api.py).
 */

export type PeriodoCentral =
  | { tipo: "horas"; horas: number }
  | { tipo: "hoje" }
  | { tipo: "datas"; de: string; ate: string }; // AAAA-MM-DD, no fuso do navegador

export const PERIODOS_RAPIDOS: { id: string; rotulo: string; periodo: PeriodoCentral }[] = [
  { id: "8h", rotulo: "8 h", periodo: { tipo: "horas", horas: 8 } },
  { id: "24h", rotulo: "24 h", periodo: { tipo: "horas", horas: 24 } },
  { id: "hoje", rotulo: "Hoje", periodo: { tipo: "hoje" } },
  { id: "7d", rotulo: "7 dias", periodo: { tipo: "horas", horas: 24 * 7 } },
  { id: "30d", rotulo: "30 dias", periodo: { tipo: "horas", horas: 24 * 30 } },
];

export const PERIODO_PADRAO: PeriodoCentral = { tipo: "horas", horas: 24 };
export const DIAS_MAX = 30;

/** AAAA-MM-DD de uma data, no fuso do navegador. */
export function diaLocal(data: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

function inicioDoDia(dia: string): number {
  const [a, m, d] = dia.split("-").map(Number);
  return Math.floor(new Date(a, m - 1, d, 0, 0, 0).getTime() / 1000);
}

function fimDoDia(dia: string): number {
  const [a, m, d] = dia.split("-").map(Number);
  return Math.floor(new Date(a, m - 1, d, 23, 59, 59).getTime() / 1000);
}

/** O trecho da URL das rotas da Central (?horas= ou ?desde=&ate=). */
export function consultaPeriodo(p: PeriodoCentral): string {
  if (p.tipo === "horas") return `horas=${p.horas}`;
  if (p.tipo === "hoje") return `desde=${inicioDoDia(diaLocal(new Date()))}`;
  return `desde=${inicioDoDia(p.de)}&ate=${fimDoDia(p.ate)}`;
}

function diaCurto(dia: string): string {
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
}

/** Como o período aparece nos rótulos ("24 h", "hoje", "03/11 a 05/11"). */
export function rotuloPeriodo(p: PeriodoCentral): string {
  if (p.tipo === "hoje") return "hoje";
  if (p.tipo === "datas") return p.de === p.ate ? diaCurto(p.de) : `${diaCurto(p.de)} a ${diaCurto(p.ate)}`;
  const rapido = PERIODOS_RAPIDOS.find((r) => r.periodo.tipo === "horas" && r.periodo.horas === p.horas);
  return rapido?.rotulo ?? `${p.horas} h`;
}

/** O id do atalho escolhido, ou "datas". */
export function idPeriodo(p: PeriodoCentral): string {
  if (p.tipo === "datas") return "datas";
  return PERIODOS_RAPIDOS.find((r) => JSON.stringify(r.periodo) === JSON.stringify(p))?.id ?? "datas";
}

/** Se o período vai até agora (os números acompanham o relógio). Um intervalo que termina hoje também. */
export function ateAgora(p: PeriodoCentral): boolean {
  return p.tipo !== "datas" || p.ate >= diaLocal(new Date());
}

/** Mensagem de erro de um intervalo de datas, ou null se estiver certo. */
export function erroDatas(de: string, ate: string): string | null {
  if (!de || !ate) return "Escolha as duas datas.";
  if (ate < de) return "A data final é antes da inicial.";
  if (de > diaLocal(new Date())) return "A data inicial ainda não chegou.";
  if ((fimDoDia(ate) - inicioDoDia(de)) / 86400 > DIAS_MAX) return `O período vai até ${DIAS_MAX} dias.`;
  return null;
}

const CHAVE = "central-periodo";

export function lerPeriodo(): PeriodoCentral {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as PeriodoCentral | null;
    if (salvo?.tipo === "horas" && PERIODOS_RAPIDOS.some((r) => r.periodo.tipo === "horas" && r.periodo.horas === salvo.horas)) return salvo;
    if (salvo?.tipo === "hoje") return salvo;
    // Um intervalo de datas não volta na próxima visita: a Central abre ao vivo.
  } catch {
    /* sem armazenamento ou valor estragado: o padrão */
  }
  return PERIODO_PADRAO;
}

export function salvarPeriodo(p: PeriodoCentral) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(p));
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
}
