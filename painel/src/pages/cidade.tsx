import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Landmark, MapPinned, MessagesSquare, Rocket, Users } from "lucide-react";
import { api, type RespostaPanorama } from "@/lib/api";
import { useAcesso, useRotulos } from "@/hooks/use-permissoes";
import { fasesDaImplantacao } from "@/lib/rotulos";
import { fmtInt } from "@/lib/formato";
import { EmptyState, PageHeader, PageLoader } from "@/components/widgets/widgets";
import { Table, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { Slideover } from "@/components/comando/slideover";
import { cn } from "@/lib/utils";
import { FichaUnidade, type UnidadeSaude } from "@/components/unidades/ficha-unidade";

/*
 * As unidades da organização, no painel (unidades de saúde na saúde; matriz, filiais, lojas na empresa): a lista
 * (sem mapa: o mapa é a aba Cidade/Mapa, /comando), com a ficha de cada uma num painel lateral (conferência, fotos,
 * agente da unidade), os números da implantação e as áreas.
 */

interface TipoUnidade {
  id: string;
  nome: string;
  cor: string | null;
  ordem: number | null;
}

type Unidade = UnidadeSaude & { situacao?: string | null };

export function Cidade() {
  // Quem é de uma organização vê a dela; a equipe GestorGov, a organização padrão do servidor.
  const acesso = useAcesso().data;
  const daOrganizacao = !!acesso?.organizacao;
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const qc = useQueryClient();
  const panorama = useQuery({
    queryKey: ["gestao-panorama", daOrganizacao],
    queryFn: () => api<RespostaPanorama<Unidade>>(daOrganizacao ? "/organizacao/panorama" : "/gestao/panorama"),
  });
  const catalogo = useQuery({
    queryKey: ["gestao-catalogo"],
    queryFn: () => api<{ tipos_unidade: TipoUnidade[] }>("/implantacao/catalogo"),
    staleTime: Infinity,
  });
  const tipos = useMemo(() => new Map((catalogo.data?.tipos_unidade ?? []).map((t) => [t.id, t])), [catalogo.data]);
  const dados = panorama.data?.organizacao ? panorama.data : null;
  const org = dados?.organizacao;
  const r = useRotulos(dados?.segmento.rotulos);
  const usaCnes = dados?.segmento.usa_cnes ?? true;
  const fases = new Map<string, string>(fasesDaImplantacao(r));
  const fase = dados?.fase ?? dados?.onboarding?.etapa ?? null;
  const local = org ? [org.cidade, org.uf].filter(Boolean).join("-") : "";
  const unidades = dados?.unidades ?? [];
  const porTipo = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const u of unidades) contagem.set(u.tipo_id ?? "outro", (contagem.get(u.tipo_id ?? "outro") ?? 0) + 1);
    return [...contagem].sort((a, b) => (tipos.get(a[0])?.ordem ?? 99) - (tipos.get(b[0])?.ordem ?? 99));
  }, [unidades, tipos]);
  const ficha = unidades.find((u) => u.id === selecionada);

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title={r.Unidades}
        icon={MapPinned}
        description={
          org
            ? `${[org.sigla || org.nome, local].filter(Boolean).join(" · ")} · as ${r.unidades}, a conferência de cada uma e os ${r.areas} da ${r.organizacao_curta}.`
            : `A organização, as ${r.unidades} e a situação de cada uma.`
        }
      />

      {panorama.isLoading && <PageLoader className="h-[50vh]" label="Abrindo o cadastro" />}
      {panorama.isError && (
        <div className="surface-card">
          <EmptyState title="Não foi possível abrir o cadastro da organização">{(panorama.error as Error).message}</EmptyState>
        </div>
      )}

      {panorama.data && !org && (
        <div className="surface-card has-waves">
          <EmptyState icon={<Landmark className="size-5" />} title="Nenhuma organização implantada">
            <p>
              A implantação é uma conversa com o Assistente de Implantação: ele pergunta se é uma Secretaria de Saúde ou uma empresa, pede os
              dados do cadastro, monta as áreas, as atividades, os responsáveis e os agentes e, por último, traz as unidades.
            </p>
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Numero icone={Building2} rotulo={r.Unidades} valor={fmtInt(unidades.length)} />
            <Numero icone={Landmark} rotulo={`${r.Areas} da ${r.organizacao_curta}`} valor={fmtInt(dados?.areas.length ?? 0)} />
            <Numero icone={Users} rotulo={`${r.Pessoas} cadastrados`} valor={fmtInt(dados?.pessoas.length ?? 0)} />
            <Numero
              icone={Rocket}
              rotulo="Implantação"
              valor={org.situacao === "ativo" ? "Concluída" : "Em andamento"}
              detalhe={org.situacao !== "ativo" && fase ? `etapa: ${(fases.get(fase) ?? fase).toLowerCase()}` : undefined}
            />
          </div>

          {ficha && (
            <Slideover
              titulo={ficha.nome_fantasia || ficha.nome}
              subtitulo={tipos.get(ficha.tipo_id ?? "")?.nome ?? r.Unidade}
              aoFechar={() => setSelecionada(null)}
            >
              <FichaUnidade unidade={ficha} tipos={[...tipos.values()]} aoMudar={() => qc.invalidateQueries({ queryKey: ["gestao-panorama"] })} />
            </Slideover>
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
              <h2 className="text-sm font-semibold">{r.Unidades}</h2>
              <p className="text-xs text-muted-foreground">
                {usaCnes ? "Públicas e conveniadas ao SUS. " : ""}Clique numa linha para abrir a ficha.{" "}
                <a href="/painel/comando" target="_blank" rel="noreferrer" className="font-semibold text-primary-text hover:underline">
                  Ver no mapa
                </a>
              </p>
            </div>
            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Bairro</TableHead>
                    {usaCnes && <TableHead>CNES</TableHead>}
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <tbody>
                  {unidades.length === 0 && (
                    <TableEmpty colSpan={usaCnes ? 5 : 4}>
                      Nenhuma unidade cadastrada ainda.{" "}
                      {usaCnes ? "O Assistente de Implantação importa as unidades do CNES." : "O Assistente de Implantação cadastra as unidades com você."}
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
                      {usaCnes && <TableCell className="num">{u.cnes || "—"}</TableCell>}
                      <TableCell>{u.confirmada ? "Conferida" : "A conferir"}</TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </TableWrapper>
          </section>

          {(dados?.areas.length ?? 0) > 0 && (
            <section className="surface-card p-4">
              <h2 className="mb-3 text-sm font-semibold">
                {r.Areas} da {org.nome || r.organizacao}
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {dados?.areas.map((s) => (
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
            <Link to="/implantacao" className="font-semibold text-primary-text hover:underline">
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
