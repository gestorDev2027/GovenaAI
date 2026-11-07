import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Crosshair,
  DoorOpen,
  ExternalLink,
  Headset,
  Loader2,
  Maximize,
  Minimize,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Moon,
  MousePointerClick,
  Plus,
  Sun,
  Hourglass,
  Timer,
  Users,
  X,
} from "lucide-react";
import {
  api,
  type Central as DadosCentral,
  type RespostaAlertas,
  type Conversa,
  type ConversaCentral,
} from "@/lib/api";
import { fmtDataHora, fmtInt, fmtSegundos } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { LogoIcone, LogoMarca } from "@/components/layout/logo";
import { StatusBadge } from "@/components/widgets/widgets";
import { UsoNaResposta } from "@/components/conhecimento/uso";
import type { ApiCamera, Selecao } from "@/components/central/escritorio";
import { PainelSetor } from "@/components/central/painel-setor";
import { PainelAgente } from "@/components/central/painel-agente";
import { PainelGeral } from "@/components/central/painel-geral";
import { ABAS_CENTRAL, TabelasCentral, type AbaCentral } from "@/components/central/tabelas";
import { SeletorPeriodo } from "@/components/central/seletor-periodo";
import { ateAgora, consultaPeriodo, lerPeriodo, rotuloPeriodo, salvarPeriodo } from "@/lib/periodo-central";
import { useCentralAoVivo } from "@/hooks/use-central-ao-vivo";
import { tripulante } from "@/lib/tripulacao";
import { ROTULO_FERRAMENTA } from "./conversas";
import { TextoComLinks } from "./chat";

/*
 * Central ao vivo: tela cheia, aberta em outra aba. O escritório 3D (com os setores e os agentes que andam
 * até eles) ocupa o fundo; por cima, a barra do topo, a tripulação com os números do período e o painel da
 * direita, que mostra o que estiver selecionado: uma conversa, um agente ou o dashboard de um setor.
 * As outras abas (conversas, alertas, agentes, acontecimentos) cobrem o escritório com os números do
 * período e uma tabela; a linha abre um painel lateral (ver components/central/tabelas.tsx).
 */

// O escritório (Three.js) é baixado à parte, depois do resto da tela.
const Cena = lazy(() => import("@/components/central/escritorio"));

// Os mesmos limites e cores da cena, repetidos para não carregar o Three.js antes da hora.
const SEGUNDOS_CONVERSANDO = 120;
const LARGURA_PAINEL = 400;

// Na mesa da planta só fica quem teve mensagem nos últimos 15 min (o mesmo da cena).
const SEGUNDOS_NA_MESA = 15 * 60;
const naMesa = (c: ConversaCentral) => c.status === "em_atendimento" && c.parada_ha_s != null && c.parada_ha_s <= SEGUNDOS_NA_MESA;
const conversandoAgora = (c: ConversaCentral) => c.parada_ha_s != null && c.parada_ha_s <= SEGUNDOS_CONVERSANDO;
const corDaConversa = (c: ConversaCentral) =>
  c.status === "transferido" ? "#F4B800" : c.status === "encerrado" ? "#94a3b8" : conversandoAgora(c) ? "#22c55e" : "#52A2FF";

const CHAVE_ABA = "central-aba";

/** A aba do endereço (?aba=alertas, para mandar o link) ou a última aberta neste navegador. */
function lerAba(): AbaCentral {
  const doEndereco = new URLSearchParams(window.location.search).get("aba");
  if (ABAS_CENTRAL.some((a) => a.id === doEndereco)) return doEndereco as AbaCentral;
  try {
    const salva = localStorage.getItem(CHAVE_ABA);
    if (ABAS_CENTRAL.some((a) => a.id === salva)) return salva as AbaCentral;
  } catch {
    /* sem armazenamento: abre no escritório */
  }
  return "escritorio";
}

function useTelaLarga() {
  const [larga, setLarga] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const consulta = window.matchMedia("(min-width: 1024px)");
    const mudar = () => setLarga(consulta.matches);
    consulta.addEventListener("change", mudar);
    return () => consulta.removeEventListener("change", mudar);
  }, []);
  return larga;
}

function useTelaCheia() {
  const [cheia, setCheia] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const mudar = () => setCheia(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", mudar);
    return () => document.removeEventListener("fullscreenchange", mudar);
  }, []);
  const alternar = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else document.documentElement.requestFullscreen().catch(() => toast.info("O navegador não permitiu a tela cheia."));
  };
  return { cheia, alternar };
}

/* ───────── Peças flutuantes ───────── */

function Vidro({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-2xl border border-border/80 bg-card/85 shadow-[0_16px_40px_-16px_rgb(0_0_0/0.5)] backdrop-blur-xl", className)}>
      {children}
    </div>
  );
}

function BotaoIcone({ titulo, onClick, children, className }: { titulo: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      className={cn("grid size-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4", className)}
    >
      {children}
    </button>
  );
}

/** Número compacto da barra do topo: ícone na cor, valor e rótulo embaixo. */
function Numero({ icone, rotulo, valor, detalhe, cor }: { icone: ReactNode; rotulo: string; valor: string; detalhe?: string; cor: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-2 whitespace-nowrap" title={detalhe ? `${rotulo} · ${detalhe}` : rotulo}>
      <span className="grid size-7 shrink-0 place-items-center rounded-lg text-white [&_svg]:size-3.5" style={{ background: cor }}>
        {icone}
      </span>
      <div className="leading-tight">
        <div className="num text-sm font-semibold">{valor}</div>
        <div className="text-[10px] text-muted-foreground">{rotulo}</div>
      </div>
    </div>
  );
}

function Rotulo({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
      {children}
      <span className="h-px flex-1 bg-border" />
      {extra}
    </div>
  );
}

function CabecalhoPainel({
  icone,
  cor,
  rotulo,
  titulo,
  aoFechar,
  children,
}: {
  icone: ReactNode;
  cor: string;
  rotulo: string;
  titulo: string;
  aoFechar?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-3.5">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl text-white shadow-sm [&_svg]:size-5" style={{ background: cor }}>
        {icone}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">{rotulo}</div>
        <div className="truncate text-[15px] font-semibold">{titulo}</div>
        {children}
      </div>
      {aoFechar && (
        <button
          type="button"
          aria-label="Voltar à visão geral"
          onClick={aoFechar}
          className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/* ───────── Painel: uma conversa ───────── */

function PainelConversa({ resumo, aoFechar }: { resumo: ConversaCentral; aoFechar: () => void }) {
  const conversa = useQuery({
    queryKey: ["conversa", resumo.id, resumo.atualizada_em],
    queryFn: () => api<Conversa>(`/conversas/${encodeURIComponent(resumo.id)}`),
    // Chegou mensagem nova (atualizada_em mudou): mantém o que já está na tela enquanto busca. Outra conversa: começa limpo.
    placeholderData: (anterior, consultaAnterior) => (consultaAnterior?.queryKey[1] === resumo.id ? anterior : undefined),
  });
  const vazia = !!conversa.data && conversa.data.itens.length === 0;
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [conversa.data]);

  return (
    <>
      <CabecalhoPainel icone={<Headset />} cor={corDaConversa(resumo)} rotulo={`Conversa · ${resumo.origem}`} titulo={resumo.nome || "Servidor sem nome"} aoFechar={aoFechar}>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={resumo.status} />
          {resumo.status === "em_atendimento" && (
            <span className="text-[11px] text-muted-foreground">{conversandoAgora(resumo) ? "conversando agora" : "esperando o servidor"}</span>
          )}
        </div>
      </CabecalhoPainel>
      {resumo.motivo && (
        <div className="border-b border-border px-4 py-3">
          <Rotulo>Transferência{resumo.categoria_rotulo ? ` · ${resumo.categoria_rotulo}` : ""}</Rotulo>
          <p className="rounded-xl border border-primary/30 bg-primary/8 px-3 py-2 text-xs leading-relaxed">{resumo.motivo}</p>
        </div>
      )}
      <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {conversa.isLoading && (
          <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Abrindo a conversa…
          </p>
        )}
        {conversa.isError && (
          <div className="space-y-2 py-10 text-center text-xs text-muted-foreground">
            <p>Não foi possível abrir a conversa: {(conversa.error as Error).message}</p>
            <button type="button" onClick={() => conversa.refetch()} className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted">
              Tentar de novo
            </button>
          </div>
        )}
        {vazia && (
          <div className="mx-auto max-w-[300px] space-y-2 py-10 text-center">
            <span className="mx-auto grid size-10 place-items-center rounded-xl bg-primary/10 text-primary-text">
              <Hourglass className="size-5" />
            </span>
            <p className="text-sm font-semibold">
              {conversa.data!.nao_chegou ? "O agente ainda não falou com este servidor" : "Só as boas-vindas foram enviadas"}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {conversa.data!.nao_chegou
                ? "O aviso de entrada da Unnichat não chegou ao servidor, então as boas-vindas não saíram. Confira na Unnichat."
                : `As boas-vindas saíram ${conversa.data!.criada_em ? `em ${fmtDataHora(conversa.data!.criada_em)}` : ""} e o servidor ainda não respondeu. A conversa aparece aqui quando ele escrever.`}
            </p>
          </div>
        )}
        {conversa.data?.itens.map((item, i) =>
          item.papel === "contato" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-secondary px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-secondary-foreground">
                {item.texto === "(o servidor enviou o anexo sem texto)" ? "📎 anexo" : item.texto}
                {!!item.anexos?.length && <div className="mt-1 text-[11px] opacity-70">📎 {item.anexos.map((a) => a.nome).join(", ")}</div>}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-1.5">
              {!!item.ferramentas?.length && (
                <div className="flex flex-wrap gap-1">
                  {item.ferramentas.map((f, j) => (
                    <span key={j} className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground uppercase">
                      {ROTULO_FERRAMENTA[f.nome] ?? f.nome}
                    </span>
                  ))}
                </div>
              )}
              <div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-border bg-background/60 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                <TextoComLinks texto={item.texto} />
              </div>
              <UsoNaResposta uso={item.calibracao} />
            </div>
          ),
        )}
        <div ref={fim} />
      </div>
      <div className="border-t border-border px-4 py-3">
        <a
          href={`/painel/conversas?id=${encodeURIComponent(resumo.id)}`}
          target="_blank"
          rel="noopener"
          className="flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Abrir no painel <ExternalLink className="size-3.5" />
        </a>
      </div>
    </>
  );
}

/* ───────── Tela ───────── */

export function Central() {
  const { theme, toggle } = useTheme();
  const { cheia, alternar } = useTelaCheia();
  const larga = useTelaLarga();
  // O período vale para tudo: números, escritório e abas (lib/periodo-central.ts).
  const [periodoEscolhido, setPeriodoEscolhido] = useState(lerPeriodo);
  useEffect(() => salvarPeriodo(periodoEscolhido), [periodoEscolhido]);
  // As conversas do chat de teste do painel ficam fora dos números e das abas, a menos que se peça.
  const [incluirTestes, setIncluirTestes] = useState(false);
  const consulta = consultaPeriodo(periodoEscolhido) + (incluirTestes ? "&incluir_testes=true" : "");
  const vivo = ateAgora(periodoEscolhido);
  const [selecao, setSelecao] = useState<Selecao>(null);
  // O painel da direita começa fechado (o escritório fica livre) e abre ao selecionar algo.
  const [painelAberto, setPainelAberto] = useState(false);
  // O escritório começa com o prédio fechado (vista de fora); abre pela barra de botões, num clique no prédio
  // ou ao selecionar algo de dentro dele.
  const [predioAberto, setPredioAberto] = useState(false);
  const [aba, setAba] = useState<AbaCentral>(lerAba);
  const noEscritorio = aba === "escritorio";
  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_ABA, aba);
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }, [aba]);
  const camera = useRef<ApiCamera | null>(null);
  const aoVivo = useCentralAoVivo();
  const alertas = useQuery({
    queryKey: ["central-alertas", consulta],
    queryFn: () => api<RespostaAlertas>(`/central/alertas?${consulta}`),
    refetchInterval: 30_000,
  });
  const dados = useQuery({
    queryKey: ["central", consulta],
    queryFn: () => api<DadosCentral>(`/central?${consulta}`),
    // Ao trocar o período, os números antigos ficam na tela (marcados como carregando) até os novos chegarem.
    placeholderData: (anterior) => anterior,
    // Um período que já terminou não muda: busca uma vez.
    refetchInterval: vivo ? 10_000 : false,
  });

  useEffect(() => {
    document.title = "Secretaria · GestorGov";
  }, []);

  const agentes = useMemo(() => dados.data?.agentes ?? [], [dados.data]);
  const todas = useMemo(() => agentes.flatMap((a) => a.conversas), [agentes]);
  const ativas = todas.filter((c) => c.status === "em_atendimento");
  // A mesma régua da Visão geral (painel_api._agora): atendendo agora = na mesa (mensagem nos últimos 15 min);
  // o resto do que está aberto é espera pelo servidor, separada em boas-vindas sem resposta e conversas paradas.
  const atendendoAgora = ativas.filter(naMesa);
  const aguardando = ativas.filter((c) => !naMesa(c));
  const boasVindasAguardando = aguardando.filter((c) => c.mensagens === 0).length;
  // Transferidas e encerradas no período (pela hora em que aconteceu), como em todas as abas.
  const transferidas = todas.filter((c) => c.transferida_no_periodo);
  const encerradas = todas.filter((c) => c.encerrada_no_periodo);
  const duracoes = todas.map((c) => c.duracao_media_s).filter((d): d is number => d != null);
  const tempoMedio = duracoes.length ? duracoes.reduce((a, b) => a + b, 0) / duracoes.length : null;
  const periodo = rotuloPeriodo(periodoEscolhido);

  const conversaEscolhida = selecao?.tipo === "conversa" ? todas.find((c) => c.id === selecao.id) : undefined;
  const indiceAgente = selecao?.tipo === "agente" ? agentes.findIndex((a) => a.id === selecao.id) : -1;
  const mostrarPainel = larga && painelAberto && noEscritorio;

  const selecionar = (s: Selecao) => {
    setSelecao(s);
    if (s) {
      setPainelAberto(true);
      setPredioAberto(true);
    }
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_35%_25%,color-mix(in_oklab,var(--color-primary)_9%,var(--color-background)),var(--color-background)_65%)] text-foreground">
      {/* A nave-mãe */}
      <div className="absolute inset-0">
        {dados.data && (
          <Suspense
            fallback={
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Montando a central…
                </span>
              </div>
            }
          >
            <Cena
              agentes={agentes}
              eventos={aoVivo.eventos}
              inicio={aoVivo.inicio}
              selecao={selecao}
              aoSelecionar={selecionar}
              margemDireita={mostrarPainel ? LARGURA_PAINEL + 24 : 0}
              api={camera}
              aberto={predioAberto}
              aoAbrir={() => setPredioAberto(true)}
            />
          </Suspense>
        )}
        {dados.isLoading && (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Buscando as conversas…
            </span>
          </div>
        )}
        {dados.isError && <div className="grid h-full place-items-center text-sm text-destructive">{(dados.error as Error).message}</div>}
      </div>

      {/* Barra do topo: marca, conexão, números do período, tripulação, alertas e os comandos */}
      <Vidro className="absolute top-3 right-3 left-3 z-30 flex h-14 items-center gap-2 px-3">
        <LogoMarca className="ml-1 hidden h-[18px] sm:inline-flex" />
        <LogoIcone className="size-8 sm:hidden" />
        <span aria-hidden="true" className="hidden h-6 w-px bg-border sm:block" />
        <div className="min-w-0 shrink-0 leading-tight">
          <div className="text-sm font-semibold">Secretaria</div>
          <div className="flex items-center gap-1 text-[10px] font-semibold text-success">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
            {!vivo ? `período fechado · ${periodo}` : aoVivo.conectado ? "ao vivo" : dados.isFetching ? "atualizando" : "a cada 10 s"}
          </div>
        </div>

        {/* Os números ficam só nas telas bem largas: nas abas, os mesmos estão no topo da tabela. */}
        <span aria-hidden="true" className="ml-1 hidden h-8 w-px bg-border 2xl:block" />
        <div className="hidden items-center 2xl:flex">
          <Numero
            icone={<Headset />}
            rotulo="Atendendo agora"
            valor={fmtInt(atendendoAgora.length)}
            detalhe={`mensagem nos últimos 15 min · ${fmtInt(atendendoAgora.filter(conversandoAgora).length)} nos últimos 2 min`}
            cor="#22c55e"
          />
          <Numero
            icone={<Hourglass />}
            rotulo="Aguardando o servidor"
            valor={fmtInt(aguardando.length)}
            detalhe={`${fmtInt(boasVindasAguardando)} boas-vindas sem resposta · ${fmtInt(aguardando.length - boasVindasAguardando)} conversas paradas`}
            cor="#3b82f6"
          />
          <Numero icone={<Users />} rotulo="Transferidas" detalhe={`no período de ${periodo}`} valor={fmtInt(transferidas.length)} cor="#F4B800" />
          <span className="contents">
            <Numero icone={<CheckCircle2 />} rotulo="Encerradas" detalhe={`no período de ${periodo}`} valor={fmtInt(encerradas.length)} cor="#10b981" />
            <Numero icone={<Timer />} rotulo="Resposta" detalhe="tempo médio de resposta" valor={tempoMedio != null ? fmtSegundos(tempoMedio) : "—"} cor="#8b5cf6" />
          </span>
        </div>

        {/* Tripulação: um avatar por agente, com o ponto de quem está atendendo agora */}
        <span aria-hidden="true" className="hidden h-8 w-px bg-border xl:block" />
        <div className="hidden items-center xl:flex" role="group" aria-label="Tripulação">
          {agentes.map((a, i) => {
            const { cor } = tripulante(a.id, agentes);
            const doAgente = a.conversas.filter(naMesa);
            const ativo = selecao?.tipo === "agente" && selecao.id === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => selecionar({ tipo: "agente", id: a.id })}
                title={`${a.nome} · ${a.cargo ?? a.funcao} · ${doAgente.length} ${doAgente.length === 1 ? "conversa ativa" : "conversas ativas"}`}
                aria-label={a.nome}
                className={cn(
                  "relative grid size-8 place-items-center rounded-full ring-2 ring-card transition-transform hover:z-10 hover:scale-110",
                  i > 0 && "-ml-2",
                  ativo && "z-10 scale-110 ring-foreground/70",
                )}
                style={{ background: cor }}
              >
                <img src="/painel/espaco/gestorgov-branco.png" alt="" className="size-[18px]" />
                {doAgente.length > 0 && (
                  <span
                    className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card", doAgente.some(conversandoAgora) ? "bg-[#22c55e]" : "bg-[#f59e0b]")}
                  />
                )}
              </button>
            );
          })}
        </div>

        {(alertas.data?.total ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setAba("alertas")}
            className="ml-1 flex shrink-0 items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive transition-colors hover:bg-destructive/20"
            title="Conversas que pedem atenção: falha na resposta, transferida há tempo, bloqueio do guardrail"
          >
            <span className="size-1.5 rounded-full bg-destructive" />
            {alertas.data!.total} {alertas.data!.total === 1 ? "alerta" : "alertas"}
          </button>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <SeletorPeriodo periodo={periodoEscolhido} aoMudar={setPeriodoEscolhido} className="mr-1 hidden sm:flex" />
          <BotaoIcone titulo={theme === "dark" ? "Tema claro" : "Tema escuro"} onClick={toggle}>
            {theme === "dark" ? <Sun /> : <Moon />}
          </BotaoIcone>
          <BotaoIcone titulo={cheia ? "Sair da tela cheia" : "Tela cheia"} onClick={alternar}>
            {cheia ? <Minimize /> : <Maximize />}
          </BotaoIcone>
          {larga && noEscritorio && (
            <BotaoIcone
              titulo={painelAberto ? "Recolher o painel" : "Mostrar o painel"}
              onClick={() => setPainelAberto((a) => !a)}
              className={cn(painelAberto && "bg-muted text-foreground")}
            >
              {painelAberto ? <PanelRightClose /> : <PanelRightOpen />}
            </BotaoIcone>
          )}
          <a
            href="/painel/"
            title="Voltar ao painel"
            className="ml-1 hidden items-center gap-1.5 rounded-xl border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex"
          >
            <ArrowLeft className="size-3.5" /> <span className="hidden 2xl:inline">Painel</span>
          </a>
        </div>
      </Vidro>

      {/* Abas: o escritório ou uma das tabelas */}
      <Vidro className="absolute top-20 left-3 flex max-w-[calc(100%-1.5rem)] gap-0.5 overflow-x-auto p-1">
        {ABAS_CENTRAL.map((a) => {
          const contagem = a.id === "alertas" ? alertas.data?.total ?? 0 : a.id === "conversas" ? ativas.length : 0;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setAba(a.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors",
                aba === a.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {a.rotulo}
              {contagem > 0 && (
                <span
                  className={cn(
                    "num rounded-full px-1.5 text-[10px]",
                    aba === a.id ? "bg-primary-foreground/20" : a.id === "alertas" ? "bg-destructive/15 text-destructive" : "bg-muted",
                  )}
                >
                  {contagem}
                </span>
              )}
            </button>
          );
        })}
        <span aria-hidden="true" className="mx-1 my-1 w-px shrink-0 bg-border" />
        <button
          type="button"
          onClick={() => setIncluirTestes((v) => !v)}
          aria-pressed={incluirTestes}
          title="Incluir as conversas do chat de teste do painel nos números e nas abas"
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors",
            incluirTestes ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <span className={cn("size-2 rounded-full border", incluirTestes ? "border-primary bg-primary" : "border-muted-foreground")} />
          Testes do painel
        </button>
      </Vidro>

      {/* As tabelas cobrem o escritório (que segue montado, para voltar sem recarregar) */}
      {!noEscritorio && (
        <Vidro className="absolute top-[8.25rem] right-3 bottom-3 left-3 flex flex-col overflow-hidden p-3">
          <TabelasCentral
            aba={aba}
            agentes={agentes}
            alertas={alertas.data?.alertas ?? []}
            baixados={alertas.data?.baixados ?? []}
            baixaDisponivel={alertas.data?.baixa_disponivel ?? false}
            eventos={aoVivo.eventos}
            carregando={dados.isLoading || (dados.isFetching && dados.isPlaceholderData)}
            consulta={consulta}
            vivo={vivo}
            periodo={periodo}
            aoVerNoEscritorio={(s) => {
              setAba("escritorio");
              selecionar(s);
            }}
          />
        </Vidro>
      )}

      {/* Câmera */}
      {noEscritorio && (
      <Vidro className="absolute bottom-16 left-3 flex flex-col p-1 sm:bottom-3" >
        <BotaoIcone titulo="Aproximar" onClick={() => camera.current?.aproximar(1.25)}>
          <Plus />
        </BotaoIcone>
        <BotaoIcone titulo="Afastar" onClick={() => camera.current?.aproximar(0.8)}>
          <Minus />
        </BotaoIcone>
        <BotaoIcone titulo="Ver a central inteira" onClick={() => { setSelecao(null); camera.current?.centralizar(); }}>
          <Crosshair />
        </BotaoIcone>
        <BotaoIcone
          titulo={predioAberto ? "Ver o prédio por fora" : "Entrar no escritório"}
          onClick={() => {
            if (predioAberto) setSelecao(null);
            setPredioAberto(!predioAberto);
          }}
          className={cn(predioAberto && "bg-muted text-foreground")}
        >
          {predioAberto ? <Building2 /> : <DoorOpen />}
        </BotaoIcone>
      </Vidro>
      )}

      {/* Legenda e dica */}
      {noEscritorio && (
      <Vidro
        className="absolute bottom-3 left-16 hidden flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2 text-[11px] text-muted-foreground sm:flex"

      >
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#22c55e]" /> Conversando agora
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#52A2FF]" /> Esperando o servidor (até 15 min)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#F4B800]" /> Transferida
        </span>
        <span className="flex items-center gap-1.5 border-l border-border pl-4">
          <MousePointerClick className="size-3.5" /> Clique num agente, num balão ou num setor · arraste para mover · botão direito gira
        </span>
      </Vidro>
      )}

      {/* Painel da direita */}
      {mostrarPainel && (
        <Vidro className="absolute top-20 right-3 bottom-3 flex flex-col overflow-hidden" >
          <div style={{ width: LARGURA_PAINEL }} className="flex min-h-0 flex-1 flex-col">
            {conversaEscolhida ? (
              <PainelConversa key={conversaEscolhida.id} resumo={conversaEscolhida} aoFechar={() => setSelecao(null)} />
            ) : indiceAgente >= 0 ? (
              <PainelAgente
                key={agentes[indiceAgente].id}
                agente={agentes[indiceAgente]}
                cor={tripulante(agentes[indiceAgente].id, agentes).cor}
                consulta={consulta}
                periodo={periodo}
                eventos={aoVivo.eventos}
                agentes={agentes}
                aoFechar={() => setSelecao(null)}
                aoAbrirConversa={(id) => selecionar({ tipo: "conversa", id })}
              />
            ) : selecao?.tipo === "setor" ? (
              <PainelSetor
                key={selecao.id}
                setor={selecao.id}
                agentes={agentes}
                consulta={consulta}
                periodo={periodo}
                eventos={aoVivo.eventos}
                aoFechar={() => setSelecao(null)}
                aoAbrirConversa={(id) => selecionar({ tipo: "conversa", id })}
                aoAbrirAgente={(id) => selecionar({ tipo: "agente", id })}
              />
            ) : (
              <PainelGeral
                agentes={agentes}
                periodo={periodo}
                eventos={aoVivo.eventos}
                aoRecolher={() => setPainelAberto(false)}
                aoAbrirAgente={(id) => selecionar({ tipo: "agente", id })}
                aoAbrirSetor={(id) => selecionar({ tipo: "setor", id })}
                aoAbrirConversa={(id) => selecionar({ tipo: "conversa", id })}
              />
            )}
          </div>
        </Vidro>
      )}
    </div>
  );
}
