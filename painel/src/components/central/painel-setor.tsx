import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Building2,
  Clock3,
  FileSearch,
  FileText,
  Headset,
  Inbox,
  Landmark,
  Library,
  MessagesSquare,
  Package,
  SearchX,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { api, type AgenteCentral, type AlertaCentral, type ConversaCentral, type EventoCentral, type SetoresCentral } from "@/lib/api";
import { fmtInt, fmtRelativo, fmtSegundos } from "@/lib/formato";
import { tripulante } from "@/lib/tripulacao";
import { FERRAMENTAS_DO_SETOR, SETORES, setorDaFerramenta, type SetorId } from "@/lib/setores";
import { Anel, Atividade, Barras, Indicador, ListaAoVivo, serieDeAtividade, Titulo } from "./dashboard";

/*
 * O painel de um setor da Central ao vivo: o mini dashboard do que acontece ali (indicadores, atividade
 * da última hora, barras por agente ou por motivo) e a lista ao vivo do setor. Os números do período vêm
 * de /central/setores; os de cada mesa, de /central (indicadores).
 */

export const ICONE_SETOR: Record<SetorId, ReactNode> = {
  atendimento: <MessagesSquare />,
  recepcao: <Inbox />,
  secretaria: <FileSearch />,
  fontes: <Library />,
  base: <BookOpen />,
  implantacao: <Package />,
  catalogo: <Landmark />,
  equipe: <Building2 />,
};

/** O que acontece no setor (o mesmo critério que faz o agente andar até lá). */
export function eventosDoSetor(eventos: EventoCentral[], setor: SetorId) {
  return eventos.filter((e) => {
    if (setor === "recepcao") return e.tipo === "mensagem" || e.tipo === "respondeu";
    if (setor === "atendimento") return e.tipo !== "pensando";
    if (setor === "equipe") return e.tipo === "transferiu";
    return e.tipo === "ferramenta" && !!e.ferramenta && setorDaFerramenta(e.ferramenta, e.agente) === setor;
  });
}

export function PainelSetor({
  setor,
  agentes,
  consulta,
  periodo,
  eventos,
  aoFechar,
  aoAbrirConversa,
  aoAbrirAgente,
}: {
  setor: SetorId;
  agentes: AgenteCentral[];
  /** O período (?horas= ou ?desde=&ate=, ver lib/periodo-central.ts). */
  consulta: string;
  periodo: string;
  eventos: EventoCentral[];
  aoFechar: () => void;
  aoAbrirConversa: (sessionId: string) => void;
  aoAbrirAgente: (id: string) => void;
}) {
  const { nome, descricao, cor } = SETORES[setor];
  const corDe = (id: string) => tripulante(id, agentes).cor;
  const nomeDe = (id: string) => agentes.find((a) => a.id === id)?.nome ?? id;
  const numeros = useQuery({
    queryKey: ["central-setores", consulta],
    queryFn: () => api<SetoresCentral>(`/central/setores?${consulta}`),
    refetchInterval: 30_000,
    retry: false,
  });
  const alertas = useQuery({
    queryKey: ["central-alertas"],
    queryFn: () => api<{ alertas: AlertaCentral[]; total: number }>("/central/alertas"),
    refetchInterval: 30_000,
    enabled: setor === "equipe",
  });
  const n = numeros.data;
  const doSetor = useMemo(() => eventosDoSetor(eventos, setor), [eventos, setor]);
  const serie = useMemo(() => serieDeAtividade(doSetor), [doSetor]);
  const semNumeros = numeros.isError ? (
    <p className="rounded-xl bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">Os números do período ainda não estão disponíveis neste servidor.</p>
  ) : null;

  let conteudo: ReactNode = null;
  if (setor === "atendimento") {
    const soma = (f: (a: AgenteCentral) => number) => agentes.reduce((t, a) => t + f(a), 0);
    const tempos = agentes.map((a) => a.indicadores?.tempo_medio_resposta_s).filter((v): v is number => v != null);
    const conversas = soma((a) => a.indicadores?.conversas ?? a.conversas.length);
    const transferidas = soma((a) => a.conversas.filter((c) => c.transferida_no_periodo).length);
    const avaliadas = soma((a) => a.indicadores?.calibracao_avaliadas ?? 0);
    const aprovadas = agentes.reduce((t, a) => t + (a.indicadores?.calibracao_aprovacao ?? 0) * (a.indicadores?.calibracao_avaliadas ?? 0), 0);
    conteudo = (
      <>
        <div className="grid grid-cols-2 gap-2">
          <Indicador icone={<Headset />} rotulo="Em atendimento" valor={fmtInt(soma((a) => a.indicadores?.em_atendimento ?? 0))} detalhe={`${fmtInt(soma((a) => a.indicadores?.conversando_agora ?? 0))} conversando agora`} cor={cor} />
          <Indicador icone={<MessagesSquare />} rotulo={`Conversas · ${periodo}`} valor={fmtInt(conversas)} cor="#8b5cf6" />
          <Indicador icone={<Clock3 />} rotulo="Tempo de resposta" valor={tempos.length ? fmtSegundos(tempos.reduce((x, y) => x + y, 0) / tempos.length) : "—"} detalhe="média dos agentes" cor="#F4B800" />
          <Indicador icone={<Users />} rotulo={`Transferidas · ${periodo}`} valor={fmtInt(transferidas)} cor="#F4B800" />
        </div>
        <div className="flex justify-around rounded-2xl border border-border bg-background/40 py-3">
          <Anel valor={conversas ? 1 - transferidas / conversas : null} cor="#22c55e" rotulo="Resolvidas sem humano" />
          <Anel valor={avaliadas ? aprovadas / avaliadas : null} cor="#8b5cf6" rotulo="Aprovação na calibração" />
        </div>
        <Atividade serie={serie} cor={cor} rotulo="Atividade na última hora" />
        <div>
          <Titulo>Por agente</Titulo>
          <div className="space-y-1.5">
            {agentes.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => aoAbrirAgente(a.id)}
                className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-background/40 px-2.5 py-2 text-left transition-colors hover:border-primary/40"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full" style={{ background: corDe(a.id) }}>
                  <img src="/painel/espaco/gestorgov-branco.png" alt="" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{a.nome}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{a.cargo ?? a.funcao}</span>
                </span>
                <span className="grid grid-cols-3 gap-3 text-right">
                  <span>
                    <span className="num block text-xs font-semibold">{fmtInt(a.indicadores?.em_atendimento ?? 0)}</span>
                    <span className="block text-[9px] text-muted-foreground">agora</span>
                  </span>
                  <span>
                    <span className="num block text-xs font-semibold">{fmtInt(a.indicadores?.conversas ?? a.conversas.length)}</span>
                    <span className="block text-[9px] text-muted-foreground">período</span>
                  </span>
                  <span>
                    <span className="num block text-xs font-semibold">
                      {a.indicadores?.tempo_medio_resposta_s != null ? fmtSegundos(a.indicadores.tempo_medio_resposta_s) : "—"}
                    </span>
                    <span className="block text-[9px] text-muted-foreground">resposta</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </>
    );
  } else if (setor === "recepcao") {
    const porOrigem = Object.entries(n?.mensagens.por_origem ?? {});
    conteudo = (
      <>
        {semNumeros}
        <div className="grid grid-cols-2 gap-2">
          <Indicador icone={<ArrowDownLeft />} rotulo={`Recebidas · ${periodo}`} valor={n ? fmtInt(n.mensagens.recebidas) : "—"} detalhe="mensagens dos contatos" cor={cor} />
          <Indicador icone={<ArrowUpRight />} rotulo={`Respondidas · ${periodo}`} valor={n ? fmtInt(n.mensagens.respondidas) : "—"} detalhe="respostas dos agentes" cor="#3b82f6" />
        </div>
        <Atividade serie={serie} cor={cor} rotulo="Mensagens na última hora" />
        <div>
          <Titulo>Por origem</Titulo>
          <Barras
            itens={porOrigem.map(([origem, valor]) => ({
              rotulo: origem === "whatsapp" ? "WhatsApp" : origem === "painel" ? "Chat do painel" : "Outras",
              valor,
              cor: origem === "whatsapp" ? "#22c55e" : origem === "painel" ? "#3b82f6" : "#94a3b8",
            }))}
            vazio="Sem mensagens no período."
          />
        </div>
      </>
    );
  } else if (setor === "secretaria" || setor === "fontes" || setor === "implantacao" || setor === "catalogo") {
    // Cada sala atende várias ferramentas: soma as chamadas de todas, por agente.
    const dados = (FERRAMENTAS_DO_SETOR[setor] ?? []).map((f) => n?.ferramentas[f]).filter((d) => d != null);
    const porAgente: Record<string, number> = {};
    for (const d of dados) for (const [agente, v] of Object.entries(d.por_agente)) porAgente[agente] = (porAgente[agente] ?? 0) + v;
    const daqui = Object.entries(porAgente);
    const total = dados.reduce((t, d) => t + d.total, 0);
    const semResultado = dados.length ? dados.reduce((t, d) => t + (d.sem_resultado ?? 0), 0) : null;
    conteudo = (
      <>
        {semNumeros}
        <div className="grid grid-cols-2 gap-2">
          <Indicador icone={ICONE_SETOR[setor]} rotulo={`${setor === "fontes" ? "Buscas" : "Consultas"} · ${periodo}`} valor={n ? fmtInt(total) : "—"} cor={cor} />
          <Indicador
            icone={<SearchX />}
            rotulo="Sem resultado"
            valor={semResultado != null ? fmtInt(semResultado) : "—"}
            detalhe={setor === "fontes" ? "nada achado nas fontes públicas" : "em todas as chamadas do setor"}
            cor="#ef4444"
          />
        </div>
        {total > 0 && semResultado != null && (
          <div className="flex justify-around rounded-2xl border border-border bg-background/40 py-3">
            <Anel valor={1 - semResultado / total} cor={cor} rotulo="Encontraram o que buscavam" />
          </div>
        )}
        <Atividade serie={serie} cor={cor} rotulo={setor === "fontes" ? "Buscas na última hora" : "Consultas na última hora"} />
        <div>
          <Titulo>Por agente</Titulo>
          <Barras itens={daqui.map(([agente, valor]) => ({ rotulo: nomeDe(agente), valor, cor: corDe(agente) }))} vazio="Nenhuma consulta no período." />
        </div>
      </>
    );
  } else if (setor === "base") {
    const documentos = Object.values(n?.conhecimento.documentos_ativos ?? {}).reduce((a, b) => a + b, 0);
    const exemplos = Object.values(n?.conhecimento.exemplos_ativos ?? {}).reduce((a, b) => a + b, 0);
    conteudo = (
      <>
        {semNumeros}
        <div className="grid grid-cols-2 gap-2">
          <Indicador icone={<FileText />} rotulo="Documentos em uso" valor={n ? fmtInt(documentos) : "—"} cor={cor} />
          <Indicador icone={<Sparkles />} rotulo="Exemplos aprovados" valor={n ? fmtInt(exemplos) : "—"} detalhe="vindos da Calibração" cor="#8b5cf6" />
        </div>
        <div>
          <Titulo>Aprovação na calibração</Titulo>
          <div className="grid grid-cols-4 gap-2 rounded-2xl border border-border bg-background/40 py-3">
            {agentes.map((a) => (
              <Anel key={a.id} valor={a.indicadores?.calibracao_aprovacao} cor={corDe(a.id)} tamanho={52} rotulo={a.nome} />
            ))}
          </div>
        </div>
        <div>
          <Titulo>Documentos por agente</Titulo>
          <Barras itens={agentes.map((a) => ({ rotulo: a.nome, valor: n?.conhecimento.documentos_ativos[a.id] ?? 0, cor: corDe(a.id) }))} vazio="Nenhum documento ativo." />
        </div>
      </>
    );
  } else if (setor === "equipe") {
    const transferidas: ConversaCentral[] = agentes.flatMap((a) => a.conversas.filter((c) => c.transferida_no_periodo));
    const porMotivo = new Map<string, number>();
    for (const c of transferidas) porMotivo.set(c.categoria_rotulo || "Sem motivo", (porMotivo.get(c.categoria_rotulo || "Sem motivo") ?? 0) + 1);
    const esperando = (alertas.data?.alertas ?? []).filter((al) => al.tipo === "transferida_aguardando");
    conteudo = (
      <>
        <div className="grid grid-cols-2 gap-2">
          <Indicador icone={<Users />} rotulo={`Transferidas · ${periodo}`} valor={fmtInt(transferidas.length)} cor={cor} />
          <Indicador icone={<AlertTriangle />} rotulo="Esperando a equipe" valor={fmtInt(n?.transferencias.aguardando ?? esperando.length)} detalhe="há mais de 15 min" cor="#ef4444" />
        </div>
        <div>
          <Titulo>Por motivo</Titulo>
          <Barras itens={[...porMotivo.entries()].sort((a, b) => b[1] - a[1]).map(([rotulo, valor]) => ({ rotulo, valor, cor }))} vazio="Nenhuma transferência no período." />
        </div>
        {esperando.length > 0 && (
          <div>
            <Titulo extra={<span>{esperando.length}</span>}>Precisam de atenção</Titulo>
            <div className="space-y-1.5">
              {esperando.map((al) => (
                <button
                  key={al.session_id}
                  type="button"
                  onClick={() => al.session_id && aoAbrirConversa(al.session_id)}
                  className="flex w-full items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 px-2.5 py-2 text-left text-xs hover:bg-warning/15"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-text" />
                  <span className="min-w-0">
                    <b>{al.contato || "Sem nome"}</b> <span className="text-muted-foreground">· {nomeDe(al.agente)}</span>
                    <span className="block text-[11px] text-muted-foreground">{al.texto}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <Titulo extra={<span>{transferidas.length}</span>}>Transferidas</Titulo>
          <div className="space-y-0.5">
            {transferidas.slice(0, 10).map((c) => (
              <button key={c.id} type="button" onClick={() => aoAbrirConversa(c.id)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-muted/60">
                <span className="size-2 shrink-0 rounded-full" style={{ background: cor }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{c.nome || "Servidor sem nome"}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{c.categoria_rotulo || c.motivo || "Transferida"}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{fmtRelativo(c.atualizada_em)}</span>
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="relative overflow-hidden border-b border-border px-4 py-4">
        <div className="pointer-events-none absolute -top-16 -left-10 size-40 rounded-full opacity-25 blur-3xl" style={{ background: cor }} />
        <div className="relative flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl text-white shadow-lg [&_svg]:size-5" style={{ background: cor }}>
            {ICONE_SETOR[setor]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Setor · {periodo}</div>
            <div className="truncate text-base font-semibold">{nome}</div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{descricao}</p>
          </div>
          <button
            type="button"
            aria-label="Voltar à visão geral"
            onClick={aoFechar}
            className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {conteudo}
        <div>
          <Titulo
            extra={
              <span className="inline-flex items-center gap-1 text-success">
                <span className="size-1.5 animate-pulse rounded-full bg-current" /> ao vivo
              </span>
            }
          >
            Acontecendo agora
          </Titulo>
          <ListaAoVivo
            eventos={doSetor}
            agentes={agentes}
            aoAbrirConversa={aoAbrirConversa}
            vazio={
              setor === "recepcao"
                ? "As mensagens que chegarem aparecem aqui."
                : setor === "equipe"
                  ? "As transferências aparecem aqui."
                  : "Quando um agente vier buscar algo aqui, aparece nesta lista."
            }
          />
        </div>
      </div>
    </>
  );
}
