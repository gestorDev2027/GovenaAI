import { useRef, type CSSProperties, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Painel lateral de detalhes: um cartão que flutua à direita, com cabeçalho (ícone, rótulo em caixa
 * alta, título e descrição), uma faixa opcional de indicadores, corpo que rola sozinho e rodapé fixo
 * com as ações. Usa o Dialog do Radix, que prende o foco, fecha no Esc e devolve o foco a quem abriu.
 * No celular ocupa a tela inteira.
 */

const LARGURAS = {
  md: "sm:max-w-xl",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  "2xl": "sm:max-w-[min(1240px,calc(100vw-1.5rem))]",
} as const;

export function PainelLateral({
  aberto,
  aoMudar,
  titulo,
  descricao,
  rotulo,
  icone,
  destaque,
  rodape,
  largura = "lg",
  corpo = "rolagem",
  focoNoPainel = false,
  children,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  titulo: ReactNode;
  descricao?: ReactNode;
  rotulo?: ReactNode;
  icone?: ReactNode;
  /** Faixa logo abaixo do cabeçalho, fora da rolagem (ex.: IndicadoresPainel). */
  destaque?: ReactNode;
  rodape?: ReactNode;
  largura?: keyof typeof LARGURAS;
  /** rolagem: o corpo rola com recuo padrão; livre: quem usa divide o corpo (ex.: duas colunas que rolam). */
  corpo?: "rolagem" | "livre";
  /** Ao abrir, o foco fica no painel e não no primeiro botão (que ganharia o contorno de foco, como num menu). */
  focoNoPainel?: boolean;
  children: ReactNode;
}) {
  const conteudo = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={aberto} onOpenChange={aoMudar}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/50 backdrop-blur-[4px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          ref={conteudo}
          tabIndex={-1}
          onOpenAutoFocus={
            focoNoPainel
              ? (e) => {
                  e.preventDefault();
                  conteudo.current?.focus();
                }
              : undefined
          }
          className={cn(
            // Vidro do painel, mais denso (styles.css: .vidro, .vidro-denso): o painel cobre a página.
            "vidro vidro-denso fixed inset-0 z-50 flex w-full flex-col overflow-hidden text-card-foreground outline-none",
            "sm:inset-y-3 sm:right-3 sm:left-auto sm:rounded-2xl",
            "!shadow-[inset_0_1px_0_oklch(1_0_0/0.13),0_28px_70px_-16px_rgb(0_0_0/0.55)]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-8 data-[state=open]:duration-300",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-8 data-[state=closed]:duration-150",
            "motion-reduce:animate-none",
            LARGURAS[largura],
          )}
          style={{ "--tw-ease": "cubic-bezier(0.16, 1, 0.3, 1)" } as CSSProperties}
        >
          <div className="relative flex shrink-0 items-start gap-3.5 px-5 pt-5 pb-4 pr-16 sm:px-6">
            {icone && (
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-text [&_svg]:size-[18px]"
              >
                {icone}
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {rotulo && (
                <span className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">{rotulo}</span>
              )}
              <Dialog.Title className="text-base leading-snug font-semibold tracking-tight break-words sm:text-lg">{titulo}</Dialog.Title>
              <Dialog.Description className={cn("text-sm leading-relaxed text-muted-foreground", !descricao && "sr-only")}>
                {descricao ?? titulo}
              </Dialog.Description>
            </div>
          </div>

          {destaque && <div className="relative shrink-0 px-5 pb-4 sm:px-6">{destaque}</div>}

          {corpo === "livre" ? (
            <div className="relative flex min-h-0 flex-1 border-t border-border/60">{children}</div>
          ) : (
            <div className="thin-scroll relative min-h-0 flex-1 overflow-y-auto border-t border-border/60 px-5 py-5 sm:px-6">{children}</div>
          )}

          {rodape && (
            <div className="relative flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-background/30 px-5 py-3.5 sm:px-6">
              {rodape}
            </div>
          )}

          <Dialog.Close
            aria-label="Fechar"
            className="absolute top-4 right-4 grid size-9 place-items-center rounded-xl border border-border/60 bg-card/40 text-muted-foreground outline-none transition-colors hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const TONS_BARRA = {
  primario: "bg-primary",
  sucesso: "bg-success",
  alerta: "bg-warning",
  neutro: "bg-muted-foreground/60",
} as const;

export interface IndicadorPainel {
  rotulo: ReactNode;
  valor: ReactNode;
  detalhe?: ReactNode;
  icone?: ReactNode;
  /** 0 a 1: desenha uma barra de progresso embaixo do valor. */
  barra?: number;
  tom?: keyof typeof TONS_BARRA;
}

/** Faixa de números do painel (ex.: "Trechos 3 · Exemplos 1"), para usar em `destaque`. */
export function IndicadoresPainel({ itens }: { itens: IndicadorPainel[] }) {
  return (
    <div className={cn("grid gap-2", itens.length >= 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
      {itens.map((item, i) => (
        <div key={i} className="flex flex-col gap-1 rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[10px] tracking-wider text-muted-foreground uppercase [&_svg]:size-3.5">
            {item.icone}
            {item.rotulo}
          </span>
          <span className="num text-xl leading-none font-bold tracking-tight text-foreground">{item.valor}</span>
          {item.barra != null && (
            <span className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", TONS_BARRA[item.tom ?? "primario"])}
                style={{ width: `${Math.round(Math.min(Math.max(item.barra, 0), 1) * 100)}%` }}
              />
            </span>
          )}
          {item.detalhe && <span className="text-[11px] text-muted-foreground">{item.detalhe}</span>}
        </div>
      ))}
    </div>
  );
}

/** Seção do corpo do painel: rótulo em caixa alta com a contagem e, à direita, uma ação. */
export function SecaoPainel({
  titulo,
  contagem,
  acao,
  children,
  className,
}: {
  titulo: ReactNode;
  contagem?: number;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2.5", className)}>
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">{titulo}</h3>
        {contagem != null && (
          <span className="num rounded-md bg-muted/60 px-1.5 py-px text-[10px] text-muted-foreground">{contagem}</span>
        )}
        <span aria-hidden="true" className="h-px flex-1 bg-border/60" />
        {acao}
      </div>
      {children}
    </section>
  );
}

/** Um campo do painel: rótulo, conteúdo e uma ajuda curta embaixo. */
export function Campo({ rotulo, ajuda, children, className }: { rotulo: ReactNode; ajuda?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="text-sm font-semibold">{rotulo}</div>
      {children}
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}
