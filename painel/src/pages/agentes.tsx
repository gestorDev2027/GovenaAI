import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Brain, Database, Loader2, MessagesSquare, Plug, Save, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDataHora } from "@/lib/formato";
import { usePodeNaOrganizacao, useRotulos } from "@/hooks/use-permissoes";
import { Button } from "@/components/ui/button";
import { Slideover } from "@/components/comando/slideover";
import { EmptyState, PageHeader, PageLoader } from "@/components/widgets/widgets";

/*
 * Os agentes da organização e a ficha de cada um (CLAUDE.md, §5b): características, memória, os dados que ele enxerga e
 * o que pode propor (ler; criar, alterar e apagar só como proposta para aprovar), o escopo e as integrações. Quem tem
 * "criar agentes" edita; os outros veem.
 */

type Operacao = "ler" | "criar" | "alterar" | "apagar";
interface Ficha {
  caracteristicas: { cor?: string; tom?: string; autonomia?: string };
  /** area: divide a memória com os agentes da área; organizacao: lê a memória geral da organização. */
  memoria: { area?: boolean; organizacao?: boolean };
  permissoes: Record<string, Operacao[]>;
  escopo: "area" | "organizacao";
  integracoes: string[];
  atualizado_em: string | null;
  atualizado_por: string | null;
}
interface AgenteDaOrganizacao {
  id: string;
  nome: string;
  cargo?: string;
  area?: string;
  cor?: string;
  /** Os nomes das áreas a que o agente está ligado. */
  areas: string[];
  ficha: Ficha;
}
interface Dominio {
  id: string;
  nome: string;
  descricao: string;
  operacoes: Operacao[];
}
interface Resposta {
  agentes: AgenteDaOrganizacao[];
  dominios: Dominio[];
  autonomias: { id: string; nome: string }[];
  tons: string[];
}

const OPERACOES: [Operacao, string][] = [
  ["ler", "Ler"],
  ["criar", "Criar"],
  ["alterar", "Alterar"],
  ["apagar", "Apagar"],
];
const CORES = ["#1A63D8", "#52A2FF", "#1BAF7A", "#F4B800", "#8B5CF6", "#14C4D4", "#E83E8C", "#0D1B38"];

export function AgentesDaOrganizacao() {
  const dados = useQuery({ queryKey: ["organizacao-agentes"], queryFn: () => api<Resposta>("/organizacao/agentes") });
  const [aberto, setAberto] = useState<string | null>(null);
  const lista = dados.data?.agentes ?? [];
  const agente = lista.find((a) => a.id === aberto);
  const r = useRotulos();

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Agentes"
        icon={Bot}
        description={`Os agentes de IA da ${r.organizacao_curta}. A ficha de cada um diz o que ele enxerga e o que pode propor; toda mudança nos dados passa pela sua aprovação.`}
      />
      {dados.isLoading && <PageLoader className="h-[40vh]" label="Abrindo os agentes" />}
      {dados.isError && (
        <div className="surface-card">
          <EmptyState title="Não foi possível abrir os agentes">{(dados.error as Error).message}</EmptyState>
        </div>
      )}
      {dados.data && !lista.length && (
        <div className="surface-card">
          <EmptyState icon={<Bot className="size-5" />} title="Nenhum agente ainda">
            Os agentes de cada {r.area} são criados na <Link to="/implantacao" className="font-semibold text-primary-text hover:underline">implantação</Link>.
          </EmptyState>
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {lista.map((a) => {
          const cor = a.ficha.caracteristicas.cor || a.cor || "#1A63D8";
          const mudancas = Object.values(a.ficha.permissoes).flat().filter((o) => o !== "ler").length;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setAberto(a.id)}
                className="surface-card flex w-full items-start gap-3 p-4 text-left transition-shadow outline-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: cor }}>
                  <Bot className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{a.nome}</span>
                  <span className="block truncate text-xs text-muted-foreground">{a.areas.join(", ") || a.area || `sem ${r.area}`}</span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    <Selo>{a.ficha.caracteristicas.autonomia === "consulta" ? "Só consulta" : "Propõe e espera aprovação"}</Selo>
                    <Selo>{mudancas ? `${mudancas} tipo(s) de mudança liberados` : "Só leitura nos dados"}</Selo>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {agente && dados.data && <FichaDoAgente agente={agente} catalogo={dados.data} aoFechar={() => setAberto(null)} />}
    </div>
  );
}

function Selo({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{children}</span>;
}

function Secao({ icone: Icone, titulo, children }: { icone: typeof Bot; titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
        <Icone className="size-3.5" /> {titulo}
      </h3>
      {children}
    </section>
  );
}

function FichaDoAgente({ agente, catalogo, aoFechar }: { agente: AgenteDaOrganizacao; catalogo: Resposta; aoFechar: () => void }) {
  const r = useRotulos();
  const qc = useQueryClient();
  const pode = usePodeNaOrganizacao()("criar_agentes");
  const [ficha, setFicha] = useState<Ficha>(agente.ficha);
  useEffect(() => setFicha(agente.ficha), [agente]);
  const salvar = useMutation({
    mutationFn: () =>
      api<Ficha>(`/organizacao/agentes/${encodeURIComponent(agente.id)}/ficha`, {
        method: "PUT",
        body: JSON.stringify({ caracteristicas: ficha.caracteristicas, memoria: ficha.memoria, permissoes: ficha.permissoes, escopo: ficha.escopo }),
      }),
    onSuccess: () => {
      toast.success("Ficha salva");
      qc.invalidateQueries({ queryKey: ["organizacao-agentes"] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });
  const car = ficha.caracteristicas;
  const cor = car.cor || agente.cor || "#1A63D8";
  const alternar = (dominio: string, op: Operacao) =>
    setFicha((f) => {
      const atuais = new Set(f.permissoes[dominio] ?? []);
      if (atuais.has(op)) {
        atuais.delete(op);
        if (op === "ler") atuais.clear(); // sem ler, não muda nada
      } else {
        atuais.add(op);
        atuais.add("ler");
      }
      return { ...f, permissoes: { ...f.permissoes, [dominio]: OPERACOES.map(([o]) => o).filter((o) => atuais.has(o)) } };
    });

  return (
    <Slideover
      titulo={agente.nome}
      subtitulo={agente.areas.join(", ") || agente.area}
      aoFechar={aoFechar}
      rodape={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/chat"
            search={{ agente: agente.id }}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-4 text-sm hover:bg-secondary"
          >
            <MessagesSquare className="size-4" /> Conversar
          </Link>
          {pode && (
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar a ficha
            </Button>
          )}
        </div>
      }
    >
      <fieldset disabled={!pode} className="space-y-6">
        <div className="flex items-center gap-3 rounded-xl border border-border p-3">
          <span aria-hidden="true" className="grid size-14 place-items-center rounded-2xl text-white shadow-sm" style={{ background: cor }}>
            <Bot className="size-7" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{agente.nome}</p>
            <p className="text-xs text-muted-foreground">
              {ficha.atualizado_em ? `Ficha alterada em ${fmtDataHora(ficha.atualizado_em)} por ${ficha.atualizado_por}` : "Ficha padrão (ainda não ajustada)"}
            </p>
          </div>
        </div>

        <Secao icone={Sparkles} titulo="Características">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor do agente">
            {CORES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={cor === c}
                aria-label={`Cor ${c}`}
                onClick={() => setFicha((f) => ({ ...f, caracteristicas: { ...f.caracteristicas, cor: c } }))}
                className={cn("size-7 rounded-full ring-offset-2 ring-offset-card", cor === c && "ring-2 ring-foreground")}
                style={{ background: c }}
              />
            ))}
          </div>
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Tom das respostas</span>
            <select
              value={car.tom ?? "profissional"}
              onChange={(e) => setFicha((f) => ({ ...f, caracteristicas: { ...f.caracteristicas, tom: e.target.value } }))}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              {catalogo.tons.map((t) => (
                <option key={t} value={t}>
                  {t[0].toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1.5" role="radiogroup" aria-label="Autonomia">
            <span className="text-xs text-muted-foreground">Autonomia</span>
            {catalogo.autonomias.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`autonomia-${agente.id}`}
                  checked={(car.autonomia ?? "propoe") === a.id}
                  onChange={() => setFicha((f) => ({ ...f, caracteristicas: { ...f.caracteristicas, autonomia: a.id } }))}
                />
                {a.nome}
              </label>
            ))}
            <p className="text-[11px] text-muted-foreground">Nenhum agente grava direto: toda mudança vira uma proposta para um responsável aprovar.</p>
          </div>
        </Secao>

        <Secao icone={Database} titulo="Dados que acessa">
          <div className="flex gap-2 text-sm" role="radiogroup" aria-label="Escopo">
            {(
              [
                ["area", `Só o ${r.area} dele`],
                ["organizacao", `A ${r.organizacao_curta} inteira`],
              ] as const
            ).map(([id, rotulo]) => (
              <label key={id} className={cn("flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2", ficha.escopo === id ? "border-primary bg-primary/5" : "border-border")}>
                <input type="radio" name={`escopo-${agente.id}`} checked={ficha.escopo === id} onChange={() => setFicha((f) => ({ ...f, escopo: id }))} />
                {rotulo}
              </label>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Tipo de dado</th>
                  {OPERACOES.map(([, r]) => (
                    <th key={r} className="px-1 py-2 text-center font-medium">
                      {r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catalogo.dominios.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <span className="block font-medium">{d.nome}</span>
                      <span className="block text-[11px] text-muted-foreground">{d.descricao}</span>
                    </td>
                    {OPERACOES.map(([op, r]) => {
                      const aceita = d.operacoes.includes(op);
                      return (
                        <td key={op} className="px-1 py-2 text-center">
                          {aceita ? (
                            <input
                              type="checkbox"
                              aria-label={`${r} ${d.nome}`}
                              checked={(ficha.permissoes[d.id] ?? []).includes(op)}
                              onChange={() => alternar(d.id, op)}
                              className="size-4"
                            />
                          ) : (
                            <span className="text-muted-foreground/40" aria-label="não se aplica">
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>

        <Secao icone={Brain} titulo="Memória">
          {(
            [
              ["area", `Divide a memória com os agentes do ${r.area}`],
              ["organizacao", `Lê a memória geral da ${r.organizacao_curta}`],
            ] as const
          ).map(([id, rotulo]) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!ficha.memoria[id]}
                onChange={(e) => setFicha((f) => ({ ...f, memoria: { ...f.memoria, [id]: e.target.checked } }))}
              />
              {rotulo}
            </label>
          ))}
          <p className="text-[11px] text-muted-foreground">A memória compartilhada (Mem0, no banco da organização) entra no próximo passo; a escolha já fica guardada.</p>
        </Secao>

        <Secao icone={Plug} titulo="Integrações externas">
          <p className="text-sm text-muted-foreground">
            As integrações com outros sistemas (APIs, MCP, bancos) chegam com a Central de integrações, e cada agente usará só as liberadas aqui.
          </p>
        </Secao>
      </fieldset>
    </Slideover>
  );
}
