import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Network, Plus, ShieldCheck, Sparkles, Users } from "lucide-react";
import { api, type PermissaoPrefeitura } from "@/lib/api";
import { fmtInt } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { usePodeNaPrefeitura } from "@/hooks/use-permissoes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { EmptyState, PageHeader, PageLoader } from "@/components/widgets/widgets";

/*
 * Organograma e cargos da prefeitura: a hierarquia (quem se reporta a quem), quem ocupa cada cargo e as
 * PERMISSÕES de cada um no sistema. O dono (ou quem tem "gerenciar_cargos") monta o organograma padrão do
 * catálogo, cria cargos e marca as permissões; os demais só veem.
 */

export interface Cargo {
  id: string;
  nome: string;
  nivel: string;
  superior_id: string | null;
  atribuicoes: string | null;
  permissoes: PermissaoPrefeitura[];
  ativo: boolean;
  ocupantes: { email: string; nome: string | null; ativo: boolean }[];
}
interface CatalogoPermissoes {
  permissoes: { id: PermissaoPrefeitura; rotulo: string; descricao: string }[];
  niveis: string[];
}

export const NIVEIS: Record<string, string> = {
  direcao: "Direção",
  superintendencia: "Superintendência",
  coordenacao: "Coordenação",
  unidade: "Unidade",
  controle: "Controle e apoio",
};

export function useCargos() {
  return useQuery({ queryKey: ["prefeitura-cargos"], queryFn: () => api<{ cargos: Cargo[] }>("/prefeitura/cargos") });
}

export function Cargos() {
  const qc = useQueryClient();
  const podeNaPrefeitura = usePodeNaPrefeitura();
  const gerencia = podeNaPrefeitura("gerenciar_cargos");
  const cargos = useCargos();
  const catalogo = useQuery({
    queryKey: ["prefeitura-permissoes"],
    queryFn: () => api<CatalogoPermissoes>("/prefeitura/permissoes"),
    staleTime: Infinity,
  });
  const [aberto, setAberto] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const padrao = useMutation({
    mutationFn: () => api<{ criados: number }>("/prefeitura/cargos/padrao", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefeitura-cargos"] }),
  });

  const lista = cargos.data?.cargos ?? [];
  // A árvore: os de cima primeiro, cada um seguido dos que se reportam a ele.
  const arvore = useMemo(() => {
    const filhos = new Map<string | null, Cargo[]>();
    const ids = new Set(lista.map((c) => c.id));
    for (const c of lista) {
      const pai = c.superior_id && ids.has(c.superior_id) ? c.superior_id : null;
      filhos.set(pai, [...(filhos.get(pai) ?? []), c]);
    }
    const saida: { cargo: Cargo; nivel: number }[] = [];
    const andar = (pai: string | null, profundidade: number) => {
      for (const c of filhos.get(pai) ?? []) {
        saida.push({ cargo: c, nivel: profundidade });
        andar(c.id, profundidade + 1);
      }
    };
    andar(null, 0);
    return saida;
  }, [lista]);

  const ocupados = lista.filter((c) => c.ocupantes.some((o) => o.ativo)).length;

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Organograma e cargos"
        icon={Network}
        description="Quem se reporta a quem, quem ocupa cada cargo e o que cada cargo pode fazer no sistema."
        actions={
          gerencia && lista.length > 0 ? (
            <Button onClick={() => setCriando(true)}>
              <Plus /> Novo cargo
            </Button>
          ) : undefined
        }
      />

      {cargos.isLoading && <PageLoader className="h-[50vh]" label="Abrindo o organograma" />}
      {cargos.isError && (
        <div className="surface-card">
          <EmptyState title="Não foi possível abrir o organograma">{(cargos.error as Error).message}</EmptyState>
        </div>
      )}

      {cargos.data && lista.length === 0 && (
        <div className="surface-card has-waves">
          <EmptyState icon={<Network className="size-5" />} title="O organograma ainda está vazio">
            <p>
              O organograma padrão da Secretaria de Saúde tem 38 cargos em 5 níveis (direção, superintendências, coordenações, unidades e
              controle), cada um com as atribuições, os indicadores e as permissões sugeridas. Depois você ajusta cargo por cargo.
            </p>
            {gerencia ? (
              <Button className="mt-4" size="lg" onClick={() => padrao.mutate()} disabled={padrao.isPending}>
                {padrao.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Montar o organograma padrão
              </Button>
            ) : (
              <p className="mt-2 text-xs">Peça ao dono da prefeitura para montar o organograma.</p>
            )}
            {padrao.isError && <p className="mt-2 text-sm text-destructive">{(padrao.error as Error).message}</p>}
          </EmptyState>
        </div>
      )}

      {lista.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Numero rotulo="Cargos" valor={fmtInt(lista.length)} />
            <Numero rotulo="Com alguém no cargo" valor={fmtInt(ocupados)} />
            <Numero rotulo="Sem ninguém" valor={fmtInt(lista.length - ocupados)} />
            <Numero rotulo="Superintendências" valor={fmtInt(lista.filter((c) => c.nivel === "superintendencia").length)} />
          </div>

          <ul className="surface-card divide-y divide-border overflow-hidden p-0" aria-label="Organograma">
            {arvore.map(({ cargo, nivel }) => (
              <li key={cargo.id}>
                <button
                  type="button"
                  onClick={() => setAberto(aberto === cargo.id ? null : cargo.id)}
                  aria-expanded={aberto === cargo.id}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
                  style={{ paddingLeft: 16 + Math.min(nivel, 4) * 22 }}
                >
                  <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", aberto === cargo.id && "rotate-90")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{cargo.nome}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {NIVEIS[cargo.nivel] ?? cargo.nivel} · {cargo.ocupantes.length ? cargo.ocupantes.map((o) => o.nome || o.email).join(", ") : "ninguém no cargo"}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary-text sm:inline-flex">
                    <ShieldCheck className="size-3.5" /> {cargo.permissoes.length} permissões
                  </span>
                </button>
                {aberto === cargo.id && (
                  <DetalheDoCargo cargo={cargo} cargos={lista} catalogo={catalogo.data} podeEditar={gerencia} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {criando && catalogo.data && (
        <NovoCargo cargos={lista} catalogo={catalogo.data} aoFechar={() => setCriando(false)} />
      )}
    </div>
  );
}

function DetalheDoCargo({
  cargo,
  cargos,
  catalogo,
  podeEditar,
}: {
  cargo: Cargo;
  cargos: Cargo[];
  catalogo?: CatalogoPermissoes;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const [permissoes, setPermissoes] = useState<PermissaoPrefeitura[]>(cargo.permissoes);
  const [superior, setSuperior] = useState(cargo.superior_id ?? "");
  const mudou = superior !== (cargo.superior_id ?? "") || [...permissoes].sort().join() !== [...cargo.permissoes].sort().join();
  const salvar = useMutation({
    mutationFn: () =>
      api(`/prefeitura/cargos/${cargo.id}`, { method: "PUT", body: JSON.stringify({ permissoes, superior_id: superior || null }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefeitura-cargos"] }),
  });
  const alternar = (p: PermissaoPrefeitura) => setPermissoes((atual) => (atual.includes(p) ? atual.filter((x) => x !== p) : [...atual, p]));

  return (
    <div className="grid gap-5 border-t border-border bg-muted/30 px-4 py-4 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Atribuições</p>
          <p className="mt-1">{cargo.atribuicoes || "Sem atribuições escritas."}</p>
        </div>
        <div>
          <label htmlFor={`superior-${cargo.id}`} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Reporta-se a
          </label>
          <select
            id={`superior-${cargo.id}`}
            value={superior}
            disabled={!podeEditar}
            onChange={(e) => setSuperior(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-70"
          >
            <option value="">Ninguém (topo do organograma)</option>
            {cargos
              .filter((c) => c.id !== cargo.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </select>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Quem ocupa</p>
          <p className="mt-1 flex items-center gap-1.5">
            <Users className="size-4 text-muted-foreground" />
            {cargo.ocupantes.length ? cargo.ocupantes.map((o) => `${o.nome || o.email}${o.ativo ? "" : " (bloqueado)"}`).join(", ") : "Ninguém. Convide em Equipe e acessos."}
          </p>
        </div>
      </div>
      <fieldset className="space-y-2" disabled={!podeEditar}>
        <legend className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">O que este cargo pode fazer</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {catalogo?.permissoes.map((p) => (
            <label
              key={p.id}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-lg border bg-background p-2.5 text-sm transition-colors",
                permissoes.includes(p.id) ? "border-primary/50 bg-primary/5" : "border-border",
              )}
            >
              <input type="checkbox" className="mt-0.5 size-4 accent-[#1A63D8]" checked={permissoes.includes(p.id)} onChange={() => alternar(p.id)} />
              <span>
                <span className="block font-medium">{p.rotulo}</span>
                <span className="block text-xs text-muted-foreground">{p.descricao}</span>
              </span>
            </label>
          ))}
        </div>
        {podeEditar && (
          <div className="flex items-center gap-3 pt-1">
            <Button onClick={() => salvar.mutate()} disabled={!mudou || salvar.isPending}>
              {salvar.isPending && <Loader2 className="animate-spin" />}
              Salvar o cargo
            </Button>
            {salvar.isSuccess && !mudou && <span className="text-xs text-success">Salvo.</span>}
            {salvar.isError && <span className="text-xs text-destructive">{(salvar.error as Error).message}</span>}
          </div>
        )}
      </fieldset>
    </div>
  );
}

function NovoCargo({ cargos, catalogo, aoFechar }: { cargos: Cargo[]; catalogo: CatalogoPermissoes; aoFechar: () => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [nivel, setNivel] = useState("coordenacao");
  const [superior, setSuperior] = useState("");
  const [atribuicoes, setAtribuicoes] = useState("");
  const criar = useMutation({
    mutationFn: () =>
      api("/prefeitura/cargos", {
        method: "POST",
        body: JSON.stringify({ nome: nome.trim(), nivel, superior_id: superior || null, atribuicoes }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prefeitura-cargos"] });
      aoFechar();
    },
  });
  function enviar(e: FormEvent) {
    e.preventDefault();
    if (nome.trim().length >= 2) criar.mutate();
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" role="dialog" aria-modal="true" aria-labelledby="novo-cargo">
      <form onSubmit={enviar} className="surface-card w-full max-w-lg space-y-4 p-6">
        <h2 id="novo-cargo" className="text-lg font-semibold">
          Novo cargo
        </h2>
        <div className="space-y-1.5">
          <label htmlFor="cargo-nome" className="text-sm font-medium">
            Nome do cargo
          </label>
          <Input id="cargo-nome" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} className="h-10" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="cargo-nivel" className="text-sm font-medium">
              Nível
            </label>
            <select id="cargo-nivel" value={nivel} onChange={(e) => setNivel(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-2 text-sm">
              {catalogo.niveis.map((n) => (
                <option key={n} value={n}>
                  {NIVEIS[n] ?? n}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cargo-superior" className="text-sm font-medium">
              Reporta-se a
            </label>
            <select id="cargo-superior" value={superior} onChange={(e) => setSuperior(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-2 text-sm">
              <option value="">Ninguém</option>
              {cargos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cargo-atribuicoes" className="text-sm font-medium">
            Atribuições
          </label>
          <textarea
            id="cargo-atribuicoes"
            rows={3}
            value={atribuicoes}
            onChange={(e) => setAtribuicoes(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">As permissões sugeridas para o nível entram já marcadas; ajuste depois no cargo.</p>
        </div>
        {criar.isError && <p className="text-sm text-destructive">{(criar.error as Error).message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={nome.trim().length < 2 || criar.isPending}>
            {criar.isPending && <Loader2 className="animate-spin" />}
            Criar cargo
          </Button>
        </div>
      </form>
    </div>
  );
}

export function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="surface-card p-4">
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="num mt-1 text-2xl font-semibold">{valor}</div>
    </div>
  );
}
