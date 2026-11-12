import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Building2,
  ChartColumnBig,
  ClipboardCheck,
  ExternalLink,
  FilePen,
  LayoutDashboard,
  Landmark,
  Library,
  MonitorPlay,
  Rocket,
  Users,
} from "lucide-react";
import { api, type RespostaPanorama } from "@/lib/api";
import { useAcesso, usePodeNaOrganizacao, useRotulos } from "@/hooks/use-permissoes";
import { useContagemAprovacoes } from "@/hooks/use-tarefas";
import { BarraParticipacao, EmptyState, KpiCard, PageHeader, PageLoader, SeloComparacao } from "@/components/widgets/widgets";

/*
 * O Painel (a tela inicial): os números que o cadastro já tem (setores, unidades, servidores, aprovações), a montagem
 * da secretaria em barras de participação e os atalhos para os módulos. Só dado real: os módulos novos (Telão,
 * Editais, Produção, Análises) aparecem como atalhos "em construção", sem números.
 */

interface TipoUnidade {
  id: string;
  nome: string;
  cor: string | null;
  ordem: number | null;
}

type Unidade = { id: string; tipo_id?: string | null };

const MODULOS = [
  { to: "/telao", rotulo: "Telão", icone: MonitorPlay, texto: "Sala de situação ao vivo" },
  { to: "/editais", rotulo: "Editais", icone: Library, texto: "Modelos da Lei 14.133" },
  { to: "/producao", rotulo: "Produção", icone: FilePen, texto: "Processo em fases, com os agentes" },
  { to: "/analises", rotulo: "Análises", icone: ChartColumnBig, texto: "Execução orçamentária" },
] as const;

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
  const aprovacoes = useContagemAprovacoes(daOrganizacao && podeNaOrganizacao("ver_painel"));
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

  const comResponsavel = areas.filter((a) => a.responsavel).length;
  const comAtividades = areas.filter((a) => a.atividades.length > 0).length;
  const comAgente = areas.filter((a) => a.agentes.length > 0).length;
  const local = org ? [org.cidade, org.uf].filter(Boolean).join("-") : "";

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Painel"
        icon={LayoutDashboard}
        description={org ? `${[org.sigla || org.nome, local].filter(Boolean).join(" · ")} · a visão geral da ${r.organizacao_curta}.` : "A visão geral da organização."}
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
            <Link
              to="/implantacao"
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[filter] outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Rocket className="size-4" />
              Começar a implantação
            </Link>
          </EmptyState>
        </div>
      )}

      {org && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard
              label={r.Areas}
              count={areas.length}
              icon={<Landmark />}
              comparacao={areas.length > 0 && <SeloComparacao>{comAgente} com agente</SeloComparacao>}
            />
            <KpiCard
              label={r.Unidades}
              count={unidades.length}
              icon={<Building2 />}
              accent="cyan"
              detalhe={unidades.length === 0 ? "nenhuma cadastrada ainda" : `${porTipo.length} ${porTipo.length === 1 ? "tipo" : "tipos"}`}
            />
            <KpiCard label={`${r.Pessoas} cadastrados`} count={dados?.pessoas.length ?? 0} icon={<Users />} accent="green" />
            <KpiCard
              label="Esperando aprovação"
              count={aprovacoes}
              icon={<ClipboardCheck />}
              accent="amber"
              comparacao={aprovacoes > 0 && <SeloComparacao tom="ruim">pede ação</SeloComparacao>}
              detalhe={
                <Link to="/aprovacoes" className="text-primary-text hover:underline">
                  Abrir aprovações
                </Link>
              }
            />
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

          <section aria-labelledby="modulos" className="space-y-2">
            <h2 id="modulos" className="text-sm font-semibold">
              Módulos
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {MODULOS.map(({ to, rotulo, icone: Icone, texto }) => (
                <Link key={to} to={to} className="surface-card is-interactive group flex items-start gap-3 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary-text">
                    <Icone className="size-[18px]" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold">
                      {rotulo}
                      <span className="rounded bg-warning/16 px-1.5 text-2xs font-semibold whitespace-nowrap text-warning-text">em breve</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{texto}</span>
                  </span>
                </Link>
              ))}
              <a
                href="/painel/secretaria"
                target="_blank"
                rel="noopener"
                className="surface-card is-interactive group flex items-start gap-3 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-success/14 text-success">
                  <Bot className="size-[18px]" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    Central ao vivo
                    <ExternalLink aria-hidden="true" className="size-3 opacity-60" />
                  </span>
                  <span className="text-xs text-muted-foreground">O prédio com os agentes trabalhando (outra aba)</span>
                </span>
              </a>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
