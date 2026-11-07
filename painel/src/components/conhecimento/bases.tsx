import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Calendar, Check, FileText, Globe2, Library, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import { api, type BaseCompartilhada } from "@/lib/api";
import { fmtDataHora } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { useAgentes } from "@/hooks/use-agentes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { Paginacao, usePaginacao } from "@/components/ui/paginacao";
import { Campo, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import { Chip, Table, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { EmptyState, PageLoader, Pills } from "@/components/widgets/widgets";
import { Documentos } from "./documentos";
import { usePode } from "@/hooks/use-permissoes";

/*
 * Bases de conhecimento compartilhadas: conjuntos de documentos que valem para todos os agentes (geral)
 * ou para os escolhidos. Cada agente busca nos documentos dele e nos das bases que valem para ele; o
 * roteiro e os exemplos continuam sendo só do agente. Os documentos de uma base usam as mesmas rotas de
 * hoje, com agente=base_<id> (o "dono").
 */

const ID_BASE = /^[a-z0-9-]{3,30}$/;
const idDe = (nome: string) =>
  nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);

const chaveBases = (agente?: string) => ["conhecimento-bases", agente ?? "todas"];

export const useBasesCompartilhadas = (agente?: string) =>
  useQuery({
    queryKey: chaveBases(agente),
    queryFn: () => api<{ bases: BaseCompartilhada[] }>(`/conhecimento/bases${agente ? `?agente=${encodeURIComponent(agente)}` : ""}`),
  });

function useGravarBase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      nova,
      corpo,
    }: {
      id: string;
      nova: boolean;
      corpo: Pick<BaseCompartilhada, "nome" | "descricao" | "geral" | "agentes">;
    }) =>
      nova
        ? api<BaseCompartilhada>("/conhecimento/bases", { method: "POST", body: JSON.stringify({ id, ...corpo }) })
        : api<BaseCompartilhada>(`/conhecimento/bases/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(corpo) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conhecimento-bases"] }),
    onError: (e: Error) => toast.error("Não foi possível salvar a base", { description: e.message }),
  });
}

/** "Todos os agentes" ou as etiquetas dos agentes, na cor de cada um. */
function Alcance({ base }: { base: Pick<BaseCompartilhada, "geral" | "agentes"> }) {
  const agentes = useAgentes();
  if (base.geral) return <Chip tom="primario">Todos os agentes</Chip>;
  if (!base.agentes.length) return <span className="text-xs text-muted-foreground">nenhum agente</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {base.agentes.map((id) => {
        const a = agentes.find((x) => x.id === id);
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium"
            style={{ borderColor: `${a?.cor ?? "#888"}66` }}
          >
            <span className="size-1.5 rounded-full" style={{ background: a?.cor ?? "#888" }} />
            {a?.nome ?? id}
          </span>
        );
      })}
    </div>
  );
}

export function TabelaBases() {
  const pode = usePode();
  const bases = useBasesCompartilhadas();
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<{ id: string | null } | null>(null);
  const lista = bases.data?.bases ?? [];
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return lista.filter((b) => !termo || [b.nome, b.id, b.descricao].some((t) => t.toLowerCase().includes(termo)));
  }, [lista, busca]);
  const paginacao = usePaginacao(visiveis);

  if (bases.isLoading) return <PageLoader className="h-[40vh]" label="Carregando as bases" />;
  if (bases.isError)
    return (
      <div className="surface-card">
        <EmptyState title="Não foi possível carregar as bases">{(bases.error as Error).message}</EmptyState>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Documentos que valem para vários agentes. O roteiro e os exemplos continuam sendo de cada agente.
        </p>
        <Button className="ml-auto" disabled={!pode("editar_conhecimento")} title={pode("editar_conhecimento") ? undefined : "Sem a permissão Editar conhecimento"} onClick={() => setAberta({ id: null })}>
          <Plus /> Nova base
        </Button>
      </div>
      <TableWrapper className="max-h-[calc(100dvh-24rem)]">
        <Table className="min-w-[820px]">
          <TableHeader>
            <tr>
              <TableHead icone={Library}>Base</TableHead>
              <TableHead icone={Bot}>Vale para</TableHead>
              <TableHead icone={FileText} className="text-right">
                Documentos
              </TableHead>
              <TableHead icone={Calendar}>Atualizada</TableHead>
              <TableHead className="sticky right-0 bg-card text-right">Ações</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {visiveis.length === 0 && (
              <TableEmpty colSpan={5}>
                {lista.length ? "Nenhuma base com essa busca." : "Nenhuma base compartilhada ainda. Crie a primeira em “Nova base”."}
              </TableEmpty>
            )}
            {paginacao.itens.map((b) => (
              <TableRow key={b.id} className="group cursor-pointer" onClick={() => setAberta({ id: b.id })}>
                <TableCell>
                  <div className="font-semibold">{b.nome}</div>
                  <div className="max-w-72 truncate text-xs text-muted-foreground" title={b.descricao}>
                    {b.descricao || <span className="num">{b.id}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <Alcance base={b} />
                </TableCell>
                <TableCell numeric>{b.documentos}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <div>{fmtDataHora(b.atualizado_em)}</div>
                  {b.atualizado_por && <div className="text-xs text-muted-foreground">{b.atualizado_por}</div>}
                </TableCell>
                <TableCell className="sticky right-0 bg-card transition-colors group-hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end">
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Editar"
                      aria-label={`Editar ${b.nome}`}
                      onClick={() => setAberta({ id: b.id })}
                    >
                      <Pencil />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>
      {lista.length > 10 && <Paginacao {...paginacao} />}
      <FormBase
        base={aberta?.id ? (lista.find((b) => b.id === aberta.id) ?? null) : null}
        aberto={aberta !== null}
        aoCriar={(b) => setAberta({ id: b.id })}
        aoFechar={() => setAberta(null)}
      />
    </div>
  );
}

function FormBase({
  base,
  aberto,
  aoCriar,
  aoFechar,
}: {
  base: BaseCompartilhada | null;
  aberto: boolean;
  aoCriar: (b: BaseCompartilhada) => void;
  aoFechar: () => void;
}) {
  const agentes = useAgentes();
  const gravar = useGravarBase();
  const qc = useQueryClient();
  const pode = usePode();
  const nova = base === null;
  const vazio = { id: "", idEditado: false, nome: "", descricao: "", geral: true, agentes: [] as string[] };
  const [f, setF] = useState(vazio);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  useEffect(() => {
    if (!aberto) return;
    setF(
      base ? { id: base.id, idEditado: true, nome: base.nome, descricao: base.descricao, geral: base.geral, agentes: base.agentes } : vazio,
    );
    setConfirmarExclusao(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, base?.id, base?.atualizado_em]);

  const id = nova && !f.idEditado ? idDe(f.nome) : f.id;
  const original = base ? { nome: base.nome, descricao: base.descricao, geral: base.geral, agentes: base.agentes } : null;
  const alterado =
    !original || JSON.stringify({ nome: f.nome, descricao: f.descricao, geral: f.geral, agentes: f.agentes }) !== JSON.stringify(original);
  const problema =
    nova && !ID_BASE.test(id)
      ? "O identificador tem de 3 a 30 caracteres: minúsculas, números e hífen."
      : !f.nome.trim()
        ? "Falta o nome."
        : !f.geral && !f.agentes.length
          ? "Escolha ao menos um agente, ou deixe a base valer para todos."
          : null;

  const excluir = useMutation({
    mutationFn: () => api(`/conhecimento/bases/${encodeURIComponent(base!.id)}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conhecimento-bases"] });
      toast.success("Base excluída");
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  const salvar = () =>
    gravar.mutate(
      { id, nova, corpo: { nome: f.nome.trim(), descricao: f.descricao.trim(), geral: f.geral, agentes: f.geral ? [] : f.agentes } },
      {
        onSuccess: (b) => {
          toast.success(nova ? `Base ${b.nome} criada` : `Base ${b.nome} salva`, {
            description: nova ? "Agora envie os documentos dela." : undefined,
          });
          if (nova) aoCriar(b);
        },
      },
    );

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={(a) => !a && aoFechar()}
      largura="2xl"
      rotulo="Base compartilhada"
      icone={<Library />}
      titulo={nova ? "Nova base" : base.nome}
      descricao="Documentos que valem para todos os agentes ou para os escolhidos. Cada agente busca nos dele e nos das bases que valem para ele."
      rodape={
        <>
          {!nova && (
            <div className="mr-auto flex items-center gap-2">
              {confirmarExclusao ? (
                <>
                  <span className="text-xs text-destructive">Excluir a base?</span>
                  <Button size="sm" variant="destructive" disabled={excluir.isPending} onClick={() => excluir.mutate()}>
                    Excluir
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmarExclusao(false)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  disabled={base.documentos > 0 || !pode("excluir")}
                  title={base.documentos > 0 ? "Exclua os documentos da base antes." : undefined}
                  onClick={() => setConfirmarExclusao(true)}
                >
                  <Trash2 /> Excluir base
                </Button>
              )}
            </div>
          )}
          {problema && alterado && <span className="text-xs text-muted-foreground">{problema}</span>}
          <Button variant="ghost" onClick={aoFechar}>
            Fechar
          </Button>
          <Button disabled={!alterado || !!problema || gravar.isPending || !pode("editar_conhecimento")} onClick={salvar}>
            <Save /> {nova ? "Criar base" : "Salvar"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <SecaoPainel titulo="Base">
          <div className="grid gap-4 md:grid-cols-2">
            <Campo rotulo="Nome">
              <Input
                value={f.nome}
                maxLength={80}
                placeholder="Ex.: Institucional"
                onChange={(e) => setF({ ...f, nome: e.target.value })}
              />
            </Campo>
            <Campo rotulo="Identificador" ajuda={nova ? "Não muda depois de criada." : undefined}>
              <Input
                className="num"
                value={id}
                disabled={!nova}
                maxLength={30}
                onChange={(e) => setF({ ...f, id: e.target.value.toLowerCase(), idEditado: true })}
              />
            </Campo>
          </div>
          <Campo rotulo="Descrição" ajuda="Opcional. Do que tratam os documentos.">
            <Input value={f.descricao} maxLength={300} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
          </Campo>
        </SecaoPainel>

        <SecaoPainel titulo="Vale para">
          <Pills
            rotulo="Vale para"
            value={f.geral ? "todos" : "escolhidos"}
            onChange={(v) => setF({ ...f, geral: v === "todos" })}
            options={[
              { value: "todos", label: "Todos os agentes" },
              { value: "escolhidos", label: "Agentes escolhidos" },
            ]}
          />
          {!f.geral && (
            <div className="grid gap-2 md:grid-cols-2">
              {agentes.map((a) => {
                const marcado = f.agentes.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="checkbox"
                    aria-checked={marcado}
                    onClick={() => setF({ ...f, agentes: marcado ? f.agentes.filter((x) => x !== a.id) : [...f.agentes, a.id] })}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-2.5 text-left",
                      marcado ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded border",
                        marcado ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {marcado && <Check className="size-3.5" />}
                    </span>
                    <span className="size-2 shrink-0 rounded-full" style={{ background: a.cor }} />
                    <span className="text-sm font-semibold">{a.nome}</span>
                    {a.cargo && <span className="truncate text-xs text-muted-foreground">{a.cargo}</span>}
                  </button>
                );
              })}
            </div>
          )}
          {f.geral && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Globe2 className="size-3.5" /> Vale também para os agentes que forem criados depois.
            </p>
          )}
        </SecaoPainel>

        {nova ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Crie a base para enviar os documentos dela.
          </p>
        ) : (
          <Documentos agente={base.dono} />
        )}
      </div>
    </PainelLateral>
  );
}

/** No editor do agente: as bases que valem para ele, com atalho para ligar ou desligar (as gerais valem sempre). */
export function BasesDoAgente({ agente }: { agente: string }) {
  const pode = usePode();
  const bases = useBasesCompartilhadas(agente);
  const gravar = useGravarBase();
  const lista = bases.data?.bases ?? [];

  const alternar = (b: BaseCompartilhada) =>
    gravar.mutate(
      {
        id: b.id,
        nova: false,
        corpo: {
          nome: b.nome,
          descricao: b.descricao,
          geral: false,
          agentes: b.vale ? b.agentes.filter((a) => a !== agente) : [...b.agentes, agente],
        },
      },
      {
        onSuccess: (x) =>
          toast.success(b.vale ? `${x.nome} deixou de valer para este agente` : `${x.nome} passou a valer para este agente`),
      },
    );

  return (
    <SecaoPainel titulo="Bases compartilhadas que este agente usa" contagem={lista.filter((b) => b.vale).length}>
      <p className="text-xs text-muted-foreground">
        O agente busca nos documentos dele e nos destas bases. As bases se criam em Conhecimento → Bases compartilhadas.
      </p>
      {bases.isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-4 text-center text-sm text-muted-foreground">
          Nenhuma base compartilhada ainda.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {lista.map((b) => (
            <li
              key={b.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2",
                b.vale ? "border-primary/40 bg-primary/5" : "border-border",
              )}
            >
              <Library className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{b.nome}</span>
                <span className="block text-xs text-muted-foreground">
                  {b.documentos} documento(s){b.descricao ? ` · ${b.descricao}` : ""}
                </span>
              </span>
              {b.geral ? (
                <Chip tom="primario">Todos os agentes</Chip>
              ) : (
                <Button size="sm" variant={b.vale ? "outline" : "default"} disabled={gravar.isPending || !pode("editar_conhecimento")} onClick={() => alternar(b)}>
                  {b.vale ? "Desligar" : "Usar"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SecaoPainel>
  );
}
