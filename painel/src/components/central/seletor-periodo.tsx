import { useEffect, useRef, useState } from "react";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DIAS_MAX,
  PERIODOS_RAPIDOS,
  diaLocal,
  erroDatas,
  idPeriodo,
  rotuloPeriodo,
  type PeriodoCentral,
} from "@/lib/periodo-central";

/**
 * O período da Central: atalhos (8 h, 24 h, hoje, 7 e 30 dias) e um intervalo de datas. Vale para os números,
 * o escritório e todas as abas.
 */
export function SeletorPeriodo({ periodo, aoMudar, className }: { periodo: PeriodoCentral; aoMudar: (p: PeriodoCentral) => void; className?: string }) {
  const escolhido = idPeriodo(periodo);
  const [aberto, setAberto] = useState(false);
  const hoje = diaLocal(new Date());
  const [de, setDe] = useState(periodo.tipo === "datas" ? periodo.de : diaLocal(new Date(Date.now() - 6 * 86400_000)));
  const [ate, setAte] = useState(periodo.tipo === "datas" ? periodo.ate : hoje);
  const caixa = useRef<HTMLDivElement>(null);
  const erro = erroDatas(de, ate);

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => caixa.current && !caixa.current.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const botao = (ativo: boolean) =>
    cn(
      "rounded-lg px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors",
      ativo ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div ref={caixa} className={cn("relative flex rounded-xl border border-border bg-muted/40 p-0.5", className)}>
      {PERIODOS_RAPIDOS.map((r) => (
        <button key={r.id} type="button" onClick={() => aoMudar(r.periodo)} className={botao(escolhido === r.id)}>
          {r.rotulo}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className={cn(botao(escolhido === "datas"), "inline-flex items-center gap-1")}
        aria-expanded={aberto}
        title="Escolher um intervalo de datas"
      >
        <CalendarRange className="size-3.5" />
        {periodo.tipo === "datas" ? rotuloPeriodo(periodo) : "Datas"}
      </button>
      {aberto && (
        <div className="absolute top-full right-0 z-50 mt-2 w-72 rounded-2xl border border-border bg-card p-3 shadow-xl">
          <div className="mb-2 text-xs font-semibold">Intervalo de datas</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              De
              <input type="date" value={de} max={hoje} onChange={(e) => setDe(e.target.value)} className="h-9 rounded-xl border bg-muted/50 px-2 text-xs text-foreground outline-none focus:border-primary/50" />
            </label>
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              Até
              <input type="date" value={ate} max={hoje} onChange={(e) => setAte(e.target.value)} className="h-9 rounded-xl border bg-muted/50 px-2 text-xs text-foreground outline-none focus:border-primary/50" />
            </label>
          </div>
          <p className={cn("mt-2 text-[11px]", erro ? "text-destructive" : "text-muted-foreground")}>
            {erro ?? `Até ${DIAS_MAX} dias. Conta o que aconteceu entre as duas datas, inclusive.`}
          </p>
          <button
            type="button"
            disabled={!!erro}
            onClick={() => {
              aoMudar({ tipo: "datas", de, ate });
              setAberto(false);
            }}
            className="mt-2 w-full rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}
