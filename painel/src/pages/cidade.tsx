import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Landmark, MapPin, MapPinned, MessagesSquare, Rocket, Users, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAcesso } from "@/hooks/use-permissoes";
import { fmtInt } from "@/lib/formato";
import { EmptyState, PageHeader, PageLoader } from "@/components/widgets/widgets";
import { Table, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { MapaCidade, type UnidadeNoMapa } from "@/components/mapa/mapa-cidade";
import { cn } from "@/lib/utils";
import { FichaUnidade, type UnidadeSaude } from "@/components/unidades/ficha-unidade";

/*
 * Visão Cidade: o município com as unidades de saúde públicas e conveniadas ao SUS, a partir do cadastro
 * (GET /prefeitura/panorama ou /gestao/panorama). O mapa (Mapbox, com MAPBOX_TOKEN) mostra um pino por unidade;
 * clicar no pino ou na linha abre a ficha. A lista é a versão acessível do mapa e vale sem ele.
 */

interface TipoUnidade {
  id: string;
  nome: string;
  cor: string | null;
  ordem: number | null;
}

type Unidade = UnidadeSaude & { situacao?: string | null };

interface Setor {
  id: string;
  nome: string;
  responsavel: { nome: string } | null;
  agentes: unknown[];
  atividades: unknown[];
}

interface Panorama {
  municipio: {
    id: string;
    nome: string;
    uf: string;
    codigo_ibge: string;
    situacao: string | null;
    populacao: number | null;
    latitude: string | number | null;
    longitude: string | number | null;
  } | null;
  secretaria?: { nome: string | null; secretario_nome: string | null } | null;
  setores?: Setor[];
  unidades?: Unidade[];
  servidores?: unknown[];
  onboarding?: { etapa: string | null } | null;
}

const ETAPAS: Record<string, string> = {
  municipio: "município",
  unidades: "unidades de saúde",
  setores: "setores",
  atividades: "atividades",
  responsaveis: "responsáveis",
  agentes: "agentes",
  revisao: "revisão",
};

export function Cidade() {
  // Quem é de uma prefeitura vê a dela; a equipe GestorGov, o município padrão do servidor.
  const acesso = useAcesso().data;
  const daPrefeitura = !!acesso?.prefeitura;
  const token = acesso?.mapbox_token;
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const panorama = useQuery({
    queryKey: ["gestao-panorama", daPrefeitura],
    queryFn: () => api<Panorama>(daPrefeitura ? "/prefeitura/panorama" : "/gestao/panorama"),
  });
  const catalogo = useQuery({
    queryKey: ["gestao-catalogo"],
    queryFn: () => api<{ tipos_unidade: TipoUnidade[] }>("/implantacao/catalogo"),
    staleTime: Infinity,
  });
  const tipos = useMemo(() => new Map((catalogo.data?.tipos_unidade ?? []).map((t) => [t.id, t])), [catalogo.data]);
  const dados = panorama.data;
  const mun = dados?.municipio;
  const unidades = dados?.unidades ?? [];
  const porTipo = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const u of unidades) contagem.set(u.tipo_id ?? "outro", (contagem.get(u.tipo_id ?? "outro") ?? 0) + 1);
    return [...contagem].sort((a, b) => (tipos.get(a[0])?.ordem ?? 99) - (tipos.get(b[0])?.ordem ?? 99));
  }, [unidades, tipos]);
  const noMapa: UnidadeNoMapa[] = useMemo(
    () =>
      unidades
        .filter((u) => u.latitude != null && u.longitude != null)
        .map((u) => ({
          id: u.id,
          nome: u.nome_fantasia || u.nome,
          tipo: u.tipo_id ?? "outro",
          cor: tipos.get(u.tipo_id ?? "")?.cor ?? "#424E6B",
          latitude: Number(u.latitude),
          longitude: Number(u.longitude),
        })),
    [unidades, tipos],
  );
  const ficha = unidades.find((u) => u.id === selecionada);

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Cidade"
        icon={MapPinned}
        description={
          mun
            ? `${mun.nome}-${mun.uf} · as unidades de saúde do município e a situação da implantação.`
            : "O município, as unidades de saúde e a situação de cada uma."
        }
      />

      {panorama.isLoading && <PageLoader className="h-[50vh]" label="Abrindo o município" />}
      {panorama.isError && (
        <div className="surface-card">
          <EmptyState title="Não foi possível abrir o cadastro do município">{(panorama.error as Error).message}</EmptyState>
        </div>
      )}

      {dados && !mun && (
        <div className="surface-card has-waves">
          <EmptyState icon={<Landmark className="size-5" />} title="Nenhum município implantado">
            <p>
              A implantação é uma conversa com o Assistente de Implantação: ele pede o CEP da prefeitura, importa as unidades do CNES e
              monta os setores, as atividades, os responsáveis e os agentes.
            </p>
            <Link
              to="/chat"
              search={{ agente: "onboarding" }}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[filter] outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Rocket className="size-4" />
              Começar a implantação
            </Link>
          </EmptyState>
        </div>
      )}

      {mun && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Numero icone={Building2} rotulo="Unidades de saúde" valor={fmtInt(unidades.length)} />
            <Numero icone={Landmark} rotulo="Setores da secretaria" valor={fmtInt(dados?.setores?.length ?? 0)} />
            <Numero icone={Users} rotulo="Servidores cadastrados" valor={fmtInt(dados?.servidores?.length ?? 0)} />
            <Numero
              icone={Rocket}
              rotulo="Implantação"
              valor={mun.situacao === "ativo" ? "Concluída" : "Em andamento"}
              detalhe={
                mun.situacao !== "ativo" && dados?.onboarding?.etapa ? `etapa: ${ETAPAS[dados.onboarding.etapa] ?? dados.onboarding.etapa}` : undefined
              }
            />
          </div>

          {token && noMapa.length > 0 && (
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <MapaCidade
                token={token}
                unidades={noMapa}
                centro={mun.latitude != null && mun.longitude != null ? [Number(mun.latitude), Number(mun.longitude)] : null}
                selecionada={selecionada}
                aoSelecionar={setSelecionada}
                className="h-[460px]"
              />
              <FichaDaUnidade
                unidade={ficha}
                tipo={ficha ? tipos.get(ficha.tipo_id ?? "") : undefined}
                tipos={[...tipos.values()]}
                aoFechar={() => setSelecionada(null)}
                total={noMapa.length}
              />
            </section>
          )}

          {porTipo.length > 0 && (
            <section className="surface-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Unidades por tipo</h2>
              <ul className="flex flex-wrap gap-2">
                {porTipo.map(([tipo, n]) => (
                  <li key={tipo} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm">
                    <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: tipos.get(tipo)?.cor ?? "#424E6B" }} />
                    <span>{tipos.get(tipo)?.nome ?? tipo}</span>
                    <span className="num font-semibold">{fmtInt(n)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Unidades de saúde</h2>
              <p className="text-xs text-muted-foreground">Públicas e conveniadas ao SUS. Clique numa linha para ver no mapa.</p>
            </div>
            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Bairro</TableHead>
                    <TableHead>CNES</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <tbody>
                  {unidades.length === 0 && (
                    <TableEmpty colSpan={5}>
                      Nenhuma unidade cadastrada ainda. O Assistente de Implantação importa as unidades do CNES.
                    </TableEmpty>
                  )}
                  {unidades.map((u) => (
                    <TableRow
                      key={u.id}
                      onClick={() => setSelecionada(u.id)}
                      className={cn("cursor-pointer", u.id === selecionada && "bg-primary/8")}
                    >
                      <TableCell className="font-medium">{u.nome_fantasia || u.nome}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: tipos.get(u.tipo_id ?? "")?.cor ?? "#424E6B" }} />
                          {tipos.get(u.tipo_id ?? "")?.nome ?? u.tipo_id ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell>{u.bairro || "—"}</TableCell>
                      <TableCell className="num">{u.cnes || "—"}</TableCell>
                      <TableCell>{u.confirmada ? "Confirmada" : "A confirmar"}</TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </TableWrapper>
          </section>

          {(dados?.setores?.length ?? 0) > 0 && (
            <section className="surface-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Setores da {dados?.secretaria?.nome || "Secretaria Municipal de Saúde"}</h2>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {dados?.setores?.map((s) => (
                  <li key={s.id} className="rounded-md border border-border bg-background px-3 py-2">
                    <div className="text-sm font-medium">{s.nome}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.responsavel?.nome ? `Responsável: ${s.responsavel.nome}` : "Sem responsável"} · {fmtInt(s.atividades.length)} atividades ·{" "}
                      {s.agentes.length ? "com agente" : "sem agente"}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessagesSquare className="size-3.5" />
            Para corrigir ou completar o cadastro, converse com o{" "}
            <Link to="/chat" search={{ agente: "onboarding" }} className="font-semibold text-primary-text hover:underline">
              Assistente de Implantação
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}

function Numero({ icone: Icone, rotulo, valor, detalhe }: { icone: typeof Building2; rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="surface-card flex items-center gap-3 p-4">
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary-text">
        <Icone className="size-5" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{rotulo}</div>
        <div className="num text-xl font-semibold">{valor}</div>
        {detalhe && <div className="text-xs text-muted-foreground">{detalhe}</div>}
      </div>
    </div>
  );
}

function FichaDaUnidade({
  unidade,
  tipo,
  tipos,
  aoFechar,
  total,
}: {
  unidade?: Unidade;
  tipo?: TipoUnidade;
  tipos: TipoUnidade[];
  aoFechar: () => void;
  total: number;
}) {
  const qc = useQueryClient();
  if (!unidade) {
    return (
      <aside className="surface-card flex flex-col justify-center gap-2 p-5 text-sm text-muted-foreground">
        <MapPin className="size-5 text-primary-text" />
        <p className="font-semibold text-foreground">{total} unidades no mapa</p>
        <p>Clique num pino (ou numa linha da tabela) para ver a ficha da unidade.</p>
      </aside>
    );
  }
  return (
    <aside className="surface-card thin-scroll flex max-h-[460px] flex-col gap-3 overflow-y-auto p-5" aria-label={`Ficha de ${unidade.nome_fantasia || unidade.nome}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-1 size-3 shrink-0 rounded-full" style={{ background: tipo?.cor ?? "#424E6B" }} />
          <h2 className="text-base leading-snug font-semibold">{unidade.nome_fantasia || unidade.nome}</h2>
        </div>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar a ficha"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <FichaUnidade unidade={unidade} tipos={tipos} aoMudar={() => qc.invalidateQueries({ queryKey: ["gestao-panorama"] })} />
    </aside>
  );
}
