import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Painel que desliza da direita para ver e editar sem sair da Central (Esc fecha; o foco entra nele). */
export function Slideover({
  titulo,
  subtitulo,
  aoFechar,
  children,
  rodape,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  aoFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  const painel = useRef<HTMLElement>(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  useEffect(() => {
    painel.current?.focus();
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && fechar.current();
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, []);

  return (
    <aside
      ref={painel}
      tabIndex={-1}
      role="dialog"
      aria-label={titulo}
      className="fixed top-3 right-3 bottom-3 z-[200] flex w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-card text-card-foreground shadow-[0_30px_80px_-20px_rgba(13,27,56,0.6)] outline-none animate-in slide-in-from-right-8 fade-in-0"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base leading-snug font-semibold">{titulo}</h2>
          {subtitulo && <div className="mt-0.5 text-xs text-muted-foreground">{subtitulo}</div>}
        </div>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {rodape && <footer className="border-t border-border px-5 py-3">{rodape}</footer>}
    </aside>
  );
}
