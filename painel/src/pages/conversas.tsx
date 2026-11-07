import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  FileText,
  Headset,
  ImageIcon,
  Maximize2,
  MessagesSquare,
  Mic,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  StickyNote,
  User,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import {
  api,
  type Acao,
  type CompraCadastro,
  type Conversa,
  type FichaAluno,
  type MensagemUnnichat,
  type ResumoConversa,
  type Status,
} from "@/lib/api";
import { AvaliarResposta } from "@/components/calibracao/avaliar-resposta";
import { porArea, useAgentes } from "@/hooks/use-agentes";
import { UsoNaResposta } from "@/components/conhecimento/uso";
import { fmtDataHora, fmtInt, fmtRelativo, fmtSegundos } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader, PageLoader, StatusBadge } from "@/components/widgets/widgets";

type Filtro = "todas" | Status;

export const ROTULO_FERRAMENTA: Record<string, string> = {
  transferir_para_humano: "Transferiu para humano",
  encerrar_atendimento: "Encerrou o atendimento",
  consultar_cadastro: "Consultou o cadastro",
  buscar_aula: "Buscou aula",
  consultar_brindes: "Consultou apostilas e brindes",
  update_user_memory: "Registrou na memória",
};

const FILTROS: { value: Filtro; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "transferido", label: "Transferidas" },
  { value: "encerrado", label: "Encerradas" },
  { value: "sem_resposta", label: "Não respondeu ao agente" },
  { value: "nao_chegou", label: "Agente ainda não interagiu" },
];

/* ───────── Peças no padrão do Chat de teste ───────── */

function Rotulo({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("font-mono text-xs font-medium tracking-tight uppercase", className)}>{children}</div>;
}

const campo =
  "h-9 w-full rounded-xl border bg-muted/50 px-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50 disabled:opacity-60";

function BotaoBarra({ titulo, onClick, className, children }: { titulo: string; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className={cn("grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
    >
      {children}
    </button>
  );
}

/** Abas pequenas (as da coluna do aluno e a troca entre a conversa do agente e o WhatsApp inteiro). */
function Abas<T extends string>({ opcoes, valor, onChange }: { opcoes: { value: T; label: string }[]; valor: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5">
      {opcoes.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === valor}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 py-1 font-mono text-[11px] uppercase transition-colors",
            o.value === valor ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Linha "rótulo: valor" da coluna do aluno. Sem valor, não aparece. */
function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 text-muted-foreground">{rotulo}</span>
      <span className="min-w-0 text-right break-words">{children}</span>
    </div>
  );
}

function Cartao({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border bg-muted/50 px-3 py-2", className)}>{children}</div>;
}

/* Colunas recolhíveis: a escolha fica guardada neste navegador. */
const CHAVE_PAINEIS = "conversas-paineis";
type Paineis = { lista: boolean; aluno: boolean };

function lerPaineis(): Paineis {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_PAINEIS) ?? "null");
    if (salvo && typeof salvo.lista === "boolean" && typeof salvo.aluno === "boolean") return salvo;
  } catch {
    /* sem armazenamento: as duas colunas abertas */
  }
  return { lista: true, aluno: true };
}

type Aba = "aluno" | "unnichat" | "curso";

/* ───────── Tela ───────── */

export function Conversas() {
  const search = useSearch({ from: "/protegido/painel/conversas" });
  const navigate = useNavigate({ from: "/conversas" });
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<Filtro>((search.status as Filtro) || "todas");
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  // Com mais de um agente, dá para ver as conversas de uma área e, dentro dela, de um agente só.
  const agentes = useAgentes();
  const grupos = porArea(agentes);
  const [area, setArea] = useState("todas");
  const [agente, setAgente] = useState("todos");
  const daArea = grupos.find((g) => g.area === area)?.itens ?? [];
  const nomeDoAgente = (id?: string | null) => agentes.find((a) => a.id === id)?.nome ?? id ?? "";
  const selecionada = search.id;
  const [paineis, setPaineis] = useState<Paineis>(lerPaineis);
  const [gaveta, setGaveta] = useState<null | "lista" | "aluno">(null);
  const aba: Aba = search.aba === "unnichat" || search.aba === "curso" ? search.aba : "aluno";
  type Busca = { id?: string; status?: string; aba?: string };
  const setAba = (a: Aba) => navigate({ search: (s: Busca) => ({ ...s, aba: a === "aluno" ? undefined : a }) });
  const foco = !paineis.lista && !paineis.aluno;

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_PAINEIS, JSON.stringify(paineis));
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }, [paineis]);

  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const parametros = new URLSearchParams();
  if (filtro !== "todas") parametros.set("status", filtro);
  if (buscaAtiva) parametros.set("busca", buscaAtiva);
  if (area !== "todas") parametros.set("area", area);
  if (agente !== "todos") parametros.set("agente", agente);
  const lista = useQuery({
    queryKey: ["conversas", filtro, buscaAtiva, area, agente],
    queryFn: () => api<{ conversas: ResumoConversa[]; total: number }>(`/conversas?${parametros}`),
    refetchInterval: 30_000,
  });
  const conversa = useQuery({
    queryKey: ["conversa", selecionada],
    queryFn: () => api<Conversa>(`/conversas/${encodeURIComponent(selecionada!)}`),
    enabled: !!selecionada,
    refetchInterval: 20_000,
  });
  const ficha = useQuery({
    queryKey: ["conversa-aluno", selecionada],
    queryFn: () => api<FichaAluno>(`/conversas/${encodeURIComponent(selecionada!)}/aluno`),
    enabled: !!selecionada,
    staleTime: 60_000,
  });
  const [atualizando, setAtualizando] = useState(false);
  async function atualizarFicha() {
    if (!selecionada) return;
    setAtualizando(true);
    try {
      const nova = await api<FichaAluno>(`/conversas/${encodeURIComponent(selecionada)}/aluno?atualizar=true`);
      qc.setQueryData(["conversa-aluno", selecionada], nova);
    } finally {
      setAtualizando(false);
    }
  }

  const selecionar = (id?: string) => {
    setGaveta(null);
    navigate({ search: (s: Busca) => ({ ...s, id }) });
  };

  /* ───────── Coluna da lista ───────── */
  const colunaLista = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between">
        <Rotulo>Conversas</Rotulo>
        {lista.data && <span className="num font-mono text-[11px] text-muted-foreground">{fmtInt(lista.data.total)}</span>}
      </div>
      <div className="relative shrink-0">
        <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input className={cn(campo, "pl-8")} placeholder="Nome, mensagem ou motivo" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <div className="flex shrink-0 flex-wrap gap-1">
        {FILTROS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => {
              setFiltro(f.value);
              navigate({ search: (s: Busca) => ({ ...s, status: f.value === "todas" ? undefined : f.value }) });
            }}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
              filtro === f.value ? "border-primary/50 bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {grupos.length > 1 && (
        <select
          aria-label="Área"
          className={cn(campo, "shrink-0")}
          value={area}
          onChange={(e) => {
            setArea(e.target.value);
            setAgente("todos");
          }}
        >
          <option value="todas">Todas as áreas</option>
          {grupos.map((g) => (
            <option key={g.area} value={g.area}>
              {g.area}
            </option>
          ))}
        </select>
      )}
      {(grupos.length > 1 ? daArea.length > 1 : agentes.length > 1) && (
        <select aria-label="Agente" className={cn(campo, "shrink-0")} value={agente} onChange={(e) => setAgente(e.target.value)}>
          <option value="todos">Todos os agentes</option>
          {(grupos.length > 1 ? daArea : agentes).map((a) => (
            <option key={a.id} value={a.id}>
              {a.cargo ? `${a.nome} · ${a.cargo}` : a.nome}
            </option>
          ))}
        </select>
      )}
      <div className="thin-scroll -mr-1 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {lista.isLoading && <p className="py-6 text-center text-xs text-muted-foreground">Carregando…</p>}
        {lista.isError && <p className="py-6 text-center text-xs text-destructive">{(lista.error as Error).message}</p>}
        {lista.data && lista.data.conversas.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">Nenhuma conversa. Ajuste o filtro ou a busca.</p>
        )}
        {lista.data?.conversas.map((c) => {
          const atual = c.id === selecionada;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => selecionar(c.id)}
              className={cn(
                "flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors",
                atual ? "bg-primary/10" : "bg-muted/50 hover:bg-muted",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    c.status === "em_atendimento"
                      ? "bg-emerald-500"
                      : c.status === "transferido"
                        ? "bg-primary"
                        : c.status === "nao_chegou"
                          ? "bg-warning"
                          : "bg-muted-foreground/50",
                  )}
                />
                <span className={cn("truncate text-sm font-medium", atual && "text-primary")}>{c.nome || "Aluno sem nome"}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{fmtRelativo(c.atualizada_em)}</span>
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {c.ultima_mensagem ||
                  (c.nao_chegou
                    ? "Agente ainda não interagiu: sem boas-vindas"
                    : c.so_boas_vindas
                      ? "Boas-vindas enviadas, aguardando o aluno"
                      : "—")}
              </span>
              <span className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-muted-foreground">
                {agentes.length > 1 && c.agente && <span className="rounded bg-secondary px-1">{nomeDoAgente(c.agente)}</span>}
                {c.categoria_rotulo && <span className="rounded bg-primary/12 px-1 text-primary">{c.categoria_rotulo}</span>}
                <span>{c.mensagens} msg</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  /* ───────── Coluna do aluno ───────── */
  const colunaAluno = (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Abas
          opcoes={[
            { value: "aluno", label: "Aluno" },
            { value: "unnichat", label: "Unnichat" },
            { value: "curso", label: "Curso" },
          ]}
          valor={aba}
          onChange={setAba}
        />
        {selecionada && (
          <BotaoBarra titulo="Consultar de novo o Unnichat e o cadastro" onClick={atualizarFicha}>
            <RefreshCw className={cn("size-3.5", (atualizando || ficha.isFetching) && "animate-spin")} />
          </BotaoBarra>
        )}
      </div>
      {!selecionada ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Selecione uma conversa para ver o aluno.</p>
      ) : aba === "aluno" ? (
        <AbaAluno conversa={conversa.data} ficha={ficha.data} nomeDoAgente={nomeDoAgente} />
      ) : ficha.isLoading ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Consultando…</p>
      ) : ficha.isError ? (
        <p className="py-6 text-center text-xs text-destructive">{(ficha.error as Error).message}</p>
      ) : aba === "unnichat" ? (
        <AbaUnnichat ficha={ficha.data} />
      ) : (
        <AbaCurso ficha={ficha.data} />
      )}
      {ficha.data && aba !== "aluno" && (
        <p className="font-mono text-[10px] text-muted-foreground uppercase">Consultado {fmtRelativo(ficha.data.consultado_em)}</p>
      )}
    </div>
  );

  const c = conversa.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 sm:px-8">
      <PageHeader
        title="Conversas"
        icon={MessagesSquare}
        description="O que os agentes conversaram com os alunos, a conversa inteira do WhatsApp e o que o Unnichat e o cadastro sabem de cada um."
      />
      <div className="-mx-4 flex min-h-[520px] flex-1 gap-1.5 p-1.5 sm:-mx-8">
        {paineis.lista && <aside className="hidden w-72 shrink-0 px-2 py-3 lg:block">{colunaLista}</aside>}

        <main className="surface-card relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
          {/* Barra superior: o aluno, a situação e os botões para recolher as colunas */}
          <div className="flex h-11 shrink-0 items-center gap-2 px-3">
            <BotaoBarra
              titulo={paineis.lista ? "Recolher a lista" : "Mostrar a lista"}
              onClick={() => setPaineis((p) => ({ ...p, lista: !p.lista }))}
              className="hidden lg:grid"
            >
              {paineis.lista ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </BotaoBarra>
            <button
              type="button"
              onClick={() => setGaveta((g) => (g === "lista" ? null : "lista"))}
              className="rounded-lg border px-2 py-1 font-mono text-[11px] uppercase lg:hidden"
            >
              Lista
            </button>
            {c && (
              <>
                <span className="truncate text-sm font-semibold">{c.nome || "Aluno sem nome"}</span>
                <StatusBadge status={c.status} className="hidden sm:inline-flex" />
              </>
            )}
            <div className="ml-auto flex items-center gap-2">
              <BotaoBarra
                titulo={foco ? "Sair do modo foco" : "Modo foco: recolher as duas colunas"}
                onClick={() => setPaineis(foco ? { lista: true, aluno: true } : { lista: false, aluno: false })}
                className="hidden lg:grid"
              >
                {foco ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </BotaoBarra>
              <BotaoBarra
                titulo={paineis.aluno ? "Recolher o aluno" : "Mostrar o aluno"}
                onClick={() => setPaineis((p) => ({ ...p, aluno: !p.aluno }))}
                className="hidden xl:grid"
              >
                {paineis.aluno ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
              </BotaoBarra>
              <button
                type="button"
                onClick={() => setGaveta((g) => (g === "aluno" ? null : "aluno"))}
                className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 font-mono text-[11px] uppercase", paineis.aluno ? "xl:hidden" : "")}
              >
                <User className="size-3" /> Aluno
              </button>
            </div>
          </div>

          {gaveta && (
            <div className="thin-scroll absolute inset-x-0 top-11 bottom-0 z-20 overflow-y-auto bg-background/95 p-4 backdrop-blur-sm">
              {gaveta === "lista" ? colunaLista : colunaAluno}
            </div>
          )}

          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            <div className={cn("mx-auto flex min-h-full w-full flex-col px-4 pt-4 pb-6", foco ? "max-w-3xl" : "max-w-2xl")}>
              {!selecionada ? (
                <div className="grid flex-1 place-items-center">
                  <EmptyState icon={<MessagesSquare className="size-5" />} title="Selecione uma conversa">
                    A conversa inteira do WhatsApp, com os detalhes de cada resposta do agente, e os dados do aluno aparecem aqui.
                  </EmptyState>
                </div>
              ) : conversa.isLoading ? (
                <PageLoader className="h-64" label="Abrindo conversa" />
              ) : conversa.isError || !c ? (
                <EmptyState title="Não foi possível abrir a conversa">{(conversa.error as Error)?.message}</EmptyState>
              ) : (
                <LinhaDoTempo c={c} ficha={ficha.data} carregandoFicha={ficha.isLoading} />
              )}
            </div>
          </div>
        </main>

        {paineis.aluno && <aside className="thin-scroll hidden w-80 shrink-0 overflow-y-auto px-2 py-3 xl:block">{colunaAluno}</aside>}
      </div>
    </div>
  );
}

/* ───────── Centro: a conversa inteira ───────── */

type ItemDaConversa = Conversa["itens"][number];
type LinhaDoTempoItem =
  | { tipo: "whatsapp"; m: MensagemUnnichat; resposta?: ItemDaConversa; quando: number }
  | { tipo: "nao_enviada"; resposta: ItemDaConversa; quando: number };

const instante = (iso?: string | null) => (iso ? Date.parse(iso) : 0);
const comparavel = (texto: string) => texto.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);

/**
 * A conversa numa linha só: a base é o WhatsApp (Unnichat), com equipe, automações, notas e boas-vindas; cada
 * resposta do agente ganha os detalhes do registro dele (ferramentas, tempo, avaliação). O servidor manda cada
 * resposta numa mensagem, então o casamento é pelo texto, a partir do início da resposta. Resposta registrada
 * que não aparece no WhatsApp (a trava calou o agente, falha no envio) fica marcada como não enviada. Sem o
 * Unnichat (conversa do painel), vale só o registro do agente.
 */
function LinhaDoTempo({ c, ficha, carregandoFicha }: { c: Conversa; ficha?: FichaAluno; carregandoFicha: boolean }) {
  const transferencia = useMemo(() => c.acoes.filter((a) => a.tipo === "transferencia").at(-1), [c]);
  const u = ficha?.unnichat && !("erro" in ficha.unnichat) ? ficha.unnichat : null;
  const itens = useMemo<LinhaDoTempoItem[] | null>(() => {
    if (!u || u.mensagens.length === 0) return null;
    const usadas = new Map<number, ItemDaConversa>();
    const naoEnviadas: ItemDaConversa[] = [];
    // As mensagens do Unnichat são só as mais recentes: resposta anterior à primeira delas fica de fora.
    const primeira = instante(u.mensagens[0].quando);
    for (const r of c.itens.filter((i) => i.papel === "agente")) {
      const inicio = instante(r.quando) - 60_000;
      const indice = u.mensagens.findIndex(
        (m, i) => !usadas.has(i) && m.autor === "agente" && instante(m.quando) >= inicio && comparavel(m.texto) === comparavel(r.texto),
      );
      if (indice >= 0) usadas.set(indice, r);
      else if (instante(r.quando) >= primeira) naoEnviadas.push(r);
    }
    return [
      ...u.mensagens.map((m, i) => ({ tipo: "whatsapp" as const, m, resposta: usadas.get(i), quando: instante(m.quando) })),
      ...naoEnviadas.map((r) => ({ tipo: "nao_enviada" as const, resposta: r, quando: instante(r.quando) })),
    ].sort((a, b) => a.quando - b.quando);
  }, [c, u]);

  return (
    <div className="space-y-5">
      <div className="num text-center font-mono text-[11px] text-muted-foreground uppercase">
        {c.origem} · início {fmtDataHora(c.criada_em)} · {c.mensagens} mensagens com o agente · resposta média {fmtSegundos(c.duracao_media_s)}
        {itens && <div>WhatsApp: últimas {u!.mensagens.length} mensagens, com equipe, automações e notas</div>}
        {!itens && carregandoFicha && <div>Carregando o WhatsApp…</div>}
        {!itens && ficha?.unnichat && "erro" in ficha.unnichat && <div>{ficha.unnichat.erro} Mostrando só o registro do agente.</div>}
      </div>
      {transferencia && <CartaoTransferencia transferencia={transferencia} rotulo={c.categoria_rotulo} />}
      {itens
        ? itens.map((item, i) =>
            item.tipo === "nao_enviada" ? (
              <RespostaDoAgente key={i} c={c} item={item.resposta} aviso="Registrada pelo agente, não chegou ao WhatsApp" />
            ) : item.m.autor === "nota" || item.m.autor === "sistema" ? (
              <AvisoWhatsApp key={i} m={item.m} />
            ) : (
              <MensagemWhatsApp key={i} m={item.m} rodape={item.resposta?.run_id ? <AvaliarResposta sessionId={c.id} runId={item.resposta.run_id} origem="conversa" /> : undefined}>
                {item.resposta && <DetalhesDaResposta c={c} item={item.resposta} />}
              </MensagemWhatsApp>
            ),
          )
        : c.itens.map((item, i) =>
            item.papel === "agente" ? (
              <RespostaDoAgente key={i} c={c} item={item} />
            ) : (
              <Balao key={i} papel="aluno" texto={item.texto} quando={item.quando} anexos={item.anexos} />
            ),
          )}
      {!itens && !carregandoFicha && c.itens.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {c.nao_chegou
            ? "A Unnichat pôs o aluno com o agente, mas o aviso de entrada não chegou ao servidor: as boas-vindas não foram enviadas. Fale com ele pela Unnichat."
            : "O aluno ainda não respondeu: só as boas-vindas foram enviadas."}
        </p>
      )}
      {c.fim === "inatividade" && <div className="text-center text-xs text-muted-foreground">Encerrada por falta de resposta do aluno.</div>}
    </div>
  );
}

/** O que só o registro do agente sabe de uma resposta: quem respondeu (equipe), o que usou, ferramentas e tempo. */
function DetalhesDaResposta({ c, item }: { c: Conversa; item: ItemDaConversa }) {
  return (
    <>
      {c.equipe && item.agente && <QuemRespondeu id={item.agente} />}
      <UsoNaResposta uso={item.calibracao} />
      {item.ferramentas?.map((f, j) => (
        <span key={j} className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary">
          <Wrench className="size-3" />
          {ROTULO_FERRAMENTA[f.nome] ?? f.nome}
        </span>
      ))}
      {item.duracao_s != null && (
        <span className="num text-[11px] text-muted-foreground">
          {fmtSegundos(item.duracao_s)} · {fmtInt(item.tokens)} tokens
        </span>
      )}
    </>
  );
}

function RespostaDoAgente({ c, item, aviso }: { c: Conversa; item: ItemDaConversa; aviso?: string }) {
  return (
    <Balao papel="agente" texto={item.texto} quando={item.quando} anexos={item.anexos}
      rodape={item.run_id ? <AvaliarResposta sessionId={c.id} runId={item.run_id} origem="conversa" /> : undefined}>
      {aviso && <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning-text">{aviso}</span>}
      <DetalhesDaResposta c={c} item={item} />
    </Balao>
  );
}

function CartaoTransferencia({ transferencia, rotulo }: { transferencia: Acao; rotulo?: string | null }) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/8 p-4 text-sm">
      <div className="mb-2 flex items-center gap-2 font-semibold text-primary">
        <Headset className="size-4" /> Transferida para a equipe
        {rotulo && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px]">{rotulo}</span>}
      </div>
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]">
        {[
          ["Motivo", transferencia.motivo],
          ["O que o aluno relatou", transferencia.dificuldade_relatada],
          ["Orientações já dadas", transferencia.orientacoes_prestadas],
          ["E-mail de matrícula", transferencia.email_matricula],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

const AUTOR: Record<MensagemUnnichat["autor"], { rotulo: string; icone: typeof Bot }> = {
  aluno: { rotulo: "Aluno", icone: User },
  agente: { rotulo: "Agente", icone: Bot },
  automacao: { rotulo: "Automação", icone: Zap },
  equipe: { rotulo: "Equipe", icone: Users },
  nota: { rotulo: "Nota interna", icone: StickyNote },
  sistema: { rotulo: "Sistema", icone: StickyNote },
};

function AvisoWhatsApp({ m }: { m: MensagemUnnichat }) {
  return (
    <div
      className={cn(
        "mx-auto max-w-[90%] rounded-xl border px-3 py-2 text-xs whitespace-pre-wrap",
        m.autor === "nota" ? "border-amber-500/30 bg-amber-500/8" : "border-dashed text-muted-foreground",
      )}
    >
      <span className="mr-2 font-mono text-[10px] uppercase">{AUTOR[m.autor].rotulo}</span>
      {m.texto}
      <span className="ml-2 text-[10px] text-muted-foreground">{fmtDataHora(m.quando)}</span>
    </div>
  );
}

function MensagemWhatsApp({ m, children, rodape }: { m: MensagemUnnichat; children?: ReactNode; rodape?: ReactNode }) {
  const aluno = m.autor === "aluno";
  const Icone = AUTOR[m.autor].icone;
  const semTexto = !m.texto;
  return (
    <div className={cn("flex gap-2.5", !aluno && "flex-row-reverse")}>
      <div
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full",
          aluno ? "bg-muted text-muted-foreground" : m.autor === "agente" ? "bg-primary/14 text-primary" : "bg-secondary text-secondary-foreground",
        )}
      >
        <Icone className="size-4" />
      </div>
      <div className={cn("flex max-w-[85%] flex-col gap-1", aluno ? "items-start" : "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
            aluno ? "rounded-tl-sm bg-secondary text-secondary-foreground" : "rounded-tr-sm border bg-background/60 dark:bg-card/70",
            semTexto && "text-muted-foreground italic",
          )}
        >
          {semTexto ? `(${m.tipo})` : m.texto}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono uppercase">{AUTOR[m.autor].rotulo}{m.tipo !== "message" ? ` · ${m.tipo}` : ""}</span>
          {children}
          <span>{fmtDataHora(m.quando)}</span>
        </div>
        {rodape}
      </div>
    </div>
  );
}

/* ───────── Direita: as abas do aluno ───────── */

const ROTULO_ACAO: Record<Acao["tipo"], string> = {
  transferencia: "Transferência",
  encerramento: "Encerramento",
  inatividade: "Encerrada por inatividade",
};

function AbaAluno({ conversa, ficha, nomeDoAgente }: { conversa?: Conversa; ficha?: FichaAluno; nomeDoAgente: (id?: string | null) => string }) {
  if (!conversa) return <p className="py-6 text-center text-xs text-muted-foreground">Carregando…</p>;
  const u = ficha?.unnichat && !("erro" in ficha.unnichat) ? ficha.unnichat : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Rotulo>Contato</Rotulo>
        <Cartao>
          <Dado rotulo="Nome">{conversa.nome || u?.nome || "—"}</Dado>
          <Dado rotulo="Telefone">{conversa.telefone || u?.telefone}</Dado>
          <Dado rotulo="E-mail">{u?.email}</Dado>
          <Dado rotulo="No Unnichat desde">{u?.criado_em ? fmtDataHora(u.criado_em) : null}</Dado>
        </Cartao>
      </div>
      <div className="flex flex-col gap-1">
        <Rotulo>Atendimento</Rotulo>
        <Cartao>
          <Dado rotulo="Situação">
            <StatusBadge status={conversa.status} />
          </Dado>
          <Dado rotulo={conversa.equipe ? "Equipe" : "Agente"}>{nomeDoAgente(conversa.equipe || conversa.agente)}</Dado>
          <Dado rotulo="Origem">{conversa.origem}</Dado>
          <Dado rotulo="Início">{fmtDataHora(conversa.criada_em)}</Dado>
          <Dado rotulo="Última atividade">{fmtDataHora(conversa.atualizada_em)}</Dado>
          <Dado rotulo="Mensagens do aluno">{fmtInt(conversa.mensagens)}</Dado>
          <Dado rotulo="Resposta média">{fmtSegundos(conversa.duracao_media_s)}</Dado>
          <Dado rotulo="Tokens">{fmtInt((conversa.tokens_entrada ?? 0) + (conversa.tokens_saida ?? 0))}</Dado>
          <Dado rotulo="Sessão">
            <span className="font-mono text-[10px] break-all">{conversa.id}</span>
          </Dado>
        </Cartao>
      </div>
      {conversa.acoes.length > 0 && (
        <div className="flex flex-col gap-1">
          <Rotulo>O que o agente fez</Rotulo>
          {conversa.acoes.map((a, i) => (
            <Cartao key={i} className={a.tipo === "transferencia" ? "border-primary/30 bg-primary/8" : undefined}>
              <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                {ROTULO_ACAO[a.tipo] ?? a.tipo}
                {a.registrado_em && <span className="font-normal text-muted-foreground">{fmtDataHora(a.registrado_em)}</span>}
              </div>
              {a.motivo && <p className="mt-1 text-xs text-muted-foreground">{a.motivo}</p>}
            </Cartao>
          ))}
        </div>
      )}
    </div>
  );
}

function AbaUnnichat({ ficha }: { ficha?: FichaAluno }) {
  const u = ficha?.unnichat;
  if (!u) return <p className="py-6 text-center text-xs text-muted-foreground">Esta conversa não veio do Unnichat.</p>;
  if ("erro" in u) return <p className="py-6 text-center text-xs text-destructive">{u.erro}</p>;
  const contagem = u.mensagens.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.autor]: (acc[m.autor] ?? 0) + 1 }), {});
  const campos = Object.entries(u.campos ?? {}).filter(([, v]) => v !== null && v !== "");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Rotulo>Atendente</Rotulo>
        <Cartao className="text-xs">{u.atendente ? `${u.atendente.nome ?? "—"}${u.atendente.email ? ` · ${u.atendente.email}` : ""}` : "Ninguém atribuído"}</Cartao>
      </div>
      <div className="flex flex-col gap-1">
        <Rotulo>Negócios</Rotulo>
        {u.negocios.length === 0 && <Cartao className="text-xs text-muted-foreground">Nenhum negócio.</Cartao>}
        {u.negocios.map((n) => (
          <Cartao key={n.id}>
            <div className="flex items-center justify-between gap-2 text-xs font-semibold">
              <span className="truncate">
                {n.funil ?? "Funil"}
                {n.coluna ? ` · ${n.coluna}` : ""}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  n.status === "open" ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
                )}
              >
                {n.status === "open" ? "Aberto" : n.status === "won" ? "Ganho" : n.status === "lost" ? "Perdido" : n.status}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Desde {fmtDataHora(n.criado_em)}
              {n.produtos.length > 0 && ` · ${n.produtos.join(", ")}`}
            </div>
          </Cartao>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <Rotulo>Tags ({u.tags.length})</Rotulo>
        <div className="flex flex-wrap gap-1">
          {u.tags.map((t) => (
            <span
              key={t}
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[10px]",
                t.startsWith("agente-") || t === "comercial-em-atendimento" ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground",
              )}
            >
              {t}
            </span>
          ))}
          {u.tags.length === 0 && <span className="text-xs text-muted-foreground">Sem tags.</span>}
        </div>
      </div>
      {campos.length > 0 && (
        <div className="flex flex-col gap-1">
          <Rotulo>Campos do contato</Rotulo>
          <Cartao>
            {campos.map(([k, v]) => (
              <Dado key={k} rotulo={k}>
                {typeof v === "object" ? JSON.stringify(v) : String(v)}
              </Dado>
            ))}
          </Cartao>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Rotulo>Mensagens recentes</Rotulo>
        <Cartao>
          {(Object.keys(AUTOR) as MensagemUnnichat["autor"][])
            .filter((a) => contagem[a])
            .map((a) => (
              <Dado key={a} rotulo={AUTOR[a].rotulo}>
                {fmtInt(contagem[a])}
              </Dado>
            ))}
        </Cartao>
      </div>
    </div>
  );
}

const ROTULO_SITUACAO: Record<string, string> = {
  aprovada: "Aprovada",
  pagamento_pendente: "Pagamento pendente",
  estornada_ou_contestada: "Estornada ou contestada",
  recusada: "Recusada",
  expirada: "Expirada",
  abandonada: "Não finalizada",
};

const ROTULO_MEIO: Record<string, string> = { cartao: "cartão", pix: "Pix", boleto: "boleto" };

/** "2026-10-28" → "28/10/2026" (as datas das compras vêm só com o dia). */
function dia(iso: string | null) {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function Compra({ c }: { c: CompraCadastro }) {
  return (
    <Cartao>
      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
        <span className="min-w-0 truncate">{c.produto ?? c.grupo ?? "Produto"}</span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
            c.situacao === "aprovada" ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
          )}
        >
          {ROTULO_SITUACAO[c.situacao] ?? c.situacao.replaceAll("_", " ")}
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        {[
          c.data_confirmacao ? `confirmada em ${dia(c.data_confirmacao)}` : c.data_pedido ? `pedido em ${dia(c.data_pedido)}` : null,
          c.meio_pagamento ? (ROTULO_MEIO[c.meio_pagamento] ?? c.meio_pagamento) : null,
          c.renovacao_automatica ? "renovação automática" : null,
          c.email_da_compra,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {c.motivo_estorno_interno && <div className="mt-1 text-[11px] text-muted-foreground">Motivo do estorno: {c.motivo_estorno_interno}</div>}
    </Cartao>
  );
}

/** Valor da área do aluno, que chega no formato da função do banco: listas e objetos viram texto legível. */
function valorLegivel(v: unknown): ReactNode {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (Array.isArray(v)) {
    if (v.length === 0) return "nenhum";
    return (
      <span className="flex flex-col gap-0.5">
        {v.map((item, i) => (
          <span key={i}>{typeof item === "object" && item ? Object.values(item).filter((x) => x !== null && x !== "").join(" · ") : String(item)}</span>
        ))}
      </span>
    );
  }
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${String(x)}`).join(" · ");
  return String(v);
}

function AbaCurso({ ficha }: { ficha?: FichaAluno }) {
  const cad = ficha?.cadastro;
  if (!cad) return <p className="py-6 text-center text-xs text-muted-foreground">Sem telefone para consultar o cadastro.</p>;
  if ("erro" in cad) return <p className="py-6 text-center text-xs text-destructive">{cad.erro}</p>;
  const compras = cad.compras;
  const area = cad.area_do_aluno;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Rotulo>Compras</Rotulo>
        {!compras ? (
          <Cartao className="text-xs text-muted-foreground">Consulta de compras não configurada.</Cartao>
        ) : !compras.encontrado ? (
          <Cartao className="text-xs text-muted-foreground">Nenhuma compra neste telefone.</Cartao>
        ) : compras.telefone_confere === false ? (
          <Cartao className="text-xs text-muted-foreground">As compras deste e-mail são de outro telefone.</Cartao>
        ) : (compras.pessoas ?? 1) > 1 && !compras.compras ? (
          <Cartao className="text-xs text-muted-foreground">Telefone com compras de {compras.pessoas} pessoas: o agente pede o e-mail antes de mostrar.</Cartao>
        ) : (
          <>
            {compras.emails_das_compras && compras.emails_das_compras.length > 0 && (
              <p className="text-[11px] text-muted-foreground">E-mail das compras: {compras.emails_das_compras.join(", ")}</p>
            )}
            {(compras.compras ?? []).map((c, i) => <Compra key={i} c={c} />)}
            {(compras.compras ?? []).length === 0 && <Cartao className="text-xs text-muted-foreground">Nenhuma compra concluída.</Cartao>}
          </>
        )}
      </div>
      {compras?.tentativas_nao_concluidas && compras.tentativas_nao_concluidas.length > 0 && (
        <div className="flex flex-col gap-1">
          <Rotulo>Tentativas não concluídas</Rotulo>
          {compras.tentativas_nao_concluidas.map((c, i) => <Compra key={i} c={c} />)}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Rotulo>Área do aluno</Rotulo>
        {!area ? (
          <Cartao className="text-xs text-muted-foreground">Consulta da área do aluno não configurada.</Cartao>
        ) : !area.alunos ? (
          <Cartao className="text-xs text-muted-foreground">
            {(area.encontrados ?? 0) > 1 ? `${area.encontrados} cadastros neste telefone: o agente pede o e-mail.` : "Nenhum cadastro na plataforma."}
          </Cartao>
        ) : (
          area.alunos.map((aluno, i) => (
            <Cartao key={i}>
              {Object.entries(aluno).map(([k, v]) => (
                <Dado key={k} rotulo={k.replaceAll("_", " ")}>
                  {valorLegivel(v)}
                </Dado>
              ))}
            </Cartao>
          ))
        )}
      </div>
    </div>
  );
}

/** O agente que respondeu, na cor dele (conversas de equipe). */
function QuemRespondeu({ id }: { id: string }) {
  const agente = useAgentes().find((a) => a.id === id);
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold" style={{ borderColor: `${agente?.cor ?? "#888"}66` }}>
      <span className="size-1.5 rounded-full" style={{ background: agente?.cor ?? "#888" }} />
      {agente?.nome ?? id}
    </span>
  );
}

export interface AnexoExibido {
  tipo: "imagem" | "arquivo" | "audio";
  nome: string;
  /** URL local (arquivo recém-enviado). Sem ela, mostra só o nome (conversa reaberta). */
  url?: string;
}

export function Anexos({ anexos }: { anexos: AnexoExibido[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {anexos.map((a, i) =>
        a.tipo === "imagem" && a.url ? (
          <a key={i} href={a.url} target="_blank" rel="noreferrer" title={a.nome}>
            <img src={a.url} alt={a.nome} className="max-h-48 max-w-56 rounded-xl border object-cover" />
          </a>
        ) : a.tipo === "audio" && a.url ? (
          <audio key={i} controls src={a.url} className="h-10 max-w-64" />
        ) : (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-background/50 px-2.5 py-1.5 text-xs"
            title={a.nome}
          >
            {a.tipo === "imagem" ? <ImageIcon className="size-3.5" /> : a.tipo === "audio" ? <Mic className="size-3.5" /> : <FileText className="size-3.5" />}
            <span className="max-w-44 truncate">{a.nome}</span>
          </span>
        ),
      )}
    </div>
  );
}

export function Balao({
  papel,
  texto,
  quando,
  children,
  automatica = false,
  anexos,
  rodape,
}: {
  papel: "aluno" | "agente";
  texto: string;
  quando?: string | null;
  children?: React.ReactNode;
  automatica?: boolean;
  anexos?: AnexoExibido[];
  rodape?: React.ReactNode;
}) {
  const aluno = papel === "aluno";
  const semTexto = !texto || texto === "(o aluno enviou o anexo sem texto)";
  return (
    <div className={cn("flex gap-2.5", !aluno && "flex-row-reverse")}>
      <div
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full",
          aluno ? "bg-muted text-muted-foreground" : "bg-primary/14 text-primary",
        )}
      >
        {aluno ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div className={cn("flex max-w-[85%] flex-col gap-1.5", aluno ? "items-start" : "items-end")}>
        {anexos && anexos.length > 0 && <Anexos anexos={anexos} />}
        {!semTexto && (
          <div
            className={cn(
              "rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
              aluno
                ? "rounded-tl-sm bg-secondary text-secondary-foreground"
                : "rounded-tr-sm border bg-background/60 dark:bg-card/70",
            )}
          >
            {texto}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {aluno && <span className="font-mono text-[11px] text-muted-foreground uppercase">Aluno</span>}
          {automatica && <span className="text-[11px] text-muted-foreground">Mensagem automática</span>}
          {children}
          {quando && <span className="text-[11px] text-muted-foreground">{fmtDataHora(quando)}</span>}
        </div>
        {rodape}
      </div>
    </div>
  );
}
