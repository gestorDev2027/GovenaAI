import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  Calendar,
  Check,
  FlaskConical,
  Info,
  MessageSquare,
  Pencil,
  Plus,
  Rocket,
  Save,
  Search,
  ShieldCheck,
  Star,
  Users,
} from "lucide-react";
import { api, type AgenteFabrica, type Equipe } from "@/lib/api";
import { fmtDataHora } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/fields";
import { Paginacao, usePaginacao } from "@/components/ui/paginacao";
import { Campo, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import {
  CabecalhoOrdenavel,
  Chip,
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
import { AvatarAgente } from "./campos";
import { BotaoExcluirEquipe, InterruptorEquipe, travaDaEquipe, useAtivarEquipe } from "./ativacao";
import { CasosDoAgente } from "./casos";
import { usePode } from "@/hooks/use-permissoes";

/*
 * Equipes de agentes: vários agentes no mesmo canal. A cada mensagem, a recepção (que nunca fala com o
 * contato) escolhe quem responde, lendo a descrição de cada agente e as orientações da equipe. O padrão
 * recebe saudação e mensagem vaga, e as boas-vindas são as dele.
 */

const ID_EQUIPE = /^[a-z0-9-]{3,30}$/;
const MAX_MEMBROS = 8;
const idDe = (nome: string) =>
  nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);

export const useEquipes = () => useQuery({ queryKey: ["fabrica-equipes"], queryFn: () => api<{ equipes: Equipe[] }>("/fabrica/equipes") });

/** Os membros como etiquetas na cor de cada agente. */
function Membros({ ids, padrao, agentes }: { ids: string[]; padrao?: string; agentes: AgenteFabrica[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const a = agentes.find((x) => x.id === id);
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
            style={{ borderColor: `${a?.cor ?? "#888"}66`, background: `${a?.cor ?? "#888"}14` }}
            title={id === padrao ? "Padrão: recebe saudação e mensagem vaga" : undefined}
          >
            <span className="size-1.5 rounded-full" style={{ background: a?.cor ?? "#888" }} />
            {a?.nome ?? id}
            {id === padrao && <Star className="size-3 fill-current text-warning" />}
          </span>
        );
      })}
    </div>
  );
}

export function TabelaEquipes({ agentes }: { agentes: AgenteFabrica[] }) {
  const equipes = useEquipes();
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<{ id: string | null } | null>(null);
  const { chave, direcao, alternar } = useOrdenacao<"nome" | "atualizado">("nome", "asc");
  const lista = equipes.data?.equipes ?? [];
  const nomeDe = (id: string) => agentes.find((a) => a.id === id)?.nome ?? id;

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const sinal = direcao === "asc" ? 1 : -1;
    return lista
      .filter((e) => !termo || [e.nome, e.id, e.descricao, ...e.membros.map(nomeDe)].some((t) => t.toLowerCase().includes(termo)))
      .sort(
        (a, b) => (chave === "nome" ? a.nome.localeCompare(b.nome) : (a.atualizado_em ?? "").localeCompare(b.atualizado_em ?? "")) * sinal,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, busca, chave, direcao, agentes]);
  const paginacao = usePaginacao(visiveis);

  if (equipes.isLoading) return <PageLoader className="h-[50vh]" label="Carregando as equipes" />;
  if (equipes.isError)
    return (
      <div className="surface-card">
        <EmptyState title="Não foi possível carregar as equipes">{(equipes.error as Error).message}</EmptyState>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome ou membro" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">Vários agentes no mesmo canal: a recepção escolhe, a cada mensagem, quem responde.</p>
        <Button className="ml-auto" onClick={() => setAberta({ id: null })}>
          <Plus /> Nova equipe
        </Button>
      </div>

      <TableWrapper className="max-h-[calc(100dvh-18rem)]">
        <Table className="min-w-[960px]">
          <TableHeader>
            <tr>
              <TableHead>
                <CabecalhoOrdenavel rotulo="Equipe" campo="nome" chaveAtiva={chave} direcao={direcao} onAlternar={alternar} icone={Users} />
              </TableHead>
              <TableHead>Membros</TableHead>
              <TableHead icone={Star}>Padrão</TableHead>
              <TableHead icone={ShieldCheck}>Situação</TableHead>
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
                {lista.length ? "Nenhuma equipe com essa busca." : "Nenhuma equipe ainda. Crie a primeira em “Nova equipe”."}
              </TableEmpty>
            )}
            {paginacao.itens.map((e) => (
              <TableRow key={e.id} className="group cursor-pointer" onClick={() => setAberta({ id: e.id })}>
                <TableCell>
                  <div className="font-semibold">{e.nome}</div>
                  <div className="max-w-72 truncate text-xs text-muted-foreground" title={e.descricao}>
                    {e.descricao !== e.nome ? e.descricao : <span className="num">{e.id}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <Membros ids={e.membros} padrao={e.padrao} agentes={agentes} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{nomeDe(e.padrao)}</TableCell>
                <TableCell onClick={(ev) => ev.stopPropagation()}>
                  <InterruptorEquipe equipe={e} rotulo />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div>{fmtDataHora(e.atualizado_em)}</div>
                  {e.atualizado_por && <div className="text-xs text-muted-foreground">{e.atualizado_por}</div>}
                </TableCell>
                <TableCell className="sticky right-0 bg-card transition-colors group-hover:bg-muted" onClick={(ev) => ev.stopPropagation()}>
                  <div className="flex justify-end gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Editar"
                      aria-label={`Editar ${e.nome}`}
                      onClick={() => setAberta({ id: e.id })}
                    >
                      <Pencil />
                    </Button>
                    <Button size="icon" variant="ghost" asChild title="Testar no chat">
                      <Link to="/chat" search={{ agente: e.id }} aria-label={`Testar ${e.nome} no chat`}>
                        <MessageSquare />
                      </Link>
                    </Button>
                    <BotaoExcluirEquipe equipe={e} compacto aoExcluir={aberta?.id === e.id ? () => setAberta(null) : undefined} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>
      {lista.length > 10 && <Paginacao {...paginacao} />}

      <FormEquipe
        equipe={aberta?.id ? (lista.find((e) => e.id === aberta.id) ?? null) : null}
        aberto={aberta !== null}
        agentes={agentes}
        idsOcupados={[...agentes.map((a) => a.id), ...lista.map((e) => e.id)]}
        aoCriar={(e) => setAberta({ id: e.id })}
        aoFechar={() => setAberta(null)}
      />
    </div>
  );
}

/* ───────── Formulário ───────── */

type Secao = "equipe" | "membros" | "recepcao" | "casos" | "publicacao";

const SECOES: { id: Secao; rotulo: string; icone: ComponentType<{ className?: string }>; soCriada?: boolean }[] = [
  { id: "equipe", rotulo: "Equipe", icone: Users },
  { id: "membros", rotulo: "Membros e padrão", icone: Star },
  { id: "recepcao", rotulo: "Recepção", icone: Info },
  { id: "casos", rotulo: "Casos de teste", icone: FlaskConical, soCriada: true },
  { id: "publicacao", rotulo: "Testar e publicar", icone: Rocket, soCriada: true },
];
const DE_CAMPOS: Secao[] = ["equipe", "membros", "recepcao"];

type Rascunho = { id: string; idEditado: boolean; nome: string; descricao: string; membros: string[]; padrao: string; orientacoes: string };

const rascunhoDe = (e: Equipe | null): Rascunho =>
  e
    ? {
        id: e.id,
        idEditado: true,
        nome: e.nome,
        descricao: e.descricao === e.nome ? "" : e.descricao,
        membros: e.membros,
        padrao: e.padrao,
        orientacoes: e.orientacoes,
      }
    : { id: "", idEditado: false, nome: "", descricao: "", membros: [], padrao: "", orientacoes: "" };

function FormEquipe({
  equipe,
  aberto,
  agentes,
  idsOcupados,
  aoCriar,
  aoFechar,
}: {
  equipe: Equipe | null;
  aberto: boolean;
  agentes: AgenteFabrica[];
  /** Ids de agentes e de equipes: o de uma equipe nova não pode repetir nenhum. */
  idsOcupados: string[];
  aoCriar: (e: Equipe) => void;
  aoFechar: () => void;
}) {
  const qc = useQueryClient();
  const nova = equipe === null;
  const [secao, setSecao] = useState<Secao>("equipe");
  const [salvo, setSalvo] = useState<Rascunho>(() => rascunhoDe(equipe));
  const [r, setR] = useState<Rascunho>(salvo);

  // Abrir (ou criar) troca o rascunho; uma equipe que acabou de ser criada segue na seção em que estava.
  useEffect(() => {
    if (!aberto) return;
    const novo = rascunhoDe(equipe);
    setSalvo(novo);
    setR(novo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, equipe?.id, equipe?.atualizado_em]);
  useEffect(() => {
    if (aberto && nova) setSecao("equipe");
  }, [aberto, nova]);

  const id = nova && !r.idEditado ? idDe(r.nome) : r.id;
  const alterado = JSON.stringify({ ...r, id }) !== JSON.stringify({ ...salvo, id: salvo.id || id });
  const nomeDe = (x: string) => agentes.find((a) => a.id === x)?.nome ?? x;
  const problemas = [
    nova && !ID_EQUIPE.test(id) && "O identificador tem de 3 a 30 caracteres: minúsculas, números e hífen.",
    nova && idsOcupados.includes(id) && "Já existe um agente ou uma equipe com esse identificador.",
    !r.nome.trim() && "Falta o nome.",
    r.nome.trim().length > 80 && "O nome tem até 80 caracteres.",
    (r.membros.length < 2 || r.membros.length > MAX_MEMBROS) && `Escolha de 2 a ${MAX_MEMBROS} agentes.`,
    r.membros.length >= 2 && !r.membros.includes(r.padrao) && "Escolha o agente padrão entre os membros.",
  ].filter(Boolean) as string[];

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["fabrica-equipes"] });
    qc.invalidateQueries({ queryKey: ["agentes-visiveis"] });
    qc.invalidateQueries({ queryKey: ["central"] });
  };

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome: r.nome.trim(),
        descricao: r.descricao.trim(),
        membros: r.membros,
        padrao: r.padrao,
        orientacoes: r.orientacoes.trim(),
      };
      return nova
        ? api<Equipe>("/fabrica/equipes", { method: "POST", body: JSON.stringify({ id, ...corpo }) })
        : api<Equipe>(`/fabrica/equipes/${encodeURIComponent(equipe.id)}`, { method: "PUT", body: JSON.stringify(corpo) });
    },
    onSuccess: (e) => {
      atualizar();
      const novo = rascunhoDe(e);
      setSalvo(novo);
      setR(novo);
      toast.success(nova ? `Equipe ${e.nome} criada como rascunho` : `Equipe ${e.nome} salva`, {
        description: nova
          ? "Crie os casos de teste, teste no chat e publique."
          : e.publicada
            ? "Vale a partir da próxima mensagem."
            : undefined,
      });
      if (nova) aoCriar(e);
    },
    onError: (e: Error) => toast.error("Não foi possível salvar a equipe", { description: e.message }),
  });

  const fechar = () => {
    if (alterado && !window.confirm("Há alterações não salvas nesta equipe. Fechar e descartá-las?")) return;
    aoFechar();
  };

  const alternarMembro = (x: string) =>
    setR((atual) => {
      const membros = atual.membros.includes(x) ? atual.membros.filter((m) => m !== x) : [...atual.membros, x];
      // O padrão acompanha: sem padrão (ou com um que saiu), vale o primeiro membro.
      const padrao = membros.includes(atual.padrao) ? atual.padrao : (membros[0] ?? "");
      return { ...atual, membros, padrao };
    });

  const deCampos = DE_CAMPOS.includes(secao);
  const membros = r.membros.map((m) => ({ id: m, nome: nomeDe(m) }));
  // Os motivos de transferência válidos numa equipe são os de todos os membros.
  const categorias = Object.assign({}, ...r.membros.map((m) => agentes.find((a) => a.id === m)?.categorias ?? {})) as Record<
    string,
    string
  >;

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={(a) => !a && fechar()}
      largura="2xl"
      corpo="livre"
      focoNoPainel
      rotulo="Equipe de agentes"
      icone={<Users />}
      titulo={nova ? "Nova equipe" : equipe.nome}
      descricao="Vários agentes no mesmo canal. A recepção escolhe quem responde cada mensagem e nunca fala com o contato."
    >
      <div className="grid min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[15.5rem_minmax(0,1fr)] md:grid-rows-1">
        <nav
          aria-label="Seções da equipe"
          className="thin-scroll flex gap-1 overflow-x-auto border-b border-border p-2 md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:p-3"
        >
          {!nova && (
            <div className="mb-2 hidden items-center gap-2 px-2 md:flex">
              <Chip tom={equipe.publicada ? "sucesso" : "neutro"}>{equipe.publicada ? "Publicada" : "Rascunho"}</Chip>
              <span className="num truncate text-xs text-muted-foreground">{equipe.id}</span>
            </div>
          )}
          {SECOES.map((s) => {
            const ativa = s.id === secao;
            const Icone = s.icone;
            const bloqueada = s.soCriada && nova;
            return (
              <button
                key={s.id}
                type="button"
                disabled={bloqueada}
                title={bloqueada ? "Crie a equipe primeiro" : undefined}
                onClick={() => setSecao(s.id)}
                aria-current={ativa}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  ativa ? "bg-primary/12 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  bloqueada && "cursor-default opacity-50 hover:bg-transparent hover:text-muted-foreground",
                )}
              >
                <Icone className={cn("size-4 shrink-0", ativa && "text-primary-text")} />
                <span className="flex-1">{s.rotulo}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex min-h-0 flex-col">
          <div className="thin-scroll min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
            {secao === "equipe" && (
              <SecaoPainel titulo="Equipe">
                <div className="grid gap-5 md:grid-cols-2">
                  <Campo rotulo="Nome" ajuda="Como a equipe aparece no painel, no chat de teste e na Central.">
                    <Input
                      value={r.nome}
                      maxLength={80}
                      placeholder="Ex.: Atendimento ao servidor"
                      onChange={(e) => setR({ ...r, nome: e.target.value })}
                    />
                  </Campo>
                  <Campo
                    rotulo="Identificador"
                    ajuda={nova ? "Identifica a equipe (?agente=). Não muda depois." : "Identifica a equipe (?agente=)."}
                  >
                    <Input
                      className="num"
                      value={id}
                      disabled={!nova}
                      maxLength={30}
                      onChange={(e) => setR({ ...r, id: e.target.value.toLowerCase(), idEditado: true })}
                    />
                  </Campo>
                  <Campo className="md:col-span-2" rotulo="Descrição" ajuda="Opcional. Para a equipe saber do que se trata.">
                    <Input value={r.descricao} maxLength={300} onChange={(e) => setR({ ...r, descricao: e.target.value })} />
                  </Campo>
                </div>
              </SecaoPainel>
            )}

            {secao === "membros" && (
              <SecaoPainel titulo="Membros" contagem={r.membros.length}>
                <p className="text-xs text-muted-foreground">
                  De 2 a {MAX_MEMBROS} agentes. Marque a estrela do <b>padrão</b>: ele recebe saudação e mensagem vaga, e as boas-vindas da
                  equipe são as dele.
                </p>
                <div className="grid gap-2 lg:grid-cols-2">
                  {agentes.map((a) => {
                    const marcado = r.membros.includes(a.id);
                    const padrao = r.padrao === a.id && marcado;
                    return (
                      <div
                        key={a.id}
                        className={cn(
                          "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                          marcado ? "border-primary/50 bg-primary/5" : "border-border",
                        )}
                      >
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={marcado}
                          onClick={() => alternarMembro(a.id)}
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        >
                          <span
                            className={cn(
                              "mt-1 grid size-5 shrink-0 place-items-center rounded border",
                              marcado ? "border-primary bg-primary text-primary-foreground" : "border-input",
                            )}
                          >
                            {marcado && <Check className="size-3.5" />}
                          </span>
                          <AvatarAgente cor={a.cor} tamanho="sm" />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                              {a.nome}
                              {a.cargo && <span className="text-xs font-normal text-muted-foreground">{a.cargo}</span>}
                              {!a.publicado && (
                                <span className="rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">rascunho</span>
                              )}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {a.descricao || "Sem descrição: a recepção não terá como saber quando escolher este agente."}
                            </span>
                          </span>
                        </button>
                        {marcado && (
                          <button
                            type="button"
                            onClick={() => setR({ ...r, padrao: a.id })}
                            title={padrao ? "É o padrão" : "Tornar o padrão"}
                            aria-label={padrao ? `${a.nome} é o padrão` : `Tornar ${a.nome} o padrão`}
                            aria-pressed={padrao}
                            className={cn(
                              "grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-muted",
                              padrao ? "text-warning" : "text-muted-foreground/50",
                            )}
                          >
                            <Star className={cn("size-4", padrao && "fill-current")} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </SecaoPainel>
            )}

            {secao === "recepcao" && (
              <>
                <SecaoPainel titulo="O que a recepção lê">
                  <p className="text-xs text-muted-foreground">
                    A recepção escolhe pela descrição de cada agente, que se edita na identidade dele, e pelas orientações abaixo.
                  </p>
                  {r.membros.length ? (
                    <ul className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                      {r.membros.map((m) => {
                        const a = agentes.find((x) => x.id === m);
                        return (
                          <li key={m} className="flex gap-2">
                            <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: a?.cor }} />
                            <span>
                              <b>{a?.nome ?? m}</b>
                              {m === r.padrao && <span className="text-xs text-muted-foreground"> (padrão)</span>}:{" "}
                              {a?.descricao || "sem descrição"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">Escolha os membros primeiro.</p>
                  )}
                </SecaoPainel>
                <SecaoPainel titulo="Orientações para a recepção">
                  <Campo
                    rotulo="O que ela precisa saber além da descrição de cada agente"
                    ajuda={`${r.orientacoes.length} de 4.000 caracteres.`}
                  >
                    <Textarea
                      rows={8}
                      value={r.orientacoes}
                      maxLength={4000}
                      placeholder="Ex.: pedido de compra de medicamento vai para Compras mesmo quando cita o estoque. Dúvida sobre a fila vai para a Regulação."
                      onChange={(e) => setR({ ...r, orientacoes: e.target.value })}
                    />
                  </Campo>
                </SecaoPainel>
              </>
            )}

            {secao === "casos" && !nova && <CasosDoAgente agente={{ id: equipe.id, nome: equipe.nome, categorias, membros }} />}

            {secao === "publicacao" && !nova && <Publicacao equipe={equipe} alterado={alterado} aoMudar={atualizar} aoExcluir={aoFechar} />}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-5 py-3 sm:px-6">
            {!nova && (
              <Button variant="ghost" asChild>
                <Link to="/chat" search={{ agente: equipe.id }}>
                  <MessageSquare /> Testar no chat
                </Link>
              </Button>
            )}
            {deCampos && (
              <>
                {alterado && problemas.length > 0 && <span className="text-xs text-destructive">{problemas[0]}</span>}
                <Button variant="outline" className="ml-auto" disabled={!alterado} onClick={() => setR(salvo)}>
                  Descartar
                </Button>
                <Button disabled={!alterado || problemas.length > 0 || salvar.isPending} onClick={() => salvar.mutate()}>
                  <Save /> {nova ? "Criar equipe" : "Salvar"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </PainelLateral>
  );
}

function Publicacao({
  equipe,
  alterado,
  aoMudar,
  aoExcluir,
}: {
  equipe: Equipe;
  alterado: boolean;
  aoMudar: () => void;
  aoExcluir: () => void;
}) {
  const pode = usePode();
  const ativar = useAtivarEquipe(aoMudar);
  const trava = travaDaEquipe(equipe, pode("publicar"));

  return (
    <>
      <SecaoPainel titulo="1. Testar">
        <p className="text-xs text-muted-foreground">
          No chat de teste, cada resposta mostra a etapa “Recepção → agente”, com quem foi escolhido. Os casos de teste conferem a escolha
          automaticamente.
        </p>
        <Button variant="outline" asChild>
          <Link to="/chat" search={{ agente: equipe.id }}>
            <MessageSquare /> Abrir o chat de teste
          </Link>
        </Button>
      </SecaoPainel>
      <SecaoPainel titulo="2. Ativar">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
          {equipe.publicada ? (
            <>
              <Chip tom="sucesso">Ativa: está atendendo</Chip>
              <Button
                variant="outline"
                className="ml-auto"
                disabled={!!trava || ativar.isPending}
                title={trava}
                onClick={() =>
                  window.confirm(`Desativar ${equipe.nome}? Ela para de atender.`) && ativar.mutate({ id: equipe.id, ativa: false })
                }
              >
                <Archive /> Desativar
              </Button>
            </>
          ) : (
            <>
              <Chip>Inativa: não atende</Chip>
              <Button
                className="ml-auto"
                disabled={alterado || !!trava || ativar.isPending}
                title={trava ?? (alterado ? "Salve as alterações antes" : undefined)}
                onClick={() => ativar.mutate({ id: equipe.id, ativa: true })}
              >
                <Rocket /> Ativar
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          As boas-vindas são as do agente padrão.
        </p>
      </SecaoPainel>
      <SecaoPainel titulo="3. Excluir">
        <p className="text-xs text-muted-foreground">
          Só equipe inativa pode ser excluída. As conversas antigas continuam no histórico; o identificador fica
          reservado.
        </p>
        <div>
          <BotaoExcluirEquipe equipe={equipe} aoExcluir={aoExcluir} />
        </div>
      </SecaoPainel>
    </>
  );
}
