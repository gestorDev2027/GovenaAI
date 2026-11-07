const inteiro = new Intl.NumberFormat("pt-BR");
const percentual = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : inteiro.format(Math.round(n)));

export const fmtPct = (n: number | null | undefined) => (n == null ? "—" : percentual.format(n));

export function fmtSegundos(s: number | null | undefined) {
  if (s == null) return "—";
  return `${s.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;
}

export function fmtCompacto(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return inteiro.format(n);
}

export function fmtDataHora(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDia(isoDia: string) {
  const [, m, d] = isoDia.split("-");
  return `${d}/${m}`;
}

/** "há 5 min", "há 2 h", "ontem"… para listas. */
export function fmtRelativo(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return "ontem";
  return fmtDataHora(iso);
}
