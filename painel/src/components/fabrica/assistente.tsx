import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { api, type TipoAssistente } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/fields";

/*
 * O assistente de IA da fábrica: a pessoa descreve o que quer e recebe um rascunho para o formulário.
 * Nada é salvo: quem usa decide o que fazer com o rascunho (preencher os campos, comparar, escolher).
 * Cada pedido leva de 5 a 20 s; os "alertas" do rascunho aparecem em destaque.
 */

export type Rascunho<T> = T & { alertas?: string[] };

export function useAssistente<T>(tipo: TipoAssistente) {
  return useMutation({
    mutationFn: (corpo: { pedido: string; agente?: string; atual?: Record<string, unknown> }) =>
      api<{ tipo: TipoAssistente; rascunho: Rascunho<T> }>("/fabrica/assistente", {
        method: "POST",
        body: JSON.stringify({ tipo, ...corpo }),
      }).then((r) => r.rascunho),
  });
}

/** Caixa do assistente: pedido, botão e, depois da resposta, os alertas. */
export function AssistenteIA<T>({
  tipo,
  titulo,
  ajuda,
  placeholder,
  agente,
  atual,
  pedidoOpcional = false,
  aberto: abertoInicial = false,
  rotuloBotao = "Gerar com IA",
  aoReceber,
}: {
  tipo: TipoAssistente;
  titulo: string;
  ajuda: string;
  placeholder: string;
  agente?: string;
  atual?: Record<string, unknown>;
  /** Sem pedido, o assistente trabalha só com o que já sabe do agente (casos de teste). */
  pedidoOpcional?: boolean;
  aberto?: boolean;
  rotuloBotao?: string;
  aoReceber: (rascunho: Rascunho<T>) => void;
}) {
  const [aberto, setAberto] = useState(abertoInicial);
  const [pedido, setPedido] = useState("");
  const gerar = useAssistente<T>(tipo);
  const alertas = gerar.data?.alertas ?? [];

  return (
    <section className="overflow-hidden rounded-xl border border-primary/25 bg-linear-to-br from-primary/8 to-accent/5">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{titulo}</span>
          {!aberto && <span className="block truncate text-xs text-muted-foreground">{ajuda}</span>}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} />
      </button>
      {aberto && (
        <div className="space-y-3 border-t border-primary/15 px-4 py-3">
          <p className="text-xs text-muted-foreground">{ajuda}</p>
          <Textarea
            rows={4}
            value={pedido}
            maxLength={30000}
            placeholder={placeholder}
            onChange={(e) => setPedido(e.target.value)}
            className="bg-card"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={gerar.isPending || (!pedidoOpcional && pedido.trim().length < 10)}
              onClick={() => gerar.mutate({ pedido: pedido.trim(), agente, atual }, { onSuccess: (r) => aoReceber(r) })}
            >
              {gerar.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {gerar.isPending ? "Gerando…" : rotuloBotao}
            </Button>
            {gerar.isPending && <span className="text-xs text-muted-foreground">Leva de 5 a 20 segundos.</span>}
            {gerar.isSuccess && !gerar.isPending && <span className="text-xs text-success">Rascunho pronto. Revise antes de salvar.</span>}
          </div>
          {gerar.isError && <p className="text-xs text-destructive">{(gerar.error as Error).message}</p>}
          <Alertas itens={alertas} />
        </div>
      )}
    </section>
  );
}

export function Alertas({ itens }: { itens: string[] }) {
  if (!itens.length) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
      {itens.map((a) => (
        <li key={a} className="flex gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>{a}</span>
        </li>
      ))}
    </ul>
  );
}

/* ───────── Diferença entre dois textos, por linha ───────── */

type Linha = { tipo: "igual" | "saiu" | "entrou"; texto: string };

/** Diferença por linha (maior subsequência comum). Os textos das instruções têm algumas centenas de linhas. */
export function diferencaPorLinha(antes: string, depois: string): Linha[] {
  const a = antes.split("\n");
  const b = depois.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const saida: Linha[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      saida.push({ tipo: "igual", texto: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) saida.push({ tipo: "saiu", texto: a[i++] });
    else saida.push({ tipo: "entrou", texto: b[j++] });
  }
  while (i < n) saida.push({ tipo: "saiu", texto: a[i++] });
  while (j < m) saida.push({ tipo: "entrou", texto: b[j++] });
  return saida;
}

/** Mostra só o que mudou, com duas linhas iguais de contexto em volta de cada trecho. */
export function Diferenca({ antes, depois }: { antes: string; depois: string }) {
  const linhas = diferencaPorLinha(antes, depois);
  const perto = new Set<number>();
  linhas.forEach((l, k) => {
    if (l.tipo !== "igual") for (let d = -2; d <= 2; d++) perto.add(k + d);
  });
  const entrou = linhas.filter((l) => l.tipo === "entrou").length;
  const saiu = linhas.filter((l) => l.tipo === "saiu").length;

  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-xs">
        <span className="font-semibold text-success">+{entrou} linhas</span>
        <span className="font-semibold text-destructive">−{saiu} linhas</span>
      </div>
      <pre className="thin-scroll num max-h-[45vh] overflow-auto rounded-lg border border-border bg-muted/30 py-2 text-[12px] leading-relaxed">
        {linhas.map((l, k) =>
          perto.has(k) ? (
            <div
              key={k}
              className={cn(
                "px-3 whitespace-pre-wrap",
                l.tipo === "entrou" && "bg-success/12 text-success",
                l.tipo === "saiu" && "bg-destructive/12 text-destructive line-through decoration-destructive/40",
              )}
            >
              {l.tipo === "entrou" ? "+ " : l.tipo === "saiu" ? "− " : "  "}
              {l.texto || " "}
            </div>
          ) : perto.has(k - 1) ? (
            <div key={k} className="px-3 text-muted-foreground/60">
              ⋯
            </div>
          ) : null,
        )}
        {entrou + saiu === 0 && <div className="px-3 text-muted-foreground">Nenhuma diferença.</div>}
      </pre>
    </div>
  );
}
