import { useState, type ComponentType, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tabela do painel: a rolagem é do cartão (não da página), nos dois sentidos, com a altura limitada à
 * tela; a lateral se anuncia com sombra e o cabeçalho fica fixo ao rolar. Acabamento das tabelas do
 * Padrão do painel: rótulos em caixa alta pequenos, linhas com divisória fina e realce leve no hover, número
 * em coluna própria com numeral tabular.
 */

export function TableWrapper({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // A altura desconta o cabeçalho da página (fixo) e uma folga: a tabela inteira cabe na tela.
        "sombra-de-rolagem thin-scroll relative max-h-[calc(100dvh-9rem)] w-full overflow-auto rounded-xl border border-border/60 bg-card shadow-[inset_0_1px_0_oklch(1_0_0/0.08),0_18px_38px_-28px_oklch(0_0_0/0.5)]",
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full text-sm", className)} {...props} />;
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("sticky top-0 z-10 bg-card", className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-border/50 transition-colors last:border-0 hover:bg-muted/40", className)} {...props} />;
}

export function TableHead({
  className,
  icone: Icone,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { icone?: ComponentType<{ className?: string }> }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-10 border-b border-border/60 px-4 text-left text-[11px] font-medium tracking-wider whitespace-nowrap text-muted-foreground uppercase",
        className,
      )}
      {...props}
    >
      {Icone ? (
        <span className="inline-flex items-center gap-1.5">
          <Icone className="size-3.5 shrink-0 opacity-70" />
          {children}
        </span>
      ) : (
        children
      )}
    </th>
  );
}

export function TableCell({ className, numeric = false, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cn("px-4 py-2.5 align-middle", numeric && "num text-right", className)} {...props} />;
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

/** Caixa de seleção da linha e do cabeçalho (o cabeçalho fica "meio marcado" com parte selecionada). */
export function Marcador({
  marcado,
  parcial = false,
  onAlternar,
  rotulo,
}: {
  marcado: boolean;
  parcial?: boolean;
  onAlternar: () => void;
  rotulo: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={rotulo}
      checked={marcado}
      ref={(el) => {
        if (el) el.indeterminate = parcial && !marcado;
      }}
      onChange={onAlternar}
      onClick={(e) => e.stopPropagation()}
      className="size-4 cursor-pointer rounded border-border accent-[var(--color-primary)]"
    />
  );
}

/* ───────── Ordenação ───────── */

export type Direcao = "asc" | "desc";

export function useOrdenacao<Chave extends string>(chaveInicial: Chave, inicial: Direcao = "desc") {
  const [chave, setChave] = useState<Chave>(chaveInicial);
  const [direcao, setDirecao] = useState<Direcao>(inicial);
  const alternar = (nova: Chave) => {
    if (nova === chave) setDirecao((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setChave(nova);
      setDirecao("desc");
    }
  };
  return { chave, direcao, alternar };
}

export function CabecalhoOrdenavel<Chave extends string>({
  rotulo,
  campo,
  chaveAtiva,
  direcao,
  onAlternar,
  icone: Icone,
  alinhamento = "left",
}: {
  rotulo: string;
  campo: Chave;
  chaveAtiva: Chave;
  direcao: Direcao;
  onAlternar: (campo: Chave) => void;
  icone?: ComponentType<{ className?: string }>;
  alinhamento?: "left" | "right";
}) {
  const ativa = chaveAtiva === campo;
  const Seta = !ativa ? ArrowUpDown : direcao === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onAlternar(campo)}
      aria-label={`Ordenar por ${rotulo}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm uppercase outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        alinhamento === "right" && "ml-auto",
        ativa && "text-foreground",
      )}
    >
      {Icone && <Icone className="size-3.5 shrink-0 opacity-70" />}
      {rotulo}
      <Seta aria-hidden="true" className={cn("size-3.5 shrink-0", ativa ? "opacity-100" : "opacity-40")} />
    </button>
  );
}

/** Rótulo colorido de estado (ponto + texto). */
export function Chip({
  tom = "neutro",
  children,
  className,
}: {
  tom?: "neutro" | "sucesso" | "alerta" | "erro" | "info" | "primario";
  children: ReactNode;
  className?: string;
}) {
  const cores = {
    neutro: "border-border/60 bg-muted/40 text-muted-foreground [--ponto:var(--color-muted-foreground)]",
    sucesso: "border-success/30 bg-success/10 text-success [--ponto:var(--color-success)]",
    alerta: "border-warning/30 bg-warning/10 text-warning-text [--ponto:var(--color-warning)]",
    erro: "border-destructive/30 bg-destructive/10 text-destructive [--ponto:var(--color-destructive)]",
    info: "border-accent/30 bg-accent/10 text-accent [--ponto:var(--color-accent)]",
    primario: "border-primary/30 bg-primary/10 text-primary-text [--ponto:var(--color-primary)]",
  }[tom];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", cores, className)}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--ponto)]" />
      {children}
    </span>
  );
}
