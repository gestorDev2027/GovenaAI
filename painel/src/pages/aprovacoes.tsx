import { useState, type FormEvent } from "react";
import { TextoSimples } from "@/components/widgets/texto-simples";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Check, ChevronDown, ClipboardCheck, FileCheck2, Hand, Inbox, ListChecks, Loader2, ShieldCheck, Undo2, User, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDataHora } from "@/lib/formato";
import { useRotulos } from "@/hooks/use-permissoes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/fields";
import { Abas, EmptyState, PageHeader, PageLoader } from "@/components/widgets/widgets";

/*
 * Aprovações: as tarefas dos processos que esperam uma pessoa. O agente nunca decide sozinho: alguém aceita a
 * tarefa antes de ele começar, aprova as ações sensíveis no meio da execução e revisa a entrega no fim (aprova, ou
 * ajusta e devolve para ele refazer). Quem decide cada passo é o cargo com a permissão, mais a direção; o servidor
 * diz em `posso_decidir` se é você.
 */

export type SituacaoTarefa = "backlog" | "ready" | "in_progress" | "in_review" | "done" | "cancelled";

export interface PedidoDeAcao {
  id: string;
  ferramenta: string;
  descricao: string;
  argumentos: Record<string, unknown>;
}

export interface Tarefa {
  id: string;
  titulo: string;
  descricao: string | null;
  situacao: SituacaoTarefa;
  situacao_nome: string;
  origem: "agent" | "human";
  evidencia: string[];
  area_id: string;
  area: string;
  atividade_id: string | null;
  atividade: string | null;
  agente_id: string | null;
  agente: string | null;
  aceita_por: string | null;
  criada_em: string;
  historico: { de: string | null; para: string; motivo: string | null; por: string | null }[];
  posso_decidir: boolean;
  /** Parte 3: a execução parou esperando a aprovação de ações sensíveis. */
  aguardando_aprovacao?: boolean;
  pedidos?: PedidoDeAcao[];
  /** Parte 4: o texto da entrega, na revisão. */
  entrega?: string | null;
  /** O andamento da execução: rodando | aguardando_aprovacao | entregue | erro. */
  andamento?: string | null;
  tentativa?: number | null;
  erro?: string | null;
}

type Passo = "aceitar" | "acoes" | "revisar";
type Aba = Passo | "todas";

/** Em que passo a tarefa espera uma pessoa (ou nenhum). */
export function passoDa(t: Tarefa): Passo | null {
  if (t.situacao === "backlog") return "aceitar";
  if (t.situacao === "in_progress" && t.aguardando_aprovacao) return "acoes";
  if (t.situacao === "in_review") return "revisar";
  return null;
}

/** As tarefas que esperam uma pessoa (atualiza a cada 30 s). O menu usa para o contador. */
export function useTarefasAbertas(ligado = true) {
  return useQuery({
    queryKey: ["organizacao-tarefas", "abertas"],
    queryFn: () => api<{ tarefas: Tarefa[] }>("/organizacao/tarefas?situacao=abertas"),
    enabled: ligado,
    // Enquanto um agente trabalha numa tarefa, a cada 5 s (a pausa ou a entrega aparecem logo); parado, a cada 30 s.
    refetchInterval: (q) => ((q.state.data as { tarefas: Tarefa[] } | undefined)?.tarefas.some((t) => t.andamento === "rodando") ? 5_000 : 30_000),
  });
}

/** Quantas tarefas esperam uma decisão sua. */
export function useContagemAprovacoes(ligado = true): number {
  const abertas = useTarefasAbertas(ligado);
  return (abertas.data?.tarefas ?? []).filter((t) => t.posso_decidir && passoDa(t)).length;
}

const ABAS: { id: Aba; label: string; icone: typeof Bot }[] = [
  { id: "aceitar", label: "Aceitar", icone: Hand },
  { id: "acoes", label: "Aprovar ações", icone: ShieldCheck },
  { id: "revisar", label: "Revisar", icone: FileCheck2 },
  { id: "todas", label: "Todas", icone: ListChecks },
];

const VAZIO: Record<Aba, { titulo: string; texto: string }> = {
  aceitar: { titulo: "Nada para aceitar", texto: "Quando um agente propuser uma tarefa ou alguém pedir uma, ela aparece aqui para ser aceita antes de começar." },
  acoes: { titulo: "Nenhuma ação esperando", texto: "Quando um agente precisar fazer algo sensível no meio do trabalho, ele para e pede a aprovação aqui." },
  revisar: { titulo: "Nada para revisar", texto: "As entregas dos agentes chegam aqui para você aprovar ou ajustar e devolver." },
  todas: { titulo: "Nenhuma tarefa ainda", texto: "As tarefas dos processos aparecem aqui, das propostas às concluídas." },
};

export function Aprovacoes() {
  const r = useRotulos();
  const [aba, setAba] = useState<Aba>("aceitar");
  const abertas = useTarefasAbertas();
  const todas = useQuery({
    queryKey: ["organizacao-tarefas", "todas"],
    queryFn: () => api<{ tarefas: Tarefa[] }>("/organizacao/tarefas?situacao=todas"),
    enabled: aba === "todas",
    refetchInterval: 30_000,
  });

  const listaAbertas = abertas.data?.tarefas ?? [];
  const contar = (p: Passo) => listaAbertas.filter((t) => passoDa(t) === p).length;
  const consulta = aba === "todas" ? todas : abertas;
  const lista = aba === "todas" ? (todas.data?.tarefas ?? []) : listaAbertas.filter((t) => passoDa(t) === aba);

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Aprovações"
        icon={ClipboardCheck}
        description={`O que os agentes da ${r.organizacao_curta} esperam de uma pessoa: aceitar a tarefa, aprovar uma ação sensível ou revisar a entrega.`}
      />

      <Abas
        rotulo="Passos que esperam uma pessoa"
        valor={aba}
        onTrocar={setAba}
        abas={ABAS.map((a) => ({ ...a, n: a.id === "todas" ? null : abertas.data ? contar(a.id) : null }))}
      />

      {consulta.isLoading && <PageLoader className="h-[40vh]" label="Abrindo as tarefas" />}
      {consulta.isError && (
        <div className="surface-card">
          <EmptyState title="Não foi possível abrir as tarefas">{(consulta.error as Error).message}</EmptyState>
        </div>
      )}
      {consulta.data && !lista.length && (
        <div className="surface-card">
          <EmptyState icon={<Inbox className="size-5" />} title={VAZIO[aba].titulo}>
            {VAZIO[aba].texto}{" "}
            {aba !== "todas" && (
              <>
                Os processos de cada {r.area} estão em{" "}
                <Link to="/processos" className="font-semibold text-primary-text hover:underline">
                  Atividades e processos
                </Link>
                .
              </>
            )}
          </EmptyState>
        </div>
      )}

      {!!lista.length && (
        <ul className="space-y-3">
          {lista.map((t) => (
            <li key={t.id}>
              <CartaoDaTarefa tarefa={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function usarDecisao(tarefa: Tarefa) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caminho, corpo }: { caminho: string; corpo?: object; aviso: string }) =>
      api<{ ok: boolean }>(`/organizacao/tarefas/${encodeURIComponent(tarefa.id)}/${caminho}`, {
        method: "POST",
        body: corpo ? JSON.stringify(corpo) : undefined,
      }),
    onSuccess: (_r, { aviso }) => {
      toast.success(aviso);
      qc.invalidateQueries({ queryKey: ["organizacao-tarefas"] });
      qc.invalidateQueries({ queryKey: ["organizacao-atencao"] });
    },
    onError: (e: Error) => toast.error("Não foi possível registrar a decisão", { description: e.message }),
  });
}

const COR_SITUACAO: Record<SituacaoTarefa, string> = {
  backlog: "bg-warning/20 text-warning-text",
  ready: "bg-primary/10 text-primary-text",
  in_progress: "bg-primary/10 text-primary-text",
  in_review: "bg-warning/20 text-warning-text",
  done: "bg-success/12 text-success",
  cancelled: "bg-secondary text-muted-foreground",
};

function CartaoDaTarefa({ tarefa: t }: { tarefa: Tarefa }) {
  const passo = passoDa(t);
  const tituloId = `tarefa-${t.id}`;
  const daIA = t.origem === "agent";

  return (
    <article aria-labelledby={tituloId} className={cn("surface-card space-y-3 p-4 sm:p-5", passo && t.posso_decidir && "border-l-4 border-l-[#F4B800]")}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-[1_1_16rem]">
          <h2 id={tituloId} className="font-semibold break-words">
            {t.titulo}
          </h2>
          <p className="text-xs break-words text-muted-foreground">
            {[t.area, t.atividade, t.agente].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
            {daIA ? <Bot className="size-3" aria-hidden="true" /> : <User className="size-3" aria-hidden="true" />}
            {daIA ? "O agente propôs" : "Pedido de uma pessoa"}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", COR_SITUACAO[t.situacao])}>{t.situacao_nome}</span>
        </div>
      </header>

      {t.descricao && <p className="text-sm break-words whitespace-pre-line">{t.descricao}</p>}

      {!!t.evidencia.length && (
        <div>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Evidências</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm break-words">
            {t.evidencia.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Criada em {fmtDataHora(t.criada_em)}
        {t.aceita_por && ` · aceita por ${t.aceita_por}`}
      </p>

      {t.andamento === "rodando" && (
        <p className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm text-primary-text" role="status">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-primary" />
          O agente está trabalhando{t.tentativa && t.tentativa > 1 ? ` (refazendo com os ajustes, ${t.tentativa}ª vez)` : ""}…
        </p>
      )}
      {t.andamento === "erro" && t.erro && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          O agente parou: {t.erro}
        </p>
      )}
      {passo === "acoes" && <PedidosDeAcao pedidos={t.pedidos ?? []} />}
      {passo === "revisar" && <Entrega texto={t.entrega} />}

      {passo &&
        (t.posso_decidir ? (
          passo === "aceitar" ? (
            <DecidirAceite tarefa={t} />
          ) : passo === "acoes" ? (
            <DecidirAcoes tarefa={t} />
          ) : (
            <DecidirRevisao tarefa={t} />
          )
        ) : (
          <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">Esperando quem decide este passo.</p>
        ))}

      {!!t.historico.length && <Historico itens={t.historico} />}
    </article>
  );
}

function PedidosDeAcao({ pedidos }: { pedidos: PedidoDeAcao[] }) {
  if (!pedidos.length) return <p className="text-sm text-muted-foreground">O agente parou esperando a aprovação, mas não mandou o detalhe das ações.</p>;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground">O agente quer fazer</h3>
      <ul className="space-y-2">
        {pedidos.map((p) => (
          <li key={p.id} className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium break-words">{p.descricao || p.ferramenta}</p>
            <p className="text-xs text-muted-foreground">
              Ferramenta: <code className="font-mono break-all">{p.ferramenta}</code>
            </p>
            {Object.keys(p.argumentos ?? {}).length > 0 && (
              <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[minmax(0,10rem)_1fr]">
                {Object.entries(p.argumentos).map(([chave, valor]) => (
                  <div key={chave} className="contents">
                    <dt className="font-medium break-words text-muted-foreground">{chave}</dt>
                    <dd className="break-words whitespace-pre-wrap">{valorLegivel(valor)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function valorLegivel(valor: unknown): string {
  if (valor == null || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  if (typeof valor === "string" || typeof valor === "number") return String(valor);
  if (Array.isArray(valor) && valor.every((v) => typeof v !== "object" || v === null)) return valor.map(String).join(", ");
  return JSON.stringify(valor, null, 2);
}

function Entrega({ texto }: { texto?: string | null }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Entrega do agente</h3>
      {texto ? (
        <div className="thin-scroll max-h-96 space-y-1 overflow-y-auto rounded-lg border border-border bg-secondary/40 p-3 text-sm break-words"><TextoSimples texto={texto} /></div>
      ) : (
        <p className="text-sm text-muted-foreground">A entrega ainda não veio no detalhe da tarefa.</p>
      )}
    </div>
  );
}

/** Um campo de texto obrigatório (motivo ou ajustes), aberto ao pedir recusa ou devolução. */
function FormularioComMotivo({
  id,
  rotulo,
  ajuda,
  botao,
  pendente,
  aoEnviar,
  aoCancelar,
}: {
  id: string;
  rotulo: string;
  ajuda: string;
  botao: string;
  pendente: boolean;
  aoEnviar: (texto: string) => void;
  aoCancelar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const valido = texto.trim().length >= 3;
  function enviar(e: FormEvent) {
    e.preventDefault();
    if (valido) aoEnviar(texto.trim());
  }
  return (
    <form onSubmit={enviar} className="space-y-2 rounded-lg border border-border p-3">
      <label htmlFor={id} className="text-sm font-medium">
        {rotulo} <span className="text-destructive">*</span>
      </label>
      <Textarea id={id} autoFocus required minLength={3} value={texto} onChange={(e) => setTexto(e.target.value)} aria-describedby={`${id}-ajuda`} className="min-h-20" />
      <p id={`${id}-ajuda`} className="text-xs text-muted-foreground">
        {ajuda}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={aoCancelar}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" variant="destructive" disabled={!valido || pendente}>
          {pendente && <Loader2 className="animate-spin" />} {botao}
        </Button>
      </div>
    </form>
  );
}

function DecidirAceite({ tarefa }: { tarefa: Tarefa }) {
  const decidir = usarDecisao(tarefa);
  const [recusando, setRecusando] = useState(false);
  if (recusando)
    return (
      <FormularioComMotivo
        id={`motivo-${tarefa.id}`}
        rotulo="Por que recusar?"
        ajuda="O motivo fica no histórico e ajuda o agente a não propor de novo o que não serve (mínimo de 3 caracteres)."
        botao="Recusar a tarefa"
        pendente={decidir.isPending}
        aoCancelar={() => setRecusando(false)}
        aoEnviar={(motivo) => decidir.mutate({ caminho: "recusar", corpo: { motivo }, aviso: "Tarefa recusada" })}
      />
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => decidir.mutate({ caminho: "aceitar", aviso: "Tarefa aceita: o agente vai começar" })} disabled={decidir.isPending}>
        {decidir.isPending ? <Loader2 className="animate-spin" /> : <Check />} Aceitar
      </Button>
      <Button variant="outline" onClick={() => setRecusando(true)} disabled={decidir.isPending}>
        <X /> Recusar
      </Button>
    </div>
  );
}

function DecidirAcoes({ tarefa }: { tarefa: Tarefa }) {
  const decidir = usarDecisao(tarefa);
  const [recusando, setRecusando] = useState(false);
  if (recusando)
    return (
      <FormularioComMotivo
        id={`motivo-acoes-${tarefa.id}`}
        rotulo="Por que recusar as ações?"
        ajuda="O agente recebe o motivo e segue sem fazer essas ações (mínimo de 3 caracteres)."
        botao="Recusar as ações"
        pendente={decidir.isPending}
        aoCancelar={() => setRecusando(false)}
        aoEnviar={(motivo) => decidir.mutate({ caminho: "acoes", corpo: { aprovar: false, motivo }, aviso: "Ações recusadas" })}
      />
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => decidir.mutate({ caminho: "acoes", corpo: { aprovar: true }, aviso: "Ações aprovadas: o agente continua" })} disabled={decidir.isPending}>
        {decidir.isPending ? <Loader2 className="animate-spin" /> : <Check />} Aprovar
      </Button>
      <Button variant="outline" onClick={() => setRecusando(true)} disabled={decidir.isPending}>
        <X /> Recusar
      </Button>
    </div>
  );
}

function DecidirRevisao({ tarefa }: { tarefa: Tarefa }) {
  const decidir = usarDecisao(tarefa);
  const [ajustando, setAjustando] = useState(false);
  if (ajustando)
    return (
      <FormularioComMotivo
        id={`ajustes-${tarefa.id}`}
        rotulo="O que corrigir?"
        ajuda="O agente recebe os ajustes e refaz a entrega; ela volta para a sua revisão (mínimo de 3 caracteres)."
        botao="Devolver para o agente"
        pendente={decidir.isPending}
        aoCancelar={() => setAjustando(false)}
        aoEnviar={(ajustes) => decidir.mutate({ caminho: "revisao", corpo: { aprovar: false, ajustes }, aviso: "Devolvida ao agente com os ajustes" })}
      />
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => decidir.mutate({ caminho: "revisao", corpo: { aprovar: true }, aviso: "Entrega aprovada: tarefa concluída" })} disabled={decidir.isPending}>
        {decidir.isPending ? <Loader2 className="animate-spin" /> : <Check />} Aprovar
      </Button>
      <Button variant="outline" onClick={() => setAjustando(true)} disabled={decidir.isPending}>
        <Undo2 /> Ajustar e devolver
      </Button>
    </div>
  );
}

/** O histórico traz os códigos das situações; na tela, os nomes. */
const NOME_SITUACAO: Record<string, string> = {
  backlog: "Para aceitar",
  ready: "Aceita",
  in_progress: "Em execução",
  in_review: "Em revisão",
  done: "Concluída",
  cancelled: "Cancelada",
};
const nomeDa = (s: string) => NOME_SITUACAO[s] ?? s;

function Historico({ itens }: { itens: Tarefa["historico"] }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
        className="flex items-center gap-1 rounded text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform", aberto && "rotate-180")} />
        Histórico ({itens.length})
      </button>
      {aberto && (
        <ol className="mt-2 space-y-1.5 text-xs">
          {itens.map((h, i) => (
            <li key={i} className="break-words">
              <span className="font-medium">{h.de ? `${nomeDa(h.de)} → ${nomeDa(h.para)}` : nomeDa(h.para)}</span>
              {h.por && <span className="text-muted-foreground"> · {h.por}</span>}
              {h.motivo && <span className="block text-muted-foreground">{h.motivo}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
