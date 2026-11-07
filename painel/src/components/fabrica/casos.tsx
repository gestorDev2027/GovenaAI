import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ExternalLink, FlaskConical, Loader2, Pencil, Play, Plus, Save, Trash2, XCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { api, type AcaoEsperada, type AgenteFabrica, type CasoCalibracao, type CasoTeste, type ExecucaoCasos, type ResultadoCaso } from "@/lib/api";
import { fmtDataHora } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/fields";
import { Paginacao, usePaginacao } from "@/components/ui/paginacao";
import { Campo, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import { Chip, Table, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { PageLoader } from "@/components/widgets/widgets";
import { Alertas, AssistenteIA, type Rascunho } from "./assistente";
import { Selecao } from "./campos";
import { usePode } from "@/hooks/use-permissoes";

/*
 * Casos de teste do agente: uma mensagem de contato e o que se espera dele (responder, transferir com
 * um motivo, encerrar), com palavras que a resposta precisa ter ou não pode ter. "Rodar" executa os
 * casos ativos no servidor, um por vez (5 a 10 s cada); a tela acompanha a cada 3 s.
 */

const ACAO: Record<AcaoEsperada, string> = { responder: "Responder", transferir: "Transferir", encerrar: "Encerrar", qualquer: "Qualquer" };

type CasoNovo = Omit<CasoTeste, "id">;

/** De quem são os casos: um agente ou uma equipe (com os membros, para escolher quem deve responder). */
export type AlvoCasos = Pick<AgenteFabrica, "id" | "nome" | "categorias"> & { membros?: { id: string; nome: string }[] };
/** Os casos da fábrica e, só leitura, os do dataset aprovado na Calibração; rodam juntos. */
type Resposta = { casos: CasoTeste[]; calibracao?: CasoCalibracao[]; execucoes: ExecucaoCasos[] };

const chaveCasos = (agente: string) => ["fabrica-casos", agente];

export function CasosDoAgente({ agente }: { agente: AlvoCasos }) {
  const qc = useQueryClient();
  const pode = usePode();
  const caminho = `/fabrica/agentes/${encodeURIComponent(agente.id)}/casos`;
  const dados = useQuery({ queryKey: chaveCasos(agente.id), queryFn: () => api<Resposta>(caminho) });
  const [aberto, setAberto] = useState<CasoTeste | "novo" | null>(null);
  const [sugestoes, setSugestoes] = useState<Rascunho<{ casos: CasoNovo[] }> | null>(null);
  const [execucaoId, setExecucaoId] = useState<number | null>(null);

  const casos = dados.data?.casos ?? [];
  const execucoes = dados.data?.execucoes ?? [];
  const calibracao = dados.data?.calibracao ?? [];
  // A tabela mostra os dois tipos; os da Calibração depois dos da fábrica.
  const linhas: ({ origem: "fabrica"; caso: CasoTeste } | { origem: "calibracao"; caso: CasoCalibracao })[] = [
    ...casos.map((caso) => ({ origem: "fabrica" as const, caso })),
    ...calibracao.map((caso) => ({ origem: "calibracao" as const, caso })),
  ];
  const ativos = casos.filter((c) => c.ativo).length + calibracao.length;
  const paginacao = usePaginacao(linhas);

  // Retoma o acompanhamento de uma execução que já estava rodando.
  useEffect(() => {
    const rodando = execucoes.find((e) => e.situacao === "rodando");
    if (rodando && execucaoId === null) setExecucaoId(rodando.id);
  }, [execucoes, execucaoId]);

  const execucao = useQuery({
    queryKey: ["fabrica-execucao", execucaoId],
    queryFn: () => api<ExecucaoCasos>(`/fabrica/execucoes/${execucaoId}`),
    enabled: execucaoId !== null,
    refetchInterval: (q) => (q.state.data?.situacao === "rodando" || !q.state.data ? 3000 : false),
  });
  const rodando = execucao.data?.situacao === "rodando";
  useEffect(() => {
    if (execucao.data && execucao.data.situacao !== "rodando") qc.invalidateQueries({ queryKey: chaveCasos(agente.id) });
  }, [execucao.data, qc, agente.id]);

  const ultima = execucao.data && execucao.data.situacao !== "rodando" ? execucao.data : execucoes.find((e) => e.situacao !== "rodando");
  const resultadoDe = (id: number | string) => ultima?.resultado?.casos.find((r) => r.caso === id);

  const rodar = useMutation({
    mutationFn: () => api<ExecucaoCasos>(`${caminho}/executar`, { method: "POST" }),
    onSuccess: (e) => {
      setExecucaoId(e.id);
      toast.success("Testes iniciados", { description: `${ativos} caso(s), cerca de ${Math.ceil((ativos * 8) / 60)} min.` });
    },
    onError: (e: Error) => toast.error("Não foi possível rodar os testes", { description: e.message }),
  });
  const alternarAtivo = useMutation({
    mutationFn: (c: CasoTeste) =>
      api<CasoTeste>(`${caminho}/${c.id}`, { method: "PUT", body: JSON.stringify({ ...semId(c), ativo: !c.ativo }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveCasos(agente.id) }),
    onError: (e: Error) => toast.error("Não foi possível mudar o caso", { description: e.message }),
  });
  const excluir = useMutation({
    mutationFn: (c: CasoTeste) => api(`${caminho}/${c.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chaveCasos(agente.id) });
      toast.success("Caso excluído");
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  if (dados.isLoading) return <PageLoader className="h-64" label="Carregando os casos" />;
  if (dados.isError) return <p className="text-sm text-destructive">{(dados.error as Error).message}</p>;

  return (
    <div className="space-y-6">
      <AssistenteIA<{ casos: CasoNovo[] }>
        tipo="casos"
        titulo="Sugerir casos com IA"
        ajuda="A IA lê as instruções e os motivos de transferência do agente e propõe de 6 a 10 casos. Você escolhe quais salvar."
        placeholder="Opcional: o que testar, ex.: termo de referência sem quantidade, servidor com pressa, pergunta de outro setor."
        agente={agente.id}
        pedidoOpcional
        rotuloBotao="Sugerir casos"
        aoReceber={setSugestoes}
      />
      {sugestoes && <Sugestoes agente={agente} sugestoes={sugestoes} aoTerminar={() => setSugestoes(null)} />}

      <SecaoPainel
        titulo="Casos"
        contagem={linhas.length}
        acao={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setAberto("novo")}>
              <Plus /> Novo caso
            </Button>
            <Button size="sm" disabled={!ativos || rodando || rodar.isPending} onClick={() => rodar.mutate()}>
              {rodando ? <Loader2 className="animate-spin" /> : <Play />}
              {rodando ? "Rodando…" : `Rodar ${ativos} ativo(s)`}
            </Button>
          </div>
        }
      >
        {rodando && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
            <Loader2 className="size-4 animate-spin text-primary" />
            Rodando os casos no servidor, um por vez (5 a 10 s cada). Pode fechar o painel: o resultado fica salvo.
          </div>
        )}
        <TableWrapper className="max-h-[50vh]">
          <Table className="min-w-[860px]">
            <TableHeader>
              <tr>
                <TableHead className="w-12">Ativo</TableHead>
                <TableHead>Caso</TableHead>
                <TableHead>Esperado</TableHead>
                <TableHead>Última execução</TableHead>
                <TableHead className="sticky right-0 bg-card text-right">Ações</TableHead>
              </tr>
            </TableHeader>
            <tbody>
              {linhas.length === 0 && <TableEmpty colSpan={5}>Nenhum caso ainda. Crie um ou peça sugestões à IA.</TableEmpty>}
              {paginacao.itens.map((linha) => {
                if (linha.origem === "calibracao") return <LinhaCalibracao key={linha.caso.id} caso={linha.caso} resultado={resultadoDe(linha.caso.id)} />;
                const c = linha.caso;
                const r = resultadoDe(c.id);
                return (
                  <TableRow key={c.id} className={cn("group", !c.ativo && "opacity-60")}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={c.ativo ? "Desativar o caso" : "Ativar o caso"}
                        checked={c.ativo}
                        disabled={alternarAtivo.isPending}
                        onChange={() => alternarAtivo.mutate(c)}
                        className="size-4 cursor-pointer accent-[var(--color-primary)]"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold">{c.titulo}</div>
                      <div className="line-clamp-1 max-w-md text-xs text-muted-foreground">“{c.mensagem}”</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Chip tom="info">{ACAO[c.esperado.acao]}</Chip>
                        {c.esperado.categoria && (
                          <span className="text-xs text-muted-foreground">
                            {agente.categorias[c.esperado.categoria] ?? c.esperado.categoria}
                          </span>
                        )}
                        {c.esperado.agente && (
                          <span className="text-xs text-muted-foreground">
                            por {agente.membros?.find((m) => m.id === c.esperado.agente)?.nome ?? c.esperado.agente}
                          </span>
                        )}
                      </div>
                      {(c.esperado.mencionar.length > 0 || c.esperado.proibido.length > 0) && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {c.esperado.mencionar.length > 0 && `cita: ${c.esperado.mencionar.join(", ")}`}
                          {c.esperado.mencionar.length > 0 && c.esperado.proibido.length > 0 && " · "}
                          {c.esperado.proibido.length > 0 && `nunca: ${c.esperado.proibido.join(", ")}`}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <SeloResultado resultado={r} />
                    </TableCell>
                    <TableCell className="sticky right-0 bg-card transition-colors group-hover:bg-muted">
                      <div className="flex justify-end">
                        <Button size="icon" variant="ghost" title="Editar" aria-label="Editar" onClick={() => setAberto(c)}>
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title={pode("excluir") ? "Excluir" : "Sem a permissão Excluir"}
                          aria-label="Excluir"
                          disabled={excluir.isPending || !pode("excluir")}
                          onClick={() => window.confirm(`Excluir o caso "${c.titulo}"?`) && excluir.mutate(c)}
                        >
                          <Trash2 className="text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        </TableWrapper>
        {linhas.length > 10 && <Paginacao {...paginacao} />}
        {calibracao.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Os casos com o selo Calibração vêm das avaliações aprovadas na tela Calibração: só leitura aqui. Passam com nota 7 ou mais, dada
            por um avaliador automático contra a resposta esperada.
          </p>
        )}
      </SecaoPainel>

      {ultima && <Resultado execucao={ultima} membros={agente.membros} />}

      {execucoes.length > 1 && (
        <SecaoPainel titulo="Execuções anteriores" contagem={execucoes.length}>
          <ul className="space-y-1 text-xs">
            {execucoes.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-1.5">
                <span className="num text-muted-foreground">#{e.id}</span>
                <span>{fmtDataHora(e.iniciada_em)}</span>
                <span className="text-muted-foreground">{e.iniciada_por}</span>
                <span className="ml-auto">
                  {e.situacao === "rodando" ? (
                    <Chip tom="info">Rodando</Chip>
                  ) : e.situacao === "falhou" ? (
                    <Chip tom="erro">Falhou</Chip>
                  ) : (
                    <Chip tom={e.resultado && e.resultado.passou === e.resultado.total ? "sucesso" : "alerta"}>
                      {e.resultado?.passou ?? 0} de {e.resultado?.total ?? 0}
                    </Chip>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </SecaoPainel>
      )}

      <FormCaso agente={agente} caso={aberto === "novo" ? null : aberto} aberto={aberto !== null} aoFechar={() => setAberto(null)} />
    </div>
  );
}

const semId = ({ titulo, mensagem, contexto, esperado, ativo }: CasoTeste | CasoNovo): CasoNovo => ({
  titulo,
  mensagem,
  contexto,
  esperado,
  ativo,
});

const fmtNota = (nota: number) => nota.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Passou ou falhou na última execução; nos casos da Calibração, com a nota (passa com 7). */
function SeloResultado({ resultado }: { resultado?: ResultadoCaso }) {
  if (!resultado) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span title={resultado.motivos.join("\n")}>
      <Chip tom={resultado.passou ? "sucesso" : "erro"}>
        {resultado.passou ? "Passou" : "Falhou"}
        {resultado.nota != null && ` · nota ${fmtNota(resultado.nota)}`}
      </Chip>
    </span>
  );
}

/** Um caso da Calibração: só leitura, com o link para a avaliação de origem. */
function LinhaCalibracao({ caso, resultado }: { caso: CasoCalibracao; resultado?: ResultadoCaso }) {
  return (
    <TableRow className="group">
      <TableCell>
        <Chip tom="primario">Calibração</Chip>
      </TableCell>
      <TableCell>
        <div className="max-w-md font-semibold">{caso.titulo}</div>
        <div className="line-clamp-1 max-w-md text-xs text-muted-foreground">“{caso.mensagens[caso.mensagens.length - 1]}”</div>
        {caso.mensagens.length > 1 && <div className="text-[11px] text-muted-foreground">{caso.mensagens.length} mensagens na conversa</div>}
      </TableCell>
      <TableCell>
        <p className="line-clamp-2 max-w-sm text-xs text-muted-foreground" title={caso.esperado_texto}>
          {caso.esperado_texto}
        </p>
        {(caso.ferramentas_exigidas.length > 0 || caso.ferramentas_proibidas.length > 0) && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {caso.ferramentas_exigidas.length > 0 && `chama: ${caso.ferramentas_exigidas.join(", ")}`}
            {caso.ferramentas_exigidas.length > 0 && caso.ferramentas_proibidas.length > 0 && " · "}
            {caso.ferramentas_proibidas.length > 0 && `nunca chama: ${caso.ferramentas_proibidas.join(", ")}`}
          </div>
        )}
      </TableCell>
      <TableCell>
        <SeloResultado resultado={resultado} />
      </TableCell>
      <TableCell className="sticky right-0 bg-card transition-colors group-hover:bg-muted">
        <div className="flex justify-end">
          <Button size="icon" variant="ghost" asChild title="Abrir a avaliação na Calibração">
            <Link to="/calibracao" search={{ avaliacao: caso.avaliacao }} aria-label={`Abrir a avaliação ${caso.avaliacao}`}>
              <ExternalLink />
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** O resultado da última execução: quantos passaram e, por caso, o motivo da falha e a resposta. */
function Resultado({ execucao, membros }: { execucao: ExecucaoCasos; membros?: AlvoCasos["membros"] }) {
  const [aberto, setAberto] = useState<number | string | null>(null);
  const r = execucao.resultado;
  return (
    <SecaoPainel titulo={`Última execução · ${fmtDataHora(execucao.concluida_em ?? execucao.iniciada_em)}`}>
      {execucao.situacao === "falhou" || !r ? (
        <p className="text-sm text-destructive">A execução falhou antes de terminar. Tente rodar de novo.</p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className={cn("text-2xl font-semibold", r.passou === r.total ? "text-success" : "text-warning")}>
              {r.passou} de {r.total}
            </span>
            <span className="text-sm text-muted-foreground">casos passaram</span>
            <div className="ml-auto h-2 w-40 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-success" style={{ width: `${r.total ? (r.passou / r.total) * 100 : 0}%` }} />
            </div>
          </div>
          <ul className="space-y-1.5">
            {r.casos.map((c) => (
              <li key={c.caso} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setAberto(aberto === c.caso ? null : c.caso)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                >
                  {c.passou ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success" />
                  ) : (
                    <XCircle className="size-4 shrink-0 text-destructive" />
                  )}
                  <span className="flex-1 font-medium">{c.titulo}</span>
                  {c.origem === "calibracao" && <Chip tom="primario">Calibração</Chip>}
                  {c.nota != null && <span className="num text-xs text-muted-foreground">nota {fmtNota(c.nota)}</span>}
                  {c.acao && <span className="text-xs text-muted-foreground">{ACAO[c.acao]}</span>}
                  {c.agente && membros && (
                    <span className="text-xs text-muted-foreground">por {membros.find((m) => m.id === c.agente)?.nome ?? c.agente}</span>
                  )}
                  <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", aberto === c.caso && "rotate-180")} />
                </button>
                {aberto === c.caso && (
                  <div className="space-y-2 border-t border-border px-3 py-2 text-xs">
                    {c.motivos.length > 0 && (
                      <ul className="list-disc space-y-0.5 pl-4 text-destructive">
                        {c.motivos.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    )}
                    {c.resposta && <div className="rounded-lg bg-muted/50 px-3 py-2 whitespace-pre-wrap">{c.resposta}</div>}
                    {!!c.ferramentas?.length && <div className="text-muted-foreground">Ferramentas: {c.ferramentas.join(", ")}</div>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </SecaoPainel>
  );
}

/** Os casos sugeridos pela IA, com caixa de seleção; salva só os escolhidos. */
function Sugestoes({
  agente,
  sugestoes,
  aoTerminar,
}: {
  agente: AlvoCasos;
  sugestoes: Rascunho<{ casos: CasoNovo[] }>;
  aoTerminar: () => void;
}) {
  const qc = useQueryClient();
  const [marcados, setMarcados] = useState(() => new Set(sugestoes.casos.map((_, k) => k)));
  const salvar = useMutation({
    mutationFn: async () => {
      const escolhidos = sugestoes.casos.filter((_, k) => marcados.has(k));
      for (const c of escolhidos)
        await api(`/fabrica/agentes/${encodeURIComponent(agente.id)}/casos`, {
          method: "POST",
          body: JSON.stringify({ ...c, ativo: true }),
        });
      return escolhidos.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: chaveCasos(agente.id) });
      toast.success(`${n} caso(s) salvo(s)`);
      aoTerminar();
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: chaveCasos(agente.id) });
      toast.error("Parte dos casos não foi salva", { description: e.message });
    },
  });

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Casos sugeridos</h3>
        <span className="text-xs text-muted-foreground">
          {marcados.size} de {sugestoes.casos.length} marcados
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={aoTerminar}>
            Descartar
          </Button>
          <Button size="sm" disabled={!marcados.size || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar escolhidos
          </Button>
        </div>
      </div>
      <Alertas itens={sugestoes.alertas ?? []} />
      <ul className="space-y-1.5">
        {sugestoes.casos.map((c, k) => (
          <li key={k}>
            <label
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                marcados.has(k) ? "border-primary/40 bg-primary/5" : "border-border",
              )}
            >
              <input
                type="checkbox"
                checked={marcados.has(k)}
                onChange={() =>
                  setMarcados((m) => {
                    const n = new Set(m);
                    if (n.has(k)) n.delete(k);
                    else n.add(k);
                    return n;
                  })
                }
                className="mt-0.5 size-4 accent-[var(--color-primary)]"
              />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {c.titulo} <Chip tom="info">{ACAO[c.esperado.acao]}</Chip>
                  {c.esperado.categoria && (
                    <span className="text-xs font-normal text-muted-foreground">{agente.categorias[c.esperado.categoria]}</span>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">“{c.mensagem}”</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────── Formulário do caso ───────── */

const listaDe = (texto: string) =>
  texto
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);

function FormCaso({
  agente,
  caso,
  aberto,
  aoFechar,
}: {
  agente: AlvoCasos;
  caso: CasoTeste | null;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const qc = useQueryClient();
  const novo = caso === null;
  const vazio = {
    titulo: "",
    mensagem: "",
    nome: "",
    telefone: "",
    acao: "responder" as AcaoEsperada,
    categoria: "",
    quem: "",
    mencionar: "",
    proibido: "",
    ativo: true,
  };
  const [f, setF] = useState(vazio);
  useEffect(() => {
    if (!aberto) return;
    setF(
      caso
        ? {
            titulo: caso.titulo,
            mensagem: caso.mensagem,
            nome: caso.contexto.nome_contato ?? "",
            telefone: caso.contexto.telefone ?? "",
            acao: caso.esperado.acao,
            categoria: caso.esperado.categoria ?? "",
            quem: caso.esperado.agente ?? "",
            mencionar: caso.esperado.mencionar.join(", "),
            proibido: caso.esperado.proibido.join(", "),
            ativo: caso.ativo,
          }
        : vazio,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, caso]);

  const problemas = [
    !f.titulo.trim() && "Falta o título.",
    f.titulo.trim().length > 120 && "O título tem até 120 caracteres.",
    !f.mensagem.trim() && "Falta a mensagem do contato.",
  ].filter(Boolean) as string[];

  const salvar = useMutation({
    mutationFn: () => {
      const corpo: CasoNovo = {
        titulo: f.titulo.trim(),
        mensagem: f.mensagem.trim(),
        contexto: { nome_contato: f.nome.trim(), telefone: f.telefone.trim() },
        esperado: {
          acao: f.acao,
          categoria: f.acao === "transferir" && f.categoria ? f.categoria : null,
          mencionar: listaDe(f.mencionar),
          proibido: listaDe(f.proibido),
          ...(agente.membros ? { agente: f.quem || null } : {}),
        },
        ativo: f.ativo,
      };
      const caminho = `/fabrica/agentes/${encodeURIComponent(agente.id)}/casos`;
      return novo
        ? api(caminho, { method: "POST", body: JSON.stringify(corpo) })
        : api(`${caminho}/${caso.id}`, { method: "PUT", body: JSON.stringify(corpo) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chaveCasos(agente.id) });
      toast.success(novo ? "Caso criado" : "Caso salvo");
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível salvar o caso", { description: e.message }),
  });

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={(a) => !a && aoFechar()}
      largura="md"
      rotulo={`Casos de teste · ${agente.nome}`}
      icone={<FlaskConical />}
      titulo={novo ? "Novo caso" : caso.titulo}
      descricao="Uma mensagem de contato e o que se espera do agente."
      rodape={
        <>
          {problemas.length > 0 && <span className="mr-auto text-xs text-muted-foreground">{problemas[0]}</span>}
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button disabled={problemas.length > 0 || salvar.isPending} onClick={() => salvar.mutate()}>
            <Save /> {novo ? "Criar caso" : "Salvar"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Campo rotulo="Título">
          <Input
            value={f.titulo}
            maxLength={120}
            placeholder="Ex.: Pedido de reembolso"
            onChange={(e) => setF({ ...f, titulo: e.target.value })}
          />
        </Campo>
        <Campo rotulo="Mensagem do contato" ajuda="Como ele escreveria no WhatsApp.">
          <Textarea rows={4} value={f.mensagem} maxLength={2000} onChange={(e) => setF({ ...f, mensagem: e.target.value })} />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome do contato" ajuda="Opcional.">
            <Input value={f.nome} maxLength={80} onChange={(e) => setF({ ...f, nome: e.target.value })} />
          </Campo>
          <Campo rotulo="Telefone" ajuda="Opcional, para as consultas ao cadastro.">
            <Input className="num" value={f.telefone} maxLength={20} onChange={(e) => setF({ ...f, telefone: e.target.value })} />
          </Campo>
        </div>
        {agente.membros && (
          <Campo rotulo="A recepção deve escolher" ajuda="O membro da equipe que deve responder. Vazio: qualquer um.">
            <Selecao value={f.quem} onChange={(e) => setF({ ...f, quem: e.target.value })}>
              <option value="">Qualquer membro</option>
              {agente.membros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo={agente.membros ? "Quem responder deve" : "O agente deve"}>
            <Selecao value={f.acao} onChange={(e) => setF({ ...f, acao: e.target.value as AcaoEsperada })}>
              {(Object.keys(ACAO) as AcaoEsperada[]).map((a) => (
                <option key={a} value={a}>
                  {ACAO[a]}
                </option>
              ))}
            </Selecao>
          </Campo>
          {f.acao === "transferir" && (
            <Campo rotulo="Com o motivo" ajuda="Vazio: qualquer motivo.">
              <Selecao value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}>
                <option value="">Qualquer motivo</option>
                {Object.entries(agente.categorias).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Selecao>
            </Campo>
          )}
        </div>
        <Campo rotulo="A resposta precisa citar" ajuda="Palavras ou trechos curtos, separados por vírgula (até 10).">
          <Input value={f.mencionar} onChange={(e) => setF({ ...f, mencionar: e.target.value })} />
        </Campo>
        <Campo rotulo="A resposta nunca pode ter" ajuda="Palavras ou trechos curtos, separados por vírgula (até 10).">
          <Input value={f.proibido} onChange={(e) => setF({ ...f, proibido: e.target.value })} />
        </Campo>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.ativo}
            onChange={(e) => setF({ ...f, ativo: e.target.checked })}
            className="size-4 accent-[var(--color-primary)]"
          />
          Ativo (entra quando os casos rodam)
        </label>
      </div>
    </PainelLateral>
  );
}
