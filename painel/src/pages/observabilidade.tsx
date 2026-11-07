import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Activity,
  Binary,
  BookOpen,
  Bot,
  Braces,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Columns3,
  Database,
  Hash,
  Info,
  KeyRound,
  Layers,
  Loader2,
  MessageCircle,
  Rows3,
  Search,
  ToggleLeft,
  Type,
} from "lucide-react";
import { api, type ColunaBanco, type PaginaBanco, type RegistroBanco, type TabelaBanco, type ValorBanco } from "@/lib/api";
import { fmtDataHora, fmtInt, fmtRelativo } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { IndicadoresPainel, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import { CabecalhoOrdenavel, Chip, Table, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { Abas, EmptyState, PageHeader, PageLoader } from "@/components/widgets/widgets";

const GRUPOS: { id: string; label: string; icone: ComponentType<{ className?: string }> }[] = [
  { id: "Unnichat", label: "Unnichat", icone: MessageCircle },
  { id: "Conhecimento", label: "Conhecimento", icone: BookOpen },
  { id: "Calibração", label: "Calibração", icone: ClipboardCheck },
  { id: "Agno", label: "Agno", icone: Bot },
  { id: "Outras", label: "Outras", icone: Layers },
];
const POR_PAGINA = 50;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const VETOR = /^vetor de \d+ dimensões$/;
// Colunas de estado viram rótulo colorido.
const COLUNAS_DE_ESTADO = new Set(["status", "situacao", "evento", "tipo", "papel", "session_type", "run_type", "eval_type", "learning_type"]);

function iconeDoTipo(c: ColunaBanco): ComponentType<{ className?: string }> {
  const t = c.tipo.toLowerCase();
  if (c.vetor) return Binary;
  if (/time|date/.test(t) || c.nome.endsWith("_em") || c.nome.endsWith("_at")) return Calendar;
  if (/bool/.test(t)) return ToggleLeft;
  if (/json/.test(t)) return Braces;
  if (/int|numeric|double|real|float|decimal/.test(t)) return Hash;
  return Type;
}

function tomDoEstado(v: string): "sucesso" | "alerta" | "erro" | "info" | "primario" | "neutro" {
  if (/^(pronto|aprovada|completed|success|em_atendimento|ativo|onboarding)$/i.test(v)) return "sucesso";
  if (/^(processando|pendente|running|pending|paused)$/i.test(v)) return "alerta";
  if (/^(erro|recusada|error|failed|cancelled)$/i.test(v)) return "erro";
  if (/^(transferido|mensagem)$/i.test(v)) return "primario";
  if (/^(encerrado)$/i.test(v)) return "info";
  return "neutro";
}

/**
 * Observabilidade: tudo o que os agentes gravam no banco, como está agora e só para leitura. Os
 * grupos e as tabelas viram abas; a lista vem do próprio banco, então tabela nova aparece sozinha.
 * Clique numa linha para abrir o registro inteiro no painel lateral.
 */
export function Observabilidade() {
  const { grupo, tabela } = useSearch({ from: "/protegido/painel/observabilidade" });
  const navigate = useNavigate({ from: "/observabilidade" });
  const lista = useQuery({
    queryKey: ["banco-tabelas"],
    queryFn: () => api<{ banco: string; schema: string | null; tabelas: TabelaBanco[] }>("/banco/tabelas"),
  });
  const tabelas = lista.data?.tabelas ?? [];
  const contagem = (nome: string) => tabelas.find((t) => t.nome === nome)?.linhas;
  const gruposComTabelas = GRUPOS.filter((g) => tabelas.some((t) => t.grupo === g.id));
  const grupoAtivo = grupo && gruposComTabelas.some((g) => g.id === grupo) ? grupo : (gruposComTabelas[0]?.id ?? "Unnichat");
  const doGrupo = tabelas.filter((t) => t.grupo === grupoAtivo);
  const tabelaAtiva = tabela && doGrupo.some((t) => t.nome === tabela) ? tabela : doGrupo[0]?.nome;

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Observabilidade"
        icon={Activity}
        description={
          lista.data
            ? `${lista.data.banco}${lista.data.schema ? `, schema ${lista.data.schema}` : ""}: ${tabelas.length} tabelas, como estão agora. Só leitura.`
            : "Tudo o que os agentes gravam no banco, como está agora. Só leitura."
        }
      />

      {lista.isLoading && <PageLoader className="h-[60vh]" label="Lendo o banco" />}
      {lista.isError && (
        <div className="surface-card">
          <EmptyState title="Não foi possível ler o banco">{(lista.error as Error).message}</EmptyState>
        </div>
      )}

      {lista.data && (
        <>
          <div className="space-y-3">
            <Abas
              rotulo="Grupos de tabelas"
              valor={grupoAtivo}
              onTrocar={(g) => navigate({ search: { grupo: g } })}
              abas={gruposComTabelas.map((g) => ({ ...g, n: tabelas.filter((t) => t.grupo === g.id).length }))}
            />
            <div role="tablist" aria-label="Tabelas do grupo" className="thin-scroll flex gap-1.5 overflow-x-auto pb-1">
              {doGrupo.map((t) => {
                const ativa = t.nome === tabelaAtiva;
                return (
                  <button
                    key={t.nome}
                    type="button"
                    role="tab"
                    aria-selected={ativa}
                    title={t.descricao || t.nome}
                    onClick={() => navigate({ search: { grupo: grupoAtivo, tabela: t.nome } })}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      ativa ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Database className="size-3.5 opacity-60" />
                    {t.nome}
                    <span className={cn("num rounded px-1.5 py-0.5 text-2xs", ativa ? "bg-primary/14 text-primary-text" : "bg-secondary")}>
                      {fmtInt(t.linhas)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Só abas e tabelas: os números de cada tabela ficam no painel "Sobre a tabela". */}
          {tabelaAtiva && <Dados key={tabelaAtiva} nome={tabelaAtiva} grupo={grupoAtivo} linhasNoBanco={contagem(tabelaAtiva)} />}
        </>
      )}
    </div>
  );
}

function Dados({ nome, grupo, linhasNoBanco }: { nome: string; grupo: string; linhasNoBanco?: number }) {
  const [pagina, setPagina] = useState(1);
  const [digitado, setDigitado] = useState("");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<{ coluna: string; direcao: "asc" | "desc" } | null>(null);
  const [aberto, setAberto] = useState<Record<string, ValorBanco> | null>(null);
  const [sobre, setSobre] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setBusca(digitado.trim());
      setPagina(1);
    }, 400);
    return () => clearTimeout(t);
  }, [digitado]);

  const q = useQuery({
    queryKey: ["banco-linhas", nome, pagina, busca, ordem],
    queryFn: () =>
      api<PaginaBanco>(
        `/banco/tabelas/${encodeURIComponent(nome)}?pagina=${pagina}&por_pagina=${POR_PAGINA}&busca=${encodeURIComponent(busca)}` +
          (ordem ? `&ordem=${encodeURIComponent(ordem.coluna)}&direcao=${ordem.direcao}` : ""),
      ),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const inicio = d && d.total ? (d.pagina - 1) * d.por_pagina + 1 : 0;
  const fim = d ? Math.min(d.pagina * d.por_pagina, d.total) : 0;
  const alternarOrdem = (coluna: string) => {
    setPagina(1);
    setOrdem((o) => (o?.coluna === coluna ? { coluna, direcao: o.direcao === "asc" ? "desc" : "asc" } : { coluna, direcao: "desc" }));
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="num truncate text-sm font-semibold">{nome}</h2>
          <p className="text-xs text-muted-foreground">
            {d?.descricao || "Sem descrição."}
            {d && ` · ${fmtInt(d.total)} linha(s)${busca ? " com a busca" : ""} · ${d.colunas.length} colunas`}
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar em todas as colunas" value={digitado} onChange={(e) => setDigitado(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" onClick={() => setSobre(true)} disabled={!d}>
          <Info /> Sobre a tabela
        </Button>
      </div>

      {q.isLoading && <PageLoader className="h-64" label="Carregando linhas" />}
      {q.isError && <p className="text-xs text-destructive">{(q.error as Error).message}</p>}

      {d && (
        <TableWrapper className={cn("max-h-[64vh] overflow-y-auto", q.isFetching && "opacity-70")}>
          <Table className="w-max min-w-full">
            <TableHeader>
              <tr>
                {d.colunas.map((c) => (
                  <TableHead key={c.nome}>
                    {c.vetor ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Binary className="size-3.5 opacity-70" /> {c.nome}
                      </span>
                    ) : (
                      <CabecalhoOrdenavel
                        rotulo={c.nome}
                        campo={c.nome}
                        chaveAtiva={d.ordem ?? ""}
                        direcao={d.direcao}
                        onAlternar={alternarOrdem}
                        icone={iconeDoTipo(c)}
                      />
                    )}
                    {d.chave_primaria.includes(c.nome) && <span className="ml-1 text-primary-text" title="Chave primária">●</span>}
                  </TableHead>
                ))}
              </tr>
            </TableHeader>
            <tbody>
              {d.linhas.length === 0 && <TableEmpty colSpan={d.colunas.length}>{busca ? "Nada encontrado." : "Tabela vazia."}</TableEmpty>}
              {d.linhas.map((linha, i) => (
                <TableRow
                  key={i}
                  onClick={() => d.chave_primaria.length && setAberto(linha.chave)}
                  className={cn(d.chave_primaria.length && "cursor-pointer")}
                >
                  {linha.valores.map((v, j) => (
                    <TableCell
                      key={j}
                      numeric={typeof v === "number"}
                      className="max-w-[22rem] truncate py-2.5 text-xs"
                      title={typeof v === "string" ? v.slice(0, 500) : undefined}
                    >
                      <Celula coluna={d.colunas[j]} valor={v} cortada={linha.cortadas.includes(d.colunas[j].nome)} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </tbody>
          </Table>
        </TableWrapper>
      )}

      {d && d.total > d.por_pagina && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="num">
            {fmtInt(inicio)}–{fmtInt(fim)} de {fmtInt(d.total)}
          </span>
          <div className="flex items-center gap-1">
            {q.isFetching && <Loader2 className="size-3.5 animate-spin" />}
            <Button size="sm" variant="outline" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior">
              <ChevronLeft />
            </Button>
            <Button size="sm" variant="outline" disabled={fim >= d.total} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <Registro tabela={nome} chave={aberto} aoFechar={() => setAberto(null)} />
      {d && <SobreATabela aberto={sobre} aoFechar={() => setSobre(false)} nome={nome} grupo={grupo} pagina={d} linhas={linhasNoBanco ?? d.total} />}
    </section>
  );
}

/** O que a tabela guarda e a forma dela: linhas, colunas com o tipo, chave primária e as colunas de data. */
function SobreATabela({
  aberto,
  aoFechar,
  nome,
  grupo,
  pagina,
  linhas,
}: {
  aberto: boolean;
  aoFechar: () => void;
  nome: string;
  grupo: string;
  pagina: PaginaBanco;
  linhas: number;
}) {
  const datas = pagina.colunas.filter((c) => iconeDoTipo(c) === Calendar).map((c) => c.nome);
  const vetores = pagina.colunas.filter((c) => c.vetor).length;
  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={(a) => !a && aoFechar()}
      rotulo={`Tabela · ${grupo}`}
      icone={<Database />}
      titulo={<span className="num">{nome}</span>}
      descricao={pagina.descricao || "Sem descrição no banco."}
      destaque={
        <IndicadoresPainel
          itens={[
            { rotulo: "Linhas", valor: fmtInt(linhas), icone: <Rows3 /> },
            { rotulo: "Colunas", valor: fmtInt(pagina.colunas.length), icone: <Columns3 />, detalhe: vetores ? `${vetores} de vetor` : undefined },
            { rotulo: "Chave primária", valor: pagina.chave_primaria.length ? pagina.chave_primaria.join(", ") : "—", icone: <KeyRound /> },
          ]}
        />
      }
    >
      <div className="space-y-6">
        {datas.length > 0 && (
          <SecaoPainel titulo="Colunas de data" contagem={datas.length}>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Ordene a tabela por uma delas para ver o registro mais recente: <span className="num text-foreground">{datas.join(", ")}</span>.
            </p>
          </SecaoPainel>
        )}
        <SecaoPainel titulo="Colunas" contagem={pagina.colunas.length}>
          <div className="overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 text-[10.5px] tracking-wider text-muted-foreground uppercase">
                  <th className="px-3 py-2 text-left font-medium">Coluna</th>
                  <th className="px-3 py-2 text-left font-medium">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {pagina.colunas.map((c) => {
                  const Icone = iconeDoTipo(c);
                  return (
                    <tr key={c.nome} className="border-b border-border/40 last:border-0">
                      <td className="px-3 py-2">
                        <span className="num inline-flex items-center gap-1.5">
                          <Icone className="size-3.5 text-muted-foreground" />
                          {c.nome}
                          {pagina.chave_primaria.includes(c.nome) && <span className="text-primary-text" title="Chave primária">●</span>}
                        </span>
                      </td>
                      <td className="num px-3 py-2 text-muted-foreground">{c.vetor ? "vetor" : c.tipo}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SecaoPainel>
      </div>
    </PainelLateral>
  );
}

function Celula({ coluna, valor, cortada }: { coluna?: ColunaBanco; valor: ValorBanco; cortada: boolean }) {
  if (valor === null) return <span className="text-muted-foreground/50">—</span>;
  if (typeof valor === "boolean") return <Chip tom={valor ? "sucesso" : "neutro"}>{valor ? "sim" : "não"}</Chip>;
  if (typeof valor === "number") return <span className="num">{valor.toLocaleString("pt-BR")}</span>;
  if (VETOR.test(valor)) return <span className="text-accent">{valor}</span>;
  if (ISO.test(valor)) return <span title={valor}>{fmtRelativo(valor)}</span>;
  if (coluna && COLUNAS_DE_ESTADO.has(coluna.nome) && valor.length <= 40) return <Chip tom={tomDoEstado(valor)}>{valor}</Chip>;
  return <span className={cn(cortada && "text-muted-foreground")}>{valor}</span>;
}

/** O registro inteiro no painel lateral: JSON formatado, datas por extenso e textos sem corte. */
function Registro({ tabela, chave, aoFechar }: { tabela: string; chave: Record<string, ValorBanco> | null; aoFechar: () => void }) {
  const q = useQuery({
    queryKey: ["banco-registro", tabela, chave],
    queryFn: () =>
      api<RegistroBanco>(`/banco/tabelas/${encodeURIComponent(tabela)}/registro?chave=${encodeURIComponent(JSON.stringify(chave))}`),
    enabled: chave !== null,
  });
  const identificacao = useMemo(() => Object.entries(chave ?? {}).map(([k, v]) => `${k} = ${v}`).join(" · "), [chave]);
  return (
    <PainelLateral
      aberto={chave !== null}
      aoMudar={(a) => !a && aoFechar()}
      rotulo="Registro"
      icone={<Database />}
      titulo={<span className="num">{tabela}</span>}
      descricao={<span className="num">{identificacao}</span>}
    >
      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando o registro…</p>}
      {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      <dl className="space-y-4">
        {q.data?.campos.map((c) => (
          <div key={c.coluna}>
            <dt className="mb-1.5 flex items-baseline gap-2">
              <span className="num text-xs font-semibold">{c.coluna}</span>
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">{c.tipo}</span>
            </dt>
            <dd>
              <ValorCompleto valor={c.valor} />
            </dd>
          </div>
        ))}
      </dl>
    </PainelLateral>
  );
}

function ValorCompleto({ valor }: { valor: ValorBanco }) {
  const caixa = "rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs";
  if (valor === null) return <div className={cn(caixa, "text-muted-foreground/60")}>vazio</div>;
  if (typeof valor !== "string") return <div className={caixa}>{typeof valor === "boolean" ? (valor ? "sim" : "não") : valor.toLocaleString("pt-BR")}</div>;
  if (ISO.test(valor)) return <div className={caixa}>{fmtDataHora(valor)} <span className="text-muted-foreground">· {valor}</span></div>;
  let texto = valor;
  if (/^[[{]/.test(valor.trim())) {
    try {
      texto = JSON.stringify(JSON.parse(valor), null, 2);
    } catch {
      /* não é JSON: mostra como está */
    }
  }
  return <pre className={cn(caixa, "num thin-scroll max-h-96 overflow-auto whitespace-pre-wrap break-words")}>{texto}</pre>;
}
