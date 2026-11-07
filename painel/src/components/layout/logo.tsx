import { cn } from "@/lib/utils";

/** O símbolo do GestorGov: o "G" em arco com as três barras e o ponto amarelo. */
export function SimboloGestorGov({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={cn("shrink-0", className)} aria-hidden="true">
      <defs>
        <linearGradient id="gg-arco" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0E2A6B" />
          <stop offset="100%" stopColor="#1A63D8" />
        </linearGradient>
      </defs>
      {/* Arco do "G": aberto no alto à direita, onde fica o ponto amarelo. */}
      <path
        d="M98 30 A50 50 0 1 0 110 62"
        fill="none"
        stroke="url(#gg-arco)"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <rect x="34" y="62" width="12" height="30" rx="2" fill="#0B2366" />
      <rect x="52" y="48" width="12" height="44" rx="2" fill="#1A63D8" />
      <rect x="70" y="32" width="12" height="60" rx="2" fill="#52A2FF" />
      <circle cx="98" cy="30" r="8" fill="#F4B800" />
    </svg>
  );
}

/** A logo inteira: símbolo, "Gestor" na cor do texto (vale no claro e no escuro) e "GOV" em azul. */
export function LogoMarca({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} role="img" aria-label="GestorGov">
      <SimboloGestorGov className="h-full w-auto" />
      <span className="text-[1.05em] leading-none font-extrabold tracking-tight">
        <span className="text-foreground">Gestor</span> <span className="text-[#1A63D8] dark:text-[#52A2FF]">GOV</span>
      </span>
    </span>
  );
}

/** Marca do painel: a logo, o filete amarelo e o subtítulo. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex flex-col items-start gap-1 leading-tight", className)}>
      <LogoMarca className="h-7 text-lg" />
      <span className="ml-9 block h-[3px] w-10 bg-[#F4B800]" aria-hidden="true" />
      <span className="ml-9 block text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
        Gestão pública inteligente
      </span>
    </span>
  );
}

/** Só o símbolo, no menu recolhido. */
export function LogoIcone({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-md bg-card ring-1 ring-border", className)}>
      <SimboloGestorGov className="size-8" />
    </span>
  );
}
