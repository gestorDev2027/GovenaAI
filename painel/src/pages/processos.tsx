import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, CalendarClock, Hand, Loader2, MessageSquareText, MessagesSquare, Play, ShieldCheck, FileCheck2, Workflow, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePodeNaOrganizacao, useRotulos } from "@/hooks/use-permissoes";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, PageLoader } from "@/components/widgets/widgets";
import { ChatProcessos } from "@/components/processos/chat-processos";

/*
 * Atividades e processos: o que cada área faz e o caminho de cada atividade. O processo é a lista de passos: o
 * agente trabalha, e uma pessoa aceita a tarefa, aprova as ações sensíveis e revisa a entrega. Quem tem
 * "gerenciar os fluxos" pode rodar uma rotina agora e conversar com o Assistente de Processos (o painel à direita;
 * gaveta em tela estreita), que cria e altera atividades e processos e grava só o que a pessoa confirmar.
 */

const TELA_LARGA = "(min-width: 1024px)";

type TipoPasso = "agente" | "aceite" | "aprovacao" | "revisao";

interface PassoDoProcesso {
  tipo: TipoPasso;
  titulo: string;
  instrucoes?: string;
  cargos?: string[];
}

interface Atividade {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: "rotina" | "sob_demanda";
  frequencia: string | null;
  entregavel: string | null;
  ativa: boolean;
  area_id: string;
  area: string;
  agente_id: string | null;
  processo: { versao: number; passos: PassoDoProcesso[] } | null;
}

const PASSO: Record<TipoPasso, { icone: LucideIcon; rotulo: string; pessoa: boolean }> = {
  agente: { icone: Bot, rotulo: "Agente", pessoa: false },
  aceite: { icone: Hand, rotulo: "Uma pessoa aceita", pessoa: true },
  aprovacao: { icone: ShieldCheck, rotulo: "Uma pessoa aprova", pessoa: true },
  revisao: { icone: FileCheck2, rotulo: "Uma pessoa revisa", pessoa: true },
};

const FREQUENCIA: Record<string, string> = {
  hora: "a cada hora",
  horaria: "a cada hora",
  diaria: "diária",
  semanal: "semanal",
  quinzenal: "quinzenal",
  mensal: "mensal",
};

export function Processos() {
  const r = useRotulos();
  const pode = usePodeNaOrganizacao();
  const podeRodar = pode("gerenciar_fluxos");
  // O chat começa aberto em tela larga (lg) e fechado em tela estreita, onde é uma gaveta (Esc fecha).
  const [conversaAberta, setConversaAberta] = useState(() => typeof window !== "undefined" && window.matchMedia(TELA_LARGA).matches);
  useEffect(() => {
    if (!conversaAberta) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !window.matchMedia(TELA_LARGA).matches) setConversaAberta(false);
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [conversaAberta]);
  // A lista de atividades traz só o id do agente; o nome vem da lista de agentes da organização.
  const agentes = useQuery({ queryKey: ["organizacao-agentes"], queryFn: () => api<{ agentes: { id: string; nome: string }[] }>("/organizacao/agentes") });
  const nomes = useMemo(() => new Map((agentes.data?.agentes ?? []).map((g) => [g.id, g.nome])), [agentes.data]);
  const dados = useQuery({ queryKey: ["organizacao-atividades"], queryFn: () => api<{ atividades: Atividade[] }>("/organizacao/atividades") });

  const porArea = useMemo(() => {
    const grupos = new Map<string, { area: string; atividades: Atividade[] }>();
    for (const a of dados.data?.atividades ?? []) {
      const g = grupos.get(a.area_id) ?? { area: a.area, atividades: [] };
      g.atividades.push(a);
      grupos.set(a.area_id, g);
    }
    return [...grupos.entries()].sort((x, y) => x[1].area.localeCompare(y[1].area, "pt-BR"));
  }, [dados.data]);

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Atividades e processos"
        icon={Workflow}
        description={`O que cada ${r.area} faz e o caminho de cada atividade: onde o agente trabalha e onde uma pessoa decide.`}
        actions={
          podeRodar ? (
            <Button
              size="sm"
              variant={conversaAberta ? "secondary" : "default"}
              aria-expanded={conversaAberta}
              aria-controls="conversa-processos"
              onClick={() => setConversaAberta((a) => !a)}
            >
              <MessagesSquare /> Conversar com o assistente
            </Button>
          ) : (
            <p className="max-w-xs text-xs text-muted-foreground">Quem tem a permissão de gerenciar os fluxos muda os processos conversando com o assistente.</p>
          )
        }
      />

      <div className="flex items-start gap-5">
        <div className="min-w-0 flex-1 space-y-5">
          {podeRodar && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <MessageSquareText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Quer criar uma atividade ou mudar um processo? Converse com o Assistente de Processos: ele propõe o caminho e grava só o que você confirmar.
            </p>
          )}

          {dados.isLoading && <PageLoader className="h-[40vh]" label="Abrindo as atividades" />}
          {dados.isError && (
            <div className="surface-card">
              <EmptyState title="Não foi possível abrir as atividades">{(dados.error as Error).message}</EmptyState>
            </div>
          )}
          {dados.data && !porArea.length && (
            <div className="surface-card">
              <EmptyState icon={<Workflow className="size-5" />} title="Nenhuma atividade ainda">
                As atividades de cada {r.area} são escolhidas na{" "}
                <Link to="/implantacao" className="font-semibold text-primary-text hover:underline">
                  implantação
                </Link>
                {podeRodar ? ", ou criadas aqui, conversando com o assistente." : "."}
              </EmptyState>
            </div>
          )}

          {porArea.map(([areaId, grupo]) => (
            <section key={areaId} aria-labelledby={`area-${areaId}`} className="space-y-3">
              <h2 id={`area-${areaId}`} className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
                {grupo.area}
              </h2>
              <ul className={cn("grid gap-3", conversaAberta && podeRodar ? "2xl:grid-cols-2" : "lg:grid-cols-2")}>
                {grupo.atividades.map((a) => (
                  <li key={a.id}>
                    <CartaoDaAtividade atividade={a} agente={a.agente_id ? nomes.get(a.agente_id) : undefined} podeRodar={podeRodar} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {podeRodar && conversaAberta && (
          <div aria-hidden="true" className="fixed inset-0 z-40 bg-[#0D1B38]/40 lg:hidden" onClick={() => setConversaAberta(false)} />
        )}
        {podeRodar && (
          // Um elemento só: gaveta (fixa) em tela estreita e coluna fixa ao rolar em tela larga. Fechado, fica escondido
          // mas montado, para a conversa não se perder.
          <aside
            id="conversa-processos"
            className={cn(
              "max-lg:fixed max-lg:inset-y-3 max-lg:right-3 max-lg:z-50 max-lg:w-[min(380px,calc(100vw-24px))] max-lg:rounded-xl max-lg:shadow-[0_30px_80px_-20px_rgba(13,27,56,0.6)]",
              "lg:sticky lg:top-[5.25rem] lg:h-[calc(100svh-11rem)] lg:min-h-[28rem] lg:w-[380px] lg:shrink-0",
              !conversaAberta && "hidden",
            )}
          >
            <ChatProcessos aoFechar={() => setConversaAberta(false)} />
          </aside>
        )}
      </div>
    </div>
  );
}

function CartaoDaAtividade({ atividade: a, agente, podeRodar }: { atividade: Atividade; agente?: string; podeRodar: boolean }) {
  const rodar = useMutation({
    mutationFn: () =>
      api<{ rodando: boolean; atividade: string; agente: string; sessao: string }>(`/organizacao/atividades/${encodeURIComponent(a.id)}/rodar`, {
        method: "POST",
      }),
    onSuccess: () => toast.success("O agente está analisando", { description: "Se houver o que fazer, a tarefa aparece em Aprovações." }),
    onError: (e: Error) => toast.error("Não foi possível rodar a rotina", { description: e.message }),
  });
  const rotina = a.tipo === "rotina";
  const frequencia = a.frequencia ? (FREQUENCIA[a.frequencia] ?? a.frequencia) : null;
  const passos = a.processo?.passos ?? [];
  const tituloId = `atividade-${a.id}`;

  return (
    <article aria-labelledby={tituloId} className={cn("surface-card flex h-full flex-col gap-3 p-4", !a.ativa && "opacity-70")}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-[1_1_14rem]">
          <h3 id={tituloId} className="font-semibold break-words">
            {a.nome}
          </h3>
          <p className="mt-1 flex flex-wrap gap-1.5">
            <Selo>
              <CalendarClock aria-hidden="true" className="size-3" />
              {rotina ? `Rotina${frequencia ? `, ${frequencia}` : ""}` : "Sob demanda"}
            </Selo>
            <Selo>
              <Bot aria-hidden="true" className="size-3" />
              {a.agente_id ? (agente ?? "Agente da área") : "Sem agente"}
            </Selo>
            {!a.ativa && <Selo>Desligada</Selo>}
          </p>
        </div>
        {rotina && podeRodar && (
          <Button size="sm" variant="outline" onClick={() => rodar.mutate()} disabled={rodar.isPending || !a.agente_id || !a.ativa}>
            {rodar.isPending ? <Loader2 className="animate-spin" /> : <Play />} Rodar agora
          </Button>
        )}
      </header>

      {a.descricao && <p className="text-sm break-words text-muted-foreground">{a.descricao}</p>}
      {a.entregavel && (
        <p className="text-xs break-words">
          <span className="font-medium">Entrega:</span> {a.entregavel}
        </p>
      )}

      <div>
        <h4 className="mb-2 text-xs font-semibold text-muted-foreground">Processo{a.processo ? ` (versão ${a.processo.versao})` : ""}</h4>
        {passos.length ? (
          <ol className="space-y-2">
            {passos.map((p, i) => {
              const info = PASSO[p.tipo] ?? PASSO.agente;
              const Icone = info.icone;
              return (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                      info.pessoa ? "bg-warning/20 text-warning-text" : "bg-primary/10 text-primary-text",
                    )}
                  >
                    <Icone className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block break-words">
                      <span className="text-muted-foreground">{i + 1}.</span> {p.titulo}
                      <span className="sr-only"> ({info.rotulo})</span>
                    </span>
                    {p.instrucoes && <span className="block text-xs break-words text-muted-foreground">{p.instrucoes}</span>}
                    {info.pessoa && (
                      <span className="block text-xs break-words text-muted-foreground">
                        {p.cargos?.length ? `Decide: ${p.cargos.join(", ")} ou a direção` : "Decide: quem aprova na área ou a direção"}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">Ainda sem processo definido.</p>
        )}
      </div>
    </article>
  );
}

function Selo({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{children}</span>;
}
