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

/** O nome: "Gestor" na cor do texto e "Gov" em azul, numa palavra só. */
function Nome({ sobreEscuro, className }: { sobreEscuro: boolean; className?: string }) {
  return (
    <span className={cn("leading-none font-bold tracking-[-0.02em]", className)}>
      <span className={sobreEscuro ? "text-white" : "text-foreground"}>Gestor</span>
      <span className={sobreEscuro ? "text-[#52A2FF]" : "text-[#1A63D8] dark:text-[#52A2FF]"}>Gov</span>
    </span>
  );
}

/** A logo em linha: símbolo e nome. `className` define a altura (o símbolo acompanha). */
export function LogoMarca({ className, sobreEscuro = false }: { className?: string; sobreEscuro?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} role="img" aria-label="GestorGov">
      <SimboloGestorGov className="h-full w-auto" sobreEscuro={sobreEscuro} />
      <Nome sobreEscuro={sobreEscuro} className="text-[1.05em]" />
    </span>
  );
}

/**
 * A marca do sistema: o símbolo e "GestorGov" numa linha. `subtitulo` acrescenta "Gestão pública inteligente"
 * embaixo do nome (nas telas de acesso, onde há espaço); `sobreEscuro`: no menu azul-marinho e nas telas escuras.
 */
export function Logo({ className, sobreEscuro = false, subtitulo = false }: { className?: string; sobreEscuro?: boolean; subtitulo?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} role="img" aria-label="GestorGov, gestão pública inteligente">
      <SimboloGestorGov className="size-8" sobreEscuro={sobreEscuro} />
      <span className="flex flex-col gap-1">
        <Nome sobreEscuro={sobreEscuro} className="text-[19px]" />
        {subtitulo && (
          <span className={cn("text-[11px] leading-none font-medium", sobreEscuro ? "text-white/55" : "text-muted-foreground")}>
            Gestão pública inteligente
          </span>
        )}
      </span>
    </span>
  );
}

/** Só o símbolo, no menu recolhido. */
export function LogoIcone({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] ring-1 ring-white/10", className)}>
      <SimboloGestorGov sobreEscuro className="size-7" />
    </span>
  );
}
