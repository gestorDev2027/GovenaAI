import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock3, Headset, MessagesSquare, Users, X } from "lucide-react";
import { api, type AgenteCentral, type EventoCentral, type SetoresCentral } from "@/lib/api";
import { fmtInt, fmtRelativo, fmtSegundos } from "@/lib/formato";
import { Anel, Atividade, Barras, Indicador, ListaAoVivo, serieDeAtividade, Titulo } from "./dashboard";

/*
 * O painel de um agente na Central ao vivo: o mini dashboard dele (indicadores, resolução sem humano,
 * aprovação na calibração, atividade da última hora, ferramentas usadas e conversas por situação), as
 * conversas em atendimento e o que ele está fazendo agora.
 */

const ROTULO_FERRAMENTA: Record<string, string> = {
  consultar_secretaria: "Consultar a secretaria",
  listar_unidades: "Listar unidades",
  buscar_municipio: "Buscar o município",
  importar_unidades_cnes: "Importar unidades do CNES",
  transferir_para_humano: "Transferir para a equipe",
  encerrar_atendimento: "Encerrar atendimento",
  update_user_memory: "Registrar na memória",
};

export function PainelAgente({
  agente,
  cor,
  consulta,
  periodo,
  eventos,
  agentes,
  aoFechar,
  aoAbrirConversa,
}: {
  agente: AgenteCentral;
  cor: string;
  /** O período (?horas= ou ?desde=&ate=, ver lib/periodo-central.ts). */
  consulta: string;
  periodo: string;
  eventos: EventoCentral[];
  agentes: AgenteCentral[];
  aoFechar: () => void;
  aoAbrirConversa: (sessionId: string) => void;
}) {
  const ind = agente.indicadores;
  const numeros = useQuery({
    queryKey: ["central-setores", consulta],
    queryFn: () => api<SetoresCentral>(`/central/setores?${consulta}`),
    refetchInterval: 30_000,
    retry: false,
  });
  const dele = useMemo(() => eventos.filter((e) => e.agente === agente.id), [eventos, agente.id]);
  const serie = useMemo(() => serieDeAtividade(dele), [dele]);
  const ativas = agente.conversas.filter((c) => c.status === "em_atendimento");
  const transferidas = agente.conversas.filter((c) => c.transferida_no_periodo).length;
  const encerradas = agente.conversas.filter((c) => c.encerrada_no_periodo).length;
  const ferramentas = Object.entries(numeros.data?.ferramentas ?? {})
    .map(([nome, f]) => ({ nome, valor: f.por_agente[agente.id] ?? 0 }))
    .filter((f) => f.valor > 0);

  return (
    <>
      <div className="relative overflow-hidden border-b border-border px-4 py-4">
        <div className="pointer-events-none absolute -top-16 -left-10 size-40 rounded-full opacity-25 blur-3xl" style={{ background: cor }} />
        <div className="relative flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl shadow-lg" style={{ background: cor }}>
            <img src="/painel/espaco/gestorgov-branco.png" alt="" className="size-7" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
              {[agente.area, agente.modelo].filter(Boolean).join(" · ")}
            </div>
            <div className="truncate text-base font-semibold">{agente.nome}</div>
            <div className="text-[11px] text-muted-foreground">{agente.cargo ?? agente.funcao}</div>
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
        <div className="grid grid-cols-2 gap-2">
          <Indicador icone={<Headset />} rotulo="Em atendimento" valor={fmtInt(ind?.em_atendimento ?? ativas.length)} detalhe={`${fmtInt(ind?.conversando_agora ?? 0)} conversando agora`} cor={cor} />
          <Indicador icone={<MessagesSquare />} rotulo={`Conversas · ${periodo}`} valor={fmtInt(ind?.conversas ?? agente.conversas.length)} cor="#8b5cf6" />
          <Indicador icone={<Clock3 />} rotulo="Tempo de resposta" valor={ind?.tempo_medio_resposta_s != null ? fmtSegundos(ind.tempo_medio_resposta_s) : "—"} cor="#f59e0b" />
          <Indicador icone={<Users />} rotulo={`Transferidas · ${periodo}`} valor={fmtInt(transferidas)} cor="#f7931e" />
        </div>
        <div className="flex justify-around rounded-2xl border border-border bg-background/40 py-3">
          <Anel valor={ind?.transferencia_pct != null ? 1 - ind.transferencia_pct : null} cor="#22c55e" rotulo="Resolvidas sem humano" />
          <Anel valor={ind?.calibracao_aprovacao} cor="#8b5cf6" rotulo={`Aprovação · ${fmtInt(ind?.calibracao_avaliadas ?? 0)} avaliadas`} />
        </div>
        <Atividade serie={serie} cor={cor} rotulo="Atividade na última hora" />
        <div>
          <Titulo>Ferramentas · {periodo}</Titulo>
          <Barras
            itens={ferramentas.map((f) => ({ rotulo: ROTULO_FERRAMENTA[f.nome] ?? f.nome, valor: f.valor, cor }))}
            vazio={numeros.isError ? "Os números do período ainda não estão disponíveis neste servidor." : "Nenhuma ferramenta usada no período."}
          />
        </div>
        <div>
          <Titulo>Conversas por situação</Titulo>
          <Barras
            itens={[
              { rotulo: "Em atendimento", valor: ativas.length, cor: "#3b82f6" },
              { rotulo: "Transferidas", valor: transferidas, cor: "#f7931e" },
              { rotulo: "Encerradas", valor: encerradas, cor: "#10b981" },
            ]}
            vazio="Nenhuma conversa no período."
          />
        </div>
        <div>
          <Titulo extra={<span>{ativas.length}</span>}>Em atendimento</Titulo>
          {ativas.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground">Nenhuma conversa aberta agora.</p>}
          <div className="space-y-0.5">
            {ativas.slice(0, 10).map((c) => (
              <button key={c.id} type="button" onClick={() => aoAbrirConversa(c.id)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-muted/60">
                <CheckCircle2 className="size-3.5 shrink-0" style={{ color: c.parada_ha_s != null && c.parada_ha_s <= 120 ? "#22c55e" : "#f59e0b" }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{c.nome || "Servidor sem nome"}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{c.ultima_mensagem || "—"}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{fmtRelativo(c.atualizada_em)}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <Titulo
            extra={
              <span className="inline-flex items-center gap-1 text-success">
                <span className="size-1.5 animate-pulse rounded-full bg-current" /> ao vivo
              </span>
            }
          >
            O que está fazendo
          </Titulo>
          <ListaAoVivo eventos={dele} agentes={agentes} aoAbrirConversa={aoAbrirConversa} vazio="O que este agente fizer a partir de agora aparece aqui." />
        </div>
      </div>
    </>
  );
}
