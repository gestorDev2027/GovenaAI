import type { ComponentType, CSSProperties, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Construction, Info, RefreshCw } from "lucide-react";
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

/* ───────── KpiCard: cartão compacto, rótulo pequeno e o número grande (como o "Consumo" do Ramo) ───────── */

type Accent = "primary" | "cyan" | "green" | "amber" | "violet" | "red";

// Quadradinho do ícone: o tom a 10–16% com o ícone na cor cheia.
const ACCENT_CHIP: Record<Accent, string> = {
  primary: "bg-primary/12 text-primary-text",
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
  comparacao,
  detalhe,
  children,
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
  /** O selo pequeno ao lado do número (SeloComparacao). */
  comparacao?: ReactNode;
  /** Uma linha curta embaixo do número. */
  detalhe?: ReactNode;
  /** O pé do cartão (ex.: uma BarraParticipacao). */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const animated = useCountUp(count ?? 0);
  const display =
    count == null ? (value ?? "—") : format ? format(animated) : Math.round(animated).toLocaleString("pt-BR");

  const card = (
    <div
      className={cn("surface-card group flex min-w-0 flex-col gap-3 p-4", insight && "is-interactive cursor-help", className)}
      style={style}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {icon && (
            <span aria-hidden="true" className={cn("grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-4", ACCENT_CHIP[accent])}>
              {icon}
            </span>
          )}
          <span className="line-clamp-2 text-xs leading-tight font-medium text-muted-foreground sm:truncate">{label}</span>
        </span>
        {hint && <span className="shrink-0 text-right text-2xs text-muted-foreground">{hint}</span>}
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-x-2.5 gap-y-1">
        <span className="num text-[1.75rem] leading-none font-semibold tracking-tight text-foreground sm:text-3xl">{display}</span>
        {comparacao}
      </div>
      {detalhe && <p className="-mt-1 line-clamp-2 text-xs text-muted-foreground">{detalhe}</p>}
      {children}
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

/* ───────── Selo de comparação: "▲ 12% vs. mês passado", pequeno, ao lado do número ───────── */

const TOM_SELO = {
  bom: "bg-success/14 text-success",
  ruim: "bg-destructive/14 text-destructive",
  neutro: "bg-secondary text-muted-foreground",
} as const;

/** `direcao` desenha a seta; `tom` diz se é bom, ruim ou neutro. A cor não é a única pista: o texto diz o que mudou. */
export function SeloComparacao({
  children,
  direcao,
  tom = "neutro",
  title,
}: {
  children: ReactNode;
  direcao?: "sobe" | "desce";
  tom?: keyof typeof TOM_SELO;
  title?: string;
}) {
  const Seta = direcao === "sobe" ? ArrowUpRight : direcao === "desce" ? ArrowDownRight : null;
  return (
    <span title={title} className={cn("mb-0.5 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-2xs font-semibold", TOM_SELO[tom])}>
      {Seta && <Seta aria-hidden="true" className="size-3" />}
      {children}
    </span>
  );
}

/* ───────── Barra de participação: rótulo, valor e % numa linha, a barra fina embaixo ───────── */

/** "Quanto disto é daquilo". `cor` é a da série (token ou cor do catálogo); sem ela, a primária. */
export function BarraParticipacao({
  rotulo,
  valor,
  total,
  cor,
  i = 0,
}: {
  rotulo: ReactNode;
  valor: number;
  total: number;
  cor?: string;
  /** A posição na lista: escalona a entrada da barra. */
  i?: number;
}) {
  const pct = total > 0 ? Math.round((valor / total) * 100) : 0;
  const fundo = cor ?? "var(--color-primary)";
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: fundo }} />
          <span className="truncate">{rotulo}</span>
        </span>
        <span className="shrink-0 text-muted-foreground">
          <span className="num font-semibold text-foreground">{valor.toLocaleString("pt-BR")}</span>
          <span className="mx-1" aria-hidden="true">·</span>
          <span className="num">{pct}%</span>
        </span>
      </div>
      <div aria-hidden="true" className="trilha mt-1.5 h-1.5 overflow-hidden rounded-full">
        <div className="grow-bar h-full rounded-full" style={{ width: `${pct}%`, background: fundo, ["--i" as string]: i }} />
      </div>
    </div>
  );
}

/* ───────── Em construção: as telas novas entram vazias, sem números inventados ───────── */

export function EmConstrucao({
  icone: Icone,
  titulo,
  children,
  itens,
  fontes,
}: {
  icone: ComponentType<{ className?: string }>;
  titulo: string;
  children: ReactNode;
  /** O que a tela vai ter (texto, não dado). */
  itens: string[];
  /** De onde os números vão vir. */
  fontes?: string;
}) {
  return (
    <section className="surface-card" aria-labelledby="em-construcao-titulo">
      <div className="flex flex-col gap-6 p-5 sm:p-8 lg:flex-row lg:items-start lg:gap-10">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warning/16 px-2.5 py-1 text-2xs font-semibold tracking-wide text-warning-text uppercase">
            <Construction aria-hidden="true" className="size-3.5" />
            Em construção
          </span>
          <h2 id="em-construcao-titulo" className="flex items-center gap-2.5 text-xl font-semibold">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary-text">
              <Icone className="size-[18px]" />
            </span>
            {titulo}
          </h2>
          <div className="max-w-prose text-sm leading-relaxed text-muted-foreground">{children}</div>
          <p className="max-w-prose rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            Esta tela ainda não mostra números: nada aqui é inventado. Cada indicador entra quando a fonte real estiver
            ligada{fontes ? ` (${fontes})` : ""}.
          </p>
        </div>
        <div className="min-w-0 lg:w-80">
          <p className="mb-2 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">O que vai ter</p>
          <ul className="flex flex-col gap-2">
            {itens.map((item) => (
              <li key={item} className="flex items-start gap-2.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm">
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
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

/* ───────── Carregando (núcleo pulsante) ───────── */

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

/* ───────── Cabeçalho de página (a barra do topo) ───────── */

/**
 * Faixa fixa no topo da área que rola: quadrado com o ícone, título e descrição à esquerda e as
 * ações à direita. 64px de altura, alinhada ao topo do menu lateral. Fundo quase sólido com desfoque,
 * para os cards não atravessarem o título. Ocupa a largura toda da página
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

/* ───────── Seletor segmentado (os chips da barra de filtros) ───────── */

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

/* ───────── Abas com contagem ───────── */

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
