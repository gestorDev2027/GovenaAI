import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { SimboloGestorGov } from "@/components/layout/logo";
import { useEscuro, useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

/*
 * A barra que flutua no alto das telas de cena (Central ao vivo, Unidade, Mapa): a marca (volta ao painel), o nome
 * da tela e os botões. Uma só para as três, nas cores do "palco" (styles.css), que seguem o tema claro e escuro.
 */

export function BarraPalco({
  rotulo,
  titulo,
  subtitulo,
  inicio,
  children,
}: {
  /** O nome da barra para leitores de tela. */
  rotulo: string;
  titulo?: ReactNode;
  subtitulo?: ReactNode;
  /** No lugar do título: um controle (ex.: o seletor da unidade). */
  inicio?: ReactNode;
  children: ReactNode;
}) {
  const escuro = useEscuro();
  return (
    <nav
      aria-label={rotulo}
      className="absolute top-4 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 rounded-full border border-palco-borda bg-palco-barra p-1.5 pl-3 text-palco-foreground shadow-[0_18px_50px_-15px_rgb(0_0_0/0.45)] backdrop-blur-md"
    >
      <Link to="/" aria-label="Voltar ao painel" className="flex items-center gap-2 rounded-full pr-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <SimboloGestorGov sobreEscuro={escuro} className="size-7" />
        {titulo && (
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-sm font-bold">{titulo}</span>
            {subtitulo && <span className="text-[10px] opacity-65">{subtitulo}</span>}
          </span>
        )}
      </Link>
      {inicio}
      <DivisorPalco />
      {children}
      <DivisorPalco />
      <BotaoTema />
    </nav>
  );
}

export function DivisorPalco() {
  return <span className="mx-1 h-6 w-px bg-palco-borda" aria-hidden="true" />;
}

export function BotaoPalco({
  rotulo,
  ativo,
  onClick,
  contagem,
  children,
}: {
  rotulo: string;
  ativo?: boolean;
  onClick: () => void;
  /** Um número no canto (ex.: quantas unidades a conferir). */
  contagem?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      aria-pressed={ativo}
      className={cn(
        "relative grid size-9 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ativo ? "bg-primary text-primary-foreground" : "text-palco-foreground/80 hover:bg-palco-foreground/10",
      )}
    >
      {children}
      {!!contagem && (
        <span className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-warning text-[9px] font-bold text-warning-foreground">
          {contagem}
        </span>
      )}
    </button>
  );
}

/** Um link em pílula na barra (ex.: "Mapa", "Central ao vivo"). */
export function LinkPalco({ children, className, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 rounded-full bg-palco-foreground/10 px-3 text-xs text-palco-foreground/85 outline-none hover:bg-palco-foreground/15 focus-visible:ring-2 focus-visible:ring-ring",
        className as string,
      )}
    >
      {children}
    </Link>
  );
}

function BotaoTema() {
  const { theme, toggle } = useTheme();
  const escuro = theme === "dark";
  return (
    <BotaoPalco rotulo={escuro ? "Usar o tema claro" : "Usar o tema escuro"} onClick={toggle}>
      {escuro ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </BotaoPalco>
  );
}
