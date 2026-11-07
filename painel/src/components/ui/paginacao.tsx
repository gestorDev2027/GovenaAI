import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Paginação das tabelas do painel: quantidade por página, "x–y de N" e os botões de página.
 * `usePaginacao` guarda a página e o tamanho e devolve a fatia da lista; volta para a primeira página
 * quando a lista encolhe (por exemplo, ao filtrar) e a página atual deixa de existir.
 */

export function usePaginacao<T>(lista: T[], porPaginaInicial = 10) {
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(porPaginaInicial);
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina));

  useEffect(() => {
    if (pagina > paginas) setPagina(1);
  }, [pagina, paginas]);

  const atual = Math.min(pagina, paginas);
  return {
    itens: lista.slice((atual - 1) * porPagina, atual * porPagina),
    pagina: atual,
    porPagina,
    total: lista.length,
    setPagina,
    setPorPagina: (n: number) => {
      setPorPagina(n);
      setPagina(1);
    },
  };
}

export function Paginacao({
  total,
  pagina,
  porPagina,
  setPagina,
  setPorPagina,
  opcoes = [10, 25, 50],
  className,
}: {
  total: number;
  pagina: number;
  porPagina: number;
  setPagina: (p: number) => void;
  setPorPagina: (n: number) => void;
  opcoes?: number[];
  className?: string;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const de = total ? (pagina - 1) * porPagina + 1 : 0;
  const ate = Math.min(pagina * porPagina, total);
  const botao =
    "grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground", className)}>
      <label className="flex items-center gap-2">
        Por página
        <select
          value={porPagina}
          onChange={(e) => setPorPagina(Number(e.target.value))}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30"
        >
          {opcoes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3">
        <span className="num">
          {de}–{ate} de {total}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Primeira página" className={botao} disabled={pagina <= 1} onClick={() => setPagina(1)}>
            <ChevronsLeft className="size-4" />
          </button>
          <button type="button" aria-label="Página anterior" className={botao} disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
            <ChevronLeft className="size-4" />
          </button>
          <span className="num min-w-14 text-center">
            {pagina} / {paginas}
          </span>
          <button
            type="button"
            aria-label="Próxima página"
            className={botao}
            disabled={pagina >= paginas}
            onClick={() => setPagina(pagina + 1)}
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Última página"
            className={botao}
            disabled={pagina >= paginas}
            onClick={() => setPagina(paginas)}
          >
            <ChevronsRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
