import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  BookOpen,
  FileText,
  Hash,
  History,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  Trash2,
  Undo2,
  Wand2,
} from "lucide-react";
import { api, type Base, type VersaoBase } from "@/lib/api";
import { fmtDataHora, fmtInt } from "@/lib/formato";
import { corpoArrumado, dividir, juntar, previa, subtopicos, TIPO_SECAO, tipoDaSecao, type RoteiroDividido } from "@/lib/roteiro";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/fields";
import { Paginacao, usePaginacao } from "@/components/ui/paginacao";
import { Campo, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import { Chip, Table, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { usePode } from "@/hooks/use-permissoes";

/*
 * O roteiro de atendimento do agente, seção por seção: cada "## " é uma linha da tabela e se edita num
 * painel lateral. Gravar uma seção salva uma versão nova do roteiro inteiro (o histórico continua), com
 * as outras seções intactas. O texto completo também se edita num painel, para mudanças grandes.
 */

const MINIMO = 50;

export const chaveBase = (agente: string) => ["base", agente];

/** Grava o roteiro inteiro como versão nova. */
export function useGravarBase(agente: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conteudo, observacao }: { conteudo: string; observacao: string }) =>
      api<Base>(`/base?agente=${encodeURIComponent(agente)}`, {
        method: "PUT",
        body: JSON.stringify({ conteudo, observacao: observacao.trim() || null }),
      }),
    onSuccess: (b) => {
      qc.setQueryData(chaveBase(agente), b);
      qc.invalidateQueries({ queryKey: ["base-historico", agente] });
      toast.success(`Versão ${b.versao} salva`, { description: "O agente já usa esta versão na próxima mensagem." });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });
}

type Aberta = { indice: number | "abertura" | "nova" } | null;

export function TabelaSecoes({
  agente,
  base,
  nomeAgente,
  aoAtualizarComIA,
}: {
  agente: string;
  base: Base;
  nomeAgente: string;
  /** Abre o "Atualizar com IA" (o painel fica na página, para este arquivo não importar o das sugestões). */
  aoAtualizarComIA?: () => void;
}) {
  const roteiro = useMemo(() => dividir(base.conteudo), [base.conteudo]);
  const gravar = useGravarBase(agente);
  const pode = usePode();
  const podeEditar = pode("editar_conhecimento");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<Aberta>(null);
  const [textoCompleto, setTextoCompleto] = useState(false);
  // As setas de ordem gravam uma versão a cada clique: ficam escondidas até a pessoa pedir para reordenar (em 03/11, um
  // clique sem querer gravou uma versão que só trocou a ordem de uma seção).
  const [reordenando, setReordenando] = useState(false);

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return roteiro.secoes
      .map((s, indice) => ({ ...s, indice, tipo: tipoDaSecao(s.titulo) }))
      .filter((s) => !termo || s.titulo.toLowerCase().includes(termo) || s.corpo.toLowerCase().includes(termo));
  }, [roteiro, busca]);
  const paginacao = usePaginacao(linhas, 25);

  const gravarRoteiro = (novo: RoteiroDividido, observacao: string, depois?: () => void) =>
    gravar.mutate({ conteudo: juntar(novo), observacao }, { onSuccess: () => depois?.() });

  const mover = (indice: number, passo: -1 | 1) => {
    const secoes = [...roteiro.secoes];
    const alvo = indice + passo;
    [secoes[indice], secoes[alvo]] = [secoes[alvo], secoes[indice]];
    // A que vira última perde a linha em branco extra; a que deixa de ser última ganha.
    gravarRoteiro(
      { ...roteiro, secoes: secoes.map((s) => ({ ...s, corpo: corpoArrumado(s.corpo) })) },
      `Seção "${roteiro.secoes[indice].titulo}" movida`,
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar nas seções" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {aoAtualizarComIA && (
            <Button
              disabled={!podeEditar}
              title={podeEditar ? "Escreva a informação nova e a IA acha onde ela entra no roteiro" : "Sem a permissão Editar conhecimento"}
              onClick={aoAtualizarComIA}
            >
              <Wand2 /> Atualizar com IA
            </Button>
          )}
          <Button variant="outline" onClick={() => setTextoCompleto(true)}>
            <ScrollText /> Texto completo
          </Button>
          <Button
            variant={reordenando ? "secondary" : "outline"}
            disabled={!podeEditar || (!reordenando && !!busca)}
            title={
              !podeEditar
                ? "Sem a permissão Editar conhecimento"
                : busca && !reordenando
                  ? "Limpe a busca para reordenar"
                  : "Cada clique numa seta salva uma versão nova (o Histórico guarda a anterior)"
            }
            onClick={() => setReordenando((r) => !r)}
          >
            {reordenando ? <Check /> : <ArrowUpDown />} {reordenando ? "Concluir" : "Reordenar seções"}
          </Button>
          <Button
            variant="outline"
            disabled={!podeEditar}
            title={podeEditar ? undefined : "Sem a permissão Editar conhecimento"}
            onClick={() => setAberta({ indice: "nova" })}
          >
            <Plus /> Nova seção
          </Button>
        </div>
      </div>

      <TableWrapper className="max-h-[calc(100dvh-22rem)]">
        <Table className="min-w-[980px]">
          <TableHeader>
            <tr>
              <TableHead className="w-12" icone={Hash} />
              <TableHead icone={Layers}>Seção</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead icone={FileText}>Começa com</TableHead>
              <TableHead className="text-right">Subtópicos</TableHead>
              <TableHead className="text-right">Caracteres</TableHead>
              <TableHead className="sticky right-0 bg-card text-right">Ações</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {roteiro.abertura !== null && !busca && (
              <TableRow className="group cursor-pointer" onClick={() => setAberta({ indice: "abertura" })}>
                <TableCell className="num text-muted-foreground">—</TableCell>
                <TableCell>
                  <div className="font-semibold">Abertura</div>
                  <div className="text-xs text-muted-foreground">O texto antes da primeira seção</div>
                </TableCell>
                <TableCell>
                  <Chip>Introdução</Chip>
                </TableCell>
                <TableCell>
                  <p className="line-clamp-1 max-w-md text-xs text-muted-foreground">{previa(roteiro.abertura)}</p>
                </TableCell>
                <TableCell numeric>{subtopicos(roteiro.abertura)}</TableCell>
                <TableCell numeric>{fmtInt(roteiro.abertura.length)}</TableCell>
                <TableCell className="sticky right-0 bg-card transition-colors group-hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end">
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Editar"
                      aria-label="Editar a abertura"
                      onClick={() => setAberta({ indice: "abertura" })}
                    >
                      <Pencil />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {linhas.length === 0 && (
              <TableEmpty colSpan={7}>{busca ? "Nenhuma seção com essa busca." : "O roteiro ainda não tem seções."}</TableEmpty>
            )}
            {paginacao.itens.map((s) => (
              <TableRow key={s.indice} className="group cursor-pointer" onClick={() => setAberta({ indice: s.indice })}>
                <TableCell className="num text-muted-foreground">{s.indice + 1}</TableCell>
                <TableCell>
                  <div className="max-w-72 font-semibold">{s.titulo}</div>
                </TableCell>
                <TableCell>
                  <Chip tom={TIPO_SECAO[s.tipo].tom}>{TIPO_SECAO[s.tipo].rotulo}</Chip>
                </TableCell>
                <TableCell>
                  <p className="line-clamp-1 max-w-md text-xs text-muted-foreground">{previa(s.corpo) || "—"}</p>
                </TableCell>
                <TableCell numeric>{subtopicos(s.corpo)}</TableCell>
                <TableCell numeric>{fmtInt(s.corpo.length)}</TableCell>
                <TableCell className="sticky right-0 bg-card transition-colors group-hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-0.5">
                    {reordenando && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Subir (salva uma versão nova)"
                          aria-label={`Subir ${s.titulo}`}
                          disabled={s.indice === 0 || gravar.isPending || !!busca || !podeEditar}
                          onClick={() => mover(s.indice, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Descer (salva uma versão nova)"
                          aria-label={`Descer ${s.titulo}`}
                          disabled={s.indice === roteiro.secoes.length - 1 || gravar.isPending || !!busca || !podeEditar}
                          onClick={() => mover(s.indice, 1)}
                        >
                          <ArrowDown />
                        </Button>
                      </>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Editar"
                      aria-label={`Editar ${s.titulo}`}
                      onClick={() => setAberta({ indice: s.indice })}
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
      <Paginacao {...paginacao} opcoes={[25, 50, 100]} />

      <FormSecao
        aberta={aberta}
        roteiro={roteiro}
        nomeAgente={nomeAgente}
        salvando={gravar.isPending}
        aoFechar={() => setAberta(null)}
        aoGravar={gravarRoteiro}
      />
      <TextoCompleto aberto={textoCompleto} base={base} nomeAgente={nomeAgente} agente={agente} aoFechar={() => setTextoCompleto(false)} />
    </div>
  );
}

/* ───────── Uma seção ───────── */

function FormSecao({
  aberta,
  roteiro,
  nomeAgente,
  salvando,
  aoFechar,
  aoGravar,
}: {
  aberta: Aberta;
  roteiro: RoteiroDividido;
  nomeAgente: string;
  salvando: boolean;
  aoFechar: () => void;
  aoGravar: (novo: RoteiroDividido, observacao: string, depois?: () => void) => void;
}) {
  const indice = aberta?.indice;
  const abertura = indice === "abertura";
  const nova = indice === "nova";
  const original =
    typeof indice === "number"
      ? roteiro.secoes[indice]
      : abertura
        ? { titulo: "", corpo: roteiro.abertura ?? "" }
        : { titulo: "", corpo: "" };
  const [titulo, setTitulo] = useState("");
  const [corpo, setCorpo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const podeEditar = usePode()("editar_conhecimento");

  useEffect(() => {
    if (!aberta) return;
    setTitulo(original.titulo);
    setCorpo(original.corpo.replace(/\s+$/, ""));
    setObservacao("");
    setConfirmarExclusao(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta]);

  const alterado = titulo !== original.titulo || corpo !== original.corpo.replace(/\s+$/, "");
  const tipo = tipoDaSecao(titulo);
  const tituloRepetido = roteiro.secoes.some((s, i) => i !== indice && s.titulo.trim().toLowerCase() === titulo.trim().toLowerCase());
  const problema = abertura
    ? null
    : !titulo.trim()
      ? "Falta o título da seção."
      : titulo.includes("\n")
        ? "O título fica numa linha só."
        : tituloRepetido
          ? "Já existe uma seção com esse título."
          : !corpo.trim()
            ? "A seção está vazia."
            : null;

  const fechar = () => {
    if (alterado && !window.confirm("Há alterações não salvas nesta seção. Fechar e descartá-las?")) return;
    aoFechar();
  };

  const salvar = () => {
    const corpoFinal = corpoArrumado(corpo);
    if (abertura) return aoGravar({ ...roteiro, abertura: corpoFinal }, observacao || "Abertura editada", aoFechar);
    const secao = { titulo: titulo.trim(), corpo: corpoFinal };
    const secoes = nova
      ? [...roteiro.secoes.map((s) => ({ ...s, corpo: corpoArrumado(s.corpo) })), secao]
      : roteiro.secoes.map((s, i) => (i === indice ? secao : s));
    aoGravar({ ...roteiro, secoes }, observacao || (nova ? `Seção "${secao.titulo}" criada` : `Seção "${secao.titulo}" editada`), aoFechar);
  };
  const excluir = () =>
    aoGravar(
      { ...roteiro, secoes: roteiro.secoes.filter((_, i) => i !== indice) },
      observacao || `Seção "${original.titulo}" excluída`,
      aoFechar,
    );

  // Prévia das mensagens automáticas, com o nome trocado como o sistema faz.
  const exemplo = tipo === "mensagem" ? corpo.replaceAll("[NOME DO CONTATO]", "Maria").trim() : "";

  return (
    <PainelLateral
      aberto={aberta !== null}
      aoMudar={(a) => !a && fechar()}
      largura="xl"
      rotulo={`Roteiro de ${nomeAgente}`}
      icone={<BookOpen />}
      titulo={abertura ? "Abertura do roteiro" : nova ? "Nova seção" : original.titulo}
      descricao={abertura ? "O texto antes da primeira seção: título geral e orientações." : TIPO_SECAO[tipo].ajuda}
      rodape={
        <>
          {!nova && !abertura && (
            <div className="mr-auto flex items-center gap-2">
              {confirmarExclusao ? (
                <>
                  <span className="text-xs text-destructive">Excluir a seção?</span>
                  <Button size="sm" variant="destructive" disabled={salvando} onClick={excluir}>
                    Excluir
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmarExclusao(false)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button variant="ghost" className="text-destructive" onClick={() => setConfirmarExclusao(true)}>
                  <Trash2 /> Excluir seção
                </Button>
              )}
            </div>
          )}
          {problema && alterado && <span className="text-xs text-muted-foreground">{problema}</span>}
          {!alterado && observacao.trim() && (
            <span className="text-xs text-warning-text">Para salvar, mude o Texto: “O que mudou?” é só a anotação do histórico.</span>
          )}
          <Button variant="ghost" onClick={fechar}>
            Cancelar
          </Button>
          <Button disabled={!alterado || !!problema || salvando || !podeEditar} onClick={salvar}>
            <Save /> Salvar versão
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {!abertura && (
          <Campo rotulo="Título" ajuda="Aparece como “## Título” no roteiro. As mensagens automáticas dependem do título exato.">
            <div className="flex items-center gap-2">
              <Input value={titulo} maxLength={160} onChange={(e) => setTitulo(e.target.value)} />
              <Chip tom={TIPO_SECAO[tipo].tom}>{TIPO_SECAO[tipo].rotulo}</Chip>
            </div>
          </Campo>
        )}
        <Campo rotulo="Texto" ajuda="Use “### Subtópico” para dividir. Escreva só o que pode ser dito ao servidor.">
          <Textarea
            spellCheck={false}
            rows={18}
            className="num text-[13px] leading-relaxed"
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
          />
        </Campo>
        {exemplo && (
          <SecaoPainel titulo="Como o servidor recebe">
            <div className="max-w-md rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm whitespace-pre-wrap">{exemplo}</div>
          </SecaoPainel>
        )}
        <Campo rotulo="O que mudou?" ajuda="Opcional. Aparece no histórico.">
          <Input value={observacao} maxLength={300} onChange={(e) => setObservacao(e.target.value)} />
        </Campo>
      </div>
    </PainelLateral>
  );
}

/* ───────── Texto completo ───────── */

function TextoCompleto({
  aberto,
  base,
  agente,
  nomeAgente,
  aoFechar,
}: {
  aberto: boolean;
  base: Base;
  agente: string;
  nomeAgente: string;
  aoFechar: () => void;
}) {
  const gravar = useGravarBase(agente);
  const podeEditar = usePode()("editar_conhecimento");
  const [texto, setTexto] = useState(base.conteudo);
  const [observacao, setObservacao] = useState("");
  useEffect(() => {
    if (aberto) {
      setTexto(base.conteudo);
      setObservacao("");
    }
  }, [aberto, base.conteudo]);
  const alterado = texto !== base.conteudo;
  const fechar = () => {
    if (alterado && !window.confirm("Há alterações não salvas no roteiro. Fechar e descartá-las?")) return;
    aoFechar();
  };

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={(a) => !a && fechar()}
      largura="2xl"
      corpo="livre"
      rotulo={`Roteiro de ${nomeAgente}`}
      icone={<ScrollText />}
      titulo="Texto completo"
      descricao="Para mudanças grandes ou para colar um roteiro novo. Mantenha os títulos com ##."
      rodape={
        <>
          <Input
            className="mr-auto max-w-md"
            placeholder="O que mudou? (opcional, aparece no histórico)"
            value={observacao}
            maxLength={300}
            onChange={(e) => setObservacao(e.target.value)}
          />
          {!alterado && observacao.trim() && (
            <span className="text-xs text-warning-text">Para salvar, mude o texto acima: este campo é só a anotação do histórico.</span>
          )}
          <span className="num text-xs text-muted-foreground">{fmtInt(texto.length)} caracteres</span>
          <Button variant="outline" disabled={!alterado} onClick={() => setTexto(base.conteudo)}>
            <Undo2 /> Descartar
          </Button>
          <Button
            disabled={!alterado || texto.trim().length < MINIMO || gravar.isPending || !podeEditar}
            onClick={() => gravar.mutate({ conteudo: texto, observacao }, { onSuccess: aoFechar })}
          >
            <Save /> Salvar versão
          </Button>
        </>
      }
    >
      <Textarea
        spellCheck={false}
        className="num h-full min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent p-5 text-[13px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
    </PainelLateral>
  );
}

/* ───────── Histórico ───────── */

export function TabelaHistorico({ agente }: { agente: string }) {
  const qc = useQueryClient();
  const [confirmar, setConfirmar] = useState(false);
  const podeEditar = usePode()("editar_conhecimento");
  const historico = useQuery({
    queryKey: ["base-historico", agente],
    queryFn: () => api<{ versoes: VersaoBase[] }>(`/base/historico?agente=${encodeURIComponent(agente)}`),
  });
  const versoes = historico.data?.versoes ?? [];
  const paginacao = usePaginacao(versoes, 25);
  const restaurar = useMutation({
    mutationFn: () => api<Base>(`/base/restaurar?agente=${encodeURIComponent(agente)}`, { method: "POST" }),
    onSuccess: (b) => {
      qc.setQueryData(chaveBase(agente), b);
      qc.invalidateQueries({ queryKey: ["base-historico", agente] });
      setConfirmar(false);
      toast.success("Texto padrão restaurado", { description: "Gravado como versão nova; o histórico continua." });
    },
    onError: (e: Error) => toast.error("Não foi possível restaurar", { description: e.message }),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">Cada vez que o roteiro é salvo, uma versão nova entra aqui.</p>
        <div className="ml-auto flex items-center gap-2">
          {confirmar ? (
            <>
              <span className="text-xs">Gravar o texto padrão do repositório como versão nova?</span>
              <Button size="sm" variant="destructive" disabled={restaurar.isPending} onClick={() => restaurar.mutate()}>
                Restaurar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmar(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button variant="outline" disabled={!podeEditar} onClick={() => setConfirmar(true)}>
              <RotateCcw /> Restaurar texto padrão
            </Button>
          )}
        </div>
      </div>
      <TableWrapper className="max-h-[calc(100dvh-22rem)]">
        <Table className="min-w-[640px]">
          <TableHeader>
            <tr>
              <TableHead icone={History}>Versão</TableHead>
              <TableHead>Salva em</TableHead>
              <TableHead>O que mudou</TableHead>
              <TableHead className="text-right">Caracteres</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {historico.isLoading && <TableEmpty colSpan={4}>Carregando…</TableEmpty>}
            {historico.data && versoes.length === 0 && (
              <TableEmpty colSpan={4}>Nenhuma edição feita pelo painel ainda: vale o texto padrão do repositório.</TableEmpty>
            )}
            {paginacao.itens.map((v, k) => (
              <TableRow key={v.versao}>
                <TableCell className="font-semibold whitespace-nowrap">
                  Versão {v.versao} {paginacao.pagina === 1 && k === 0 && <Chip tom="sucesso">em uso</Chip>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{fmtDataHora(v.atualizado_em)}</TableCell>
                <TableCell className="text-muted-foreground">{v.observacao || "—"}</TableCell>
                <TableCell numeric>{fmtInt(v.caracteres)}</TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>
      {versoes.length > 25 && <Paginacao {...paginacao} opcoes={[25, 50, 100]} />}
    </div>
  );
}
