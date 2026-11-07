import { useMemo } from "react";
import { CheckCircle2, ChevronRight, Clock3, Headset, Users } from "lucide-react";
import type { AgenteCentral, ConversaCentral, EventoCentral } from "@/lib/api";
import { fmtInt, fmtSegundos } from "@/lib/formato";
import { tripulante } from "@/lib/tripulacao";
import { SETORES, type SetorId } from "@/lib/setores";
import { Atividade, Indicador, ListaAoVivo, serieDeAtividade, Titulo } from "./dashboard";
import { ICONE_SETOR } from "./painel-setor";

/*
 * A visão geral da Central ao vivo (o painel da direita sem nada selecionado): os números do período, a
 * atividade da última hora, um cartão por agente, os atalhos para os setores e tudo o que está
 * acontecendo agora.
 */

const conversandoAgora = (c: ConversaCentral) => c.parada_ha_s != null && c.parada_ha_s <= 120;

export function PainelGeral({
  agentes,
  periodo,
  eventos,
  aoRecolher,
  aoAbrirAgente,
  aoAbrirSetor,
  aoAbrirConversa,
}: {
  agentes: AgenteCentral[];
  periodo: string;
  eventos: EventoCentral[];
  aoRecolher: () => void;
  aoAbrirAgente: (id: string) => void;
  aoAbrirSetor: (id: SetorId) => void;
  aoAbrirConversa: (sessionId: string) => void;
}) {
  const todas = agentes.flatMap((a) => a.conversas);
  const ativas = todas.filter((c) => c.status === "em_atendimento");
  const tempos = agentes.map((a) => a.indicadores?.tempo_medio_resposta_s).filter((v): v is number => v != null);
  const serie = useMemo(() => serieDeAtividade(eventos), [eventos]);
  const maiorCarga = Math.max(1, ...agentes.map((a) => a.indicadores?.em_atendimento ?? 0));

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <div>
          <div className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Visão geral · {periodo}</div>
          <div className="text-base font-semibold">
            {agentes.length} {agentes.length === 1 ? "agente ativo" : "agentes ativos"}
          </div>
        </div>
        <button
          type="button"
          aria-label="Recolher o painel"
          title="Recolher o painel"
          onClick={aoRecolher}
          className="grid size-8 place-items-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          <Indicador icone={<Headset />} rotulo="Em atendimento" valor={fmtInt(ativas.length)} detalhe={`${fmtInt(ativas.filter(conversandoAgora).length)} conversando agora`} cor="#3b82f6" />
          <Indicador icone={<Users />} rotulo={`Transferidas · ${periodo}`} valor={fmtInt(todas.filter((c) => c.transferida_no_periodo).length)} cor="#f7931e" />
          <Indicador icone={<CheckCircle2 />} rotulo={`Encerradas · ${periodo}`} valor={fmtInt(todas.filter((c) => c.encerrada_no_periodo).length)} cor="#10b981" />
          <Indicador icone={<Clock3 />} rotulo="Tempo de resposta" valor={tempos.length ? fmtSegundos(tempos.reduce((a, b) => a + b, 0) / tempos.length) : "—"} cor="#8b5cf6" />
        </div>
        <Atividade serie={serie} cor="#3b82f6" rotulo="Atividade na última hora" />
        <div>
          <Titulo>Agentes</Titulo>
          <div className="grid grid-cols-2 gap-2">
            {agentes.map((a) => {
              const cor = tripulante(a.id, agentes).cor;
              const carga = a.indicadores?.em_atendimento ?? a.conversas.filter((c) => c.status === "em_atendimento").length;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => aoAbrirAgente(a.id)}
                  className="rounded-2xl border border-border bg-background/40 p-2.5 text-left transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full" style={{ background: cor }}>
                      <img src="/painel/espaco/gestorgov-branco.png" alt="" className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">{a.nome}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{a.cargo ?? a.funcao}</span>
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between text-[10px] text-muted-foreground">
                    <span>em atendimento</span>
                    <span className="num text-sm font-semibold text-foreground">{fmtInt(carga)}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${(carga / maiorCarga) * 100}%`, background: cor }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Titulo>Setores</Titulo>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(SETORES) as SetorId[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => aoAbrirSetor(id)}
                className="flex items-center gap-2 rounded-xl border border-border bg-background/40 px-2 py-1.5 text-left text-xs transition-colors hover:border-primary/40"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-lg text-white [&_svg]:size-3.5" style={{ background: SETORES[id].cor }}>
                  {ICONE_SETOR[id]}
                </span>
                <span className="truncate font-medium">{SETORES[id].nome}</span>
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
            Acontecendo agora
          </Titulo>
          <ListaAoVivo eventos={eventos} agentes={agentes} aoAbrirConversa={aoAbrirConversa} vazio="O que os agentes fizerem a partir de agora aparece aqui." />
        </div>
      </div>
    </>
  );
}
