import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Calendar, FileText, Pencil, Plus, Save, Search, Sparkles, Trash2 } from "lucide-react";
import { api, type Skill } from "@/lib/api";
import { fmtDataHora } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/fields";
import { Paginacao, usePaginacao } from "@/components/ui/paginacao";
import { Campo, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import {
  CabecalhoOrdenavel,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
  useOrdenacao,
} from "@/components/ui/tabela";
import { EmptyState, PageLoader } from "@/components/widgets/widgets";
import { AssistenteIA } from "./assistente";
import { usePode } from "@/hooks/use-permissoes";

/*
 * Skills: instruções e materiais de um assunto que o agente só carrega quando o assunto aparece. Cada
 * skill serve a vários agentes; a lista fica numa tabela e o formulário num painel lateral.
 */

const ID_SKILL = /^[a-z0-9-]{3,40}$/;
const idDe = (nome: string) =>
  nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export const useSkills = () => useQuery({ queryKey: ["fabrica-skills"], queryFn: () => api<{ skills: Skill[] }>("/fabrica/skills") });

/** Depois de gravar ou excluir uma skill: a lista, as opções do formulário do agente e os agentes. */
export function useAtualizarSkills() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["fabrica-skills"] });
    qc.invalidateQueries({ queryKey: ["fabrica-opcoes"] });
    qc.invalidateQueries({ queryKey: ["fabrica-agentes"] });
  };
}

export function TabelaSkills({ nomeAgente }: { nomeAgente: (id: string) => string }) {
  const skills = useSkills();
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<Skill | "nova" | null>(null);
  const { chave, direcao, alternar } = useOrdenacao<"nome" | "atualizado">("nome", "asc");
  const lista = skills.data?.skills ?? [];

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const sinal = direcao === "asc" ? 1 : -1;
    return lista
      .filter((s) => !termo || [s.nome, s.id, s.descricao].some((t) => t.toLowerCase().includes(termo)))
      .sort(
        (a, b) => (chave === "nome" ? a.nome.localeCompare(b.nome) : (a.atualizado_em ?? "").localeCompare(b.atualizado_em ?? "")) * sinal,
      );
  }, [lista, busca, chave, direcao]);
  const paginacao = usePaginacao(visiveis);

  if (skills.isLoading) return <PageLoader className="h-[50vh]" label="Carregando as skills" />;
  if (skills.isError)
    return (
      <div className="surface-card">
        <EmptyState title="Não foi possível carregar as skills">{(skills.error as Error).message}</EmptyState>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Button className="ml-auto" onClick={() => setAberta("nova")}>
          <Plus /> Nova skill
        </Button>
      </div>

      <TableWrapper className="max-h-[calc(100dvh-18rem)]">
        <Table className="min-w-[960px]">
          <TableHeader>
            <tr>
              <TableHead>
                <CabecalhoOrdenavel
                  rotulo="Skill"
                  campo="nome"
                  chaveAtiva={chave}
                  direcao={direcao}
                  onAlternar={alternar}
                  icone={Sparkles}
                />
              </TableHead>
              <TableHead>Quando o agente usa</TableHead>
              <TableHead icone={FileText}>Materiais</TableHead>
              <TableHead icone={Bot}>Agentes</TableHead>
              <TableHead>
                <CabecalhoOrdenavel
                  rotulo="Atualizada"
                  campo="atualizado"
                  chaveAtiva={chave}
                  direcao={direcao}
                  onAlternar={alternar}
                  icone={Calendar}
                />
              </TableHead>
              <TableHead className="sticky right-0 bg-card text-right">Ações</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {visiveis.length === 0 && (
              <TableEmpty colSpan={6}>
                {lista.length ? "Nenhuma skill com essa busca." : "Nenhuma skill ainda. Crie a primeira em “Nova skill”."}
              </TableEmpty>
            )}
            {paginacao.itens.map((s) => (
              <TableRow key={s.id} onClick={() => setAberta(s)} className="group cursor-pointer">
                <TableCell>
                  <div className="font-semibold">{s.nome}</div>
                  <div className="num text-xs text-muted-foreground">{s.id}</div>
                </TableCell>
                <TableCell>
                  <p className="line-clamp-2 max-w-md text-xs text-muted-foreground">{s.descricao}</p>
                </TableCell>
                <TableCell className="num">{s.referencias.length}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {s.agentes.length ? (
                      s.agentes.map((a) => (
                        <span key={a} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {nomeAgente(a)}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">nenhum</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div>{fmtDataHora(s.atualizado_em)}</div>
                  {s.atualizado_por && <div className="text-xs text-muted-foreground">{s.atualizado_por}</div>}
                </TableCell>
                <TableCell className="sticky right-0 bg-card transition-colors group-hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end">
                    <Button size="icon" variant="ghost" title="Editar" aria-label="Editar" onClick={() => setAberta(s)}>
                      <Pencil />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>
      <Paginacao {...paginacao} />

      <FormSkill
        skill={aberta === "nova" ? null : aberta}
        aberto={aberta !== null}
        aoFechar={() => setAberta(null)}
        nomeAgente={nomeAgente}
      />
    </div>
  );
}

/** Criar (skill null) ou editar uma skill. `aoCriar` recebe a skill nova (o editor do agente já a marca). */
export function FormSkill({
  skill,
  aberto,
  aoFechar,
  aoCriar,
  nomeAgente,
}: {
  skill: Skill | null;
  aberto: boolean;
  aoFechar: () => void;
  aoCriar?: (s: Skill) => void;
  nomeAgente: (id: string) => string;
}) {
  const atualizar = useAtualizarSkills();
  const pode = usePode();
  const vazio = { id: "", idEditado: false, nome: "", descricao: "", instrucoes: "", referencias: [] as Skill["referencias"] };
  const [f, setF] = useState(vazio);
  useEffect(() => {
    if (!aberto) return;
    setF(
      skill
        ? {
            id: skill.id,
            idEditado: true,
            nome: skill.nome,
            descricao: skill.descricao,
            instrucoes: skill.instrucoes,
            referencias: skill.referencias,
          }
        : vazio,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, skill]);

  const nova = skill === null;
  const id = nova && !f.idEditado ? idDe(f.nome) : f.id;
  const problemas = [
    nova && !ID_SKILL.test(id) && "O identificador tem de 3 a 40 caracteres: minúsculas, números e hífen.",
    !f.nome.trim() && "Falta o nome.",
    !f.descricao.trim() && "Falta a descrição: é por ela que o agente decide usar a skill.",
    !f.instrucoes.trim() && "Faltam as instruções.",
    f.referencias.some((r) => !r.nome.trim() || !r.conteudo.trim()) && "Há material sem nome ou sem conteúdo.",
  ].filter(Boolean) as string[];

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { nome: f.nome.trim(), descricao: f.descricao.trim(), instrucoes: f.instrucoes, referencias: f.referencias };
      return nova
        ? api<Skill>("/fabrica/skills", { method: "POST", body: JSON.stringify({ id, ...corpo }) })
        : api<Skill>(`/fabrica/skills/${encodeURIComponent(skill.id)}`, { method: "PUT", body: JSON.stringify(corpo) });
    },
    onSuccess: (s) => {
      atualizar();
      toast.success(nova ? `Skill ${s.nome} criada` : `Skill ${s.nome} salva`, {
        description: s.agentes?.length ? `Já vale para ${s.agentes.map(nomeAgente).join(", ")}.` : "Marque-a nos agentes que devem usá-la.",
      });
      if (nova) aoCriar?.(s);
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível salvar a skill", { description: e.message }),
  });
  const excluir = useMutation({
    mutationFn: () => api(`/fabrica/skills/${encodeURIComponent(skill!.id)}`, { method: "DELETE" }),
    onSuccess: () => {
      atualizar();
      toast.success("Skill excluída");
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={(a) => !a && aoFechar()}
      largura="2xl"
      corpo="livre"
      rotulo="Skill"
      icone={<Sparkles />}
      titulo={nova ? "Nova skill" : skill.nome}
      descricao="Instruções e materiais de um assunto. O agente lê a descrição e só carrega o resto quando o assunto aparece."
      rodape={
        <>
          {!nova && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              disabled={excluir.isPending || skill.agentes.length > 0 || !pode("excluir")}
              title={!pode("excluir") ? "Sem a permissão Excluir" : skill.agentes.length ? "Tire a skill dos agentes antes de excluir." : undefined}
              onClick={() => window.confirm(`Excluir a skill ${skill.nome}?`) && excluir.mutate()}
            >
              <Trash2 /> Excluir
            </Button>
          )}
          {problemas.length > 0 && <span className="text-xs text-muted-foreground">{problemas[0]}</span>}
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button disabled={problemas.length > 0 || salvar.isPending} onClick={() => salvar.mutate()}>
            <Save /> {nova ? "Criar skill" : "Salvar"}
          </Button>
        </>
      }
    >
      <div className="grid min-h-0 w-full grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_28rem] lg:grid-rows-1">
        <div className="thin-scroll min-h-0 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          <SecaoPainel titulo="Skill">
            <div className="grid gap-4 md:grid-cols-2">
              <Campo rotulo="Nome">
                <Input
                  value={f.nome}
                  maxLength={120}
                  placeholder="Ex.: Segunda via de boleto"
                  onChange={(e) => setF({ ...f, nome: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Identificador" ajuda={nova ? "Não muda depois de criada." : undefined}>
                <Input
                  className="num"
                  value={id}
                  disabled={!nova}
                  maxLength={40}
                  onChange={(e) => setF({ ...f, id: e.target.value.toLowerCase(), idEditado: true })}
                />
              </Campo>
            </div>
            <Campo rotulo="Quando o agente usa" ajuda="Uma ou duas frases. É o que o agente lê para decidir se carrega a skill.">
              <Textarea rows={3} value={f.descricao} maxLength={1000} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
            </Campo>
            <Campo rotulo="Instruções" ajuda="O passo a passo do que o agente faz e responde nesse assunto.">
              <Textarea
                rows={12}
                className="num text-[13px]"
                value={f.instrucoes}
                maxLength={40000}
                onChange={(e) => setF({ ...f, instrucoes: e.target.value })}
              />
            </Campo>
          </SecaoPainel>

          {!nova && skill.agentes.length > 0 && (
            <SecaoPainel titulo="Agentes que usam" contagem={skill.agentes.length}>
              <div className="flex flex-wrap gap-1.5">
                {skill.agentes.map((a) => (
                  <span key={a} className="rounded-md bg-muted px-2 py-0.5 text-xs">
                    {nomeAgente(a)}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Salvar remonta esses agentes: a mudança vale na próxima mensagem.</p>
            </SecaoPainel>
          )}
        </div>
        <div className="thin-scroll min-h-0 space-y-6 overflow-y-auto border-t border-border bg-muted/20 px-5 py-5 sm:px-6 lg:border-t-0 lg:border-l">
          <AssistenteIA<{ id: string; nome: string; descricao: string; instrucoes: string; referencias: Skill["referencias"] }>
            tipo="skill"
            titulo="Montar a skill com IA"
            ajuda="Descreva o assunto ou cole o material (política, tabela, passo a passo). A IA preenche os campos; nada é salvo até você criar."
            placeholder="Ex.: termo de referência: o servidor pede o termo, o agente confirma objeto, quantidades e unidades, monta a minuta e lembra que precisa da aprovação do responsável…"
            aberto={nova}
            aoReceber={(r) =>
              setF((x) => ({
                ...x,
                id: nova ? r.id : x.id,
                idEditado: nova ? true : x.idEditado,
                nome: r.nome,
                descricao: r.descricao,
                instrucoes: r.instrucoes,
                referencias: r.referencias ?? [],
              }))
            }
          />

          <SecaoPainel
            titulo="Materiais de apoio"
            contagem={f.referencias.length}
            acao={
              <Button
                size="sm"
                variant="outline"
                onClick={() => setF({ ...f, referencias: [...f.referencias, { nome: "", conteudo: "" }] })}
              >
                <Plus /> Material
              </Button>
            }
          >
            <p className="text-xs text-muted-foreground">Tabelas e textos longos que o agente consulta dentro da skill.</p>
            {f.referencias.map((r, k) => (
              <div key={k} className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={r.nome}
                    maxLength={120}
                    placeholder="Nome, ex.: tabela-de-prazos"
                    onChange={(e) =>
                      setF({ ...f, referencias: f.referencias.map((x, i) => (i === k ? { ...x, nome: e.target.value } : x)) })
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Tirar o material"
                    onClick={() => setF({ ...f, referencias: f.referencias.filter((_, i) => i !== k) })}
                  >
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </div>
                <Textarea
                  rows={5}
                  className="num text-[12px]"
                  value={r.conteudo}
                  maxLength={60000}
                  onChange={(e) =>
                    setF({ ...f, referencias: f.referencias.map((x, i) => (i === k ? { ...x, conteudo: e.target.value } : x)) })
                  }
                />
              </div>
            ))}
          </SecaoPainel>
        </div>
      </div>
    </PainelLateral>
  );
}
