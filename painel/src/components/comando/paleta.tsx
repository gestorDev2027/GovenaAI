import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Paleta de comandos (Ctrl+K ou ⌘K): tudo o que a Central faz, por nome. Setas escolhem, Enter executa, Esc fecha.
 * A busca ignora acentos e maiúsculas.
 */

export interface Comando {
  id: string;
  titulo: string;
  grupo: string;
  icone?: ComponentType<{ className?: string }>;
  dica?: string;
  executar: () => void;
}

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function Paleta({ comandos, aoFechar }: { comandos: Comando[]; aoFechar: () => void }) {
  const [termo, setTermo] = useState("");
  const [ativo, setAtivo] = useState(0);
  const lista = useRef<HTMLUListElement>(null);

  const achados = useMemo(() => {
    const t = normal(termo.trim());
    return t ? comandos.filter((c) => normal(`${c.titulo} ${c.grupo} ${c.dica ?? ""}`).includes(t)) : comandos;
  }, [termo, comandos]);

  useEffect(() => setAtivo(0), [termo]);
  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-indice="${ativo}"]`)?.scrollIntoView({ block: "nearest" });
  }, [ativo]);

  function executar(c?: Comando) {
    if (!c) return;
    aoFechar();
    c.executar();
  }

  let grupoAnterior = "";
  return (
    <div className="fixed inset-0 z-[300] grid place-items-start justify-center bg-[#0D1B38]/40 pt-[12vh] backdrop-blur-[2px]" onPointerDown={aoFechar}>
      <div
        role="dialog"
        aria-label="Paleta de comandos"
        onPointerDown={(e) => e.stopPropagation()}
        className="w-[min(620px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-white/10 bg-card text-card-foreground shadow-[0_30px_80px_-20px_rgba(13,27,56,0.7)] animate-in fade-in-0 zoom-in-95"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAtivo((a) => Math.min(a + 1, achados.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAtivo((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                executar(achados[ativo]);
              } else if (e.key === "Escape") {
                aoFechar();
              }
            }}
            placeholder="O que você quer fazer? (ex.: abrir aprovações, ver UPA, unidades)"
            aria-label="Buscar comando"
            role="combobox"
            aria-expanded="true"
            aria-controls="paleta-lista"
            className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">Esc</kbd>
        </div>
        <ul id="paleta-lista" ref={lista} role="listbox" className="thin-scroll max-h-[50vh] overflow-y-auto p-2">
          {achados.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum comando com "{termo}".</li>}
          {achados.map((c, i) => {
            const cabecalho = c.grupo !== grupoAnterior;
            grupoAnterior = c.grupo;
            const Icone = c.icone;
            return (
              <li key={c.id} role="presentation">
                {cabecalho && <p className="px-3 pt-2 pb-1 text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase">{c.grupo}</p>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === ativo}
                  data-indice={i}
                  onPointerMove={() => setAtivo(i)}
                  onClick={() => executar(c)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm outline-none",
                    i === ativo ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
                  )}
                >
                  {Icone && <Icone className="size-4 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{c.titulo}</span>
                  {c.dica && <span className={cn("truncate text-xs", i === ativo ? "text-primary-foreground/75" : "text-muted-foreground")}>{c.dica}</span>}
                  {i === ativo && <CornerDownLeft className="size-3.5 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
