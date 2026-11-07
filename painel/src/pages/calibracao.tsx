import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookMarked,
  Bot,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Database,
  Lightbulb,
  ExternalLink,
  Loader2,
  MessageSquare,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Tag,
  ThumbsDown,
  ThumbsUp,
  UserCheck,
  XCircle,
} from "lucide-react";
import {
  api,
  type AnaliseCuradoria,
  type AvaliacaoHumana,
  type ExemploCalibracao,
  type ResumoCalibracao,
  type Situacao,
} from "@/lib/api";
import { fmtDataHora, fmtRelativo } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/fields";
import { Campo, PainelLateral } from "@/components/ui/painel-lateral";
import {
  CabecalhoOrdenavel,
  Chip,
  Marcador,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
  useOrdenacao,
} from "@/components/ui/tabela";
import { Abas, EmptyState, KpiCard, PageHeader, PageLoader, Pills } from "@/components/widgets/widgets";
import { Paginacao, usePaginacao } from "@/components/ui/paginacao";
import { useOpcoesCalibracao } from "@/components/calibracao/avaliar-resposta";
import { Datasets } from "@/components/calibracao/datasets";
import { FrasesGuardrail } from "@/components/calibracao/frases-guardrail";
import { Lacunas } from "@/components/calibracao/lacunas";

type Aba = Situacao | "lacunas" | "guardrail" | "datasets" | "exemplos";

const ABAS: { value: Aba; label: string }[] = [
  { value: "pendente", label: "Aguardando curadoria" },
  { value: "lacunas", label: "Lacunas" },
  { value: "aprovada", label: "Aprovadas" },
  { value: "recusada", label: "Recusadas" },
  { value: "guardrail", label: "Guardrail" },
  { value: "datasets", label: "Datasets gold e bad" },
  { value: "exemplos", label: "Exemplos que o agente usa" },
];

const ICONE_ABA: Record<Aba, typeof Clock3> = {
  pendente: Clock3,
  lacunas: Lightbulb,
  aprovada: CheckCircle2,
  recusada: XCircle,
  guardrail: ShieldAlert,
  datasets: Database,
  exemplos: BookMarked,
};

const ORIGEM: Record<string, string> = { chat_teste: "Chat de teste", conversa: "Conversa real", guardrail: "Guardrail" };
const SITUACOES: Aba[] = ["pendente", "aprovada", "recusada"];

const RECOMENDACAO = {
  aprovar: { rotulo: "Aprovar", tom: "sucesso" },
  recusar: { rotulo: "Recusar", tom: "erro" },
  revisar: { rotulo: "Revisar", tom: "alerta" },
} as const;

const CONFIANCA = { alta: "confiança alta", media: "confiança média", baixa: "confiança baixa" } as const;

type Revisao = { id: number; decisao: "aprovar" | "recusar"; resposta_ideal?: string; observacao?: string };

function revisar(r: Revisao) {
  return api(`/calibracao/avaliacoes/${r.id}/revisar`, {
    method: "POST",
    body: JSON.stringify({ decisao: r.decisao, resposta_ideal: r.resposta_ideal, observacao: r.observacao ?? "" }),
  });
}

/** Ideal que vale ao aprovar sem abrir o detalhe: a escrita pela equipe ou, num 👎 sem ela, a sugerida pelo assistente. */
function idealParaAprovar(a: AvaliacaoHumana, analise?: AnaliseCuradoria): string | undefined {
  if (a.resposta_ideal?.trim()) return undefined; // o servidor mantém a que está gravada
  if (a.nota === -1) return analise?.resposta_ideal_sugerida.trim() || undefined;
  return undefined; // 👍 sem ideal: vale a própria resposta do agente
}

/**
 * Calibração: a fila das avaliações que a equipe fez nas respostas do agente. Um curador confere,
 * ajusta a resposta ideal e aprova (vira gabarito das avaliações automáticas e exemplo para o
 * agente) ou recusa. O assistente de curadoria (Gemini) analisa cada uma contra o roteiro e
 * recomenda; dá para aplicar as recomendações em lote, sempre com a confirmação do curador.
 */
export function Calibracao() {
  const pedido = useSearch({ from: "/protegido/painel/calibracao" });
  const [aba, setAba] = useState<Aba>(pedido.avaliacao ? "aprovada" : "pendente");
  const resumo = useQuery({ queryKey: ["calibracao-resumo"], queryFn: () => api<ResumoCalibracao>("/calibracao/resumo") });
  const fila = useQuery({
    queryKey: ["calibracao-fila", aba],
    queryFn: () =>
      api<{ avaliacoes: AvaliacaoHumana[] }>(
        aba === "guardrail" ? "/calibracao/avaliacoes?origem=guardrail&situacao=pendente&limite=200" : `/calibracao/avaliacoes?situacao=${aba}&limite=200`,
      ),
    enabled: SITUACOES.includes(aba) || aba === "guardrail",
  });
  const r = resumo.data;
  const exemplosEmUso = useQuery({
    queryKey: ["calibracao-exemplos"],
    queryFn: () => api<{ exemplos: ExemploCalibracao[] }>("/conhecimento/exemplos"),
  });

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Calibração"
        icon={ClipboardCheck}
        description={
          <>
            Avaliações da equipe nas respostas do agente (👍 / 👎 no{" "}
            <Link to="/chat" className="font-semibold text-primary hover:underline">
              chat de teste
            </Link>{" "}
            e nas{" "}
            <Link to="/conversas" className="font-semibold text-primary hover:underline">
              conversas
            </Link>
            ). Só as aprovadas passam a valer: viram gabarito das avaliações automáticas e exemplos que o agente recebe em situações parecidas.
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Respostas avaliadas" count={r?.total} icon={<ClipboardCheck className="size-5" />} />
        <KpiCard
          label="Avaliadas como boas"
          value={r?.aprovacao == null ? "—" : `${Math.round(r.aprovacao * 100)}%`}
          hint={r ? `${r.positivas} 👍 · ${r.negativas} 👎` : undefined}
          icon={<ThumbsUp className="size-5" />}
          accent="green"
        />
        <KpiCard label="Aguardando curadoria" count={r?.por_situacao.pendente} icon={<Clock3 className="size-5" />} accent="amber" />
        <KpiCard label="Aprovadas (viram gabarito)" count={r?.por_situacao.aprovada} icon={<CheckCircle2 className="size-5" />} accent="cyan" />
      </div>

      {r && r.problemas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">Problemas mais apontados</span>
          {r.problemas.map((p) => (
            <Chip key={p.problema} tom="erro">
              {p.rotulo} <span className="num font-semibold">{p.total}</span>
            </Chip>
          ))}
        </div>
      )}

      <Abas
        rotulo="Situação das avaliações"
        valor={aba}
        onTrocar={setAba}
        abas={ABAS.map((a) => ({
          id: a.value,
          label: a.label,
          icone: ICONE_ABA[a.value],
          n:
            a.value === "lacunas"
              ? undefined
              : a.value === "exemplos"
                ? exemplosEmUso.data?.exemplos.filter((e) => e.ativo).length
                : a.value === "guardrail"
                  ? r?.guardrail?.pendente
                  : a.value === "datasets"
                    ? r?.por_situacao.aprovada
                    : r?.por_situacao[a.value],
        }))}
      />

      {aba === "lacunas" ? (
        <Lacunas />
      ) : aba === "exemplos" ? (
        <Exemplos />
      ) : aba === "datasets" ? (
        <Datasets />
      ) : aba === "guardrail" ? (
        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Mensagens que o guardrail barrou como tentativa de manipulação (o aluno recebeu a resposta de “Pedido fora do atendimento”). CPF e
              cartão já chegam mascarados. <strong className="text-foreground">Confirmar</strong>: era manipulação mesmo, e o caso entra no
              dataset. <strong className="text-foreground">Falso positivo</strong>: a mensagem era legítima; desligue ou ajuste a frase que barrou.
            </p>
            {fila.isLoading ? (
              <PageLoader className="h-40" label="Carregando a fila" />
            ) : (
              <Fila key="guardrail" situacao="pendente" guardrail avaliacoes={fila.data?.avaliacoes ?? []} />
            )}
          </div>
          <FrasesGuardrail />
        </div>
      ) : fila.isLoading ? (
        <PageLoader className="h-64" label="Carregando a fila" />
      ) : (
        <Fila key={aba} situacao={aba as Situacao} avaliacoes={fila.data?.avaliacoes ?? []} abrir={aba === "aprovada" ? pedido.avaliacao : undefined} />
      )}
    </div>
  );
}

/* ───────── Fila em tabela, com seleção e o assistente ───────── */

type Chave = "criada_em" | "nota";

function Fila({
  situacao,
  avaliacoes,
  guardrail = false,
  abrir,
}: {
  situacao: Situacao;
  avaliacoes: AvaliacaoHumana[];
  guardrail?: boolean;
  /** A avaliação que já abre no painel lateral (?avaliacao= no endereço). */
  abrir?: number;
}) {
  const qc = useQueryClient();
  const opcoes = useOpcoesCalibracao();
  const podeAprovar = opcoes.data?.pode_aprovar ?? false;
  const pendente = situacao === "pendente";
  const comSelecao = pendente && podeAprovar;
  const [busca, setBusca] = useState("");
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [analises, setAnalises] = useState<Record<number, AnaliseCuradoria>>({});
  const [analisando, setAnalisando] = useState<Set<number>>(new Set());
  const [aberta, setAberta] = useState<number | null>(abrir ?? null);
  const [confirmar, setConfirmar] = useState<null | "recomendacoes" | "aprovar" | "recusar">(null);
  const { chave, direcao, alternar } = useOrdenacao<Chave>("criada_em");

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtradas = termo
      ? avaliacoes.filter((a) => [a.mensagem_aluno, a.resposta_agente, a.avaliador, a.comentario ?? ""].some((t) => t.toLowerCase().includes(termo)))
      : avaliacoes;
    const fator = direcao === "asc" ? 1 : -1;
    return [...filtradas].sort((x, y) => (chave === "nota" ? (x.nota - y.nota) * fator : x.criada_em.localeCompare(y.criada_em) * fator));
  }, [avaliacoes, busca, chave, direcao]);

  // Some da seleção o que saiu da fila (aprovada ou recusada).
  useEffect(() => {
    const ids = new Set(avaliacoes.map((a) => a.id));
    setSelecionadas((s) => new Set([...s].filter((id) => ids.has(id))));
  }, [avaliacoes]);

  const alvo = selecionadas.size ? visiveis.filter((a) => selecionadas.has(a.id)) : visiveis;
  const recomendadas = alvo.filter((a) => analises[a.id] && analises[a.id].recomendacao !== "revisar");

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["calibracao-fila"] });
    qc.invalidateQueries({ queryKey: ["calibracao-resumo"] });
    qc.invalidateQueries({ queryKey: ["calibracao-exemplos"] });
    qc.invalidateQueries({ queryKey: ["calibracao-conversa"] });
  };

  async function analisar(lista: AvaliacaoHumana[]) {
    const pendentes = lista.map((a) => a.id).filter((id) => !analisando.has(id));
    setAnalisando((s) => new Set([...s, ...pendentes]));
    let falhas = 0;
    // Duas por vez: cada análise leva alguns segundos, e o lote não deve esgotar a cota do modelo.
    const fila = [...pendentes];
    await Promise.all(
      [0, 1].map(async () => {
        while (fila.length) {
          const id = fila.shift()!;
          try {
            const r = await api<AnaliseCuradoria>(`/calibracao/avaliacoes/${id}/analisar`, { method: "POST" });
            setAnalises((m) => ({ ...m, [id]: r }));
          } catch {
            falhas += 1;
          } finally {
            setAnalisando((s) => {
              const n = new Set(s);
              n.delete(id);
              return n;
            });
          }
        }
      }),
    );
    if (falhas) toast.error(`${falhas} análise(s) falharam`, { description: "Tente de novo em instantes." });
    else toast.success(`${pendentes.length} avaliação(ões) analisada(s) pelo assistente`);
  }

  const lote = useMutation({
    mutationFn: async (revisoes: Revisao[]) => {
      let feitas = 0;
      const erros: string[] = [];
      for (const r of revisoes) {
        try {
          await revisar(r);
          feitas += 1;
        } catch (e) {
          erros.push(`#${r.id}: ${(e as Error).message}`);
        }
      }
      return { feitas, erros };
    },
    onSuccess: ({ feitas, erros }) => {
      atualizar();
      setSelecionadas(new Set());
      setConfirmar(null);
      if (erros.length) toast.error(`${feitas} feita(s), ${erros.length} com erro`, { description: erros.slice(0, 3).join(" · ") });
      else toast.success(`${feitas} avaliação(ões) revisada(s)`);
    },
  });

  function aplicar(tipo: "recomendacoes" | "aprovar" | "recusar") {
    if (tipo === "recomendacoes") {
      lote.mutate(
        recomendadas.map((a) => {
          const r = analises[a.id];
          return r.recomendacao === "aprovar"
            ? { id: a.id, decisao: "aprovar", resposta_ideal: idealParaAprovar(a, r), observacao: `Aprovada com o assistente de curadoria (${CONFIANCA[r.confianca]}).` }
            : { id: a.id, decisao: "recusar", observacao: `Recusada pela recomendação do assistente: ${r.motivo}`.slice(0, 1000) };
        }),
      );
      return;
    }
    const lista = alvo.filter((a) => tipo === "recusar" || a.nota === 1 || a.resposta_ideal?.trim() || idealParaAprovar(a, analises[a.id]));
    const puladas = alvo.length - lista.length;
    if (puladas) toast.warning(`${puladas} 👎 sem "como deveria ser" ficaram de fora`, { description: "Escreva a resposta ideal ou analise com o assistente." });
    lote.mutate(lista.map((a) => ({ id: a.id, decisao: tipo, resposta_ideal: tipo === "aprovar" ? idealParaAprovar(a, analises[a.id]) : undefined })));
  }

  const todasMarcadas = visiveis.length > 0 && visiveis.every((a) => selecionadas.has(a.id));
  const colunas = (comSelecao ? 1 : 0) + 6;
  const abertaAvaliacao = avaliacoes.find((a) => a.id === aberta) ?? null;

  if (!avaliacoes.length)
    return (
      <div className="surface-card">
        {guardrail ? (
          <EmptyState title="Nenhum bloqueio aguardando curadoria">Quando o guardrail barrar uma mensagem, ela aparece aqui.</EmptyState>
        ) : (
          <EmptyState title={pendente ? "Nada aguardando curadoria" : "Nenhuma avaliação aqui"}>
            Avalie respostas do agente com 👍 / 👎 no chat de teste ou nas conversas.
          </EmptyState>
        )}
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por mensagem, resposta ou avaliador" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {comSelecao && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {selecionadas.size > 0 && <span className="text-xs text-muted-foreground">{selecionadas.size} selecionada(s)</span>}
            <Button variant="outline" disabled={!alvo.length || analisando.size > 0} onClick={() => analisar(alvo)}>
              {analisando.size ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {analisando.size ? `Analisando ${analisando.size}…` : `Analisar com IA (${alvo.length})`}
            </Button>
            {confirmar ? (
              <span className="inline-flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-xs">
                {confirmar === "recomendacoes"
                  ? `Aplicar ${recomendadas.length} recomendação(ões)?`
                  : `${confirmar === "aprovar" ? "Aprovar" : "Recusar"} ${alvo.length} avaliação(ões)?`}
                <Button size="sm" disabled={lote.isPending} onClick={() => aplicar(confirmar)}>
                  {lote.isPending ? <Loader2 className="animate-spin" /> : null} Confirmar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmar(null)}>
                  Cancelar
                </Button>
              </span>
            ) : (
              <>
                <Button variant="outline" disabled={!recomendadas.length} onClick={() => setConfirmar("recomendacoes")}>
                  <Bot /> Aplicar recomendações ({recomendadas.length})
                </Button>
                <Button variant="outline" disabled={!selecionadas.size} onClick={() => setConfirmar("recusar")}>
                  <XCircle /> {guardrail ? "Falso positivo" : "Recusar"}
                </Button>
                <Button disabled={!selecionadas.size} onClick={() => setConfirmar("aprovar")}>
                  <CheckCircle2 /> {guardrail ? "Confirmar" : "Aprovar"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <TableWrapper>
        <Table className="min-w-[980px]">
          <TableHeader>
            <tr>
              {comSelecao && (
                <TableHead className="w-10">
                  <Marcador
                    rotulo="Selecionar todas"
                    marcado={todasMarcadas}
                    parcial={selecionadas.size > 0}
                    onAlternar={() => setSelecionadas(todasMarcadas ? new Set() : new Set(visiveis.map((a) => a.id)))}
                  />
                </TableHead>
              )}
              <TableHead>
                <CabecalhoOrdenavel rotulo="Avaliação" campo="nota" chaveAtiva={chave} direcao={direcao} onAlternar={alternar} icone={ClipboardCheck} />
              </TableHead>
              <TableHead icone={Bot}>Resposta do agente</TableHead>
              <TableHead icone={Tag}>Problemas</TableHead>
              <TableHead icone={pendente ? Sparkles : UserCheck}>{pendente ? "Assistente" : "Curadoria"}</TableHead>
              <TableHead>
                <CabecalhoOrdenavel rotulo="Avaliada" campo="criada_em" chaveAtiva={chave} direcao={direcao} onAlternar={alternar} icone={Calendar} />
              </TableHead>
              <TableHead className="w-10" />
            </tr>
          </TableHeader>
          <tbody>
            {visiveis.length === 0 && <TableEmpty colSpan={colunas}>Nada com essa busca.</TableEmpty>}
            {visiveis.map((a) => {
              const analise = analises[a.id];
              return (
                <TableRow key={a.id} onClick={() => setAberta(a.id)} className={cn("cursor-pointer", selecionadas.has(a.id) && "bg-primary/5")}>
                  {comSelecao && (
                    <TableCell>
                      <Marcador
                        rotulo={`Selecionar a avaliação ${a.id}`}
                        marcado={selecionadas.has(a.id)}
                        onAlternar={() =>
                          setSelecionadas((s) => {
                            const n = new Set(s);
                            if (n.has(a.id)) n.delete(a.id);
                            else n.add(a.id);
                            return n;
                          })
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell className="max-w-[20rem]">
                    <div className="flex items-center gap-2">
                      <NotaChip nota={a.nota} guardrail={a.origem === "guardrail"} />
                      <span className="truncate font-medium">{a.mensagem_aluno}</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      #{a.id} · {ORIGEM[a.origem] ?? a.origem} · {a.avaliador}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[22rem]">
                    <p className="line-clamp-2 text-xs text-muted-foreground">{a.resposta_agente}</p>
                  </TableCell>
                  <TableCell className="max-w-[14rem]">
                    {a.problemas_rotulos.length ? (
                      <div className="flex flex-wrap gap-1">
                        {a.problemas_rotulos.slice(0, 2).map((p) => (
                          <Chip key={p} tom="erro">{p}</Chip>
                        ))}
                        {a.problemas_rotulos.length > 2 && <Chip>+{a.problemas_rotulos.length - 2}</Chip>}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {pendente ? (
                      analisando.has(a.id) ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" /> analisando
                        </span>
                      ) : analise ? (
                        <div className="space-y-0.5">
                          <Chip tom={RECOMENDACAO[analise.recomendacao].tom}>{RECOMENDACAO[analise.recomendacao].rotulo}</Chip>
                          <div className="text-[11px] text-muted-foreground">{CONFIANCA[analise.confianca]}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/60">não analisada</span>
                      )
                    ) : (
                      <div className="space-y-0.5">
                        <Chip tom={a.situacao === "aprovada" ? "sucesso" : "erro"}>{a.situacao === "aprovada" ? "Aprovada" : "Recusada"}</Chip>
                        <div className="max-w-[12rem] truncate text-[11px] text-muted-foreground">{a.revisada_por}</div>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground" title={fmtDataHora(a.criada_em)}>
                    {fmtRelativo(a.criada_em)}
                  </TableCell>
                  <TableCell>
                    {comSelecao && !analise && !analisando.has(a.id) && (
                      <button
                        type="button"
                        title="Analisar com IA"
                        aria-label={`Analisar a avaliação ${a.id} com IA`}
                        onClick={(e) => {
                          e.stopPropagation();
                          analisar([a]);
                        }}
                        className="grid size-8 place-items-center rounded-md text-primary-text transition-colors hover:bg-primary/10"
                      >
                        <Sparkles className="size-4" />
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </tbody>
        </Table>
      </TableWrapper>

      <DetalheAvaliacao
        a={abertaAvaliacao}
        analise={abertaAvaliacao ? analises[abertaAvaliacao.id] : undefined}
        analisando={abertaAvaliacao ? analisando.has(abertaAvaliacao.id) : false}
        podeAprovar={podeAprovar}
        aoAnalisar={() => abertaAvaliacao && analisar([abertaAvaliacao])}
        aoFechar={() => setAberta(null)}
        aoRevisar={atualizar}
      />
    </div>
  );
}

function NotaChip({ nota, guardrail = false }: { nota: 1 | -1; guardrail?: boolean }) {
  if (guardrail)
    return (
      <span title="Barrada pelo guardrail" className="grid size-6 shrink-0 place-items-center rounded-md bg-warning/12 text-warning-text">
        <ShieldAlert className="size-3.5" />
      </span>
    );
  return (
    <span
      title={nota === 1 ? "Boa resposta" : "Com problema"}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md",
        nota === 1 ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive",
      )}
    >
      {nota === 1 ? <ThumbsUp className="size-3.5" /> : <ThumbsDown className="size-3.5" />}
    </span>
  );
}

/* ───────── Painel lateral da avaliação, com o assistente ao lado ───────── */

function DetalheAvaliacao({
  a,
  analise,
  analisando,
  podeAprovar,
  aoAnalisar,
  aoFechar,
  aoRevisar,
}: {
  a: AvaliacaoHumana | null;
  analise?: AnaliseCuradoria;
  analisando: boolean;
  podeAprovar: boolean;
  aoAnalisar: () => void;
  aoFechar: () => void;
  aoRevisar: () => void;
}) {
  const [ideal, setIdeal] = useState("");
  const [observacao, setObservacao] = useState("");
  useEffect(() => {
    setIdeal(a?.resposta_ideal ?? "");
    setObservacao("");
  }, [a?.id, a?.resposta_ideal]);

  const decidir = useMutation({
    mutationFn: (decisao: "aprovar" | "recusar") => revisar({ id: a!.id, decisao, resposta_ideal: ideal, observacao }),
    onSuccess: (_, decisao) => {
      aoRevisar();
      aoFechar();
      toast.success(
        decisao === "recusar"
          ? a?.origem === "guardrail"
            ? "Marcada como falso positivo: confira a frase que barrou"
            : "Recusada"
          : a?.situacao === "aprovada"
            ? "Nova versão no ar: o agente já usa este exemplo"
            : a?.origem === "guardrail"
              ? "Confirmada: o caso entrou no dataset"
              : "Aprovada: virou gabarito e exemplo para o agente",
      );
    },
    onError: (e: Error) => toast.error("Não foi possível revisar", { description: e.message }),
  });

  const pendente = a?.situacao === "pendente";
  const doGuardrail = a?.origem === "guardrail";
  const anteriores = a?.historico.slice(0, -2) ?? [];
  const mudou = ideal.trim() !== (a?.resposta_ideal?.trim() ?? "");
  const precisaIdeal = a?.nota === -1 && !ideal.trim();

  const rodape =
    a && podeAprovar ? (
      <>
        <Button variant="outline" onClick={aoFechar}>
          Cancelar
        </Button>
        {pendente && (
          <Button variant="outline" disabled={decidir.isPending} onClick={() => decidir.mutate("recusar")}>
            <XCircle /> {doGuardrail ? "Falso positivo" : "Recusar"}
          </Button>
        )}
        {a.situacao === "aprovada" ? (
          <Button
            disabled={decidir.isPending || !mudou || !ideal.trim()}
            onClick={() => decidir.mutate("aprovar")}
            title="Grava a resposta editada como nova versão do exemplo"
          >
            {decidir.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Subir nova versão
          </Button>
        ) : (
          <Button disabled={decidir.isPending || precisaIdeal} onClick={() => decidir.mutate("aprovar")}>
            {decidir.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {doGuardrail ? "Era manipulação" : "Aprovar e subir"}
          </Button>
        )}
      </>
    ) : undefined;

  return (
    <PainelLateral
      aberto={a !== null}
      aoMudar={(aberto) => !aberto && aoFechar()}
      rotulo={a ? `Avaliação #${a.id}` : "Avaliação"}
      icone={<ClipboardCheck />}
      titulo={a ? (a.origem === "guardrail" ? "Barrada pelo guardrail" : a.nota === 1 ? "Boa resposta" : "Resposta com problema") : ""}
      descricao={a ? `${ORIGEM[a.origem] ?? a.origem} · ${a.agente} · avaliada por ${a.avaliador} em ${fmtDataHora(a.criada_em)}` : undefined}
      largura="2xl"
      corpo="livre"
      rodape={rodape}
    >
      {a && (
        <div className="grid min-h-0 w-full grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:grid-rows-1">
          <div className="thin-scroll min-h-0 space-y-6 overflow-y-auto px-6 py-5">
            <div className="flex flex-wrap items-center gap-2">
              {doGuardrail ? (
                <Chip tom="alerta">Barrada pelo guardrail</Chip>
              ) : (
                <Chip tom={a.nota === 1 ? "sucesso" : "erro"}>{a.nota === 1 ? "👍 Boa resposta" : "👎 Com problema"}</Chip>
              )}
              <Chip tom={pendente ? "alerta" : a.situacao === "aprovada" ? "sucesso" : "erro"}>
                {pendente ? "Aguardando curadoria" : a.situacao === "aprovada" ? "Aprovada" : "Recusada"}
              </Chip>
              <Link
                to="/conversas"
                search={{ id: a.session_id }}
                className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Abrir conversa <ExternalLink className="size-3" />
              </Link>
            </div>

            {anteriores.length > 0 && (
              <Campo rotulo="Antes, na conversa">
                <div className="thin-scroll max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
                  {anteriores.map((h, i) => (
                    <div key={i}>
                      <span className="font-semibold">{h.papel === "aluno" ? "Aluno" : "Agente"}:</span> {h.texto}
                    </div>
                  ))}
                </div>
              </Campo>
            )}

            <Campo rotulo="Aluno">
              <div className="rounded-lg bg-secondary px-3 py-2 text-sm whitespace-pre-wrap">{a.mensagem_aluno}</div>
            </Campo>
            <Campo rotulo={doGuardrail ? "O aluno recebeu" : "O agente respondeu"}>
              <div className="rounded-lg border border-border px-3 py-2 text-sm whitespace-pre-wrap">{a.resposta_agente}</div>
            </Campo>

            {(a.problemas_rotulos.length > 0 || a.comentario) && (
              <Campo rotulo={doGuardrail ? "Motivo" : "O que a equipe apontou"}>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {a.problemas_rotulos.map((p) => (
                      <Chip key={p} tom="erro">
                        {p}
                      </Chip>
                    ))}
                  </div>
                  {a.comentario && <p className="text-sm text-muted-foreground">“{a.comentario}”</p>}
                </div>
              </Campo>
            )}

            <Campo
              rotulo="Como deveria ser"
              ajuda={
                a.situacao === "aprovada"
                  ? "Edite (ou peça ao assistente) e suba uma nova versão: o exemplo do agente é atualizado."
                  : doGuardrail
                    ? "Vazio: vale a resposta que o aluno recebeu."
                    : a.nota === 1
                    ? "Vazio: vale a própria resposta do agente."
                    : "Obrigatório para aprovar um 👎. É o que vira gabarito e exemplo."
              }
            >
              {podeAprovar ? (
                <Textarea value={ideal} onChange={(e) => setIdeal(e.target.value)} className="min-h-36" maxLength={4000} />
              ) : (
                <div className="rounded-lg border border-border px-3 py-2 text-sm whitespace-pre-wrap">{a.resposta_ideal || "—"}</div>
              )}
            </Campo>

            {podeAprovar ? (
              <Campo rotulo="Observação da curadoria" ajuda="Opcional. Fica no histórico da avaliação.">
                <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={1000} />
              </Campo>
            ) : (
              <p className="text-xs text-muted-foreground">Só os curadores (PAINEL_CURADORES) aprovam, recusam e usam o assistente.</p>
            )}
            {!pendente && (
              <p className="text-xs text-muted-foreground">
                {a.situacao === "aprovada" ? "Aprovada" : "Recusada"} por {a.revisada_por} em {fmtDataHora(a.revisada_em)}
                {a.observacao_revisao ? ` · “${a.observacao_revisao}”` : ""}
              </p>
            )}
          </div>

          {podeAprovar && (
            <Assistente
              key={a.id}
              avaliacao={a}
              ideal={ideal}
              analise={analise}
              analisando={analisando}
              aoAnalisar={aoAnalisar}
              aoUsar={(texto) => {
                setIdeal(texto);
                toast.success("Resposta colocada em “Como deveria ser”", { description: "Revise e aprove para subir." });
              }}
            />
          )}
        </div>
      )}
    </PainelLateral>
  );
}

type MensagemAssistente = { papel: "curador" | "assistente"; texto: string; ideal?: string };

const ATALHOS = [
  "Escreva a resposta ideal seguindo o roteiro",
  "Deixe mais curta",
  "Isso está de acordo com o roteiro?",
  "Devo aprovar ou recusar? Por quê?",
];

/** O assistente de curadoria em chat: analisa, responde dúvidas e reescreve a resposta ideal a pedido. */
function Assistente({
  avaliacao,
  ideal,
  analise,
  analisando,
  aoAnalisar,
  aoUsar,
}: {
  avaliacao: AvaliacaoHumana;
  ideal: string;
  analise?: AnaliseCuradoria;
  analisando: boolean;
  aoAnalisar: () => void;
  aoUsar: (texto: string) => void;
}) {
  const [mensagens, setMensagens] = useState<MensagemAssistente[]>([]);
  const [digitado, setDigitado] = useState("");
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Sem devolver o resultado: no Chrome novo scrollIntoView devolve uma Promise, e o React a trataria como limpeza.
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens.length, analise]);

  const enviar = useMutation({
    mutationFn: (lista: MensagemAssistente[]) =>
      api<{ resposta: string; resposta_ideal: string }>(`/calibracao/avaliacoes/${avaliacao.id}/assistente`, {
        method: "POST",
        body: JSON.stringify({ mensagens: lista.map(({ papel, texto }) => ({ papel, texto })), resposta_ideal_atual: ideal }),
      }),
    onSuccess: (r) => setMensagens((m) => [...m, { papel: "assistente", texto: r.resposta, ideal: r.resposta_ideal || undefined }]),
    onError: (e: Error) => toast.error("O assistente não respondeu", { description: e.message }),
  });

  function perguntar(texto: string) {
    const limpo = texto.trim();
    if (!limpo || enviar.isPending) return;
    const lista: MensagemAssistente[] = [...mensagens, { papel: "curador", texto: limpo }];
    setMensagens(lista);
    setDigitado("");
    enviar.mutate(lista);
  }

  return (
    <aside className="flex min-h-0 flex-col border-t border-border bg-muted/20 lg:border-t-0 lg:border-l">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3">
        <span className="grid size-7 place-items-center rounded-md bg-primary/10 text-primary-text">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Assistente de curadoria</div>
          <div className="truncate text-[11px] text-muted-foreground">Gemini, com o roteiro do agente. Ele sugere; quem sobe é você.</div>
        </div>
      </div>

      <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm">
        {avaliacao.situacao === "pendente" && (
          <div className="rounded-xl border border-primary/25 bg-card p-3">
            {analise ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">Recomendação</span>
                  <Chip tom={RECOMENDACAO[analise.recomendacao].tom}>{RECOMENDACAO[analise.recomendacao].rotulo}</Chip>
                  <span className="text-[11px] text-muted-foreground">{CONFIANCA[analise.confianca]}</span>
                </div>
                <p>{analise.motivo}</p>
                {analise.alertas.length > 0 && (
                  <ul className="space-y-1 text-xs text-warning-text">
                    {analise.alertas.map((al) => (
                      <li key={al} className="flex gap-1.5">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {al}
                      </li>
                    ))}
                  </ul>
                )}
                {analise.resposta_ideal_sugerida && <SugestaoDeResposta texto={analise.resposta_ideal_sugerida} aoUsar={aoUsar} />}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs text-muted-foreground">
                  Peça a análise: aprovar, recusar ou revisar, com o motivo e uma resposta sugerida.
                </p>
                <Button size="sm" variant="outline" disabled={analisando} onClick={aoAnalisar}>
                  {analisando ? <Loader2 className="animate-spin" /> : <Sparkles />} {analisando ? "Analisando…" : "Analisar"}
                </Button>
              </div>
            )}
          </div>
        )}

        {mensagens.map((m, i) =>
          m.papel === "curador" ? (
            <div key={i} className="ml-8 rounded-xl rounded-br-sm bg-primary/12 px-3 py-2 whitespace-pre-wrap">
              {m.texto}
            </div>
          ) : (
            <div key={i} className="mr-4 space-y-2 rounded-xl rounded-bl-sm border border-border bg-card px-3 py-2">
              <p className="whitespace-pre-wrap">{m.texto}</p>
              {m.ideal && <SugestaoDeResposta texto={m.ideal} aoUsar={aoUsar} />}
            </div>
          ),
        )}
        {enviar.isPending && (
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> o assistente está pensando…
          </div>
        )}
        {mensagens.length === 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {ATALHOS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => perguntar(s)}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={fim} />
      </div>

      <form
        className="shrink-0 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          perguntar(digitado);
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={digitado}
            onChange={(e) => setDigitado(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                perguntar(digitado);
              }
            }}
            placeholder="Peça um ajuste ou tire uma dúvida (Enter envia)"
            className="max-h-32 min-h-10 resize-none"
            maxLength={4000}
          />
          <Button type="submit" size="icon" disabled={!digitado.trim() || enviar.isPending} aria-label="Enviar ao assistente">
            <Send />
          </Button>
        </div>
      </form>
    </aside>
  );
}

function SugestaoDeResposta({ texto, aoUsar }: { texto: string; aoUsar: (t: string) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">Resposta sugerida</div>
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 whitespace-pre-wrap">{texto}</div>
      <Button size="sm" variant="ghost" className="h-7" onClick={() => aoUsar(texto)}>
        <MessageSquare /> Usar em “Como deveria ser”
      </Button>
    </div>
  );
}

/* ───────── Exemplos que o agente usa ───────── */

type UsoExemplo = "todos" | "em_uso" | "fora";

const USOS_EXEMPLO: { value: UsoExemplo; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "em_uso", label: "Em uso" },
  { value: "fora", label: "Fora de uso" },
];

function Exemplos() {
  const qc = useQueryClient();
  const opcoes = useOpcoesCalibracao();
  const [aberto, setAberto] = useState<ExemploCalibracao | null>(null);
  const [busca, setBusca] = useState("");
  const [uso, setUso] = useState<UsoExemplo>("todos");
  const q = useQuery({
    queryKey: ["calibracao-exemplos"],
    queryFn: () => api<{ exemplos: ExemploCalibracao[] }>("/conhecimento/exemplos"),
  });
  const alternar = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      api(`/conhecimento/exemplos/${id}/ativo`, { method: "POST", body: JSON.stringify({ ativo }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calibracao-exemplos"] }),
    onError: (e: Error) => toast.error("Não foi possível alterar", { description: e.message }),
  });
  // Busca pelo número (#13 ou 13: o exemplo ou a avaliação), pela mensagem, pela resposta ou por quem aprovou.
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const numero = /^#?\d+$/.test(termo) ? Number(termo.replace("#", "")) : null;
    return (q.data?.exemplos ?? []).filter(
      (e) =>
        (uso === "todos" || (uso === "em_uso" ? e.ativo : !e.ativo)) &&
        (!termo ||
          (numero !== null
            ? e.id === numero || e.avaliacao_id === numero
            : `${e.mensagem} ${e.resposta_ideal} ${e.contexto ?? ""} ${e.aprovado_por}`.toLowerCase().includes(termo))),
    );
  }, [q.data, busca, uso]);
  const paginacao = usePaginacao(visiveis, 25);
  if (q.isLoading) return <PageLoader className="h-64" label="Carregando os exemplos" />;
  const exemplos = q.data?.exemplos ?? [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Cada avaliação aprovada vira um exemplo, com nome, e-mail, telefone e CPF retirados. O agente recebe até 3 dos mais parecidos
        com a mensagem do aluno. Tirar de uso não apaga: dá para voltar.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-96">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por número (#13), mensagem, resposta ou quem aprovou"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Pills rotulo="Uso" value={uso} onChange={setUso} options={USOS_EXEMPLO} />
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {visiveis.length} de {exemplos.length} · {exemplos.filter((e) => e.ativo).length} em uso
        </span>
      </div>
      <TableWrapper>
        <Table className="min-w-[860px]">
          <TableHeader>
            <tr>
              <TableHead icone={BookMarked}>Exemplo</TableHead>
              <TableHead icone={MessageSquare}>Mensagem do aluno</TableHead>
              <TableHead icone={CheckCircle2}>Resposta aprovada</TableHead>
              <TableHead icone={UserCheck}>Aprovado por</TableHead>
              <TableHead icone={Calendar}>Criado</TableHead>
              <TableHead>Uso</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {exemplos.length === 0 && <TableEmpty colSpan={6}>Nenhum exemplo ainda: cada avaliação aprovada vira um.</TableEmpty>}
            {exemplos.length > 0 && visiveis.length === 0 && <TableEmpty colSpan={6}>Nenhum exemplo com essa busca.</TableEmpty>}
            {paginacao.itens.map((e) => (
              <TableRow key={e.id} onClick={() => setAberto(e)} className={cn("cursor-pointer", !e.ativo && "opacity-60")}>
                <TableCell className="whitespace-nowrap">
                  <div className="font-medium">#{e.id}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">v{e.versao} · avaliação #{e.avaliacao_id}</div>
                </TableCell>
                <TableCell className="max-w-[16rem] truncate">{e.mensagem}</TableCell>
                <TableCell className="max-w-[22rem]">
                  <p className="line-clamp-2 text-xs text-muted-foreground">{e.resposta_ideal}</p>
                </TableCell>
                <TableCell className="max-w-[12rem] truncate text-xs text-muted-foreground">{e.aprovado_por}</TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground" title={fmtDataHora(e.criado_em)}>
                  {fmtRelativo(e.criado_em)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Chip tom={e.ativo ? "sucesso" : "neutro"}>{e.ativo ? "em uso" : "fora de uso"}</Chip>
                    {opcoes.data?.pode_aprovar && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          alternar.mutate({ id: e.id, ativo: !e.ativo });
                        }}
                      >
                        {e.ativo ? "Tirar de uso" : "Voltar a usar"}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>
      {visiveis.length > 25 && <Paginacao {...paginacao} opcoes={[25, 50, 100]} />}

      <PainelLateral
        aberto={aberto !== null}
        aoMudar={(a) => !a && setAberto(null)}
        rotulo={aberto ? `Exemplo #${aberto.id} · versão ${aberto.versao}` : "Exemplo"}
        icone={<BookMarked />}
        titulo="Exemplo que o agente recebe"
        descricao={aberto ? `Da avaliação #${aberto.avaliacao_id}, aprovado por ${aberto.aprovado_por} em ${fmtDataHora(aberto.criado_em)}` : undefined}
      >
        {aberto && (
          <div className="space-y-5">
            <Chip tom={aberto.ativo ? "sucesso" : "neutro"}>{aberto.ativo ? "em uso" : "fora de uso"}</Chip>
            {aberto.contexto && (
              <Campo rotulo="Antes, o agente tinha dito">
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">{aberto.contexto}</div>
              </Campo>
            )}
            <Campo rotulo="Mensagem do aluno">
              <div className="rounded-lg bg-secondary px-3 py-2 text-sm whitespace-pre-wrap">{aberto.mensagem}</div>
            </Campo>
            <Campo rotulo="Resposta aprovada">
              <div className="rounded-lg border border-border px-3 py-2 text-sm whitespace-pre-wrap">{aberto.resposta_ideal}</div>
            </Campo>
            {aberto.observacao && (
              <Campo rotulo="Observação">
                <p className="text-sm text-muted-foreground">{aberto.observacao}</p>
              </Campo>
            )}
          </div>
        )}
      </PainelLateral>
    </div>
  );
}
