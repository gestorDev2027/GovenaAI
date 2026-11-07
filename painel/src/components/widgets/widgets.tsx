import type { ComponentType, CSSProperties, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Info, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/use-count-up";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { Status } from "@/lib/api";

/* ───────── InfoTip: "como é calculado" ───────── */

export function InfoTip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label="Como é calculado"
          className={cn(
            "inline-grid size-5 shrink-0 cursor-help place-items-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground",
            className,
          )}
        >
          <Info className="size-3.5" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-72 text-xs leading-relaxed text-muted-foreground" side="top">
        {children}
      </HoverCardContent>
    </HoverCard>
  );
}

/* ───────── KpiCard (o KpiCard do Nexa BI: ícone e dica em cima, rótulo e número embaixo) ───────── */

type Accent = "primary" | "cyan" | "green" | "amber" | "violet" | "red";

// Quadrado do ícone: o tom a 10–16% com o ícone na cor cheia, como no Nexa BI.
const ACCENT_CHIP: Record<Accent, string> = {
  primary: "bg-primary/10 text-primary-text",
  cyan: "bg-accent/14 text-accent",
  green: "bg-success/14 text-success",
  amber: "bg-warning/16 text-warning-text",
  violet: "bg-chart-5/14 text-chart-5",
  red: "bg-destructive/14 text-destructive",
};

export function KpiCard({
  label,
  count,
  format,
  value,
  hint,
  icon,
  accent = "primary",
  insight,
  className,
  style,
}: {
  label: string;
  count?: number | null;
  format?: (n: number) => string;
  value?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: Accent;
  insight?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const animated = useCountUp(count ?? 0);
  const display =
    count == null ? (value ?? "—") : format ? format(animated) : Math.round(animated).toLocaleString("pt-BR");

  const card = (
    <div
      className={cn(
        "surface-card group flex min-h-[132px] flex-col justify-between p-5",
        insight && "is-interactive cursor-help",
        className,
      )}
      style={style}
    >
      <div className="flex items-start justify-between gap-3">
        {icon && (
          <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl [&_svg]:size-5", ACCENT_CHIP[accent])}>
            {icon}
          </span>
        )}
        {hint && <span className="text-right text-xs text-muted-foreground">{hint}</span>}
      </div>
      <div className="mt-4 flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-muted-foreground">{label}</span>
        <span className="num mt-1 text-3xl leading-none font-bold tracking-tight text-foreground">{display}</span>
      </div>
    </div>
  );

  if (!insight) return card;
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>{card}</HoverCardTrigger>
      <HoverCardContent className="w-72 text-xs leading-relaxed" side="top" align="start">
        {insight}
      </HoverCardContent>
    </HoverCard>
  );
}

/* ───────── Status da conversa ───────── */

export const STATUS_INFO: Record<Status, { rotulo: string; classe: string; ponto: string }> = {
  em_atendimento: { rotulo: "Em atendimento", classe: "bg-accent/12 text-accent", ponto: "bg-accent" },
  transferido: { rotulo: "Transferida", classe: "bg-primary/12 text-primary-text", ponto: "bg-primary" },
  encerrado: { rotulo: "Encerrada", classe: "bg-success/12 text-success", ponto: "bg-success" },
  sem_resposta: { rotulo: "Não respondeu ao agente", classe: "bg-muted text-muted-foreground", ponto: "bg-muted-foreground/50" },
  nao_chegou: { rotulo: "Agente ainda não interagiu", classe: "bg-warning/12 text-warning-text", ponto: "bg-warning" },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const info = STATUS_INFO[status] ?? STATUS_INFO.em_atendimento;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        info.classe,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", info.ponto)} />
      {info.rotulo}
    </span>
  );
}

/* ───────── Carregando (núcleo pulsante do NexaCF) ───────── */

export function PageLoader({ label = "Carregando", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("surface-card grid place-items-center rounded-2xl", className ?? "h-64")}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative size-14">
          <span className="loader-orbit absolute inset-0 rounded-full border-2 border-transparent border-t-primary border-r-primary/40" />
          <span className="loader-orbit-rev absolute inset-2 rounded-full border-2 border-transparent border-b-[oklch(0.66_0.18_250)] border-l-[oklch(0.66_0.18_250/.4)]" />
          <span className="loader-core absolute inset-[22px] rounded-full bg-primary" />
        </div>
        <span className="text-shimmer text-[11px] font-semibold uppercase tracking-[0.32em]">{label}</span>
      </div>
    </div>
  );
}

/* ───────── Estado vazio / erro ───────── */

export function EmptyState({
  icon,
  title,
  children,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {icon && <div className="mb-1 grid size-12 place-items-center rounded-xl bg-muted/50 text-muted-foreground/70">{icon}</div>}
      <div className="font-semibold">{title}</div>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/* ───────── Cabeçalho de página (a barra do topo do Nexa BI) ───────── */

/**
 * Faixa fixa no topo da área que rola: quadrado com o ícone, título e descrição à esquerda e as
 * ações à direita. 64px de altura, alinhada ao topo do menu lateral. Fundo quase sólido com desfoque,
 * como a barra do Nexa BI, para os cards não atravessarem o título. Ocupa a largura toda da página
 * (a página usa `px-4 sm:px-8`, e o cabeçalho anula esse recuo).
 */
export function PageHeader({
  title,
  description,
  actions,
  icon: Icone,
  semAtualizar = false,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  semAtualizar?: boolean;
}) {
  const qc = useQueryClient();
  return (
    <header className="sticky top-0 z-20 -mx-4 flex min-h-16 shrink-0 items-center border-b border-border/55 bg-background/90 px-4 py-2 backdrop-blur-xl sm:-mx-8 sm:px-8">
      <div className="flex w-full min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
          {Icone && (
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-text">
              <Icone className="size-[18px]" />
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="line-clamp-2 text-lg leading-tight font-semibold tracking-tight sm:text-xl md:line-clamp-1">{title}</h1>
            {description && (
              <p className="line-clamp-2 text-xs leading-tight text-muted-foreground md:line-clamp-1">{description}</p>
            )}
          </div>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {actions}
          {!semAtualizar && (
            <button
              type="button"
              aria-label="Atualizar dados"
              title="Atualizar dados"
              onClick={() => qc.invalidateQueries()}
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/60 bg-card/40 text-muted-foreground transition-colors outline-none hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw className="size-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/* ───────── Seletor segmentado (os chips da barra de filtros do Nexa BI) ───────── */

export function Pills<T extends string | number>({
  options,
  value,
  onChange,
  rotulo,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  rotulo?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={rotulo}
      className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-xl border border-border/60 bg-card/40 p-1 backdrop-blur"
    >
      {options.map((o) => {
        const ativo = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-full shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ativo
                ? "bg-primary/15 font-semibold text-primary-text ring-1 ring-primary/30"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ───────── Abas com contagem (AbasDeEstado do nexa-forms) ───────── */

export function Abas<T extends string>({
  abas,
  valor,
  onTrocar,
  rotulo,
}: {
  abas: { id: T; label: string; n?: number | null; icone?: ComponentType<{ className?: string }> }[];
  valor: T;
  onTrocar: (id: T) => void;
  rotulo: string;
}) {
  return (
    <div role="tablist" aria-label={rotulo} className="thin-scroll flex gap-1 overflow-x-auto border-b border-border/60 pb-px">
      {abas.map((aba) => {
        const ativa = valor === aba.id;
        const Icone = aba.icone;
        return (
          <button
            key={aba.id}
            type="button"
            role="tab"
            aria-selected={ativa}
            onClick={() => onTrocar(aba.id)}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ativa ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icone && <Icone aria-hidden="true" className={cn("size-3.5 shrink-0", ativa ? "opacity-100" : "opacity-60")} />}
            {aba.label}
            {aba.n != null && (
              <span
                className={cn(
                  "num rounded-md px-1.5 py-0.5 text-2xs tabular-nums transition-colors",
                  ativa
                    ? "bg-primary/15 text-primary-text"
                    : aba.n === 0
                      ? "bg-secondary text-muted-foreground/60"
                      : "bg-secondary text-muted-foreground",
                )}
              >
                {aba.n}
              </span>
            )}
            {ativa && (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary shadow-[0_0_10px_1px_color-mix(in_oklab,var(--color-primary)_55%,transparent)]"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
