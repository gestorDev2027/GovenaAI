import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, ExternalLink, Info, Scale, Users } from "lucide-react";
import { toast } from "sonner";
import { api, type AvaliacaoQualidade, type ComparacaoQualidade, type DistribuicaoNiveis, type NivelSupervisor } from "@/lib/api";
import { fmtDataHora, fmtInt, fmtPct } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PainelLateral } from "@/components/ui/painel-lateral";
import { EmptyState, InfoTip } from "@/components/widgets/widgets";

/**
 * Qualidade: agente × atendimento humano, com a régua do CS do Supervisor (agente/qualidade.py). Compacto, no
 * fim da Visão geral: por critério, duas barras empilhadas (abaixo / dentro / acima) lado a lado; por tema, a
 * parte dentro ou acima de cada lado. O número de atendimentos aparece sempre: 30 contra 3 mil não se compara
 * sem ver.
 */

const ROTULO_NIVEL: Record<NivelSupervisor, string> = { abaixo: "Abaixo", dentro: "Dentro", acima: "Acima", nao_avaliavel: "Não avaliável" };

/** Uma linha por lado: a parte dos atendimentos avaliáveis que ficou dentro ou acima da régua (o que foi atingido). */
function LinhaAtingido({ d, rotulo, cor, destaque }: { d: DistribuicaoNiveis | null; rotulo: string; cor: string; destaque?: boolean }) {
  const atingiu = d && d.avaliaveis ? (d.dentro ?? 0) + (d.acima ?? 0) : null;
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)_64px_120px] items-center gap-3">
      <span className={cn("text-xs", destaque ? "font-semibold text-foreground" : "text-muted-foreground")}>{rotulo}</span>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted" title={d ? `abaixo ${fmtPct(d.abaixo)} · dentro ${fmtPct(d.dentro)} · acima ${fmtPct(d.acima)}` : "sem dados"}>
        {atingiu != null && <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${atingiu * 100}%`, background: cor }} />}
      </div>
      <span className={cn("num text-right text-sm font-bold", atingiu == null && "font-normal text-muted-foreground")}>{atingiu == null ? "—" : fmtPct(atingiu)}</span>
      <span className="num text-right text-[11px] text-muted-foreground">
        {d && d.avaliaveis ? (
          <>
            <span className={cn((d.abaixo ?? 0) > 0.1 && "font-semibold text-destructive")}>{fmtPct(d.abaixo)}</span> abaixo · {fmtInt(d.avaliaveis)}
          </>
        ) : (
          "sem dados"
        )}
      </span>
    </div>
  );
}

/** De onde sai o número de avaliadas: do total de atendimentos, só se julga quem conversou e terminou. */
export type CoberturaQualidade = { atendimentos: number; conversaram: number; abertas: number };

function Cobertura({ c, avaliadas }: { c: CoberturaQualidade; avaliadas: number }) {
  const soBoasVindas = Math.max(0, c.atendimentos - c.conversaram);
  const concluidas = Math.max(0, c.conversaram - c.abertas);
  const pct = concluidas > 0 ? Math.min(1, avaliadas / concluidas) : null;
  const passos: { rotulo: string; valor: number; nota: string; destaque?: boolean }[] = [
    { rotulo: "Atendimentos", valor: c.atendimentos, nota: "todos do período" },
    { rotulo: "Só boas-vindas", valor: soBoasVindas, nota: "o aluno não escreveu: não há conversa para julgar" },
    { rotulo: "Ainda abertas", valor: c.abertas, nota: "entram quando terminarem" },
    { rotulo: "Conversaram e terminaram", valor: concluidas, nota: "é o universo avaliável" },
    { rotulo: "Avaliadas", valor: avaliadas, nota: pct == null ? "—" : `${fmtPct(pct)} das que terminaram`, destaque: true },
  ];
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
      {passos.map((p) => (
        <div key={p.rotulo} className={cn("rounded-xl border border-border/50 bg-muted/20 px-3 py-2", p.destaque && "border-primary/40 bg-primary/8")}>
          <div className="text-[10px] tracking-wider text-muted-foreground uppercase">{p.rotulo}</div>
          <div className={cn("num text-lg font-bold", p.destaque && "text-primary-text")}>{fmtInt(p.valor)}</div>
          <div className="text-[10.5px] leading-snug text-muted-foreground">{p.nota}</div>
        </div>
      ))}
    </div>
  );
}

export function QualidadeComparada({ dias, periodo, cobertura }: { dias: number; periodo: string; cobertura?: CoberturaQualidade }) {
  const [revisar, setRevisar] = useState(false);
  const filtro = `dias=${dias}`;
  const q = useQuery({ queryKey: ["qualidade-comparacao", dias], queryFn: () => api<ComparacaoQualidade>(`/qualidade/comparacao?${filtro}`), staleTime: 5 * 60_000 });
  const d = q.data;

  return (
    <section className="surface-card rise p-4 md:p-6" style={{ ["--i" as string]: 18 }}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/14 text-accent">
            <Scale className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-base leading-snug font-semibold">
              Qualidade: agente × atendimento humano
              <InfoTip>
                O agente é avaliado com a <b>mesma régua do CS do Supervisor</b> (os mesmos critérios, níveis e catálogo de temas) e o mesmo
                modelo avaliador, e comparado com os atendimentos humanos de CS do mesmo período. Os casos não são iguais: o agente atende o
                primeiro contato e transfere os difíceis, que vão para os humanos. Compare dentro do mesmo tema e olhe o número de atendimentos.
              </InfoTip>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {d
                ? `${periodo} · agente ${fmtInt(d.agente.atendimentos)} atendimentos · humanos ${d.humanos.disponivel ? fmtInt(d.humanos.atendimentos) : "indisponível"} · régua ${d.regua.versao}`
                : "Régua do CS do Supervisor"}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRevisar(true)} disabled={!d || d.agente.atendimentos === 0}>
          <ClipboardCheck /> Revisar avaliações do agente
          {d && d.agente.revisadas > 0 && <span className="num text-xs text-muted-foreground">· {fmtInt(d.agente.revisadas)} revisadas</span>}
        </Button>
      </div>

      {q.isLoading && <p className="py-6 text-center text-xs text-muted-foreground">Carregando a comparação…</p>}
      {q.isError && <EmptyState title="Qualidade indisponível" className="py-6">{(q.error as Error).message}</EmptyState>}

      {d && d.agente.atendimentos === 0 && (
        <EmptyState title="Ainda não há avaliações do agente" className="py-6">
          A rotina diária avalia as conversas concluídas com a régua do Supervisor. Os números aparecem depois da primeira execução.
        </EmptyState>
      )}

      {d && cobertura && <Cobertura c={cobertura} avaliadas={d.agente.atendimentos} />}

      {d && d.agente.atendimentos > 0 && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: "var(--color-primary)" }} />
                Agente
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: "var(--color-accent)" }} />
                Humanos
              </span>
              <span>· % atingido = dentro ou acima da régua, entre os atendimentos avaliáveis</span>
            </div>
            <ul className="divide-y divide-border/40">
              {d.criterios.map((c) => (
                <li key={c.criterio} className="space-y-1.5 py-2.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {c.rotulo}
                    <InfoTip>{c.pergunta}</InfoTip>
                    {c.concordancia.revisadas > 0 && (
                      <span className="ml-auto text-[10.5px] text-muted-foreground" title="Revisões humanas que concordaram com o nível dado pela IA">
                        revisão concorda em <span className="num font-semibold text-foreground">{fmtPct(c.concordancia.pct)}</span> ({fmtInt(c.concordancia.revisadas)})
                      </span>
                    )}
                  </div>
                  <LinhaAtingido d={c.agente} rotulo="Agente" cor="var(--color-primary)" destaque />
                  <LinhaAtingido d={c.humanos} rotulo="Humanos" cor="var(--color-accent)" />
                </li>
              ))}
            </ul>
            {!d.humanos.disponivel && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning-text">
                <Info className="mt-px size-3.5 shrink-0" />
                <span>Lado humano indisponível: {d.humanos.motivo}</span>
              </p>
            )}
          </div>

          <div>
            <div className="mb-2 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Por tema · % dentro ou acima</div>
            <div className="thin-scroll max-h-[340px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card/95 backdrop-blur">
                  <tr className="border-b border-border/60 text-[10.5px] tracking-wider text-muted-foreground uppercase">
                    <th className="py-1.5 pr-2 text-left font-medium">Tema</th>
                    <th className="px-2 py-1.5 text-right font-medium">Agente</th>
                    <th className="py-1.5 pl-2 text-right font-medium">Humanos</th>
                  </tr>
                </thead>
                <tbody>
                  {d.temas
                    .filter((t) => t.agente_atendimentos > 0 || t.humanos_atendimentos >= 20)
                    .map((t) => (
                      <tr key={t.motivo} className="border-b border-border/30 last:border-0">
                        <td className="py-2 pr-2">{t.rotulo}</td>
                        <td className="px-2 py-2">
                          <MiniOk valor={t.agente_ok} n={t.agente_atendimentos} cor="var(--color-primary)" />
                        </td>
                        <td className="py-2 pl-2">
                          <MiniOk valor={t.humanos_ok} n={t.humanos_atendimentos} cor="var(--color-accent)" />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Users className="mt-px size-3.5 shrink-0" />
              <span>Entre parênteses, os atendimentos avaliados. Tema com menos de 20 atendimentos de um lado não sustenta comparação.</span>
            </p>
          </div>
        </div>
      )}

      {d && <RevisaoQualidade aberto={revisar} aoFechar={() => setRevisar(false)} dias={dias} />}
    </section>
  );
}

function MiniOk({ valor, n, cor }: { valor: number | null; n: number; cor: string }) {
  if (valor == null || n === 0) return <div className="text-right text-xs text-muted-foreground">—</div>;
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full" style={{ width: `${valor * 100}%`, background: cor }} />
      </span>
      <span className="num w-11 text-right text-xs font-semibold">{fmtPct(valor)}</span>
      <span className={cn("num w-10 text-right text-[10px]", n < 20 ? "text-warning-text" : "text-muted-foreground")}>({fmtInt(n)})</span>
    </div>
  );
}

/* ───────── Revisão humana: o coordenador confere o nível que a IA deu ao agente ───────── */

const NIVEIS: NivelSupervisor[] = ["abaixo", "dentro", "acima", "nao_avaliavel"];
const TOM_NIVEL: Record<NivelSupervisor, string> = {
  abaixo: "bg-destructive/14 text-destructive",
  dentro: "bg-accent/14 text-accent",
  acima: "bg-success/14 text-success",
  nao_avaliavel: "bg-muted text-muted-foreground",
};

function RevisaoQualidade({ aberto, aoFechar, dias }: { aberto: boolean; aoFechar: () => void; dias: number }) {
  const [filtro, setFiltro] = useState<"sem_revisao" | "abaixo" | "todas">("sem_revisao");
  const parametros = new URLSearchParams({ dias: String(dias), limite: "40" });
  if (filtro === "sem_revisao") parametros.set("sem_revisao", "true");
  const q = useQuery({
    queryKey: ["qualidade-avaliacoes", dias, filtro],
    queryFn: () => api<{ avaliacoes: AvaliacaoQualidade[]; criterios: { criterio: string; rotulo: string }[] }>(`/qualidade/avaliacoes?${parametros}`),
    enabled: aberto,
  });
  const lista = (q.data?.avaliacoes ?? []).filter((a) => filtro !== "abaixo" || Object.values(a.niveis).some((n) => n.nivel === "abaixo"));

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={(a) => !a && aoFechar()}
      largura="xl"
      rotulo="Régua do Supervisor"
      icone={<ClipboardCheck />}
      titulo="Revisar as avaliações do agente"
      descricao="Confira o nível que a IA deu ao agente em cada critério. Marque o nível que você daria: a concordância mostra se a régua está sendo aplicada ao agente com o mesmo rigor dos humanos."
    >
      <div className="mb-4 inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-background/40 p-1">
        {(
          [
            ["sem_revisao", "Sem revisão"],
            ["abaixo", "Com algum abaixo"],
            ["todas", "Todas"],
          ] as const
        ).map(([v, r]) => (
          <button
            key={v}
            type="button"
            onClick={() => setFiltro(v)}
            className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors", filtro === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {r}
          </button>
        ))}
      </div>
      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {q.data && lista.length === 0 && <EmptyState title="Nada para revisar com esse filtro" className="py-8" />}
      <div className="space-y-4">
        {lista.map((a) => (
          <ItemRevisao key={a.session_id} avaliacao={a} rotulos={Object.fromEntries((q.data?.criterios ?? []).map((c) => [c.criterio, c.rotulo]))} />
        ))}
      </div>
    </PainelLateral>
  );
}

function ItemRevisao({ avaliacao: a, rotulos }: { avaliacao: AvaliacaoQualidade; rotulos: Record<string, string> }) {
  const qc = useQueryClient();
  const [revisao, setRevisao] = useState<Record<string, NivelSupervisor>>(() => a.revisao ?? Object.fromEntries(Object.entries(a.niveis).map(([c, n]) => [c, n.nivel])));
  const salvar = useMutation({
    mutationFn: () => api(`/qualidade/avaliacoes/${encodeURIComponent(a.session_id)}/revisao`, { method: "PUT", body: JSON.stringify({ revisao }) }),
    onSuccess: () => {
      toast.success("Revisão salva");
      qc.invalidateQueries({ queryKey: ["qualidade-avaliacoes"] });
      qc.invalidateQueries({ queryKey: ["qualidade-comparacao"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const discorda = Object.entries(revisao).filter(([c, n]) => a.niveis[c]?.nivel !== n).length;

  return (
    <article className="rounded-xl border border-border/60 bg-muted/15 p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md bg-primary/10 px-2 py-0.5 font-semibold text-primary-text">{a.tema ?? "Sem tema"}</span>
        {a.iniciada_em && <span className="text-muted-foreground">{fmtDataHora(a.iniciada_em)}</span>}
        {a.revisor && (
          <span className="flex items-center gap-1 text-success">
            <Check className="size-3.5" /> revisada por {a.revisor}
          </span>
        )}
        <Link to="/conversas" search={{ id: a.session_id }} className="ml-auto flex items-center gap-1 font-semibold text-primary-text hover:underline">
          Abrir a conversa <ExternalLink className="size-3" />
        </Link>
      </header>
      <ul className="space-y-3">
        {Object.entries(a.niveis).map(([criterio, n]) => (
          <li key={criterio} className="grid gap-1.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                {rotulos[criterio] ?? criterio}
                <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase", TOM_NIVEL[n.nivel])}>IA: {ROTULO_NIVEL[n.nivel]}</span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{n.evidencia}</p>
            </div>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Nível que você daria em ${rotulos[criterio] ?? criterio}`}>
              {NIVEIS.map((nivel) => (
                <button
                  key={nivel}
                  type="button"
                  role="radio"
                  aria-checked={revisao[criterio] === nivel}
                  onClick={() => setRevisao((r) => ({ ...r, [criterio]: nivel }))}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] transition-colors",
                    revisao[criterio] === nivel ? cn("border-transparent font-semibold", TOM_NIVEL[nivel]) : "border-border/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {ROTULO_NIVEL[nivel]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <footer className="mt-3 flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground">{discorda ? `Você discorda em ${discorda} critério(s)` : "Você concorda com a IA em todos"}</span>
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
          {salvar.isPending ? "Salvando…" : "Salvar revisão"}
        </Button>
      </footer>
    </article>
  );
}
