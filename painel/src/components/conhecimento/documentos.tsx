import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calendar, ChevronDown, ChevronRight, Cloud, Database, Download, FileText, GitBranch, Hash, Loader2, Pencil, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { AGENTE_PADRAO, api, baixarArquivo, type Config, type DocumentoConhecimento, type TrechoDocumento } from "@/lib/api";
import { fmtDataHora, fmtInt } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/widgets/widgets";
import { Paginacao, usePaginacao } from "@/components/ui/paginacao";
import { PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import { Chip, Table, TableCell, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { usePode } from "@/hooks/use-permissoes";
import { PainelSugestoes } from "./sugestoes";

// Os mesmos tipos do servidor (agente/conhecimento.py e agente/leitura_arquivos.py).
const ACEITOS = [
  ".pdf", ".docx", ".md", ".markdown", ".txt", ".xlsx", ".csv", ".tsv", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".html", ".htm",
  ".json", ".png", ".jpg", ".jpeg", ".webp",
].join(",");
const ROTEIRO = "roteiro-atendimento.md";

type Uso = { rotulo: string; tom: "sucesso" | "info" | "alerta" | "neutro"; explicacao: string };

/** Como o documento entra nas respostas do agente agora. */
function usoNoAgente(nome: string, ativa: DocumentoConhecimento | undefined, processando: boolean, modo: Config["roteiro_modo"]): Uso {
  if (processando) return { rotulo: "Processando", tom: "alerta", explicacao: "Extraindo o texto e gerando os vetores." };
  if (nome === ROTEIRO) {
    return modo === "busca"
      ? { rotulo: "Busca por trechos", tom: "sucesso", explicacao: "Vai só o essencial do roteiro nas instruções; as seções mais parecidas com a mensagem chegam pela busca nos vetores." }
      : { rotulo: "Inteiro nas instruções", tom: "info", explicacao: "O roteiro vai completo em toda resposta (ROTEIRO_MODO=inteiro). Os vetores ficam prontos para o modo busca." };
  }
  return ativa
    ? { rotulo: "Busca por trechos", tom: "sucesso", explicacao: "O agente recebe os trechos mais parecidos com cada mensagem do aluno." }
    : { rotulo: "Fora de uso", tom: "neutro", explicacao: "Nenhuma versão ativa: o agente não usa este documento." };
}

function tamanho(bytes: number) {
  return bytes < 1024 ? `${bytes} bytes` : `${fmtInt(Math.round(bytes / 1024))} KB`;
}

const noBucket = (v: DocumentoConhecimento) => !v.caminho?.startsWith("(sem bucket)");

/**
 * Documentos de referência do agente: enviados aqui, guardados no bucket privado do Supabase e
 * divididos em trechos com embedding. Uma linha por documento; ao abrir, um painel lateral com as
 * versões, os trechos e a exclusão.
 * Enviar de novo um arquivo com o mesmo nome cria uma versão nova (só uma fica ativa).
 * "Sugerir atualizações do roteiro" abre as sugestões da IA do que o documento muda no roteiro (./sugestoes.tsx).
 */
export function Documentos({ agente = AGENTE_PADRAO }: { agente?: string }) {
  const qc = useQueryClient();
  const pode = usePode();
  const entrada = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [sugerir, setSugerir] = useState<{ id: number; nome: string; versao: number } | null>(null);
  const config = useQuery({
    queryKey: ["config", agente],
    queryFn: () => api<Config>(`/config?agente=${encodeURIComponent(agente)}`),
    staleTime: 5 * 60_000,
    // Os documentos de uma base compartilhada (dono base_<id>) não têm agente nem roteiro.
    enabled: !agente.startsWith("base_"),
  });
  const status = useQuery({
    queryKey: ["conhecimento-status"],
    queryFn: () => api<{ documentos: boolean; exemplos: boolean }>("/conhecimento/status"),
  });
  const docs = useQuery({
    queryKey: ["conhecimento-documentos", agente],
    queryFn: () => api<{ documentos: DocumentoConhecimento[] }>(`/conhecimento/documentos?agente=${encodeURIComponent(agente)}`),
    refetchInterval: (q) => (q.state.data?.documentos.some((d) => d.status === "processando") ? 2000 : false),
  });

  const enviar = useMutation({
    mutationFn: (arquivo: File) => {
      const corpo = new FormData();
      corpo.append("arquivo", arquivo, arquivo.name);
      corpo.append("agente", agente);
      return api<{ versao: number }>("/conhecimento/documentos", { method: "POST", body: corpo });
    },
    onSuccess: (r, arquivo) => {
      qc.invalidateQueries({ queryKey: ["conhecimento-documentos"] });
      toast.success(`${arquivo.name}: versão ${r.versao} enviada`, {
        description:
          "Processando: texto, trechos e embeddings. Ela passa a valer quando ficar pronta. Depois, use “Sugerir atualizações do roteiro” para ver o que o documento muda no roteiro.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível enviar", { description: e.message }),
  });

  const alternar = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      api(`/conhecimento/documentos/${id}/ativo`, { method: "POST", body: JSON.stringify({ ativo }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conhecimento-documentos"] }),
    onError: (e: Error) => toast.error("Não foi possível alterar", { description: e.message }),
  });

  // Agrupa as versões por documento (nome), a mais recente primeiro; o roteiro vem antes dos demais.
  const grupos = new Map<string, DocumentoConhecimento[]>();
  for (const d of docs.data?.documentos ?? []) grupos.set(d.nome, [...(grupos.get(d.nome) ?? []), d]);
  const linhas = [...grupos.entries()].sort(([a], [b]) => (a === ROTEIRO ? -1 : b === ROTEIRO ? 1 : a.localeCompare(b)));
  const trechosEmUso = linhas.reduce((s, [, vs]) => s + (vs.find((v) => v.ativo)?.trechos ?? 0), 0);
  const paginacao = usePaginacao(linhas);
  const abertas = aberto ? grupos.get(aberto) : undefined;
  // A versão que as sugestões comparam: a ativa ou, sem ela, a última pronta.
  const paraSugerir = (nome: string, versoes: DocumentoConhecimento[]) =>
    nome === ROTEIRO ? undefined : (versoes.find((v) => v.ativo && v.status === "pronto") ?? versoes.find((v) => v.status === "pronto"));
  const abrirSugestoes = (v: DocumentoConhecimento) => setSugerir({ id: v.id, nome: v.nome, versao: v.versao });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Documentos vetorizados</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            PDF, Word, Excel, PowerPoint, LibreOffice, texto, Markdown, CSV, RTF, HTML, JSON ou imagem (até 25 MB; imagem e PDF digitalizado são lidos pela IA). Cada arquivo fica guardado no bucket privado do Supabase e é dividido em trechos com
            vetor (embedding) para a busca. O mesmo nome de arquivo cria uma versão nova.
            {docs.data && ` ${grupos.size} documento(s) · ${fmtInt(trechosEmUso)} trechos ativos.`}
          </p>
        </div>
        <input
          ref={entrada}
          type="file"
          accept={ACEITOS}
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) enviar.mutate(arquivo);
            e.target.value = "";
          }}
        />
        <Button
          disabled={enviar.isPending || status.data?.documentos === false || !pode("editar_conhecimento")}
          title={pode("editar_conhecimento") ? undefined : "Sem a permissão Editar conhecimento"}
          onClick={() => entrada.current?.click()}
        >
          {enviar.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Enviar documento
        </Button>
      </div>

      {status.data?.documentos === false && (
        <p className="p-4 text-xs text-muted-foreground">
          Envio desligado: o servidor precisa do banco (DATABASE_URL) e do Storage do Supabase (SUPABASE_URL e
          SUPABASE_SERVICE_ROLE_KEY).
        </p>
      )}
      {docs.isLoading && <p className="p-4 text-xs text-muted-foreground">Carregando documentos…</p>}
      {docs.data && grupos.size === 0 && <p className="p-4 text-xs text-muted-foreground">Nenhum documento enviado ainda.</p>}

      {linhas.length > 0 && (
        <TableWrapper>
          <Table className="min-w-[860px]">
            <TableHeader>
              <tr>
                <TableHead icone={FileText}>Documento</TableHead>
                <TableHead icone={Sparkles}>Uso no agente</TableHead>
                <TableHead icone={GitBranch}>Versão em uso</TableHead>
                <TableHead icone={Hash} className="text-right">Trechos</TableHead>
                <TableHead icone={Cloud}>Arquivo</TableHead>
                <TableHead icone={Calendar}>Última versão</TableHead>
                <TableHead className="sticky right-0 bg-card text-right">Ações</TableHead>
              </tr>
            </TableHeader>
            <tbody>
              {paginacao.itens.map(([nome, versoes]) => {
                const ativa = versoes.find((v) => v.ativo);
                const ultima = versoes[0];
                const uso = usoNoAgente(nome, ativa, versoes.some((v) => v.status === "processando"), config.data?.roteiro_modo);
                return (
                    <TableRow key={nome} className={cn("group cursor-pointer", aberto === nome && "bg-primary/5")} onClick={() => setAberto(nome)}>
                      <TableCell className="max-w-[22rem]">
                        <div className="flex items-center gap-2">
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium" title={nome}>
                            {nome === ROTEIRO ? "Roteiro do atendimento" : nome}
                          </span>
                        </div>
                        {nome === ROTEIRO && (
                          <div className="mt-0.5 pl-6 text-xs text-muted-foreground">Cada versão salva do roteiro vira uma versão aqui</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1">
                          <Chip tom={uso.tom}>{uso.rotulo}</Chip>
                          <InfoTip>{uso.explicacao}</InfoTip>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {ativa ? `v${ativa.versao}` : "—"} <span className="text-xs">de {versoes.length}</span>
                      </TableCell>
                      <TableCell numeric>{ativa ? fmtInt(ativa.trechos) : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {noBucket(ultima) ? (
                          <span className="inline-flex items-center gap-1"><Cloud className="size-3.5" /> No bucket</span>
                        ) : (
                          <span className="inline-flex items-center gap-1"><Database className="size-3.5" /> Só no banco</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                        {fmtDataHora(ultima.enviado_em)} · {ultima.enviado_por}
                      </TableCell>
                      <TableCell className="sticky right-0 bg-card transition-colors group-hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-0.5">
                          {paraSugerir(nome, versoes) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Sugerir atualizações do roteiro"
                              aria-label={`Sugerir atualizações do roteiro a partir de ${nome}`}
                              disabled={!pode("editar_conhecimento")}
                              onClick={() => abrirSugestoes(paraSugerir(nome, versoes)!)}
                            >
                              <Wand2 />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" title="Versões e trechos" aria-label={`Abrir ${nome}`} onClick={() => setAberto(nome)}>
                            <Pencil />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                );
              })}
            </tbody>
          </Table>
        </TableWrapper>
      )}
      {linhas.length > 10 && <Paginacao {...paginacao} />}

      <PainelLateral
        aberto={!!abertas}
        aoMudar={(a) => !a && setAberto(null)}
        largura="xl"
        rotulo="Documento"
        icone={<FileText />}
        titulo={aberto === ROTEIRO ? "Roteiro do atendimento" : (aberto ?? "")}
        descricao={
          aberto === ROTEIRO
            ? "Cada versão salva do roteiro vira uma versão aqui, dividida em trechos com vetor."
            : "As versões enviadas, com os trechos que o agente recebe na busca. Só uma versão fica em uso."
        }
      >
        {abertas && aberto && (
          <div className="space-y-6">
            {paraSugerir(aberto, abertas) && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card/60 px-4 py-3">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  O documento não muda o roteiro sozinho. A IA compara os dois e sugere as mudanças; você revisa e decide o que aplicar.
                </p>
                <Button size="sm" disabled={!pode("editar_conhecimento")} onClick={() => abrirSugestoes(paraSugerir(aberto, abertas)!)}>
                  <Wand2 /> Sugerir atualizações do roteiro
                </Button>
              </div>
            )}
            <SecaoPainel titulo="Versões" contagem={abertas.length}>
              <Versoes versoes={abertas} alternar={(id, ativo) => alternar.mutate({ id, ativo })} />
            </SecaoPainel>
            {aberto !== ROTEIRO && <ExcluirDocumento agente={agente} nome={aberto} versoes={abertas} aoExcluir={() => setAberto(null)} />}
          </div>
        )}
      </PainelLateral>
      <PainelSugestoes documento={sugerir} dono={agente} aoFechar={() => setSugerir(null)} />
    </section>
  );
}

function Versoes({ versoes, alternar }: { versoes: DocumentoConhecimento[]; alternar: (id: number, ativo: boolean) => void }) {
  const pode = usePode();
  const [aberto, setAberto] = useState<number | null>(() => versoes.find((v) => v.ativo)?.id ?? null);
  const baixar = useMutation({
    mutationFn: (v: DocumentoConhecimento) => baixarArquivo(`/conhecimento/documentos/${v.id}/arquivo`, v.nome),
    onError: (e: Error) => toast.error("Não foi possível baixar", { description: e.message }),
  });
  return (
    <ul className="mt-2 space-y-1.5">
      {versoes.map((v) => (
        <li key={v.id} className="rounded-lg border bg-card/60 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 font-semibold"
              onClick={() => setAberto((a) => (a === v.id ? null : v.id))}
              disabled={v.status !== "pronto"}
            >
              {aberto === v.id ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              Versão {v.versao}
            </button>
            {v.ativo && <span className="rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success">ativa</span>}
            <span className="text-muted-foreground">
              {fmtDataHora(v.enviado_em)} · {v.enviado_por} · {tamanho(v.tamanho)}
            </span>
            {v.status === "processando" && (
              <span className="inline-flex items-center gap-1 text-primary">
                <Loader2 className="size-3 animate-spin" /> processando
              </span>
            )}
            {v.status === "pronto" && <span className="text-muted-foreground">{v.trechos} trechos</span>}
            {v.status === "erro" && <span className="text-destructive">erro: {v.erro}</span>}
            <span className="ml-auto flex items-center gap-1">
              {noBucket(v) && (
                <Button size="sm" variant="ghost" className="h-7" disabled={baixar.isPending} onClick={() => baixar.mutate(v)}>
                  <Download /> Baixar arquivo
                </Button>
              )}
              {v.status === "pronto" && (
                <Button size="sm" variant="ghost" className="h-7" disabled={!pode("editar_conhecimento")} onClick={() => alternar(v.id, !v.ativo)}>
                  {v.ativo ? "Tirar de uso" : "Usar esta versão"}
                </Button>
              )}
            </span>
          </div>
          {aberto === v.id && <Trechos id={v.id} />}
        </li>
      ))}
    </ul>
  );
}

/** Exclui o documento inteiro: versões, trechos com vetor e arquivos no bucket. Pede confirmação. */
function ExcluirDocumento({
  nome,
  agente,
  versoes,
  aoExcluir,
}: {
  nome: string;
  agente: string;
  versoes: DocumentoConhecimento[];
  aoExcluir: () => void;
}) {
  const qc = useQueryClient();
  const [confirmar, setConfirmar] = useState(false);
  const pode = usePode();
  const trechos = versoes.reduce((s, v) => s + (v.trechos || 0), 0);
  const excluir = useMutation({
    mutationFn: () =>
      api<{ versoes: number; trechos: number; arquivos: number; erro_bucket?: string }>(
        `/conhecimento/documentos?nome=${encodeURIComponent(nome)}&agente=${encodeURIComponent(agente)}`,
        { method: "DELETE" },
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["conhecimento-documentos"] });
      aoExcluir();
      if (r.erro_bucket) toast.warning("Excluído do banco, mas não do bucket", { description: r.erro_bucket });
      else toast.success(`${nome} excluído`, { description: `${r.versoes} versão(ões), ${r.trechos} trechos e ${r.arquivos} arquivo(s).` });
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-xs">
      {confirmar ? (
        <>
          <span className="text-destructive">
            Excluir {versoes.length} versão(ões), {fmtInt(trechos)} trechos com vetor e o(s) arquivo(s) do bucket? Não tem volta.
          </span>
          <Button size="sm" variant="ghost" onClick={() => setConfirmar(false)}>
            Cancelar
          </Button>
          <Button size="sm" variant="destructive" disabled={excluir.isPending} onClick={() => excluir.mutate()}>
            {excluir.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />} Excluir de vez
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:bg-destructive/10"
          disabled={!pode("excluir")}
          title={pode("excluir") ? undefined : "Sem a permissão Excluir"}
          onClick={() => setConfirmar(true)}
        >
          <Trash2 /> Excluir documento
        </Button>
      )}
    </div>
  );
}

function Trechos({ id }: { id: number }) {
  const q = useQuery({
    queryKey: ["conhecimento-trechos", id],
    queryFn: () => api<{ trechos: TrechoDocumento[] }>(`/conhecimento/documentos/${id}/trechos`),
  });
  if (q.isLoading) return <p className="mt-2 text-muted-foreground">Carregando trechos…</p>;
  return (
    <ol className="thin-scroll mt-2 max-h-80 space-y-2 overflow-y-auto">
      {q.data?.trechos.map((t) => (
        <li key={t.ordem} className="rounded-md border bg-background/50 p-2">
          <div className="mb-1 flex items-baseline gap-2">
            <span className="num text-[11px] text-muted-foreground">#{t.ordem + 1}</span>
            {t.secao && <span className="font-semibold">{t.secao}</span>}
          </div>
          <div className="whitespace-pre-wrap text-muted-foreground">{t.conteudo}</div>
        </li>
      ))}
    </ol>
  );
}
