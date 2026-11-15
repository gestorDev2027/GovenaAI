import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, Building2, ClipboardCheck, Landmark, Radio, Rocket } from "lucide-react";
import { api, type RespostaPanorama } from "@/lib/api";
import { useAcesso, usePodeNaOrganizacao, useRotulos } from "@/hooks/use-permissoes";
import { passoDa, useTarefasAbertas } from "@/hooks/use-tarefas";
import { useAgentes } from "@/hooks/use-agentes";
import { useCentralAoVivo } from "@/hooks/use-central-ao-vivo";
import { fasesDaImplantacao } from "@/lib/rotulos";
import { rotuloDoEvento } from "@/lib/eventos";
import { fmtRelativo } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { BarraParticipacao, EmptyState, KpiCard, PageHeader, PageLoader, SeloComparacao } from "@/components/widgets/widgets";

/*
 * O Painel (a tela inicial): o que pede a decisão de alguém, o que os agentes estão fazendo agora, as unidades e a
 * montagem da secretaria. Só dado real: nada de número de exemplo e nenhum atalho para tela em construção.
 */

interface TipoUnidade {
  id: string;
  nome: string;
  cor: string | null;
  ordem: number | null;
}

type Unidade = { id: string; tipo_id?: string | null; confirmada?: boolean | null };

const PASSO_ROTULO = { aceitar: "Aceitar ou recusar", acoes: "Aprovar ações", revisar: "Revisar a entrega" } as const;

export function PainelGeral() {
  const acesso = useAcesso().data;
  const daOrganizacao = !!acesso?.organizacao;
  const podeNaOrganizacao = usePodeNaOrganizacao();
  // A mesma consulta da tela de unidades (o cache serve às duas).
  const panorama = useQuery({
    queryKey: ["gestao-panorama", daOrganizacao],
    queryFn: () => api<RespostaPanorama<Unidade>>(daOrganizacao ? "/organizacao/panorama" : "/gestao/panorama"),
  });
  const catalogo = useQuery({
    queryKey: ["gestao-catalogo"],
    queryFn: () => api<{ tipos_unidade: TipoUnidade[] }>("/implantacao/catalogo"),
    staleTime: Infinity,
  });
  const verTarefas = daOrganizacao && podeNaOrganizacao("ver_painel");
  const abertas = useTarefasAbertas(verTarefas);
  const agentes = useAgentes();
  const aoVivo = useCentralAoVivo();
  const dados = panorama.data?.organizacao ? panorama.data : null;
  const org = dados?.organizacao;
  const r = useRotulos(dados?.segmento.rotulos);
  const areas = dados?.areas ?? [];
  const unidades = dados?.unidades ?? [];
  const tipos = useMemo(() => new Map((catalogo.data?.tipos_unidade ?? []).map((t) => [t.id, t])), [catalogo.data]);
  const porTipo = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const u of unidades) contagem.set(u.tipo_id ?? "outro", (contagem.get(u.tipo_id ?? "outro") ?? 0) + 1);
    return [...contagem].sort((a, b) => b[1] - a[1]);
  }, [unidades]);

  const decisoes = (abertas.data?.tarefas ?? []).filter((t) => t.posso_decidir && passoDa(t));
  const comResponsavel = areas.filter((a) => a.responsavel).length;
  const comAtividades = areas.filter((a) => a.atividades.length > 0).length;
  const comAgente = areas.filter((a) => a.agentes.length > 0).length;
  const aConferir = unidades.filter((u) => !u.confirmada).length;
  const local = org ? [org.cidade, org.uf].filter(Boolean).join("-") : "";
  const nomeAgente = (id: string) => agentes.find((a) => a.id === id)?.nome ?? id;
  const eventos = [...aoVivo.eventos].reverse().filter((e) => e.tipo && e.tipo !== "pensando").slice(0, 7);

  // A implantação ainda aberta: em que etapa está e o que falta nela.
  const fases = fasesDaImplantacao(r);
  const fase = dados?.fase;
  const emImplantacao = !!fase && fase !== "concluido";
  const numeroDaFase = emImplantacao ? fases.findIndex(([id]) => id === fase) + 1 : 0;
  const faltaNaFase = emImplantacao ? (dados?.pendencias?.[fase] ?? []) : [];

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Painel"
        description={
          org
            ? `${[org.sigla || org.nome, local].filter(Boolean).join(" · ")}: o que pede decisão, o que os agentes fazem agora e como está a ${r.organizacao_curta}.`
            : "A visão geral da organização."
        }
      />

      {panorama.isLoading && <PageLoader className="h-[50vh]" label="Abrindo o painel" />}
      {panorama.isError && (
        <div className="surface-card">
          <EmptyState title="Não foi possível abrir o painel">{(panorama.error as Error).message}</EmptyState>
        </div>
      )}

      {panorama.data && !org && (
        <div className="surface-card has-waves">
          <EmptyState icon={<Landmark className="size-5" />} title="Nenhuma organização implantada">
            <p>O Painel se monta com a implantação: a cidade, os setores, os responsáveis, os agentes e as unidades.</p>
            <Button asChild className="mt-4">
              <Link to="/implantacao">
                <Rocket />
                Começar a implantação
              </Link>
            </Button>
          </EmptyState>
        </div>
      )}

      {org && emImplantacao && (
        <section aria-labelledby="implantacao" className="surface-card flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg bg-warning/16 text-warning-text">
            <Rocket className="size-5" />
          </span>
          <div className="min-w-0 flex-[1_1_20rem]">
            <h2 id="implantacao" className="text-sm font-semibold">
              Implantação em andamento · etapa {numeroDaFase} de {fases.length}: {fases[numeroDaFase - 1]?.[1]}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {faltaNaFase.length > 0 ? `Falta: ${faltaNaFase.slice(0, 3).join("; ")}${faltaNaFase.length > 3 ? "…" : "."}` : "Continue com o assistente para concluir."}
            </p>
          </div>
          <Button asChild variant="accent">
            <Link to="/implantacao">
              Continuar a implantação
              <ArrowRight />
            </Link>
          </Button>
        </section>
      )}

      {org && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard
              label="Esperando sua decisão"
              count={verTarefas ? decisoes.length : null}
              icon={<ClipboardCheck />}
              accent="amber"
              comparacao={decisoes.length > 0 && <SeloComparacao tom="ruim">pede ação</SeloComparacao>}
              detalhe={
                <Link to="/aprovacoes" className="text-primary-text hover:underline">
                  Abrir aprovações
                </Link>
              }
            />
            <KpiCard
              label="Agentes no ar"
              count={agentes.length}
              icon={<Bot />}
              accent="green"
              detalhe={`${comAgente} de ${areas.length} ${r.areas} com agente`}
            />
            <KpiCard
              label={r.Unidades}
              count={unidades.length}
              icon={<Building2 />}
              accent="cyan"
              comparacao={aConferir > 0 && <SeloComparacao tom="ruim">{aConferir} a conferir</SeloComparacao>}
              detalhe={unidades.length === 0 ? "nenhuma cadastrada ainda" : `${porTipo.length} ${porTipo.length === 1 ? "tipo" : "tipos"}`}
            />
            <KpiCard
              label={r.Areas}
              count={areas.length}
              icon={<Landmark />}
              detalhe={areas.length > 0 ? `${comResponsavel} com responsável` : `nenhum ${r.area} ainda`}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-5">
            <section className="surface-card flex flex-col gap-3 p-4 lg:col-span-3" aria-labelledby="decisoes">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="decisoes" className="text-sm font-semibold">
                  Esperando decisão
                </h2>
                <Link to="/aprovacoes" className="text-2xs text-primary-text hover:underline">
                  Ver todas
                </Link>
              </div>
              {!verTarefas ? (
                <p className="text-sm text-muted-foreground">Seu cargo não acompanha as aprovações.</p>
              ) : decisoes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nada esperando você agora. Quando um agente entregar algo, aparece aqui.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {decisoes.slice(0, 5).map((t) => {
                    const passo = passoDa(t);
                    return (
                      <li key={t.id}>
                        <Link
                          to="/aprovacoes"
                          className="flex items-center gap-3 rounded-md px-1 py-2.5 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{t.titulo}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[t.area, t.agente, fmtRelativo(t.criada_em)].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          {passo && (
                            <span className="shrink-0 rounded-full bg-warning/16 px-2 py-0.5 text-2xs font-semibold text-warning-text">{PASSO_ROTULO[passo]}</span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="surface-card flex flex-col gap-3 p-4 lg:col-span-2" aria-labelledby="ao-vivo">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="ao-vivo" className="flex items-center gap-2 text-sm font-semibold">
                  <Radio aria-hidden="true" className="size-4 text-success" />
                  Acontecimentos ao vivo
                </h2>
                <a href="/painel/secretaria" target="_blank" rel="noopener" className="text-2xs text-primary-text hover:underline">
                  Abrir a Central
                </a>
              </div>
              {eventos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum agente trabalhou desde que o servidor ligou. O que acontecer aparece aqui na hora.</p>
              ) : (
                <ol className="space-y-2.5">
                  {eventos.map((e) => (
                    <li key={e.id} className="flex gap-3 text-sm">
                      <span className="num w-14 shrink-0 text-2xs text-muted-foreground">{fmtRelativo(e.quando)}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{rotuloDoEvento(e)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{nomeAgente(e.agente)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <div className="grid gap-3 lg:grid-cols-5">
            <section className="surface-card flex flex-col gap-4 p-4 lg:col-span-3" aria-labelledby="montagem">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="montagem" className="text-sm font-semibold">
                  Montagem da {r.organizacao_curta}
                </h2>
                <span className="text-2xs text-muted-foreground">
                  de <span className="num">{areas.length}</span> {r.areas}
                </span>
              </div>
              {areas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum {r.area} cadastrado ainda.</p>
              ) : (
                <div className="flex flex-col gap-3.5">
                  <BarraParticipacao rotulo="Com responsável (quem aprova)" valor={comResponsavel} total={areas.length} cor="var(--color-viz-1)" />
                  <BarraParticipacao rotulo="Com atividades" valor={comAtividades} total={areas.length} cor="var(--color-viz-3)" i={1} />
                  <BarraParticipacao rotulo="Com o agente do setor" valor={comAgente} total={areas.length} cor="var(--color-viz-2)" i={2} />
                </div>
              )}
            </section>

            <section className="surface-card flex flex-col gap-4 p-4 lg:col-span-2" aria-labelledby="por-tipo">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="por-tipo" className="text-sm font-semibold">
                  {r.Unidades} por tipo
                </h2>
                <Link to="/cidade" className="text-2xs text-primary-text hover:underline">
                  Ver o território
                </Link>
              </div>
              {porTipo.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma {r.unidade} cadastrada. O Assistente de Implantação importa as unidades do CNES.
                </p>
              ) : (
                <div className="flex flex-col gap-3.5">
                  {porTipo.slice(0, 6).map(([tipo, n], i) => (
                    <BarraParticipacao key={tipo} rotulo={tipos.get(tipo)?.nome ?? tipo} valor={n} total={unidades.length} cor={tipos.get(tipo)?.cor ?? undefined} i={i} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
