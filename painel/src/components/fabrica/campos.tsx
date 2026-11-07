import { useState, type ComponentProps } from "react";
import { Check, Lock, Plus, Trash2 } from "lucide-react";
import type { OpcoesFabrica } from "@/lib/api";
import { CATEGORIA_FIXA, CORES, FERRAMENTA_OBRIGATORIA, chaveDoRotulo } from "@/lib/fabrica";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";

/** Lista de opções no mesmo estilo dos campos de texto. */
export function Selecao({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

/** As cores sugeridas e, no fim, qualquer outra. */
export function EscolhaDeCor({ valor, aoMudar, cores = CORES }: { valor: string; aoMudar: (cor: string) => void; cores?: string[] }) {
  const propria = !cores.includes(valor.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-2">
      {cores.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={valor.toLowerCase() === c}
          onClick={() => aoMudar(c)}
          className={cn(
            "grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-card transition-transform hover:scale-110",
            valor.toLowerCase() === c && "ring-2 ring-foreground/60",
          )}
          style={{ background: c }}
        >
          {valor.toLowerCase() === c && <Check className="size-4 text-white" />}
        </button>
      ))}
      <label
        title="Outra cor"
        className={cn(
          "relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-border ring-offset-2 ring-offset-card",
          propria && "border-solid ring-2 ring-foreground/60",
        )}
        style={propria ? { background: valor } : undefined}
      >
        {!propria && <Plus className="size-4 text-muted-foreground" />}
        <input type="color" value={valor} onChange={(e) => aoMudar(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

/**
 * Os motivos de transferência (chave → rótulo). A chave sai do rótulo de um motivo novo e não muda
 * depois; "Outro assunto" entra sempre e não sai.
 */
export function EditorCategorias({ valor, aoMudar }: { valor: Record<string, string>; aoMudar: (v: Record<string, string>) => void }) {
  const [novo, setNovo] = useState("");
  const chaveNova = chaveDoRotulo(novo);
  const repetida = chaveNova in valor;
  const lista = Object.entries(valor).sort(([a], [b]) => Number(a === CATEGORIA_FIXA.chave) - Number(b === CATEGORIA_FIXA.chave));

  const acrescentar = () => {
    if (!chaveNova || repetida) return;
    // O "outro" fica sempre por último.
    const { [CATEGORIA_FIXA.chave]: outro, ...resto } = valor;
    aoMudar({ ...resto, [chaveNova]: novo.trim(), [CATEGORIA_FIXA.chave]: outro ?? CATEGORIA_FIXA.rotulo });
    setNovo("");
  };

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {lista.map(([chave, rotulo]) => {
          const fixa = chave === CATEGORIA_FIXA.chave;
          return (
            <li key={chave} className="flex items-center gap-2">
              <Input value={rotulo} maxLength={60} onChange={(e) => aoMudar({ ...valor, [chave]: e.target.value })} className="flex-1" />
              <code className="num hidden w-36 shrink-0 truncate text-[11px] text-muted-foreground md:block" title={chave}>
                {chave}
              </code>
              {fixa ? (
                <span title="Entra sempre" className="grid size-9 shrink-0 place-items-center text-muted-foreground">
                  <Lock className="size-3.5" />
                </span>
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Tirar ${rotulo}`}
                  onClick={() => {
                    const { [chave]: _, ...resto } = valor;
                    aoMudar(resto);
                  }}
                >
                  <Trash2 className="text-muted-foreground" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          acrescentar();
        }}
      >
        <Input
          value={novo}
          maxLength={60}
          placeholder="Novo motivo, ex.: Acesso à plataforma"
          onChange={(e) => setNovo(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" variant="outline" disabled={!chaveNova || repetida}>
          <Plus /> Acrescentar
        </Button>
      </form>
      {repetida && <p className="text-xs text-destructive">Já existe um motivo com esse nome.</p>}
    </div>
  );
}

/** As ferramentas do agente: um cartão por ferramenta, marcável; a transferência fica travada. */
export function EscolhaDeFerramentas({
  opcoes,
  valor,
  aoMudar,
}: {
  opcoes: OpcoesFabrica["ferramentas"];
  valor: string[];
  aoMudar: (v: string[]) => void;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {opcoes.map((f) => {
        const obrigatoria = f.obrigatoria || f.id === FERRAMENTA_OBRIGATORIA;
        const marcada = obrigatoria || valor.includes(f.id);
        return (
          <button
            key={f.id}
            type="button"
            role="checkbox"
            aria-checked={marcada}
            disabled={obrigatoria}
            onClick={() => aoMudar(marcada ? valor.filter((v) => v !== f.id) : [...valor, f.id])}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-default",
              marcada ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50",
            )}
          >
            <span
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border",
                marcada ? "border-primary bg-primary text-primary-foreground" : "border-input",
              )}
            >
              {obrigatoria ? <Lock className="size-3" /> : marcada && <Check className="size-3.5" />}
            </span>
            <span className="min-w-0 space-y-0.5">
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                {f.nome}
                {obrigatoria && <span className="rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">obrigatória</span>}
                {!f.disponivel && (
                  <span className="rounded bg-warning/15 px-1.5 text-[10px] font-medium text-warning">fonte não configurada</span>
                )}
              </span>
              <span className="block text-xs text-muted-foreground">{f.descricao}</span>
              <code className="num block text-[10px] text-muted-foreground/70">{f.id}</code>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** O avatar do agente: o símbolo do GestorGov em branco sobre a cor dele, como na barra da Central. */
export function AvatarAgente({ cor, tamanho = "md", className }: { cor: string; tamanho?: "sm" | "md" | "lg"; className?: string }) {
  const medidas = { sm: ["size-7", "size-4"], md: ["size-9", "size-5"], lg: ["size-12", "size-7"] }[tamanho];
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center rounded-full shadow-sm ring-2 ring-white/15", medidas[0], className)}
      style={{ background: `radial-gradient(circle at 30% 25%, color-mix(in oklab, ${cor} 70%, white), ${cor} 60%)` }}
    >
      <img src="/painel/espaco/gestorgov-branco.png" alt="" className={cn("drop-shadow-sm", medidas[1])} />
    </span>
  );
}
