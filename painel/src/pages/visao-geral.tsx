import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BookOpenText,
  Bug,
  ChartColumnStacked,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Clock3,
  Coins,
  Flag,
  GitBranch,
  Hourglass,
  Info,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  MessageCircle,
  MessageCircleOff,
  MessageSquareMore,
  MessageSquareText,
  MessagesSquare,
  PauseCircle,
  Quote,
  Radio,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  ThumbsUp,
  Timer,
  UserRoundCog,
  Users,
  Wrench,
} from "lucide-react";
import { api, type DesfechosConversa, type Indicadores } from "@/lib/api";
import { fmtCompacto, fmtDia, fmtInt, fmtPct, fmtSegundos } from "@/lib/formato";
import { agruparPorTema, TIPOS, type TipoTransferencia } from "@/lib/temas-transferencia";
import { cn } from "@/lib/utils";
import { EmptyState, InfoTip, KpiCard, PageHeader, PageLoader, Pills } from "@/components/widgets/widgets";
import { QualidadeComparada } from "@/components/widgets/qualidade-comparada";
import { useCodigoGestao } from "@/lib/gestao";
import { BotaoLinkGestao } from "@/components/widgets/link-gestao";
import { SeletorPeriodo } from "@/components/central/seletor-periodo";
import { DIAS_MAX, consultaPeriodo, rotuloPeriodo, type PeriodoCentral } from "@/lib/periodo-central";

/**
 * Visão geral no padrão do Nexa BI. A régua (o que é atendimento, concluído, retido) é a mesma da Central ao
 * vivo e da tela de Conversas, e está escrita no Dicionário no fim da página.
 *
 * Retenção = atendimentos concluídos que NÃO foram transferidos para um humano ÷ concluídos. A decomposição
 * mostra de onde ela vem: resolvido pelo agente, aluno parou no meio e não respondeu às boas-vindas. A visão
 * "Só quem conversou" tira da conta quem nunca respondeu.
 */

export const PERIODOS = [
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" },
];

// Cor de cada desfecho, a mesma em todos os blocos da página.
const COR = {
  resolvido: "var(--color-success)",
  parou: "var(--color-chart-3)",
  semResposta: "oklch(0.65 0.02 260)",
  transferido: "var(--color-primary)",
  andamento: "var(--color-chart-5)",
  base: "var(--color-accent)",
} as const;

const EIXO = { fontSize: 11, fill: "var(--color-muted-foreground)" };
const GRADE = "color-mix(in oklab, var(--color-foreground) 6%, transparent)";

const NOME_FERRAMENTA: Record<string, string> = {
  consultar_cadastro: "Consultar cadastro do aluno",
  consultar_brindes: "Consultar apostilas e brindes",
  buscar_aula: "Buscar aula",
  delegate_task_to_member: "Passar para outro agente da equipe",
};

const fmtReais = (n: number | null | undefined, casas = 2) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });

function fmtMinutos(min: number | null | undefined) {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  return h < 24 ? `${h.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : `${(h / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`;
}

const taxa = (parte: number, base: number) => (base ? parte / base : null);

/** Variação contra o período anterior: em pontos percentuais (taxas) ou em % (contagens). */
function Variacao({
  atual,
  anterior,
  taxa: emPontos = false,
  melhor = "subir",
}: {
  atual: number | null | undefined;
  anterior: number | null | undefined;
  taxa?: boolean;
  melhor?: "subir" | "descer";
}) {
  // Sem o período anterior (ex.: o agente começou agora), não há com o que comparar: nada aparece.
  if (atual == null || anterior == null || (!emPontos && anterior === 0)) return null;
  const diferenca = emPontos ? (atual - anterior) * 100 : ((atual - anterior) / anterior) * 100;
  if (Math.abs(diferenca) < 0.05) return <span className="text-xs text-muted-foreground">igual ao anterior</span>;
  const subiu = diferenca > 0;
  const bom = subiu === (melhor === "subir");
  const Seta = subiu ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("num inline-flex items-center gap-0.5 text-xs font-semibold", bom ? "text-success" : "text-destructive")} title="Em relação ao período anterior, de mesmo tamanho">
      <Seta className="size-3.5" />
      {subiu ? "+" : "−"}
      {Math.abs(diferenca).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
      {emPontos ? " pp" : "%"}
    </span>
  );
}

export function VisaoGeral() {
  const [dias, setDias] = useState(30);
  // Os números são sempre do conjunto dos agentes (sem filtro de área).
  const q = useQuery({
    queryKey: ["indicadores", dias],
    queryFn: () => api<Indicadores>(`/indicadores?dias=${dias}`),
    refetchInterval: 60_000,
    // Ao trocar o período, os números anteriores ficam na tela (esmaecidos) até os novos chegarem.
    placeholderData: keepPreviousData,
  });
  const trocando = q.isPlaceholderData && q.isFetching;
  const rotuloPeriodo = PERIODOS.find((p) => p.value === dias)?.label ?? `${dias} dias`;

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Visão geral"
        icon={LayoutDashboard}
        description={`Retenção, qualidade e custo do atendimento pelos agentes, com a mesma régua da Central ao vivo${
          q.dataUpdatedAt ? ` · números de ${new Date(q.dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}, atualizados a cada minuto` : ""
        }.`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <BotaoLinkGestao />
            <Pills options={PERIODOS} value={dias} onChange={setDias} rotulo="Período" />
          </div>
        }
      />

      {q.isLoading && <PageLoader className="h-[60vh]" label="Montando o painel" />}
      {q.isError && (
        <div className="surface-card">
          <EmptyState title="Não foi possível carregar os indicadores">{(q.error as Error).message}</EmptyState>
        </div>
      )}
      {trocando && (
        <div className="sticky top-[72px] z-10 mx-auto flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-card/90 px-4 py-1.5 text-xs font-medium shadow-lg backdrop-blur">
          <Loader2 className="size-3.5 animate-spin text-primary-text" />
          Atualizando para {rotuloPeriodo}…
        </div>
      )}
      <div className={cn("space-y-5 transition-opacity", trocando && "pointer-events-none opacity-50")}>
        {q.data && <Conteudo dados={q.data} periodo={rotuloPeriodo} />}
        {/* Fim da página: o agente julgado com a régua do Supervisor, ao lado do atendimento humano. */}
        {q.data && (
          <QualidadeComparada
            dias={dias}
            periodo={rotuloPeriodo}
            cobertura={{ atendimentos: q.data.totais.conversas, conversaram: q.data.totais.com_resposta, abertas: q.data.totais.abertas }}
          />
        )}
        {q.data && <Dicionario dados={q.data} periodo={rotuloPeriodo} />}
      </div>
    </div>
  );
}

/** O link da gestão (pages/gestao.tsx): só os blocos de números, na mesma ordem da Visão geral. */
export function ConteudoGestao({ dados, periodo }: { dados: Indicadores; periodo: string }) {
  if (dados.totais.conversas === 0) {
    return (
      <div className="surface-card has-waves">
        <EmptyState icon={<MessagesSquare className="size-5" />} title="Nenhum atendimento no período" />
      </div>
    );
  }
  return (
    <>
      <Retencao dados={dados} periodo={periodo} />
      <Agora dados={dados} />
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Jornada dados={dados} />
        <PorDia dados={dados} />
      </section>
      <Transferencias dados={dados} periodo={periodo} />
      <Ferramentas dados={dados} periodo={periodo} />
      <Eficiencia dados={dados} />
      <Horario diasPagina={dados.periodo.dias} />
    </>
  );
}

/* ───────── Peças no padrão do Nexa BI ───────── */

function Cabecalho({
  icone: Icone,
  tom = "primary",
  titulo,
  subtitulo,
  ajuda,
  acao,
}: {
  icone: typeof Info;
  tom?: "primary" | "cyan" | "green" | "violet" | "amber";
  titulo: ReactNode;
  subtitulo?: ReactNode;
  ajuda?: ReactNode;
  acao?: ReactNode;
}) {
  const tons = {
    primary: "bg-primary/10 text-primary-text",
    cyan: "bg-accent/14 text-accent",
    green: "bg-success/14 text-success",
    violet: "bg-chart-5/14 text-chart-5",
    amber: "bg-warning/16 text-warning-text",
  };
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", tons[tom])}>
          <Icone className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-base leading-snug font-semibold">
            {titulo}
            {ajuda && <InfoTip>{ajuda}</InfoTip>}
          </div>
          {subtitulo && <div className="mt-0.5 text-xs text-muted-foreground">{subtitulo}</div>}
        </div>
      </div>
      {acao}
    </div>
  );
}

function Segmentado<T extends string>({ opcoes, valor, aoMudar }: { opcoes: [T, string][]; valor: T; aoMudar: (v: T) => void }) {
  return (
    <div role="radiogroup" className="inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-background/40 p-1">
      {opcoes.map(([v, rotulo]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={valor === v}
          onClick={() => aoMudar(v)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            valor === v
              ? "bg-primary text-primary-foreground shadow-[0_4px_14px_-6px_color-mix(in_oklab,var(--color-primary)_80%,transparent)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {rotulo}
        </button>
      ))}
    </div>
  );
}

/** Mini-cartão do Nexa BI: ícone num quadrado, rótulo pequeno em caixa alta e o valor. */
function Mini({ icone: Icone, rotulo, valor, detalhe, tom }: { icone: typeof Info; rotulo: ReactNode; valor: ReactNode; detalhe?: ReactNode; tom: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", tom)}>
        <Icone className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[10px] tracking-wider text-muted-foreground uppercase">{rotulo}</div>
        <div className="num truncate text-sm font-semibold text-foreground">
          {valor} {detalhe && <span className="text-xs font-normal text-muted-foreground">· {detalhe}</span>}
        </div>
      </div>
    </div>
  );
}

function BarraDesfecho({ d, largura = "w-28" }: { d: DesfechosConversa; largura?: string }) {
  const total = d.resolvido + d.parou + d.transferido + d.aberta;
  const partes: [string, number, string][] = [
    ["Resolvido", d.resolvido, COR.resolvido],
    ["Parou", d.parou, COR.parou],
    ["Transferido", d.transferido, COR.transferido],
    ["Aberta", d.aberta, COR.andamento],
  ];
  return (
    <div className={cn("flex h-1.5 overflow-hidden rounded-full bg-muted", largura)} title={partes.map(([r, n]) => `${r} ${n}`).join(" · ")}>
      {total > 0 && partes.map(([r, n, cor]) => n > 0 && <span key={r} className="h-full" style={{ width: `${(n / total) * 100}%`, background: cor }} />)}
    </div>
  );
}

function DicaGrafico({ active, payload, label, formatos }: TooltipProps<number, string> & { formatos?: Record<string, (v: number) => string> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-44 rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-lg">
      <div className="mb-1.5 font-semibold">{typeof label === "string" && label.includes("-") ? fmtDia(label) : label}</div>
      {payload
        .filter((p) => p.value != null)
        .map((p) => (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-sm" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="num font-semibold">{(formatos?.[String(p.dataKey)] ?? fmtInt)(Number(p.value))}</span>
          </div>
        ))}
    </div>
  );
}

/* ───────── Conteúdo ───────── */

function Conteudo({ dados, periodo }: { dados: Indicadores; periodo: string }) {
  const t = dados.totais;
  const a = dados.anterior;

  if (t.conversas === 0 && t.nao_chegaram === 0) {
    return (
      <div className="surface-card has-waves">
        <EmptyState icon={<MessagesSquare className="size-5" />} title="Nenhum atendimento no período">
          Quando alunos (ou a equipe, pelo Chat de teste) conversarem com o agente, os números aparecem aqui.{" "}
          <Link to="/chat" className="font-semibold text-primary-text hover:underline">
            Abrir o Chat de teste
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      {t.nao_chegaram > 0 && (
        <Link
          to="/conversas"
          search={{ status: "nao_chegou" }}
          className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-text hover:bg-warning/15"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            <b>{fmtInt(t.nao_chegaram)}</b> aluno(s) entraram com o agente na Unnichat e o <b>agente ainda não interagiu</b>: o aviso de
            entrada não chegou ao servidor e ninguém mandou as boas-vindas.
          </span>
          <ArrowRight className="ml-auto size-4 shrink-0" />
        </Link>
      )}

      <Retencao dados={dados} periodo={periodo} />
      <Agora dados={dados} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Jornada dados={dados} />
        <PorDia dados={dados} />
      </section>

      <Transferencias dados={dados} periodo={periodo} />
      <Ferramentas dados={dados} periodo={periodo} />

      <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        <KpiCard
          label="Aprovação da equipe"
          value={fmtPct(dados.qualidade.aprovacao_pct)}
          accent="green"
          icon={<ThumbsUp />}
          hint={`${fmtInt(dados.qualidade.avaliadas)} avaliadas`}
          insight={<>Respostas marcadas com 👍 ÷ respostas avaliadas pela equipe no período ({fmtInt(dados.qualidade.positivas)} 👍 · {fmtInt(dados.qualidade.negativas)} 👎).</>}
        />
        <KpiCard
          label="Nota das avaliações automáticas"
          value={dados.qualidade.nota_automatica == null ? "—" : `${dados.qualidade.nota_automatica.toLocaleString("pt-BR")}/10`}
          accent="cyan"
          icon={<BadgeCheck />}
          hint={<SerieMiniatura pontos={dados.qualidade.nota_automatica_serie.map((p) => p.nota)} />}
          insight={<>Média do último dia em que as avaliações automáticas rodaram: casos fixos e os aprovados na Calibração, corrigidos por um juiz de 0 a 10. A linha mostra os dias do período.</>}
        />
        <KpiCard
          label="Respostas sem informação"
          value={fmtPct(t.lacuna_pct)}
          accent="amber"
          icon={<Lightbulb />}
          hint={<Variacao atual={t.lacuna_pct} anterior={a.lacuna_pct} taxa melhor="descer" />}
          insight={<>Respostas em que o agente disse que não tinha a informação ou não achou a aula ÷ respostas do período ({fmtInt(t.respostas_com_lacuna)} de {fmtInt(t.respostas)}). O que falta aparece em Calibração › Lacunas.</>}
        />
        <KpiCard
          label="Confiabilidade das ferramentas"
          value={fmtPct(dados.qualidade.confiabilidade_pct)}
          accent="violet"
          icon={<Wrench />}
          hint={
            dados.qualidade.guardrail > 0 ? (
              <span className="inline-flex items-center gap-1">
                <ShieldAlert className="size-3" /> {fmtInt(dados.qualidade.guardrail)} barradas
              </span>
            ) : undefined
          }
          insight={<>Casos das avaliações automáticas em que o agente usou as ferramentas certas (transferir, consultar o cadastro, buscar aula), no último dia. Junto, os pedidos de manipulação barrados pelo guardrail no período.</>}
        />
      </section>

      <Eficiencia dados={dados} />
      <Horario diasPagina={dados.periodo.dias} />
    </>
  );
}

/* ───────── Taxa de retenção (o card principal, com ondas) ───────── */

function Retencao({ dados, periodo }: { dados: Indicadores; periodo: string }) {
  const [base, setBase] = useState<"todos" | "conversa">("todos");
  const t = dados.totais;
  const d = t.retidas_detalhe;
  const todos = base === "todos";
  const partes = [
    { chave: "resolvido", rotulo: "Resolvido pelo agente", valor: d.encerradas_pelo_agente, icone: CheckCircle2, tom: "bg-success/14 text-success", cor: COR.resolvido },
    { chave: "parou", rotulo: "Aluno parou no meio", valor: d.inatividade, icone: PauseCircle, tom: "bg-chart-3/14 text-chart-3", cor: COR.parou },
    ...(todos
      ? [{ chave: "sem", rotulo: "Não respondeu", valor: d.sem_resposta, icone: MessageCircleOff, tom: "bg-muted text-muted-foreground", cor: COR.semResposta }]
      : []),
    { chave: "transferido", rotulo: "Transferido", valor: t.transferidas, icone: UserRoundCog, tom: "bg-primary/10 text-primary-text", cor: COR.transferido },
  ];
  const total = partes.reduce((s, p) => s + p.valor, 0);
  const retidos = total - t.transferidas;
  const anterior = dados.anterior;
  const taxaAnterior = todos
    ? anterior.retencao_pct
    : taxa(
        anterior.retidas_detalhe.encerradas_pelo_agente + anterior.retidas_detalhe.inatividade,
        anterior.retidas_detalhe.encerradas_pelo_agente + anterior.retidas_detalhe.inatividade + anterior.transferidas,
      );

  return (
    <section className="surface-card has-waves rise relative flex flex-col gap-6 overflow-hidden p-6 lg:p-7" style={{ ["--i" as string]: 0 }}>
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="pulse-live size-2.5 rounded-full bg-success" />
          <span className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Taxa de retenção · {periodo}</span>
          <InfoTip>
            <b>Atendimentos concluídos que não foram transferidos para um humano</b> ÷ atendimentos concluídos. Concluído = resolvido pelo
            agente, aluno parou de responder, não respondeu às boas-vindas em 23 h ou transferido. Os em andamento ficam fora até terminar.
            “Só quem conversou” tira da conta quem nunca respondeu às boas-vindas.
          </InfoTip>
        </div>
        <Segmentado
          opcoes={[
            ["todos", "Todos os atendimentos"],
            ["conversa", "Só quem conversou"],
          ]}
          valor={base}
          aoMudar={setBase}
        />
      </div>

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
        <div className="shrink-0">
          <div className="flex items-end gap-3">
            <span className="num text-gradient-brand text-5xl leading-none font-bold tracking-tight lg:text-6xl">{fmtPct(taxa(retidos, total))}</span>
            <span className="mb-1.5">
              <Variacao atual={taxa(retidos, total)} anterior={taxaAnterior} taxa />
            </span>
          </div>
          <div className="mt-3 text-sm">
            <span className="num font-semibold">{fmtInt(retidos)}</span> de <span className="num font-semibold">{fmtInt(total)}</span>{" "}
            {todos ? "atendimentos concluídos" : "conversas concluídas"} sem humano
          </div>
          {todos ? (
            <div className="num mt-1 text-xs text-muted-foreground">
              {fmtInt(t.conversas)} atendimentos = {fmtInt(t.terminadas)} concluídos + {fmtInt(t.em_andamento)} em andamento
            </div>
          ) : (
            <div className="num mt-1 text-xs text-muted-foreground">
              {fmtInt(t.conversas)} atendimentos = {fmtInt(total)} conversas concluídas + {fmtInt(t.abertas)} abertas +{" "}
              {fmtInt(t.conversas - total - t.abertas)} só boas-vindas (fora desta conta)
            </div>
          )}
          <div className="mt-0.5 text-xs text-muted-foreground">
            Os cards ao lado somam os {fmtInt(total)} {todos ? "concluídos" : "concluídos que conversaram"} de {periodo}; os em andamento entram quando terminarem.
          </div>
        </div>
        <div className={cn("grid w-full grid-cols-2 gap-2.5 lg:max-w-[600px]", !todos && "sm:grid-cols-3")}>
          {partes.map((p) => (
            <Mini key={p.chave} icone={p.icone} rotulo={p.rotulo} valor={fmtInt(p.valor)} detalhe={fmtPct(taxa(p.valor, total))} tom={p.tom} />
          ))}
        </div>
      </div>

      <div className="relative">
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          {total > 0 &&
            partes.map((p) => p.valor > 0 && <div key={p.chave} className="h-full transition-[width] duration-500" style={{ width: `${(p.valor / total) * 100}%`, background: p.cor }} />)}
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>retidos, sem humano</span>
          <span>transferidos</span>
        </div>
      </div>
    </section>
  );
}

/* ───────── Agora: os mesmos números da barra da Central ao vivo ───────── */

function Agora({ dados }: { dados: Indicadores }) {
  const g = dados.agora;
  const gestao = useCodigoGestao();
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <span className="pulse-live size-2 rounded-full bg-success" />
        <span className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Agora · mesma régua da Central ao vivo</span>
        {!gestao && (
          <a href="/painel/central" target="_blank" rel="noopener" className="ml-auto flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline">
            Abrir a Central <ArrowRight className="size-3.5" />
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          className="rise"
          style={{ ["--i" as string]: 1 }}
          label="Atendendo agora"
          count={g.atendendo_agora}
          accent="green"
          icon={<MessageSquareMore />}
          hint="últimos 15 min"
          insight={<>Conversas abertas com mensagem do aluno ou do agente nos últimos 15 minutos: quem está na mesa do escritório da Central.</>}
        />
        <KpiCard
          className="rise"
          style={{ ["--i" as string]: 2 }}
          label="Aguardando as boas-vindas"
          count={g.aguardando_boas_vindas}
          accent="cyan"
          icon={<Send />}
          hint="dentro de 23 h"
          insight={<>O agente mandou as boas-vindas e o aluno ainda não escreveu. Passado o prazo de inatividade, o atendimento é concluído como “não respondeu”.</>}
        />
        <KpiCard
          className="rise"
          style={{ ["--i" as string]: 3 }}
          label="Conversas abertas paradas"
          count={g.abertas_paradas}
          accent="violet"
          icon={<Hourglass />}
          hint={g.abertas_fora_do_prazo > 0 ? `${fmtInt(g.abertas_fora_do_prazo)} fora do prazo` : "esperando o aluno"}
          insight={
            <>
              O aluno conversou e não escreve há mais de 15 minutos, sem a conversa terminar. As que passaram do prazo de inatividade já
              deveriam ter sido encerradas pela rotina: vale conferir em Observabilidade.
            </>
          }
        />
        <KpiCard
          className="rise"
          style={{ ["--i" as string]: 4 }}
          label="Aviso de entrada não chegou"
          count={dados.totais.nao_chegaram}
          accent="amber"
          icon={<AlertTriangle />}
          hint="ação manual"
          insight={<>A Unnichat colocou o aluno com o agente, mas o aviso não chegou ao servidor e ninguém mandou as boas-vindas. Fica fora de todas as taxas.</>}
        />
      </div>
    </section>
  );
}

/* ───────── Jornada: para onde foi cada atendimento, em dois ramos ───────── */

type Fatia = { nome: string; cor: string; total: number; nota?: string };

/** Uma barra só, dividida na proporção de cada fatia. */
function BarraDividida({ fatias, total, alta = false }: { fatias: Fatia[]; total: number; alta?: boolean }) {
  return (
    <div className={cn("flex w-full gap-0.5 overflow-hidden rounded-md bg-muted", alta ? "h-4" : "h-2.5")}>
      {fatias
        .filter((f) => f.total > 0)
        .map((f) => (
          <div
            key={f.nome}
            title={`${f.nome}: ${fmtInt(f.total)} (${fmtPct(taxa(f.total, total))})`}
            className="h-full transition-[width] duration-500"
            style={{ width: `${(f.total / Math.max(1, total)) * 100}%`, background: f.cor }}
          />
        ))}
    </div>
  );
}

function Ramo({ titulo, total, de, fatias }: { titulo: string; total: number; de: number; fatias: Fatia[] }) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/15 p-3.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">{titulo}</span>
        <span className="num text-[13px] font-bold">
          {fmtInt(total)} <span className="text-[11px] font-normal text-muted-foreground">· {fmtPct(taxa(total, de))} do total</span>
        </span>
      </div>
      <BarraDividida fatias={fatias} total={total} />
      <ul className="mt-2.5 space-y-1.5">
        {fatias.map((f) => (
          <li key={f.nome} className="grid grid-cols-[auto_minmax(0,1fr)_auto_3rem] items-center gap-2 text-xs">
            <span className="size-2.5 rounded-sm" style={{ background: f.cor }} />
            <span className="min-w-0">
              {f.nome}
              {f.nota && <span className="block text-[10.5px] leading-tight text-muted-foreground">{f.nota}</span>}
            </span>
            <span className="num font-semibold">{fmtInt(f.total)}</span>
            <span className="num text-right text-muted-foreground">{fmtPct(taxa(f.total, total))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Jornada({ dados }: { dados: Indicadores }) {
  const t = dados.totais;
  const d = t.retidas_detalhe;
  // As mesmas categorias do bloco "Agora" e da Central. Os totais fecham: atendimentos = só boas-vindas + conversou.
  const boasVindas: Fatia[] = [
    { nome: "Não respondeu", cor: COR.semResposta, total: d.sem_resposta, nota: "passou de 23 h sem escrever" },
    { nome: "Aguardando o aluno", cor: COR.andamento, total: t.aguardando_boas_vindas, nota: "ainda dentro das 23 h" },
  ];
  const conversa: Fatia[] = [
    { nome: "Resolvido pelo agente", cor: COR.resolvido, total: d.encerradas_pelo_agente },
    { nome: "Aluno parou no meio", cor: COR.parou, total: d.inatividade },
    { nome: "Transferido para humano", cor: COR.transferido, total: t.transferidas },
    { nome: "Conversa aberta", cor: COR.andamento, total: t.abertas, nota: "ainda em andamento" },
  ];
  const soBoasVindas = boasVindas.reduce((s, f) => s + f.total, 0);
  const conversou = conversa.reduce((s, f) => s + f.total, 0);
  const ramos: Fatia[] = [
    { nome: "Conversou com o agente", cor: COR.base, total: conversou },
    { nome: "Só recebeu as boas-vindas", cor: COR.semResposta, total: soBoasVindas },
  ];

  return (
    <div className="surface-card rise p-4 md:p-5" style={{ ["--i" as string]: 11 }}>
      <Cabecalho
        icone={GitBranch}
        tom="cyan"
        titulo="Para onde foi cada atendimento"
        subtitulo="Primeiro, se o aluno conversou; depois, como terminou"
        ajuda={
          <>
            As mesmas categorias do bloco “Agora” e da Central. Em andamento = {fmtInt(t.aguardando_boas_vindas)} aguardando o aluno +{" "}
            {fmtInt(t.abertas)} conversas abertas = {fmtInt(t.em_andamento)}; entram nas taxas quando terminarem.
          </>
        }
      />
      {t.conversas === 0 ? (
        <EmptyState title="Sem atendimentos para mostrar" className="py-10" />
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="num text-3xl font-bold tracking-tight">{fmtInt(t.conversas)}</span>
              <span className="text-sm text-muted-foreground">atendimentos no período</span>
            </div>
            <BarraDividida fatias={ramos} total={t.conversas} alta />
            <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 text-[11px] text-muted-foreground">
              {ramos.map((r) => (
                <span key={r.nome} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm" style={{ background: r.cor }} />
                  {r.nome} <b className="num text-foreground">{fmtPct(taxa(r.total, t.conversas))}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Ramo titulo="Conversou com o agente" total={conversou} de={t.conversas} fatias={conversa} />
            <Ramo titulo="Só recebeu as boas-vindas" total={soBoasVindas} de={t.conversas} fatias={boasVindas} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── Atendimentos por dia: quantidade ou retenção, um de cada vez ───────── */

const SERIES_DIA = [
  { chave: "encerradas_pelo_agente", rotulo: "Resolvido pelo agente", cor: COR.resolvido },
  { chave: "inatividade", rotulo: "Aluno parou", cor: COR.parou },
  { chave: "transferidas", rotulo: "Transferido", cor: COR.transferido },
  { chave: "sem_resposta", rotulo: "Não respondeu às boas-vindas", cor: COR.semResposta },
  { chave: "em_andamento", rotulo: "Em andamento", cor: COR.andamento },
] as const;

/** Retidos e transferidos do dia, em números absolutos. */
const SERIES_RETENCAO = [
  { chave: "retidas", rotulo: "Retidos (sem humano)", cor: COR.resolvido },
  { chave: "transferidas", rotulo: "Transferidos para humano", cor: COR.transferido },
] as const;

function DicaRetencao({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as { retidas: number; transferidas: number; concluidos: number };
  return (
    <div className="min-w-48 rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-lg">
      <div className="mb-1.5 font-semibold">{typeof label === "string" ? fmtDia(label) : label}</div>
      {SERIES_RETENCAO.map((s) => (
        <div key={s.chave} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-sm" style={{ background: s.cor }} />
            {s.rotulo}
          </span>
          <span className="num font-semibold">{fmtInt(p[s.chave])}</span>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between gap-4 border-t border-border/50 pt-1">
        <span className="text-muted-foreground">Concluídos</span>
        <span className="num font-semibold">{fmtInt(p.concluidos)}</span>
      </div>
    </div>
  );
}

function PorDia({ dados }: { dados: Indicadores }) {
  const [vista, setVista] = useState<"quantidade" | "retencao">("quantidade");
  // Os dias antes do primeiro atendimento só achatam o gráfico: começa no primeiro dia com movimento.
  const primeiro = dados.serie.findIndex((s) => s.total > 0);
  const serie = (primeiro < 0 ? [] : dados.serie.slice(primeiro)).map((s) => {
    return { ...s, concluidos: s.retidas + s.transferidas };
  });

  return (
    <div className="surface-card rise p-4 md:p-5" style={{ ["--i" as string]: 12 }}>
      <Cabecalho
        icone={ChartColumnStacked}
        titulo="Atendimentos por dia"
        subtitulo={
          vista === "quantidade"
            ? "Quantos começaram em cada dia e como estão hoje"
            : "Concluídos de cada dia: quantos ficaram com o agente e quantos foram para um humano"
        }
        acao={
          <Segmentado
            opcoes={[
              ["quantidade", "Quantidade"],
              ["retencao", "Retenção"],
            ]}
            valor={vista}
            aoMudar={setVista}
          />
        }
      />
      {serie.length === 0 ? (
        <EmptyState title="Sem atendimentos no período" className="py-10" />
      ) : vista === "quantidade" ? (
        <>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRADE} strokeDasharray="3 3" />
                <XAxis dataKey="dia" tickFormatter={fmtDia} tick={EIXO} axisLine={false} tickLine={false} minTickGap={18} />
                <YAxis allowDecimals={false} tick={EIXO} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => fmtInt(v)} />
                <Tooltip content={<DicaGrafico />} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} />
                {SERIES_DIA.map((s, i) => (
                  <Bar
                    key={s.chave}
                    dataKey={s.chave}
                    name={s.rotulo}
                    stackId="dia"
                    fill={s.cor}
                    radius={i === SERIES_DIA.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    maxBarSize={28}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {SERIES_DIA.map((s) => (
              <span key={s.chave} className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: s.cor }} />
                {s.rotulo}
              </span>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie} margin={{ top: 18, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRADE} strokeDasharray="3 3" />
                <XAxis dataKey="dia" tickFormatter={fmtDia} tick={EIXO} axisLine={false} tickLine={false} minTickGap={18} />
                <YAxis allowDecimals={false} tick={EIXO} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => fmtInt(v)} />
                <Tooltip content={<DicaRetencao />} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} />
                {SERIES_RETENCAO.map((s, i) => (
                  <Bar
                    key={s.chave}
                    dataKey={s.chave}
                    name={s.rotulo}
                    stackId="concluidos"
                    fill={s.cor}
                    radius={i === SERIES_RETENCAO.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    maxBarSize={28}
                  >
                    {i === SERIES_RETENCAO.length - 1 && (
                      <LabelList
                        dataKey="concluidos"
                        position="top"
                        formatter={(v: number) => (v > 0 ? fmtInt(v) : "")}
                        style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                      />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {SERIES_RETENCAO.map((s) => (
              <span key={s.chave} className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: s.cor }} />
                {s.rotulo}
              </span>
            ))}
            <span>· o número em cima é o total de concluídos do dia</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ───────── Transferências: o que dá para evitar ───────── */

const TOM_TIPO: Record<TipoTransferencia, { classe: string; cor: string; icone: typeof Info }> = {
  evitavel: { classe: "bg-success/14 text-success", cor: COR.resolvido, icone: Wrench },
  correta: { classe: "bg-accent/14 text-accent", cor: "var(--color-accent)", icone: CircleCheck },
  produto: { classe: "bg-warning/16 text-warning-text", cor: "var(--color-warning)", icone: Bug },
  revisar: { classe: "bg-muted text-muted-foreground", cor: COR.semResposta, icone: Search },
};

function Transferencias({ dados, periodo }: { dados: Indicadores; periodo: string }) {
  const [aba, setAba] = useState<"tema" | "categoria">("tema");
  const [aberto, setAberto] = useState(0);
  const gestao = useCodigoGestao();
  const grupos = agruparPorTema(dados.transferencias);
  const total = dados.transferencias.length;
  const max = Math.max(1, ...grupos.map((g) => g.total));
  const porTipo = (Object.keys(TIPOS) as TipoTransferencia[]).map((tipo) => ({
    tipo,
    total: grupos.filter((g) => g.tema.tipo === tipo).reduce((s, g) => s + g.total, 0),
  }));
  const maxCategoria = Math.max(1, ...dados.categorias.map((c) => c.total));

  return (
    <section className="surface-card rise p-4 md:p-6" style={{ ["--i" as string]: 13 }}>
      <Cabecalho
        icone={UserRoundCog}
        titulo="Transferências: o que dá para evitar"
        subtitulo={`${fmtInt(total)} transferências em ${periodo}, agrupadas pelo motivo que o agente registrou`}
        ajuda={
          <>
            O agente escolhe uma categoria e escreve o motivo ao transferir. A categoria sozinha esconde o problema, então os motivos são agrupados
            por tema. <b>Evitável</b>: o agente resolveria com uma ferramenta ou conteúdo novo. <b>Correta</b>: precisa de uma pessoa.{" "}
            <b>Produto</b>: defeito da plataforma.
          </>
        }
        acao={
          <Segmentado
            opcoes={[
              ["tema", "Por tema"],
              ["categoria", "Por categoria do agente"],
            ]}
            valor={aba}
            aoMudar={setAba}
          />
        }
      />

      {total === 0 ? (
        <EmptyState title="Nenhuma transferência" className="py-8">
          O agente resolveu tudo sem passar para a equipe neste período.
        </EmptyState>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
            {porTipo.map(({ tipo, total: n }) => (
              <Mini key={tipo} icone={TOM_TIPO[tipo].icone} rotulo={TIPOS[tipo].rotulo} valor={fmtInt(n)} detalhe={fmtPct(taxa(n, total))} tom={TOM_TIPO[tipo].classe} />
            ))}
          </div>

          {/* Rolagem própria: com muitos temas abertos o card não cresce além da tela. */}
          <div className="thin-scroll -mr-2 max-h-[420px] overflow-y-auto pr-2">
          {aba === "tema" ? (
            <ul className="divide-y divide-border/40">
              {grupos.map((g, i) => {
                const tom = TOM_TIPO[g.tema.tipo];
                const aberta = aberto === i;
                return (
                  <li key={g.tema.id} className="py-2.5">
                    <button type="button" onClick={() => setAberto(aberta ? -1 : i)} aria-expanded={aberta} className="w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", aberta && "rotate-90")} />
                        <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase", tom.classe)}>{TIPOS[g.tema.tipo].rotulo}</span>
                        <span className="font-medium">{g.tema.rotulo}</span>
                        <span className="hidden text-[11px] text-muted-foreground lg:inline">{g.categorias.map((c) => `${c.rotulo} ${c.total}`).join(" · ")}</span>
                        <span className="num ml-auto font-semibold">{fmtInt(g.total)}</span>
                        <span className="num w-12 text-right text-xs text-muted-foreground">{fmtPct(taxa(g.total, total))}</span>
                      </div>
                      <div className="mt-1.5 ml-6 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${(g.total / max) * 100}%`, background: tom.cor }} />
                      </div>
                    </button>
                    {aberta && (
                      <div className={cn("mt-3 ml-6 grid gap-2.5", !gestao && "md:grid-cols-2")}>
                        {!gestao && (
                        <div className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
                          <div className="mb-1 flex items-center gap-1.5 text-[10px] tracking-wider text-muted-foreground uppercase">
                            <Quote className="size-3" /> Motivos registrados
                          </div>
                          <ul className="space-y-1 text-xs leading-relaxed text-foreground/85 italic">
                            {g.exemplos.length ? g.exemplos.map((m, k) => <li key={k}>“{m}”</li>) : <li>Sem motivo escrito.</li>}
                          </ul>
                        </div>
                        )}
                        <div className="rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5">
                          <div className="mb-1 flex items-center gap-1.5 text-[10px] tracking-wider text-primary-text uppercase">
                            <Lightbulb className="size-3" /> O que fazer
                          </div>
                          <div className="text-xs leading-relaxed">{g.tema.acao}</div>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="space-y-3">
              {dados.categorias.map((c) => (
                <li key={c.categoria}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{c.rotulo}</span>
                    <span>
                      <span className="num font-semibold">{fmtInt(c.total)}</span>
                      <span className="num ml-2 text-xs text-muted-foreground">{fmtPct(taxa(c.total, total))}</span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(c.total / maxCategoria) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          </div>
        </>
      )}
    </section>
  );
}

/* ───────── Uso de ferramentas ───────── */

function Ferramentas({ dados, periodo }: { dados: Indicadores; periodo: string }) {
  const t = dados.totais;
  const conversas = t.consulta.com.conversas + t.consulta.sem.conversas;
  const chamadas = t.ferramentas.reduce((s, f) => s + f.chamadas, 0);
  const erros = t.ferramentas.reduce((s, f) => s + f.erros, 0);
  const resolucao = (g: DesfechosConversa) => taxa(g.resolvido, g.resolvido + g.parou + g.transferido);
  const transferencia = (g: DesfechosConversa) => taxa(g.transferido, g.resolvido + g.parou + g.transferido);
  const cadastro = t.ferramentas.find((f) => f.ferramenta === "consultar_cadastro");

  return (
    <section className="surface-card rise p-4 md:p-6" style={{ ["--i" as string]: 14 }}>
      <Cabecalho
        icone={Wrench}
        tom="violet"
        titulo="Uso de ferramentas"
        subtitulo={`Consultas que o agente faz para responder · ${periodo} · sem transferir e encerrar, que são desfechos`}
        ajuda="Chamadas que o agente fez durante as respostas: consultar o cadastro do aluno, as apostilas e brindes, buscar uma aula ou passar para outro agente da equipe."
      />
      <div className="mb-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Mini icone={MessageSquareText} rotulo="Respostas com consulta" valor={fmtPct(taxa(t.respostas_com_consulta, t.respostas))} detalhe={`${fmtInt(t.respostas_com_consulta)} de ${fmtInt(t.respostas)}`} tom="bg-chart-5/14 text-chart-5" />
        <Mini icone={Users} rotulo="Conversas com consulta" valor={fmtPct(taxa(t.consulta.com.conversas, conversas))} detalhe={`${fmtInt(t.consulta.com.conversas)} de ${fmtInt(conversas)}`} tom="bg-chart-5/14 text-chart-5" />
        <Mini icone={CircleAlert} rotulo="Chamadas com erro" valor={fmtInt(erros)} detalhe={`de ${fmtInt(chamadas)}`} tom={erros ? "bg-destructive/14 text-destructive" : "bg-chart-5/14 text-chart-5"} />
        <Mini icone={Timer} rotulo="Consulta ao cadastro" valor={fmtSegundos(cadastro?.duracao_media_s)} detalhe="tempo médio" tom="bg-chart-5/14 text-chart-5" />
      </div>

      {t.ferramentas.length === 0 ? (
        <EmptyState title="Nenhuma consulta no período" className="py-6" />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[11px] tracking-wider text-muted-foreground uppercase">
                  <th className="py-2 pr-3 text-left font-medium">Ferramenta</th>
                  <th className="px-3 py-2 text-right font-medium">Chamadas</th>
                  <th className="px-3 py-2 text-right font-medium">Conversas</th>
                  <th className="px-3 py-2 text-left font-medium">Como terminaram</th>
                  <th className="py-2 pl-3 text-right font-medium">Resolvidas</th>
                </tr>
              </thead>
              <tbody>
                {t.ferramentas.map((f) => {
                  const r = resolucao(f);
                  return (
                    <tr key={f.ferramenta} className="border-b border-border/40 transition-colors last:border-0 hover:bg-muted/40">
                      <td className="py-2.5 pr-3">
                        <div>{NOME_FERRAMENTA[f.ferramenta] ?? f.ferramenta}</div>
                        <div className="num text-[11px] text-muted-foreground">{f.ferramenta}</div>
                      </td>
                      <td className="num px-3 py-2.5 text-right font-semibold">{fmtInt(f.chamadas)}</td>
                      <td className="num px-3 py-2.5 text-right">
                        {fmtInt(f.conversas)} <span className="text-xs text-muted-foreground">· {fmtPct(taxa(f.conversas, conversas))}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <BarraDesfecho d={f} />
                      </td>
                      <td className={cn("num py-2.5 pl-3 text-right font-semibold", r != null && r >= 0.6 && "text-success")}>{fmtPct(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {[
                ["Resolvido", COR.resolvido],
                ["Parou", COR.parou],
                ["Transferido", COR.transferido],
                ["Aberta", COR.andamento],
              ].map(([r, cor]) => (
                <span key={r} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm" style={{ background: cor }} />
                  {r}
                </span>
              ))}
              <span>· Resolvidas = resolvidas ÷ concluídas</span>
            </div>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
            <div className="mb-3 text-[10px] tracking-wider text-muted-foreground uppercase">Conversas com e sem consulta</div>
            {(
              [
                ["Com consulta", t.consulta.com],
                ["Sem consulta", t.consulta.sem],
              ] as const
            ).map(([rotulo, g]) => (
              <div key={rotulo} className="mb-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{rotulo}</span>
                  <span className="num text-xs text-muted-foreground">{fmtInt(g.conversas)} conversas</span>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-background/40 px-2.5 py-1.5">
                    <div className="text-[10px] text-muted-foreground">Resolvidas pelo agente</div>
                    <div className="num text-base font-bold text-success">{fmtPct(resolucao(g))}</div>
                  </div>
                  <div className="rounded-lg bg-background/40 px-2.5 py-1.5">
                    <div className="text-[10px] text-muted-foreground">Transferidas</div>
                    <div className="num text-base font-bold text-primary-text">{fmtPct(transferencia(g))}</div>
                  </div>
                </div>
              </div>
            ))}
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" />
              <span>O agente consulta justamente nos casos difíceis (acesso, compra). A diferença mostra o tipo de caso, não que a consulta piora o atendimento.</span>
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/* ───────── Horário, eficiência e últimas transferências ───────── */

type PorHora = { desde: number; ate: number | null; total_alunos: number; total_mensagens: number; alunos: number[]; mensagens: number[] };

/** Quando os alunos conversam: alunos diferentes por hora do dia, com o mesmo filtro de período da Central. */
function Horario({ diasPagina }: { diasPagina: number }) {
  const gestao = useCodigoGestao();
  const [periodo, setPeriodo] = useState<PeriodoCentral>({ tipo: "horas", horas: Math.min(diasPagina, DIAS_MAX) * 24 });
  const consulta = consultaPeriodo(periodo);
  const q = useQuery({
    queryKey: ["indicadores-por-hora", consulta, gestao],
    queryFn: () => api<PorHora>(gestao ? `/gestao/${encodeURIComponent(gestao)}/por-hora?${consulta}` : `/indicadores/por-hora?${consulta}`),
    placeholderData: (anterior) => anterior,
  });
  const valores = q.data?.alunos ?? [];
  const max = Math.max(0, ...valores);
  const pico = valores.indexOf(max);
  const serie = valores.map((n, h) => ({ hora: `${h}h`, n }));
  const mensagens = q.data?.mensagens ?? [];
  const foraDoHorario = mensagens.reduce((s, n, h) => (h >= 20 || h < 8 ? s + n : s), 0);

  return (
    <section className="surface-card rise p-4 md:p-6" style={{ ["--i" as string]: 15 }}>
      <Cabecalho
        icone={Clock3}
        tom="violet"
        titulo="Quando os alunos conversam"
        subtitulo={`${rotuloPeriodo(periodo)} · hora de Brasília · alunos diferentes que escreveram ao agente em cada hora`}
        acao={<SeletorPeriodo periodo={periodo} aoMudar={setPeriodo} />}
      />
      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Mini
          icone={Users}
          rotulo="Alunos que conversaram"
          valor={q.data ? fmtInt(q.data.total_alunos) : "—"}
          detalhe={q.data ? `${fmtInt(q.data.total_mensagens)} mensagens` : undefined}
          tom="bg-chart-5/14 text-chart-5"
        />
        <Mini icone={Clock3} rotulo="Hora de pico" valor={max > 0 ? `${pico}h–${pico + 1}h` : "—"} detalhe={max > 0 ? `${fmtInt(max)} alunos` : undefined} tom="bg-chart-5/14 text-chart-5" />
        <Mini
          icone={MessageSquareText}
          rotulo="Mensagens fora do horário (20h–8h)"
          valor={fmtPct(taxa(foraDoHorario, q.data?.total_mensagens ?? 0))}
          detalhe="sem equipe humana"
          tom="bg-chart-5/14 text-chart-5"
        />
      </div>
      <div className={cn("h-56", q.isFetching && "opacity-70")}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={serie} margin={{ top: 6, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRADE} strokeDasharray="3 3" />
            <XAxis dataKey="hora" tick={EIXO} axisLine={false} tickLine={false} interval={1} />
            <YAxis allowDecimals={false} tick={EIXO} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtInt(v)} />
            <Tooltip content={<DicaGrafico />} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} />
            <Bar dataKey="n" name="Alunos" radius={[4, 4, 0, 0]}>
              {serie.map((s) => (
                <Cell key={s.hora} fill={s.n === max && max > 0 ? "var(--color-chart-1)" : "color-mix(in oklab, var(--color-accent) 70%, transparent)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Cada aluno conta uma vez por hora em que escreveu. Por isso a soma das barras pode passar do total de alunos: quem escreveu às 10h e às 15h aparece nas duas.
      </p>
    </section>
  );
}

function Eficiencia({ dados }: { dados: Indicadores }) {
  const t = dados.totais;
  const itens: [typeof Info, string, string, string][] = [
    [Timer, "Tempo de resposta", fmtSegundos(t.tempo_modelo_s), `média · p90 ${fmtSegundos(t.tempo_resposta_p90_s)}`],
    [Clock, "Duração da conversa", fmtMinutos(t.duracao_mediana_min), "mediana, do início à última mensagem"],
    [MessageCircle, "Mensagens por conversa", t.mensagens_por_conversa == null ? "—" : t.mensagens_por_conversa.toLocaleString("pt-BR"), `${fmtInt(t.respostas)} respostas`],
    [
      Coins,
      t.custo_configurado ? "Custo por conversa" : "Tokens por conversa",
      t.custo_configurado ? fmtReais(t.custo_por_conversa, 3) : fmtCompacto(t.com_resposta ? (t.tokens_entrada + t.tokens_saida) / t.com_resposta : null),
      t.custo_configurado
        ? `${fmtReais(t.custo_reais)} no período`
        : `${fmtCompacto(t.tokens_entrada + t.tokens_saida)} no período · sem preço configurado`,
    ],
  ];
  return (
    <section className="surface-card rise p-4 md:p-5" style={{ ["--i" as string]: 16 }}>
      <Cabecalho icone={Timer} tom="cyan" titulo="Eficiência" subtitulo="Quanto tempo e quanto do modelo cada atendimento usa" />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {itens.map(([Icone, rotulo, valor, detalhe]) => (
          <div key={rotulo} className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] tracking-wider text-muted-foreground uppercase">
              <Icone className="size-3.5" />
              {rotulo}
            </div>
            <div className="num mt-1 text-lg font-bold">{valor}</div>
            <div className="text-[11px] text-muted-foreground">{detalhe}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────── Dicionário: a régua, com as contas feitas com os números do período ───────── */

function Dicionario({ dados, periodo }: { dados: Indicadores; periodo: string }) {
  const t = dados.totais;
  const d = t.retidas_detalhe;
  const conversou = d.encerradas_pelo_agente + d.inatividade + t.transferidas;
  const grupos: [string, typeof Info, [string, string, string, string][]][] = [
    [
      "Volume",
      MessagesSquare,
      [
        ["Atendimentos", "Quantos alunos o agente recebeu?", `${fmtInt(t.conversas - t.com_resposta)} só boas-vindas + ${fmtInt(t.com_resposta)} conversaram = ${fmtInt(t.conversas)}`, "Aviso de entrada que não chegou (fica em “Agora”)."],
        ["Alunos que conversaram", "A mensagem de boas-vindas engaja?", `${fmtInt(t.com_resposta)} ÷ ${fmtInt(t.conversas)} atendimentos = ${fmtPct(taxa(t.com_resposta, t.conversas))}`, "Quem só recebeu as boas-vindas."],
      ],
    ],
    [
      "Desfecho",
      Flag,
      [
        ["Concluído", "Quais atendimentos já têm resultado?", `${fmtInt(t.conversas)} atendimentos − ${fmtInt(t.em_andamento)} em andamento = ${fmtInt(t.terminadas)}`, "Boas-vindas ainda no prazo e conversas abertas."],
        ["Taxa de retenção", "Quanto o agente resolve sem a equipe?", `${fmtInt(t.retidas)} não transferidos ÷ ${fmtInt(t.terminadas)} concluídos = ${fmtPct(t.retencao_pct)}`, "Em andamento. Em “Só quem conversou”, também quem não respondeu."],
        ["Transferência", "Quanto vai para a equipe?", `${fmtInt(t.transferidas)} ÷ ${fmtInt(t.terminadas)} concluídos = ${fmtPct(t.transferencia_pct)}`, "Em andamento. Retenção + transferência = 100%."],
        ["Resolvido pelo agente", "Em quantos o agente fechou o assunto?", `${fmtInt(d.encerradas_pelo_agente)} ÷ ${fmtInt(conversou)} que conversaram = ${fmtPct(taxa(d.encerradas_pelo_agente, conversou))}`, "Quem parou de responder no meio (é “aluno parou”)."],
        ["Aluno parou no meio", "Quantos abandonaram a conversa?", `${fmtInt(d.inatividade)} encerrados por inatividade depois de conversar`, "Quem nunca respondeu às boas-vindas."],
      ],
    ],
    [
      "Agora",
      Radio,
      [
        ["Atendendo agora", "Há alguém sendo atendido neste momento?", "Conversa aberta com mensagem nos últimos 15 min (a mesa do escritório da Central)", "Conversas paradas e boas-vindas aguardando."],
        ["Conversas abertas paradas", "Quantas conversas esperam o aluno?", "O aluno conversou e não escreve há mais de 15 min", "Boas-vindas sem resposta."],
      ],
    ],
    [
      "Ferramentas",
      Wrench,
      [
        ["Respostas com consulta", "Quanto o agente depende de dados para responder?", `${fmtInt(t.respostas_com_consulta)} ÷ ${fmtInt(t.respostas)} respostas = ${fmtPct(taxa(t.respostas_com_consulta, t.respostas))}`, "Transferir e encerrar (são desfechos)."],
        ["Resolvidas por ferramenta", "A consulta ajuda a resolver?", "Conversas que usaram a ferramenta e foram resolvidas ÷ concluídas", "Conversas abertas."],
      ],
    ],
    [
      "Velocidade e qualidade",
      ShieldCheck,
      [
        ["Tempo de resposta", "O aluno espera muito?", `Média ${fmtSegundos(t.tempo_modelo_s)} · p90 ${fmtSegundos(t.tempo_resposta_p90_s)}`, "A espera proposital para juntar mensagens seguidas."],
        ["Nota automática", "As respostas estão corretas?", "Média diária das notas de 0 a 10 do avaliador nos casos de teste", "Conversas reais (avaliadas pela equipe na Calibração)."],
      ],
    ],
  ];
  return (
    <section className="surface-card rise p-4 md:p-6" style={{ ["--i" as string]: 18 }}>
      <Cabecalho
        icone={BookOpenText}
        titulo="Dicionário das métricas"
        subtitulo={`O painel, a Central e Conversas usam exatamente estas definições · contas com os números de ${periodo} · fonte: ${
          dados.fonte === "views" ? "views do banco (agente_metricas.vw_atendimentos)" : "cálculo do servidor"
        }`}
      />
      <div className="space-y-5">
        {grupos.map(([nome, Icone, linhas]) => (
          <div key={nome}>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
              <Icone className="size-3.5 text-primary-text" />
              {nome}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-[10.5px] tracking-wider text-muted-foreground/80 uppercase">
                    <th className="w-[19%] py-1.5 pr-4 text-left font-medium">Métrica</th>
                    <th className="w-[24%] py-1.5 pr-4 text-left font-medium">Responde</th>
                    <th className="py-1.5 pr-4 text-left font-medium">Conta</th>
                    <th className="w-[24%] py-1.5 text-left font-medium">Não entra</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(([metrica, pergunta, conta, fora]) => (
                    <tr key={metrica} className="border-b border-border/30 align-top transition-colors hover:bg-muted/30">
                      <td className="py-2.5 pr-4 font-semibold">{metrica}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{pergunta}</td>
                      <td className="py-2.5 pr-4">
                        <span className="num rounded-md bg-muted/40 px-1.5 py-0.5 text-xs">{conta}</span>
                      </td>
                      <td className="py-2.5 text-xs text-muted-foreground">{fora}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Linha pequena da evolução de uma medida (sem eixos): o valor exato fica no cartão e na dica. */
function SerieMiniatura({ pontos }: { pontos: number[] }) {
  if (pontos.length < 2) return null;
  const min = Math.min(...pontos);
  const max = Math.max(...pontos);
  const faixa = max - min || 1;
  const largura = 64;
  const altura = 18;
  const caminho = pontos
    .map((v, i) => `${i === 0 ? "M" : "L"}${((i / (pontos.length - 1)) * largura).toFixed(1)},${(altura - 2 - ((v - min) / faixa) * (altura - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} aria-hidden className="text-[var(--color-viz-1)]">
      <path d={caminho} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
