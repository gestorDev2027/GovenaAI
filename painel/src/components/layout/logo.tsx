import { cn } from "@/lib/utils";

/** O símbolo do GestorGov: o "G" em arco com as três barras e o ponto amarelo. */
export function SimboloGestorGov({ className, sobreEscuro = false }: { className?: string; sobreEscuro?: boolean }) {
  const arco = sobreEscuro ? "gg-arco-claro" : "gg-arco";
  return (
    <svg viewBox="0 0 120 120" className={cn("shrink-0", className)} aria-hidden="true">
      <defs>
        <linearGradient id={arco} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={sobreEscuro ? "#8FC2FF" : "#0E2A6B"} />
          <stop offset="100%" stopColor={sobreEscuro ? "#52A2FF" : "#1A63D8"} />
        </linearGradient>
      </defs>
      {/* Arco do "G": aberto no alto à direita, onde fica o ponto amarelo. */}
      <path
        d="M98 30 A50 50 0 1 0 110 62"
        fill="none"
        stroke={`url(#${arco})`}
        strokeWidth="14"
        strokeLinecap="round"
      />
      <rect x="34" y="62" width="12" height="30" rx="2" fill={sobreEscuro ? "#C9DEFF" : "#0B2366"} />
      <rect x="52" y="48" width="12" height="44" rx="2" fill="#1A63D8" />
      <rect x="70" y="32" width="12" height="60" rx="2" fill="#52A2FF" />
      <circle cx="98" cy="30" r="8" fill="#F4B800" />
    </svg>
  );
}

/** A logo inteira: símbolo, "Gestor" na cor do texto (vale no claro e no escuro) e "GOV" em azul. */
export function LogoMarca({ className, sobreEscuro = false }: { className?: string; sobreEscuro?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} role="img" aria-label="GestorGov">
      <SimboloGestorGov className="h-full w-auto" sobreEscuro={sobreEscuro} />
      <span className="text-[1.05em] leading-none font-extrabold tracking-tight">
        <span className={sobreEscuro ? "text-white" : "text-foreground"}>Gestor</span>{" "}
        <span className={sobreEscuro ? "text-[#52A2FF]" : "text-[#1A63D8] dark:text-[#52A2FF]"}>GOV</span>
      </span>
    </span>
  );
}

/** Marca do painel: a logo, o filete amarelo e o subtítulo. `sobreEscuro`: no menu azul-marinho. */
export function Logo({ className, sobreEscuro = false }: { className?: string; sobreEscuro?: boolean }) {
  return (
    <span className={cn("flex flex-col items-start gap-1 leading-tight", className)}>
      <LogoMarca className="h-7 text-lg" sobreEscuro={sobreEscuro} />
      <span className="ml-9 block h-[3px] w-10 rounded-full bg-[#F4B800]" aria-hidden="true" />
      <span
        className={cn(
          "ml-9 block text-[10px] font-semibold tracking-[0.18em] uppercase",
          sobreEscuro ? "text-white/60" : "text-muted-foreground",
        )}
      >
        Gestão pública inteligente
      </span>
    </span>
  );
}

/** Só o símbolo, no menu recolhido. */
export function LogoIcone({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl bg-white ring-1 ring-white/10", className)}>
      <SimboloGestorGov className="size-8" />
    </span>
  );
}
