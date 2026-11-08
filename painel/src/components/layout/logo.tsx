import { useId } from "react";
import { cn } from "@/lib/utils";

/** O símbolo do GestorGov: o "G" em arco com as três barras e o ponto amarelo. */
export function SimboloGestorGov({ className, sobreEscuro = false }: { className?: string; sobreEscuro?: boolean }) {
  // Um id por símbolo: com dois na mesma página (cabeçalho e rodapé), o degradê de um não pega o do outro.
  const arco = `gg-arco-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 120 120" className={cn("shrink-0", className)} aria-hidden="true">
      <defs>
        <linearGradient id={arco} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={sobreEscuro ? "#8FC2FF" : "#0E2A6B"} />
          <stop offset="100%" stopColor={sobreEscuro ? "#52A2FF" : "#1A63D8"} />
        </linearGradient>
      </defs>
      {/* Arco do "G": aberto no alto à direita, onde fica o ponto amarelo. */}
      <path d="M98 30 A50 50 0 1 0 110 62" fill="none" stroke={`url(#${arco})`} strokeWidth="14" strokeLinecap="round" />
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
    <span className={cn("leading-none font-bold tracking-[-0.025em]", className)}>
      <span className={sobreEscuro ? "text-white" : "text-foreground"}>Gestor</span>
      <span className={sobreEscuro ? "text-[#52A2FF]" : "text-[#1A63D8] dark:text-[#52A2FF]"}>Gov</span>
    </span>
  );
}

/** A logo em linha, com a altura dada por `className` (o símbolo acompanha). Para placas e lugares sem tamanho fixo. */
export function LogoMarca({ className, sobreEscuro = false }: { className?: string; sobreEscuro?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} role="img" aria-label="GestorGov">
      <SimboloGestorGov className="h-full w-auto" sobreEscuro={sobreEscuro} />
      <Nome sobreEscuro={sobreEscuro} className="text-[1.05em]" />
    </span>
  );
}

// Os três tamanhos da marca, iguais em todas as telas: o símbolo, o nome e o espaço entre eles andam juntos.
const TAMANHOS = {
  sm: { simbolo: "size-7", nome: "text-[17px]", espaco: "gap-2" }, // barras finas (implantação)
  md: { simbolo: "size-8", nome: "text-[20px]", espaco: "gap-2.5" }, // cabeçalhos e menu
  lg: { simbolo: "size-11", nome: "text-[26px]", espaco: "gap-3" }, // telas de acesso e rodapé da landing
} as const;

/**
 * A marca do sistema: o símbolo e "GestorGov" numa linha. `tamanho`: sm, md (padrão) ou lg. `subtitulo` põe "Gestão
 * pública inteligente" embaixo do nome (só nas telas de acesso e no rodapé, onde há espaço); `sobreEscuro`: no menu
 * azul-marinho e nas faixas escuras.
 */
export function Logo({
  className,
  sobreEscuro = false,
  subtitulo = false,
  tamanho = "md",
}: {
  className?: string;
  sobreEscuro?: boolean;
  subtitulo?: boolean;
  tamanho?: keyof typeof TAMANHOS;
}) {
  const t = TAMANHOS[tamanho];
  return (
    <span className={cn("inline-flex items-center", t.espaco, className)} role="img" aria-label="GestorGov, gestão pública inteligente">
      <SimboloGestorGov className={t.simbolo} sobreEscuro={sobreEscuro} />
      <span className="flex flex-col gap-1.5">
        <Nome sobreEscuro={sobreEscuro} className={t.nome} />
        {subtitulo && (
          <span className={cn("text-[11px] leading-none font-medium tracking-wide", sobreEscuro ? "text-white/60" : "text-muted-foreground")}>
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
