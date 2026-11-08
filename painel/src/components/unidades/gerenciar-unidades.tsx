import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Image as ImageIcon, Plus, Search, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePodeNaOrganizacao } from "@/hooks/use-permissoes";
import { Button } from "@/components/ui/button";
import { FichaUnidade, FormUnidade, type TipoUnidadeSaude, type UnidadeSaude } from "./ficha-unidade";

/*
 * A conferência das unidades pela organização: a lista (a conferir primeiro), a ficha de cada uma e o cadastro de uma
 * nova pelo CEP. Usada na implantação e na Central de comando. Os dados vêm do panorama da organização de quem está
 * logado; depois de cada mudança, o panorama é recarregado (o mapa e o quadro da implantação acompanham).
 */

type Filtro = "conferir" | "todas";

export function GerenciarUnidades({ inicial }: { inicial?: string | "nova" }) {
  const qc = useQueryClient();
  const pode = usePodeNaOrganizacao()("gerenciar_unidades");
  const panorama = useQuery({
    queryKey: ["gestao-panorama", true],
    queryFn: () => api<{ organizacao: unknown; unidades?: UnidadeSaude[] }>("/organizacao/panorama"),
  });
  const catalogo = useQuery({
    queryKey: ["gestao-catalogo"],
    queryFn: () => api<{ tipos_unidade: TipoUnidadeSaude[] }>("/implantacao/catalogo"),
    staleTime: Infinity,
  });
  const [aberta, setAberta] = useState<string | "nova" | null>(inicial ?? null);
  const [filtro, setFiltro] = useState<Filtro>("conferir");
  const [termo, setTermo] = useState("");
  const tipos = catalogo.data?.tipos_unidade ?? [];
  const unidades = useMemo(() => panorama.data?.unidades ?? [], [panorama.data]);
  const aConferir = unidades.filter((u) => !u.confirmada).length;
  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ["gestao-panorama"] });
    qc.invalidateQueries({ queryKey: ["implantacao"] });
  };

  const lista = useMemo(() => {
    const t = termo.trim().toLowerCase();
    return unidades
      .filter((u) => (filtro === "conferir" ? !u.confirmada : true))
      .filter((u) => !t || `${u.nome} ${u.nome_fantasia ?? ""} ${u.bairro ?? ""} ${u.cnes ?? ""}`.toLowerCase().includes(t));
  }, [unidades, filtro, termo]);

  if (aberta === "nova")
    return (
      <div className="space-y-3">
        <Voltar aoVoltar={() => setAberta(null)} />
        <FormUnidade
          tipos={tipos}
          aoSalvar={(salva) => {
            recarregar();
            setAberta(salva.id);
          }}
          aoCancelar={() => setAberta(null)}
        />
      </div>
    );

  const unidade = aberta ? unidades.find((u) => u.id === aberta) : undefined;
  if (unidade)
    return (
      <div className="space-y-3">
        <Voltar aoVoltar={() => setAberta(null)} />
        <h3 className="text-base font-semibold">{unidade.nome_fantasia || unidade.nome}</h3>
        <FichaUnidade unidade={unidade} tipos={tipos} aoMudar={recarregar} />
      </div>
    );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {aConferir
          ? `${aConferir} de ${unidades.length} unidades a conferir. Abra cada uma, confira o endereço e o ponto no mapa e envie a foto da fachada.`
          : `As ${unidades.length} unidades estão conferidas.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Quais unidades" className="flex rounded-full bg-muted p-0.5 text-xs">
          {(
            [
              ["conferir", `A conferir · ${aConferir}`],
              ["todas", `Todas · ${unidades.length}`],
            ] as const
          ).map(([id, rotulo]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={filtro === id}
              onClick={() => setFiltro(id)}
              className={cn("rounded-full px-3 py-1", filtro === id ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground")}
            >
              {rotulo}
            </button>
          ))}
        </div>
        {pode && (
          <Button size="sm" className="ml-auto" onClick={() => setAberta("nova")}>
            <Plus /> Nova unidade
          </Button>
        )}
      </div>
      <label className="flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-sm">
        <Search className="size-4 text-muted-foreground" />
        <span className="sr-only">Buscar unidade</span>
        <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar por nome, bairro ou CNES" className="min-w-0 flex-1 bg-transparent outline-none" />
      </label>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {lista.map((u) => (
          <li key={u.id}>
            <button type="button" onClick={() => setAberta(u.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-secondary focus-visible:bg-secondary">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: tipos.find((t) => t.id === u.tipo_id)?.cor ?? "#424E6B" }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{u.nome_fantasia || u.nome}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {tipos.find((t) => t.id === u.tipo_id)?.nome ?? "Unidade"} · {u.bairro ?? "sem bairro"}
                </span>
              </span>
              {u.foto_id && <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-label="Tem foto" />}
              {u.confirmada ? (
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Conferida" />
              ) : (
                <TriangleAlert className="size-4 shrink-0 text-warning" aria-label="A conferir" />
              )}
            </button>
          </li>
        ))}
        {!lista.length && (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            {filtro === "conferir" ? "Nada a conferir." : "Nenhuma unidade cadastrada ainda."}
          </li>
        )}
      </ul>
    </div>
  );
}

function Voltar({ aoVoltar }: { aoVoltar: () => void }) {
  return (
    <button type="button" onClick={aoVoltar} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" /> Voltar à lista
    </button>
  );
}
