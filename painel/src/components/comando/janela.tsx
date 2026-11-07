import { useCallback, useEffect, useRef, useState, type ComponentType, type PointerEvent as PEvent, type ReactNode } from "react";
import { Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Janela flutuante da Central de comando: arrasta pelo título, redimensiona pelo canto, minimiza (fica só o
 * título) e fecha. Posição, tamanho e minimizada ficam guardados neste navegador, por janela. A janela clicada
 * vem para a frente. Acessível pelo teclado: o título é focável e as setas movem a janela (Shift: redimensiona).
 */

export interface Geometria {
  x: number;
  y: number;
  w: number;
  h: number;
  minimizada?: boolean;
}

const CHAVE = (id: string) => `gestorgov.comando.janela.${id}`;
let camada = 30; // z-index da próxima janela trazida para a frente

function ler(id: string, padrao: Geometria): Geometria {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE(id)) ?? "null");
    if (salvo && typeof salvo.x === "number") return { ...padrao, ...salvo };
  } catch {
    /* sem armazenamento: a posição padrão */
  }
  return padrao;
}

function caber(g: Geometria): Geometria {
  const largura = window.innerWidth;
  const altura = window.innerHeight;
  const w = Math.min(Math.max(g.w, 260), largura - 16);
  const h = Math.min(Math.max(g.h, 160), altura - 16);
  return { ...g, w, h, x: Math.min(Math.max(g.x, 8), largura - w - 8), y: Math.min(Math.max(g.y, 8), altura - 48) };
}

export function Janela({
  id,
  titulo,
  icone: Icone,
  padrao,
  aoFechar,
  acoes,
  children,
}: {
  id: string;
  titulo: string;
  icone?: ComponentType<{ className?: string }>;
  padrao: Geometria;
  aoFechar: () => void;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  const [g, setG] = useState<Geometria>(() => caber(ler(id, padrao)));
  const [z, setZ] = useState(() => ++camada);
  const arraste = useRef<{ tipo: "mover" | "redimensionar"; x0: number; y0: number; g0: Geometria } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE(id), JSON.stringify(g));
    } catch {
      /* noop */
    }
  }, [id, g]);

  useEffect(() => {
    const ajustar = () => setG((atual) => caber(atual));
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, []);

  const frente = useCallback(() => setZ(++camada), []);

  function comecar(e: PEvent, tipo: "mover" | "redimensionar") {
    if (e.button !== 0) return;
    if (tipo === "mover" && (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    frente();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    arraste.current = { tipo, x0: e.clientX, y0: e.clientY, g0: g };
  }
  function mover(e: PEvent) {
    const a = arraste.current;
    if (!a) return;
    const dx = e.clientX - a.x0;
    const dy = e.clientY - a.y0;
    setG(caber(a.tipo === "mover" ? { ...a.g0, x: a.g0.x + dx, y: a.g0.y + dy } : { ...a.g0, w: a.g0.w + dx, h: a.g0.h + dy }));
  }
  function soltar() {
    arraste.current = null;
  }
  function teclas(e: React.KeyboardEvent) {
    const passo = e.altKey ? 2 : 24;
    const mapa: Record<string, [number, number]> = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] };
    const d = mapa[e.key];
    if (!d) return;
    e.preventDefault();
    setG((atual) => caber(e.shiftKey ? { ...atual, w: atual.w + d[0], h: atual.h + d[1] } : { ...atual, x: atual.x + d[0], y: atual.y + d[1] }));
  }

  return (
    <section
      role="dialog"
      aria-label={titulo}
      onPointerDown={frente}
      style={{ left: g.x, top: g.y, width: g.w, height: g.minimizada ? undefined : g.h, zIndex: z }}
      className="fixed flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-card/95 text-card-foreground shadow-[0_24px_60px_-20px_rgba(13,27,56,0.55)] backdrop-blur-md"
    >
      <header
        tabIndex={0}
        onPointerDown={(e) => comecar(e, "mover")}
        onPointerMove={mover}
        onPointerUp={soltar}
        onKeyDown={teclas}
        aria-label={`${titulo}: arraste ou use as setas para mover (Shift + setas redimensiona)`}
        className="flex h-11 shrink-0 cursor-grab items-center gap-2 border-b border-border bg-muted/40 px-3 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        {Icone && (
          <span aria-hidden="true" className="grid size-6 place-items-center rounded-lg bg-primary/12 text-primary-text">
            <Icone className="size-3.5" />
          </span>
        )}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{titulo}</h2>
        {acoes}
        <button
          type="button"
          onClick={() => setG((atual) => ({ ...atual, minimizada: !atual.minimizada }))}
          aria-label={g.minimizada ? `Abrir ${titulo}` : `Minimizar ${titulo}`}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {g.minimizada ? <Plus className="size-4" /> : <Minus className="size-4" />}
        </button>
        <button
          type="button"
          onClick={aoFechar}
          aria-label={`Fechar ${titulo}`}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-4" />
        </button>
      </header>
      {!g.minimizada && (
        <>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
          <div
            aria-hidden="true"
            onPointerDown={(e) => comecar(e, "redimensionar")}
            onPointerMove={mover}
            onPointerUp={soltar}
            className={cn("absolute right-0 bottom-0 size-4 cursor-se-resize", "bg-[linear-gradient(135deg,transparent_50%,var(--color-border)_50%)]")}
          />
        </>
      )}
    </section>
  );
}
