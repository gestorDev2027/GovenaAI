import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePode } from "@/hooks/use-permissoes";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  ExternalLink,
  Gauge,
  Headset,
  Loader2,
  MessageSquare,
  Percent,
  Route,
  Search,
  Timer,
  User,
  Users,
} from "lucide-react";
import { api, type AgenteCentral, type AlertaCentral, type RespostaAlertas, type Conversa, type ConversaCentral, type EventoCentral } from "@/lib/api";
import { fmtDataHora, fmtInt, fmtSegundos } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { tripulante } from "@/lib/tripulacao";
import {
  CabecalhoOrdenavel,
  Chip,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
  useOrdenacao,
} from "@/components/ui/tabela";
import { IndicadoresPainel, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import { UsoNaResposta } from "@/components/conhecimento/uso";
import { StatusBadge } from "@/components/widgets/widgets";
import { Indicador, ListaAoVivo, descreverEvento, pct } from "./dashboard";
import { PainelRastreamento } from "./rastreamento";
import { ROTULO_FERRAMENTA } from "@/pages/conversas";
import { TextoComLinks } from "@/pages/chat";

/*
 * As abas de tabela da Central ao vivo: por cima do escritório, os números principais do período e uma
 * tabela com rolagem própria (conversas, alertas, agentes ou acontecimentos). Clicar numa linha abre o
 * painel lateral com os dados daquela conversa ou daquele agente.
 */

export type AbaCentral = "escritorio" | "conversas" | "alertas" | "agentes" | "acontecimentos";

export const ABAS_CENTRAL: { id: AbaCentral; rotulo: string }[] = [
  { id: "escritorio", rotulo: "Escritório" },
  { id: "conversas", rotulo: "Conversas" },
  { id: "alertas", rotulo: "Alertas" },
  { id: "agentes", rotulo: "Agentes" },
  { id: "acontecimentos", rotulo: "Acontecimentos" },
];

// Os mesmos limites da cena e do topo da Central.
const SEGUNDOS_CONVERSANDO = 120;
const conversandoAgora = (c: ConversaCentral) => c.parada_ha_s != null && c.parada_ha_s <= SEGUNDOS_CONVERSANDO;

/** Há quanto tempo a conversa teve a última mensagem, a partir dos segundos parada. */
function fmtParada(s: number | null) {
  if (s == null) return "—";
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

function SituacaoConversa({ c }: { c: ConversaCentral }) {
  if (c.status === "transferido") return <Chip tom="primario">Transferida</Chip>;
  if (c.status === "encerrado") return <Chip>{c.fim === "inatividade" ? "Encerrada sem resposta" : "Encerrada"}</Chip>;
  return conversandoAgora(c) ? <Chip tom="sucesso">Conversando agora</Chip> : <Chip tom="alerta">Esperando o aluno</Chip>;
}

function NomeAgente({ id, agentes }: { id: string; agentes: AgenteCentral[] }) {
  const agente = agentes.find((a) => a.id === id);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="size-2 shrink-0 rounded-full" style={{ background: tripulante(id, agentes).cor }} />
      {agente?.nome ?? id}
    </span>
  );
}

/* ───────── Números principais ───────── */

/**
 * Os números do período. A regra é a mesma das abas: Conversas = as com atividade no período; Transferidas e
 * Encerradas = as transferidas / encerradas dentro do período (pela hora em que aconteceu), que são as
 * linhas dos filtros de mesmo nome em Conversas e os acontecimentos de mesmo tipo.
 */
export function MetricasCentral({
  agentes,
  alertas,
  periodo,
  carregando,
}: {
  agentes: AgenteCentral[];
  alertas: number;
  periodo: string;
  /** Enquanto as conversas do período não chegam, os números mostram "—" em vez de zero. */
  carregando?: boolean;
}) {
  if (carregando) {
    return (
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {["Em atendimento", `Conversas · ${periodo}`, `Transferidas · ${periodo}`, `Encerradas · ${periodo}`, "Resposta média", "Alertas"].map((r) => (
          <Indicador key={r} icone={<Loader2 className="animate-spin" />} rotulo={r} valor="—" detalhe="carregando…" cor="#94a3b8" />
        ))}
      </div>
    );
  }
  const todas = agentes.flatMap((a) => a.conversas);
  const ativas = todas.filter((c) => c.status === "em_atendimento");
  const transferidas = todas.filter((c) => c.transferida_no_periodo).length;
  const encerradas = todas.filter((c) => c.encerrada_no_periodo);
  const semResposta = encerradas.filter((c) => c.fim === "inatividade").length;
  const duracoes = todas.map((c) => c.duracao_media_s).filter((d): d is number => d != null);
  const tempoMedio = duracoes.length ? duracoes.reduce((a, b) => a + b, 0) / duracoes.length : null;
  const mensagens = todas.reduce((s, c) => s + c.mensagens, 0);
  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <Indicador icone={<Headset />} rotulo="Em atendimento" valor={fmtInt(ativas.length)} detalhe={`${fmtInt(ativas.filter(conversandoAgora).length)} conversando agora`} cor="#3b82f6" />
      <Indicador icone={<MessageSquare />} rotulo={`Conversas · ${periodo}`} valor={fmtInt(todas.length)} detalhe={`${fmtInt(mensagens)} mensagens`} cor="#0ea5e9" />
      <Indicador icone={<Users />} rotulo={`Transferidas · ${periodo}`} valor={fmtInt(transferidas)} detalhe={`${pct(todas.length ? transferidas / todas.length : null)} das conversas`} cor="#f7931e" />
      <Indicador
        icone={<CheckCircle2 />}
        rotulo={`Encerradas · ${periodo}`}
        valor={fmtInt(encerradas.length)}
        detalhe={`${fmtInt(encerradas.length - semResposta)} pelo agente · ${fmtInt(semResposta)} sem resposta`}
        cor="#10b981"
      />
      <Indicador icone={<Timer />} rotulo="Resposta média" valor={tempoMedio != null ? fmtSegundos(tempoMedio) : "—"} detalhe="por mensagem do aluno" cor="#8b5cf6" />
      <Indicador icone={<AlertTriangle />} rotulo="Alertas" valor={fmtInt(alertas)} detalhe="pedem atenção agora" cor={alertas ? "#ef4444" : "#94a3b8"} />
    </div>
  );
}

/* ───────── Abas de tabela ───────── */

type Escolha = { tipo: "conversa"; id: string } | { tipo: "rastreamento"; id: string } | { tipo: "agente"; id: string } | null;

export function TabelasCentral({
  aba,
  agentes,
  alertas,
  baixados = [],
  baixaDisponivel = false,
  eventos,
  carregando,
  consulta,
  vivo,
  periodo,
  aoVerNoEscritorio,
}: {
  aba: Exclude<AbaCentral, "escritorio">;
  agentes: AgenteCentral[];
  alertas: AlertaCentral[];
  /** Os alertas que já tiveram baixa (agente/alertas.py). */
  baixados?: AlertaCentral[];
  baixaDisponivel?: boolean;
  eventos: EventoCentral[];
  /** As conversas do período ainda estão chegando. */
  carregando?: boolean;
  /** O período e os testes (?horas= ou ?desde=&ate=, ver lib/periodo-central.ts). */
  consulta: string;
  /** O período vai até agora (as tabelas acompanham); senão, já terminou. */
  vivo: boolean;
  periodo: string;
  /** Volta ao escritório com a conversa ou o agente selecionado. */
  aoVerNoEscritorio: (escolha: { tipo: "conversa" | "agente"; id: string }) => void;
}) {
  const [escolha, setEscolha] = useState<Escolha>(null);
  const abrirConversa = (id: string) => setEscolha({ tipo: "conversa", id });
  const abrirAgente = (id: string) => setEscolha({ tipo: "agente", id });
  const todas = useMemo(() => agentes.flatMap((a) => a.conversas.map((c) => ({ ...c, agente: a.id }))), [agentes]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <MetricasCentral agentes={agentes} alertas={alertas.length} periodo={periodo} carregando={carregando} />
      {aba === "conversas" && <TabelaConversas conversas={todas} agentes={agentes} periodo={periodo} carregando={carregando} aoAbrir={abrirConversa} />}
      {aba === "alertas" && (
        <TabelaAlertas alertas={alertas} baixados={baixados} baixaDisponivel={baixaDisponivel} agentes={agentes} aoAbrirConversa={abrirConversa} />
      )}
      {aba === "agentes" && <TabelaAgentes agentes={agentes} aoAbrir={abrirAgente} />}
      {aba === "acontecimentos" && (
        <TabelaAcontecimentos consulta={consulta} vivo={vivo} aoVivo={eventos} agentes={agentes} aoAbrirConversa={abrirConversa} />
      )}

      {escolha?.tipo === "conversa" && (
        <PainelConversaLateral
          id={escolha.id}
          resumo={todas.find((c) => c.id === escolha.id)}
          agentes={agentes}
          aoFechar={() => setEscolha(null)}
          aoVerNoEscritorio={todas.some((c) => c.id === escolha.id) ? () => aoVerNoEscritorio({ tipo: "conversa", id: escolha.id }) : undefined}
          aoRastrear={() => setEscolha({ tipo: "rastreamento", id: escolha.id })}
        />
      )}
      {escolha?.tipo === "rastreamento" && (
        <PainelRastreamento
          id={escolha.id}
          nome={todas.find((c) => c.id === escolha.id)?.nome}
          aoFechar={() => setEscolha(null)}
          aoVoltar={() => setEscolha({ tipo: "conversa", id: escolha.id })}
        />
      )}
      {escolha?.tipo === "agente" && (
        <PainelAgenteLateral
          agente={agentes.find((a) => a.id === escolha.id)}
          agentes={agentes}
          eventos={eventos}
          periodo={periodo}
          aoFechar={() => setEscolha(null)}
          aoAbrirConversa={abrirConversa}
          aoVerNoEscritorio={() => aoVerNoEscritorio(escolha)}
        />
      )}
    </div>
  );
}

const campo =
  "h-9 rounded-xl border bg-muted/50 px-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50";

function Filtros({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>;
}

/** Botões de filtro; com `contagem`, cada um mostra quantas linhas tem (com os outros filtros aplicados). */
function Opcoes<T extends string>({
  opcoes,
  valor,
  onChange,
  contagem,
}: {
  opcoes: { value: T; label: string }[];
  valor: T;
  onChange: (v: T) => void;
  contagem?: (v: T) => number;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {opcoes.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
            valor === o.value ? "border-primary/50 bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {o.label}
          {contagem && <span className="num text-[10px] opacity-70">{fmtInt(contagem(o.value))}</span>}
        </button>
      ))}
    </div>
  );
}

function SeletorAgente({ agentes, valor, onChange }: { agentes: AgenteCentral[]; valor: string; onChange: (v: string) => void }) {
  if (agentes.length < 2) return null;
  return (
    <select aria-label="Agente" className={campo} value={valor} onChange={(e) => onChange(e.target.value)}>
      <option value="todos">Todos os agentes</option>
      {agentes.map((a) => (
        <option key={a.id} value={a.id}>
          {a.nome}
        </option>
      ))}
    </select>
  );
}

function Contador({ n, singular, plural, carregando }: { n: number; singular: string; plural: string; carregando?: boolean }) {
  return (
    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
      {carregando && <Loader2 className="mr-1 inline size-3 animate-spin" />}
      {fmtInt(n)} {n === 1 ? singular : plural}
    </span>
  );
}

/** Hora curta: "14:32" hoje, "04/11 14:32" nos outros dias. */
function fmtQuando(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? hora : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hora}`;
}

/* Conversas */

type ConversaComAgente = ConversaCentral & { agente: string };
type ChaveConversa = "nome" | "agente" | "mensagens" | "resposta" | "inicio" | "atividade";
type FiltroSituacao = "todas" | "em_atendimento" | "transferido" | "encerrado" | "sem_resposta";

/** A situação de cada filtro: as de "Transferidas" e "Encerradas" são as dos números do topo (no período). */
const naSituacao: Record<FiltroSituacao, (c: ConversaCentral) => boolean> = {
  todas: () => true,
  em_atendimento: (c) => c.status === "em_atendimento",
  transferido: (c) => !!c.transferida_no_periodo,
  encerrado: (c) => !!c.encerrada_no_periodo,
  sem_resposta: (c) => !!c.encerrada_no_periodo && c.fim === "inatividade",
};

function TabelaConversas({
  conversas,
  agentes,
  periodo,
  carregando,
  aoAbrir,
}: {
  conversas: ConversaComAgente[];
  agentes: AgenteCentral[];
  periodo: string;
  carregando?: boolean;
  aoAbrir: (id: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState<FiltroSituacao>("todas");
  const [agente, setAgente] = useState("todos");
  const ordem = useOrdenacao<ChaveConversa>("atividade");
  const nomeDoAgente = (id: string) => agentes.find((a) => a.id === id)?.nome ?? id;

  // Busca e agente primeiro: as contagens dos botões de situação seguem esses dois filtros.
  const daBusca = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return conversas.filter(
      (c) =>
        (agente === "todos" || c.agente === agente) &&
        (!termo || `${c.nome} ${c.ultima_mensagem} ${c.motivo ?? ""} ${c.categoria_rotulo ?? ""}`.toLowerCase().includes(termo)),
    );
  }, [conversas, busca, agente]);

  const linhas = useMemo(() => {
    const valor = (c: ConversaComAgente): string | number => {
      switch (ordem.chave) {
        case "nome":
          return (c.nome || "").toLowerCase();
        case "agente":
          return nomeDoAgente(c.agente).toLowerCase();
        case "mensagens":
          return c.mensagens;
        case "resposta":
          return c.duracao_media_s ?? -1;
        case "inicio":
          return c.criada_em ? new Date(c.criada_em).getTime() : 0;
        default:
          return -(c.parada_ha_s ?? Number.MAX_SAFE_INTEGER); // maior = mais recente
      }
    };
    return daBusca
      .filter(naSituacao[situacao])
      .sort((a, b) => {
        const [x, y] = [valor(a), valor(b)];
        const r = x < y ? -1 : x > y ? 1 : 0;
        return ordem.direcao === "asc" ? r : -r;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daBusca, situacao, ordem.chave, ordem.direcao]);

  const cab = (rotulo: string, campoOrdem: ChaveConversa, alinhamento: "left" | "right" = "left") => (
    <CabecalhoOrdenavel rotulo={rotulo} campo={campoOrdem} chaveAtiva={ordem.chave} direcao={ordem.direcao} onAlternar={ordem.alternar} alinhamento={alinhamento} />
  );

  return (
    <>
      <Filtros>
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(campo, "w-60 pl-8")} placeholder="Aluno, mensagem ou motivo" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Opcoes
          opcoes={[
            { value: "todas", label: "Todas" },
            { value: "em_atendimento", label: "Em atendimento" },
            { value: "transferido", label: `Transferidas · ${periodo}` },
            { value: "encerrado", label: `Encerradas · ${periodo}` },
            { value: "sem_resposta", label: "Sem resposta do aluno" },
          ]}
          valor={situacao}
          onChange={setSituacao}
          contagem={(v) => daBusca.filter(naSituacao[v]).length}
        />
        <SeletorAgente agentes={agentes} valor={agente} onChange={setAgente} />
        <Contador n={linhas.length} singular="conversa" plural="conversas" />
      </Filtros>
      <TableWrapper className="max-h-none min-h-0 flex-1">
        <Table>
          <TableHeader>
            <tr>
              <TableHead>{cab("Aluno", "nome")}</TableHead>
              <TableHead>{cab("Agente", "agente")}</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Última mensagem</TableHead>
              <TableHead className="text-right">{cab("Msgs", "mensagens", "right")}</TableHead>
              <TableHead className="text-right">{cab("Resposta", "resposta", "right")}</TableHead>
              <TableHead className="text-right">{cab("Início", "inicio", "right")}</TableHead>
              <TableHead className="text-right">{cab("Atividade", "atividade", "right")}</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {linhas.length === 0 && (
              <TableEmpty colSpan={9}>{carregando ? "Carregando as conversas do período…" : "Nenhuma conversa no período com esses filtros."}</TableEmpty>
            )}
            {linhas.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => aoAbrir(c.id)}>
                <TableCell className="max-w-48 truncate font-medium">{c.nome || "Aluno sem nome"}</TableCell>
                <TableCell>
                  <NomeAgente id={c.agente} agentes={agentes} />
                </TableCell>
                <TableCell>
                  <SituacaoConversa c={c} />
                </TableCell>
                <TableCell className="max-w-56 truncate text-muted-foreground">{c.categoria_rotulo ?? c.motivo ?? "—"}</TableCell>
                <TableCell className="max-w-72 truncate text-muted-foreground">{c.ultima_mensagem || "—"}</TableCell>
                <TableCell numeric>{fmtInt(c.mensagens)}</TableCell>
                <TableCell numeric>{fmtSegundos(c.duracao_media_s)}</TableCell>
                <TableCell numeric className="whitespace-nowrap text-muted-foreground">{fmtQuando(c.criada_em)}</TableCell>
                <TableCell numeric className="whitespace-nowrap">
                  <span className="block">{fmtParada(c.parada_ha_s)}</span>
                  <span className="block text-[10px] text-muted-foreground">{fmtDataHora(c.atualizada_em)}</span>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>
    </>
  );
}

/* Alertas */

const ROTULO_ALERTA: Record<AlertaCentral["tipo"], string> = {
  falha_na_resposta: "Falha na resposta",
  transferida_aguardando: "Transferida aguardando",
  guardrail_pendente: "Bloqueio a revisar",
};

type FiltroAlerta = "todos" | AlertaCentral["tipo"];
type ChaveAlerta = "nivel" | "contato" | "parada";
type VistaAlerta = "abertos" | "baixados";
const ROTULO_BAIXA: Record<string, string> = { equipe_assumiu: "Equipe assumiu", resolvido: "Resolvido" };
/** Quem deu a baixa: o e-mail, "automática" ou, sem login com o Google, "sem login". */
const quemDeuBaixa = (por: string | null | undefined) => (!por ? "—" : por === "chave de acesso" ? "sem login" : por);
const PESO_NIVEL = { alto: 0, medio: 1, baixo: 2 } as const;

/** Os botões de baixa de um alerta (ou "Reabrir", nos que já tiveram baixa). */
function AcoesAlerta({ alerta, baixado }: { alerta: AlertaCentral; baixado: boolean }) {
  const cliente = useQueryClient();
  const enviar = useMutation({
    mutationFn: ({ rota, motivo }: { rota: "baixa" | "reabrir"; motivo?: string }) =>
      api(`/central/alertas/${rota}`, {
        method: "POST",
        body: JSON.stringify({ tipo: alerta.tipo, session_id: alerta.session_id, referencia: alerta.referencia, motivo }),
      }),
    onSuccess: (_r, { rota, motivo }) => {
      toast.success(rota === "baixa" ? `Baixa dada: ${alerta.contato || "alerta"}.` : `Alerta reaberto: ${alerta.contato || "alerta"}.`);
      // A lista leva alguns segundos para ser recalculada: a linha muda de lado já, e a busca confirma depois.
      const mesmo = (a: AlertaCentral) => a.tipo === alerta.tipo && a.session_id === alerta.session_id;
      cliente.setQueriesData<RespostaAlertas>({ queryKey: ["central-alertas"] }, (d) => {
        if (!d) return d;
        const baixados = d.baixados ?? [];
        if (rota === "baixa") {
          const movido = { ...alerta, baixa: { motivo: motivo ?? "resolvido", motivo_rotulo: ROTULO_BAIXA[motivo ?? "resolvido"] ?? "Resolvido", por: null, em: new Date().toISOString() } };
          const alertas = d.alertas.filter((a) => !mesmo(a));
          return { ...d, alertas, total: alertas.length, baixados: [movido, ...baixados.filter((a) => !mesmo(a))] };
        }
        const alertas = [{ ...alerta, baixa: undefined }, ...d.alertas.filter((a) => !mesmo(a))];
        return { ...d, alertas, total: alertas.length, baixados: baixados.filter((a) => !mesmo(a)) };
      });
      cliente.invalidateQueries({ queryKey: ["central-alertas"] });
    },
    onError: (erro) => toast.error((erro as Error).message),
  });
  const botao = (rotulo: string, rota: "baixa" | "reabrir", motivo?: string) => (
    <button
      type="button"
      disabled={enviar.isPending}
      onClick={(e) => {
        e.stopPropagation();
        enviar.mutate({ rota, motivo });
      }}
      className="rounded-full border px-2.5 py-1 text-[11px] whitespace-nowrap text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-foreground disabled:opacity-50"
    >
      {rotulo}
    </button>
  );
  if (baixado) return <div className="flex justify-end">{botao("Reabrir", "reabrir")}</div>;
  return (
    <div className="flex justify-end gap-1">
      {alerta.tipo === "transferida_aguardando" && botao("Equipe assumiu", "baixa", "equipe_assumiu")}
      {botao("Resolvido", "baixa", "resolvido")}
    </div>
  );
}

function TabelaAlertas({
  alertas,
  baixados,
  baixaDisponivel,
  agentes,
  aoAbrirConversa,
}: {
  alertas: AlertaCentral[];
  baixados: AlertaCentral[];
  baixaDisponivel: boolean;
  agentes: AgenteCentral[];
  aoAbrirConversa: (id: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<FiltroAlerta>("todos");
  const [agente, setAgente] = useState("todos");
  const [vista, setVista] = useState<VistaAlerta>("abertos");
  const ordem = useOrdenacao<ChaveAlerta>("nivel");
  const podeTratar = usePode()("tratar_alertas") && baixaDisponivel;
  const daVista = vista === "abertos" ? alertas : baixados;

  const daBusca = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return daVista.filter(
      (a) => (agente === "todos" || a.agente === agente) && (!termo || `${a.contato ?? ""} ${a.texto}`.toLowerCase().includes(termo)),
    );
  }, [daVista, busca, agente]);

  const linhas = useMemo(() => {
    const valor = (a: AlertaCentral): string | number => {
      if (ordem.chave === "contato") return (a.contato || "").toLowerCase();
      if (ordem.chave === "parada") return a.parada_min ?? -1;
      return PESO_NIVEL[a.nivel] * 1e7 - (a.parada_min ?? 0); // nível e, dentro dele, o mais parado primeiro
    };
    return daBusca
      .filter((a) => tipo === "todos" || a.tipo === tipo)
      .sort((a, b) => {
        const [x, y] = [valor(a), valor(b)];
        const r = x < y ? -1 : x > y ? 1 : 0;
        return ordem.direcao === "asc" ? r : -r;
      });
  }, [daBusca, tipo, ordem.chave, ordem.direcao]);

  const cab = (rotulo: string, campoOrdem: ChaveAlerta, alinhamento: "left" | "right" = "left") => (
    <CabecalhoOrdenavel rotulo={rotulo} campo={campoOrdem} chaveAtiva={ordem.chave} direcao={ordem.direcao} onAlternar={ordem.alternar} alinhamento={alinhamento} />
  );

  return (
    <>
      <Filtros>
        <Opcoes
          opcoes={[
            { value: "abertos", label: "Abertos" },
            { value: "baixados", label: "Com baixa" },
          ]}
          valor={vista}
          onChange={setVista}
          contagem={(v) => (v === "abertos" ? alertas.length : baixados.length)}
        />
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(campo, "w-56 pl-8")} placeholder="Aluno ou o que aconteceu" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Opcoes
          opcoes={[
            { value: "todos", label: "Todos" },
            { value: "falha_na_resposta", label: ROTULO_ALERTA.falha_na_resposta },
            { value: "transferida_aguardando", label: ROTULO_ALERTA.transferida_aguardando },
            ...(vista === "abertos" ? [{ value: "guardrail_pendente" as const, label: ROTULO_ALERTA.guardrail_pendente }] : []),
          ]}
          valor={tipo}
          onChange={setTipo}
          contagem={(v) => daBusca.filter((a) => v === "todos" || a.tipo === v).length}
        />
        <SeletorAgente agentes={agentes} valor={agente} onChange={setAgente} />
        <Contador n={linhas.length} singular="alerta" plural="alertas" />
      </Filtros>
      {vista === "abertos" && (
        <p className="shrink-0 text-[11px] text-muted-foreground">
          Quando a equipe responde o aluno no WhatsApp, a baixa é automática (conferida a cada 10 minutos). Use os botões para o que foi
          resolvido de outro jeito; o alerta volta se acontecer algo novo na conversa.
        </p>
      )}
      <TableWrapper className="max-h-none min-h-0 flex-1">
        <Table>
          <TableHeader>
            <tr>
              <TableHead>{cab("Nível", "nivel")}</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Agente</TableHead>
              <TableHead>{cab("Aluno", "contato")}</TableHead>
              <TableHead>{vista === "abertos" ? "O que aconteceu" : "Baixa"}</TableHead>
              <TableHead className="text-right">Desde</TableHead>
              <TableHead className="text-right">{cab("Parado há", "parada", "right")}</TableHead>
              {podeTratar && <TableHead className="text-right">Ação</TableHead>}
            </tr>
          </TableHeader>
          <tbody>
            {linhas.length === 0 && (
              <TableEmpty colSpan={podeTratar ? 8 : 7}>
                {daVista.length
                  ? "Nenhum alerta com esses filtros."
                  : vista === "abertos"
                    ? "Nada pedindo atenção no período."
                    : "Nenhuma baixa no período."}
              </TableEmpty>
            )}
            {linhas.map((a, i) => (
              <TableRow
                key={`${a.tipo}-${a.session_id ?? a.agente}-${i}`}
                className={cn(a.session_id && "cursor-pointer")}
                onClick={() => a.session_id && aoAbrirConversa(a.session_id)}
                title={a.session_id ? "Abrir a conversa" : undefined}
              >
                <TableCell>
                  <Chip tom={a.nivel === "alto" ? "erro" : a.nivel === "medio" ? "alerta" : "neutro"}>
                    {a.nivel === "alto" ? "Alto" : a.nivel === "medio" ? "Médio" : "Baixo"}
                  </Chip>
                </TableCell>
                <TableCell className="whitespace-nowrap">{ROTULO_ALERTA[a.tipo] ?? a.tipo}</TableCell>
                <TableCell>
                  <NomeAgente id={a.agente} agentes={agentes} />
                </TableCell>
                <TableCell className="max-w-40 truncate">{a.contato || (a.quantidade ? `${fmtInt(a.quantidade)} casos` : "—")}</TableCell>
                {a.baixa ? (
                  <TableCell className={cn("truncate text-muted-foreground", podeTratar ? "max-w-64" : "max-w-96")} title={a.texto}>
                    <span className="text-foreground">{a.baixa.motivo_rotulo}</span> · {quemDeuBaixa(a.baixa.por)} · {fmtQuando(a.baixa.em)}
                  </TableCell>
                ) : (
                  <TableCell className={cn("truncate text-muted-foreground", podeTratar ? "max-w-64" : "max-w-96")} title={a.texto}>
                    {a.texto}
                  </TableCell>
                )}
                <TableCell numeric className="whitespace-nowrap text-muted-foreground">{fmtQuando(a.desde)}</TableCell>
                <TableCell numeric className="whitespace-nowrap">{a.parada_min != null ? fmtParada(a.parada_min * 60) : "—"}</TableCell>
                {podeTratar && (
                  <TableCell>{a.session_id && a.referencia != null && a.tipo !== "guardrail_pendente" && <AcoesAlerta alerta={a} baixado={!!a.baixa} />}</TableCell>
                )}
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>
    </>
  );
}

/* Agentes */

type ChaveAgente = "nome" | "atendendo" | "conversas" | "transferencia" | "resposta" | "aprovacao";

function TabelaAgentes({ agentes, aoAbrir }: { agentes: AgenteCentral[]; aoAbrir: (id: string) => void }) {
  const ordem = useOrdenacao<ChaveAgente>("conversas");
  const linhas = useMemo(() => {
    const valor = (a: AgenteCentral): string | number => {
      const ind = a.indicadores;
      switch (ordem.chave) {
        case "nome":
          return a.nome.toLowerCase();
        case "atendendo":
          return ind?.em_atendimento ?? 0;
        case "transferencia":
          return ind?.transferencia_pct ?? -1;
        case "resposta":
          return ind?.tempo_medio_resposta_s ?? -1;
        case "aprovacao":
          return ind?.calibracao_aprovacao ?? -1;
        default:
          return ind?.conversas ?? a.conversas.length;
      }
    };
    return [...agentes].sort((a, b) => {
      const [x, y] = [valor(a), valor(b)];
      const r = x < y ? -1 : x > y ? 1 : 0;
      return ordem.direcao === "asc" ? r : -r;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentes, ordem.chave, ordem.direcao]);
  const cab = (rotulo: string, campoOrdem: ChaveAgente, alinhamento: "left" | "right" = "right") => (
    <CabecalhoOrdenavel rotulo={rotulo} campo={campoOrdem} chaveAtiva={ordem.chave} direcao={ordem.direcao} onAlternar={ordem.alternar} alinhamento={alinhamento} />
  );
  return (
    <TableWrapper className="max-h-none min-h-0 flex-1">
      <Table>
        <TableHeader>
          <tr>
            <TableHead>{cab("Agente", "nome", "left")}</TableHead>
            <TableHead>Função</TableHead>
            <TableHead className="text-right">{cab("Atendendo", "atendendo")}</TableHead>
            <TableHead className="text-right">{cab("Conversas", "conversas")}</TableHead>
            <TableHead className="text-right">{cab("Transferência", "transferencia")}</TableHead>
            <TableHead className="text-right">{cab("Resposta", "resposta")}</TableHead>
            <TableHead className="text-right">{cab("Aprovação", "aprovacao")}</TableHead>
            <TableHead>Modelo</TableHead>
          </tr>
        </TableHeader>
        <tbody>
          {linhas.length === 0 && <TableEmpty colSpan={8}>Nenhum agente no ar.</TableEmpty>}
          {linhas.map((a) => {
            const ind = a.indicadores;
            return (
              <TableRow key={a.id} className="cursor-pointer" onClick={() => aoAbrir(a.id)}>
                <TableCell className="font-medium">
                  <NomeAgente id={a.id} agentes={agentes} />
                </TableCell>
                <TableCell className="max-w-56 truncate text-muted-foreground">{a.cargo ?? a.funcao}</TableCell>
                <TableCell numeric>
                  {fmtInt(ind?.em_atendimento ?? 0)}
                  {!!ind?.conversando_agora && <span className="ml-1 text-[11px] text-success">({fmtInt(ind.conversando_agora)} agora)</span>}
                </TableCell>
                <TableCell numeric>{fmtInt(ind?.conversas ?? a.conversas.length)}</TableCell>
                <TableCell numeric>{pct(ind?.transferencia_pct)}</TableCell>
                <TableCell numeric>{fmtSegundos(ind?.tempo_medio_resposta_s)}</TableCell>
                <TableCell numeric title={ind ? `${fmtInt(ind.calibracao_avaliadas)} respostas avaliadas` : undefined}>{pct(ind?.calibracao_aprovacao)}</TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">{a.modelo ?? "—"}</TableCell>
              </TableRow>
            );
          })}
        </tbody>
      </Table>
    </TableWrapper>
  );
}

/* Acontecimentos */

type FiltroTipo = "todos" | "respondeu" | "ferramenta" | "transferiu" | "encerrou" | "boas_vindas" | "falhas";

const FILTROS_TIPO: { value: FiltroTipo; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "respondeu", label: "Respostas" },
  { value: "ferramenta", label: "Ferramentas" },
  { value: "transferiu", label: "Transferências" },
  { value: "encerrou", label: "Encerramentos" },
  { value: "boas_vindas", label: "Boas-vindas" },
  { value: "falhas", label: "Bloqueios e falhas" },
];

const doTipo = (e: EventoCentral, tipo: FiltroTipo) =>
  tipo === "todos" || (tipo === "falhas" ? e.tipo === "guardrail" || e.tipo === "erro" : e.tipo === tipo);

/**
 * O histórico do período (/central/acontecimentos), montado do que fica gravado: sobrevive aos deploys. O mesmo
 * período e as mesmas conversas dos números do topo: os encerramentos e as transferências daqui são as
 * encerradas e as transferidas de lá. Com o período até agora, cada acontecimento novo da conexão ao vivo
 * pede o histórico de novo, para a tabela acompanhar o agente.
 */
function TabelaAcontecimentos({
  consulta,
  vivo,
  aoVivo,
  agentes,
  aoAbrirConversa,
}: {
  consulta: string;
  vivo: boolean;
  aoVivo: EventoCentral[];
  agentes: AgenteCentral[];
  aoAbrirConversa: (id: string) => void;
}) {
  const [agente, setAgente] = useState("todos");
  const [tipo, setTipo] = useState<FiltroTipo>("todos");
  const [busca, setBusca] = useState("");
  const historico = useQuery({
    queryKey: ["central-acontecimentos", consulta],
    queryFn: () => api<{ eventos: EventoCentral[]; total: number }>(`/central/acontecimentos?${consulta}`),
    refetchInterval: vivo ? 30_000 : false,
    placeholderData: (anterior) => anterior,
  });
  const ultimoAoVivo = aoVivo.filter((e) => e.tipo !== "pensando" && e.tipo !== "mensagem").at(-1)?.id;
  const { refetch } = historico;
  useEffect(() => {
    if (ultimoAoVivo && vivo) refetch();
  }, [ultimoAoVivo, vivo, refetch]);

  // Busca e agente primeiro: as contagens dos botões de tipo seguem esses dois filtros.
  const daBusca = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (historico.data?.eventos ?? []).filter(
      (e) =>
        (agente === "todos" || e.agente === agente) &&
        (!termo || `${e.contato} ${e.texto ?? ""} ${e.motivo ?? ""} ${e.categoria_rotulo ?? ""}`.toLowerCase().includes(termo)),
    );
  }, [historico.data, agente, busca]);
  const linhas = useMemo(() => daBusca.filter((e) => doTipo(e, tipo)), [daBusca, tipo]);
  const cortados = (historico.data?.total ?? 0) - (historico.data?.eventos.length ?? 0);

  return (
    <>
      <Filtros>
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(campo, "w-56 pl-8")} placeholder="Aluno, resposta ou motivo" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Opcoes opcoes={FILTROS_TIPO} valor={tipo} onChange={setTipo} contagem={(v) => daBusca.filter((e) => doTipo(e, v)).length} />
        <SeletorAgente agentes={agentes} valor={agente} onChange={setAgente} />
        <Contador n={linhas.length} singular="acontecimento" plural="acontecimentos" carregando={historico.isFetching} />
      </Filtros>
      {cortados > 0 && (
        <p className="shrink-0 text-[11px] text-muted-foreground">
          Mostrando os {fmtInt(historico.data!.eventos.length)} mais recentes de {fmtInt(historico.data!.total)}. Escolha um período menor para ver todos.
        </p>
      )}
      <TableWrapper className="max-h-none min-h-0 flex-1">
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Quando</TableHead>
              <TableHead>Agente</TableHead>
              <TableHead>O que fez</TableHead>
              <TableHead>Aluno</TableHead>
              <TableHead>Detalhe</TableHead>
              <TableHead>Canal</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {historico.isLoading && <TableEmpty colSpan={6}>Carregando o histórico…</TableEmpty>}
            {historico.isError && <TableEmpty colSpan={6}>{(historico.error as Error).message}</TableEmpty>}
            {historico.data && linhas.length === 0 && <TableEmpty colSpan={6}>Nenhum acontecimento no período com esses filtros.</TableEmpty>}
            {linhas.map((e) => {
              const d = descreverEvento(e);
              const detalhe = [e.categoria_rotulo, e.motivo].filter(Boolean).join(" · ");
              return (
                <TableRow key={e.id} className="cursor-pointer" onClick={() => aoAbrirConversa(e.session_id)}>
                  <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">{fmtDataHora(e.quando)}</TableCell>
                  <TableCell>
                    <NomeAgente id={e.agente} agentes={agentes} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="grid size-5 place-items-center rounded-full text-white [&_svg]:size-3" style={{ background: d.cor }}>
                        {d.icone}
                      </span>
                      {d.texto}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-48 truncate">{e.contato || "—"}</TableCell>
                  <TableCell className="max-w-[28rem] truncate text-muted-foreground" title={[detalhe, e.texto].filter(Boolean).join(" · ")}>
                    {detalhe || e.texto || (e.duracao_s != null ? fmtSegundos(e.duracao_s) : "—")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.origem === "whatsapp" ? "WhatsApp" : e.origem === "painel" ? "Painel" : "Outro"}</TableCell>
                </TableRow>
              );
            })}
          </tbody>
        </Table>
      </TableWrapper>
    </>
  );
}

/* ───────── Painéis laterais ───────── */

function BotaoRodape({ children, onClick, href }: { children: ReactNode; onClick?: () => void; href?: string }) {
  const classe = "inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted";
  return href ? (
    <a href={href} target="_blank" rel="noopener" className={cn(classe, "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}>
      {children}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={classe}>
      {children}
    </button>
  );
}

function PainelConversaLateral({
  id,
  resumo,
  agentes,
  aoFechar,
  aoVerNoEscritorio,
  aoRastrear,
}: {
  id: string;
  resumo?: ConversaComAgente;
  agentes: AgenteCentral[];
  aoFechar: () => void;
  aoVerNoEscritorio?: () => void;
  /** Abre o rastreamento da conversa (raciocínio, ferramentas, contexto e Learning). */
  aoRastrear: () => void;
}) {
  const conversa = useQuery({
    queryKey: ["conversa", id, resumo?.atualizada_em],
    queryFn: () => api<Conversa>(`/conversas/${encodeURIComponent(id)}`),
  });
  const c = conversa.data;
  const transferencia = c?.acoes.filter((a) => a.tipo === "transferencia").at(-1);
  const nome = resumo?.nome || c?.nome || "Aluno sem nome";
  return (
    <PainelLateral
      aberto
      aoMudar={(aberto) => !aberto && aoFechar()}
      largura="md"
      icone={<Headset />}
      rotulo={`Conversa · ${resumo?.origem ?? c?.origem ?? ""}`}
      titulo={nome}
      descricao={
        <span className="inline-flex flex-wrap items-center gap-2">
          {resumo ? <SituacaoConversa c={resumo} /> : c && <StatusBadge status={c.status} />}
          {(resumo?.agente || c?.agente) && <NomeAgente id={(resumo?.agente || c?.agente)!} agentes={agentes} />}
          {c?.telefone && <span className="font-mono text-xs">{c.telefone}</span>}
        </span>
      }
      destaque={
        <IndicadoresPainel
          itens={[
            { rotulo: "Mensagens", valor: fmtInt(resumo?.mensagens ?? c?.mensagens ?? 0), icone: <MessageSquare /> },
            { rotulo: "Resposta média", valor: fmtSegundos(resumo?.duracao_media_s ?? c?.duracao_media_s), icone: <Timer /> },
            { rotulo: "Última atividade", valor: resumo ? fmtParada(resumo.parada_ha_s) : fmtDataHora(c?.atualizada_em), icone: <Clock /> },
          ]}
        />
      }
      rodape={
        <>
          {aoVerNoEscritorio && <BotaoRodape onClick={aoVerNoEscritorio}>Ver no escritório</BotaoRodape>}
          <BotaoRodape onClick={aoRastrear}>
            <Route className="size-3.5" /> Rastreamento
          </BotaoRodape>
          <BotaoRodape href={`/painel/conversas?id=${encodeURIComponent(id)}`}>
            Abrir em Conversas <ExternalLink className="size-3.5" />
          </BotaoRodape>
        </>
      }
    >
      <div className="space-y-5">
        {transferencia && (
          <SecaoPainel titulo={`Transferência${c?.categoria_rotulo ? ` · ${c.categoria_rotulo}` : ""}`}>
            <div className="space-y-1 rounded-xl border border-primary/30 bg-primary/8 px-3 py-2 text-xs leading-relaxed">
              {transferencia.motivo && <p>{transferencia.motivo}</p>}
              {transferencia.dificuldade_relatada && <p className="text-muted-foreground">Relato: {transferencia.dificuldade_relatada}</p>}
              {transferencia.orientacoes_prestadas && <p className="text-muted-foreground">Orientações: {transferencia.orientacoes_prestadas}</p>}
            </div>
          </SecaoPainel>
        )}
        <SecaoPainel titulo="Conversa com o agente" contagem={c?.itens.length}>
          {conversa.isLoading && (
            <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Abrindo a conversa…
            </p>
          )}
          {conversa.isError && <p className="py-4 text-xs text-destructive">{(conversa.error as Error).message}</p>}
          {c && c.itens.length === 0 && <p className="py-4 text-xs text-muted-foreground">O aluno ainda não respondeu: só as boas-vindas foram enviadas.</p>}
          <div className="space-y-3">
            {c?.itens.map((item, i) =>
              item.papel === "aluno" ? (
                <div key={i} className="flex justify-end gap-2">
                  <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-secondary px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-secondary-foreground">
                    {item.texto === "(o aluno enviou o anexo sem texto)" ? "📎 anexo" : item.texto}
                    {!!item.anexos?.length && <div className="mt-1 text-[11px] opacity-70">📎 {item.anexos.map((a) => a.nome).join(", ")}</div>}
                  </div>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <User className="size-3.5" />
                  </span>
                </div>
              ) : (
                <div key={i} className="flex gap-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/14 text-primary">
                    <Bot className="size-3.5" />
                  </span>
                  <div className="min-w-0 space-y-1.5">
                    {!!item.ferramentas?.length && (
                      <div className="flex flex-wrap gap-1">
                        {item.ferramentas.map((f, j) => (
                          <span key={j} className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground uppercase">
                            {ROTULO_FERRAMENTA[f.nome] ?? f.nome}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="rounded-2xl rounded-tl-sm border border-border bg-background/60 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                      <TextoComLinks texto={item.texto} />
                    </div>
                    <UsoNaResposta uso={item.calibracao} />
                    {item.quando && <span className="text-[10px] text-muted-foreground">{fmtDataHora(item.quando)}</span>}
                  </div>
                </div>
              ),
            )}
          </div>
        </SecaoPainel>
      </div>
    </PainelLateral>
  );
}

function PainelAgenteLateral({
  agente,
  agentes,
  eventos,
  periodo,
  aoFechar,
  aoAbrirConversa,
  aoVerNoEscritorio,
}: {
  agente?: AgenteCentral;
  agentes: AgenteCentral[];
  eventos: EventoCentral[];
  periodo: string;
  aoFechar: () => void;
  aoAbrirConversa: (id: string) => void;
  aoVerNoEscritorio: () => void;
}) {
  if (!agente) return null;
  const ind = agente.indicadores;
  const recentes = [...agente.conversas].sort((a, b) => (a.parada_ha_s ?? Infinity) - (b.parada_ha_s ?? Infinity));
  return (
    <PainelLateral
      aberto
      aoMudar={(aberto) => !aberto && aoFechar()}
      largura="lg"
      icone={<Bot />}
      rotulo={`Agente · ${agente.area ?? "sem área"}`}
      titulo={agente.nome}
      descricao={`${agente.cargo ?? agente.funcao}${agente.modelo ? ` · ${agente.modelo}` : ""} · encerra após ${agente.minutos_inatividade >= 60 ? `${fmtInt(Math.round(agente.minutos_inatividade / 60))} h` : `${fmtInt(agente.minutos_inatividade)} min`} sem resposta`}
      destaque={
        <IndicadoresPainel
          itens={[
            { rotulo: "Atendendo", valor: fmtInt(ind?.em_atendimento ?? 0), detalhe: `${fmtInt(ind?.conversando_agora ?? 0)} conversando agora`, icone: <Activity /> },
            { rotulo: `Conversas em ${periodo}`, valor: fmtInt(ind?.conversas ?? agente.conversas.length), icone: <MessageSquare /> },
            { rotulo: "Transferência", valor: pct(ind?.transferencia_pct), barra: ind?.transferencia_pct ?? undefined, tom: "alerta", icone: <Percent /> },
            { rotulo: "Resposta média", valor: fmtSegundos(ind?.tempo_medio_resposta_s), icone: <Timer /> },
            {
              rotulo: "Aprovação na Calibração",
              valor: pct(ind?.calibracao_aprovacao),
              detalhe: `${fmtInt(ind?.calibracao_avaliadas ?? 0)} avaliadas`,
              barra: ind?.calibracao_aprovacao ?? undefined,
              tom: "sucesso",
              icone: <Gauge />,
            },
          ]}
        />
      }
      rodape={<BotaoRodape onClick={aoVerNoEscritorio}>Ver no escritório</BotaoRodape>}
    >
      <div className="space-y-6">
        <SecaoPainel titulo="Conversas do período" contagem={recentes.length}>
          <TableWrapper className="max-h-80">
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Msgs</TableHead>
                  <TableHead className="text-right">Atividade</TableHead>
                </tr>
              </TableHeader>
              <tbody>
                {recentes.length === 0 && <TableEmpty colSpan={4}>Nenhuma conversa no período.</TableEmpty>}
                {recentes.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => aoAbrirConversa(c.id)}>
                    <TableCell className="max-w-44 truncate font-medium">{c.nome || "Aluno sem nome"}</TableCell>
                    <TableCell>
                      <SituacaoConversa c={c} />
                    </TableCell>
                    <TableCell numeric>{fmtInt(c.mensagens)}</TableCell>
                    <TableCell numeric className="whitespace-nowrap">{fmtParada(c.parada_ha_s)}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableWrapper>
        </SecaoPainel>
        <SecaoPainel titulo="Acontecimentos recentes">
          <ListaAoVivo
            eventos={eventos.filter((e) => e.agente === agente.id)}
            agentes={agentes}
            aoAbrirConversa={aoAbrirConversa}
            vazio="Nenhum acontecimento desde que o servidor subiu."
            limite={20}
          />
        </SecaoPainel>
      </div>
    </PainelLateral>
  );
}
