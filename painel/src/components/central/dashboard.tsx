import type { ReactNode } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Brain, CheckCircle2, Hand, Search, ShieldAlert, Users, Wrench } from "lucide-react";
import type { AgenteCentral, EventoCentral } from "@/lib/api";
import { fmtInt, fmtRelativo } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { tripulante } from "@/lib/tripulacao";

/*
 * Peças dos mini dashboards dos painéis da Central ao vivo: cartão de indicador, anel de porcentagem,
 * gráfico de atividade da última hora, barras e a lista ao vivo dos acontecimentos.
 */

export const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/** Cartão de indicador: ícone na cor, rótulo, valor grande e um detalhe. */
export function Indicador({ icone, rotulo, valor, detalhe, cor, destaque }: { icone: ReactNode; rotulo: string; valor: string; detalhe?: string; cor: string; destaque?: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-background/40 p-3">
      <div className="pointer-events-none absolute -top-8 -right-8 size-20 rounded-full opacity-20 blur-2xl" style={{ background: cor }} />
      <div className="flex items-start justify-between gap-2">
        <span className="grid size-8 place-items-center rounded-xl text-white shadow-sm [&_svg]:size-4" style={{ background: cor }}>
          {icone}
        </span>
        {destaque}
      </div>
      <div className="num mt-2 text-xl leading-none font-semibold">{valor}</div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">{rotulo}</div>
      {detalhe && <div className="truncate text-[10px] text-muted-foreground/80">{detalhe}</div>}
    </div>
  );
}

/** Anel de porcentagem (0 a 1), com o valor no meio. */
export function Anel({ valor, cor, tamanho = 64, rotulo }: { valor: number | null | undefined; cor: string; tamanho?: number; rotulo: string }) {
  const r = (tamanho - 8) / 2;
  const volta = 2 * Math.PI * r;
  const v = valor == null ? 0 : Math.max(0, Math.min(1, valor));
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: tamanho, height: tamanho }}>
        <svg width={tamanho} height={tamanho} className="-rotate-90">
          <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke="currentColor" strokeWidth={6} className="text-muted" />
          <circle
            cx={tamanho / 2}
            cy={tamanho / 2}
            r={r}
            fill="none"
            stroke={cor}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={`${v * volta} ${volta}`}
            className="transition-[stroke-dasharray] duration-700"
          />
        </svg>
        <span className="num absolute inset-0 grid place-items-center text-xs font-semibold">{pct(valor)}</span>
      </div>
      <span className="text-center text-[10px] leading-tight text-muted-foreground">{rotulo}</span>
    </div>
  );
}

/** Quantos acontecimentos por intervalo nos últimos `minutos` (o mais antigo primeiro). */
export function serieDeAtividade(eventos: EventoCentral[], minutos = 60, intervalo = 5): number[] {
  const agora = Date.now();
  const caixas = Array.from({ length: Math.ceil(minutos / intervalo) }, () => 0);
  for (const e of eventos) {
    const idade = (agora - new Date(e.quando).getTime()) / 60_000;
    if (idade < 0 || idade >= minutos) continue;
    caixas[caixas.length - 1 - Math.floor(idade / intervalo)] += 1;
  }
  return caixas;
}

/** Gráfico de área com a atividade (sparkline), com o total ao lado. */
export function Atividade({ serie, cor, rotulo }: { serie: number[]; cor: string; rotulo: string }) {
  const largura = 240;
  const altura = 48;
  const maior = Math.max(1, ...serie);
  const passo = largura / Math.max(1, serie.length - 1);
  const pontos = serie.map((v, i) => [i * passo, altura - 4 - (v / maior) * (altura - 8)] as const);
  const linha = pontos.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const total = serie.reduce((a, b) => a + b, 0);
  const id = `grad-${cor.replace("#", "")}`;
  return (
    <div className="rounded-2xl border border-border bg-background/40 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-muted-foreground">{rotulo}</span>
        <span className="num text-sm font-semibold">{fmtInt(total)}</span>
      </div>
      <svg viewBox={`0 0 ${largura} ${altura}`} className="mt-1 h-12 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={cor} stopOpacity="0.45" />
            <stop offset="1" stopColor={cor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${linha} L${largura},${altura} L0,${altura} Z`} fill={`url(#${id})`} />
        <path d={linha} fill="none" stroke={cor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between font-mono text-[9px] text-muted-foreground">
        <span>há 1 h</span>
        <span>agora</span>
      </div>
    </div>
  );
}

export function Titulo({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
      {children}
      <span className="h-px flex-1 bg-border" />
      {extra}
    </div>
  );
}

/** Barras horizontais: rótulo, valor e a barra na cor de cada item. */
export function Barras({ itens, vazio, formatar = fmtInt }: { itens: { rotulo: string; valor: number; cor: string }[]; vazio: string; formatar?: (v: number) => string }) {
  const maior = Math.max(1, ...itens.map((i) => i.valor));
  if (!itens.length || itens.every((i) => !i.valor)) return <p className="px-1 py-1 text-xs text-muted-foreground">{vazio}</p>;
  return (
    <div className="space-y-2">
      {itens.map((i) => (
        <div key={i.rotulo}>
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: i.cor }} />
              <span className="truncate">{i.rotulo}</span>
            </span>
            <span className="num font-semibold">{formatar(i.valor)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(i.valor / maior) * 100}%`, background: i.cor }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const ROTULO_FERRAMENTA: Record<string, string> = {
  consultar_secretaria: "consultou a secretaria",
  listar_unidades: "listou as unidades",
  buscar_municipio: "buscou o município",
  importar_unidades_cnes: "importou as unidades do CNES",
  transferir_para_humano: "transferiu para a equipe",
  encerrar_atendimento: "encerrou o atendimento",
  update_user_memory: "registrou na memória",
};

/** O ícone, o texto e a cor de um acontecimento (lista ao vivo e tabela de acontecimentos). */
export function descreverEvento(e: EventoCentral) {
  switch (e.tipo) {
    case "mensagem":
      return { icone: <ArrowDownLeft />, texto: "recebeu uma mensagem", cor: "#22c55e" };
    case "respondeu":
      return { icone: <ArrowUpRight />, texto: "respondeu", cor: "#3b82f6" };
    case "ferramenta":
      return { icone: e.ferramenta === "buscar_municipio" ? <Search /> : <Wrench />, texto: ROTULO_FERRAMENTA[e.ferramenta ?? ""] ?? `usou ${e.ferramenta}`, cor: "#0ea5e9" };
    case "transferiu":
      return { icone: <Users />, texto: "transferiu para a equipe", cor: "#F4B800" };
    case "encerrou":
      return { icone: <CheckCircle2 />, texto: "encerrou", cor: "#10b981" };
    case "guardrail":
      return { icone: <ShieldAlert />, texto: "barrou um pedido fora do atendimento", cor: "#a855f7" };
    case "erro":
      return { icone: <AlertTriangle />, texto: "falhou ao responder", cor: "#ef4444" };
    case "boas_vindas":
      return { icone: <Hand />, texto: "mandou as boas-vindas", cor: "#14b8a6" };
    default:
      return { icone: <Brain />, texto: "pensando", cor: "#94a3b8" };
  }
}

/** A lista ao vivo: o mais novo primeiro, com ícone por tipo e o agente na cor dele. */
export function ListaAoVivo({ eventos, agentes, aoAbrirConversa, vazio, limite = 15 }: { eventos: EventoCentral[]; agentes: AgenteCentral[]; aoAbrirConversa: (id: string) => void; vazio: string; limite?: number }) {
  const nome = (id: string) => agentes.find((a) => a.id === id)?.nome ?? id;
  const lista = eventos.filter((e) => e.tipo !== "pensando").slice(-limite).reverse();
  if (!lista.length) return <p className="px-1 py-1 text-xs text-muted-foreground">{vazio}</p>;
  return (
    <ol className="relative space-y-0.5 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-border">
      {lista.map((e) => {
        const d = descreverEvento(e);
        return (
          <li key={e.id}>
            <button type="button" onClick={() => aoAbrirConversa(e.session_id)} className="relative flex w-full items-start gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-muted/60">
              <span className="relative z-10 grid size-5 shrink-0 place-items-center rounded-full text-white ring-4 ring-card [&_svg]:size-3" style={{ background: d.cor }}>
                {d.icone}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">
                  <b style={{ color: tripulante(e.agente, agentes).cor }}>{nome(e.agente)}</b> {d.texto}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {[e.contato, e.categoria_rotulo ?? e.texto].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              <span className={cn("shrink-0 font-mono text-[10px] text-muted-foreground")}>{fmtRelativo(e.quando)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
