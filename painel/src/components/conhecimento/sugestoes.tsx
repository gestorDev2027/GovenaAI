import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, BookMarked, Check, FileText, Loader2, Pencil, RefreshCw, Undo2, Wand2 } from "lucide-react";
import { api, type Base, type BaseCompartilhada, type SugestaoRoteiro, type SugestoesRoteiro } from "@/lib/api";
import { aplicarMudancas, diferenca, dividir, juntar, type MudancaRoteiro } from "@/lib/roteiro";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/fields";
import { PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import { Chip } from "@/components/ui/tabela";
import { Pills } from "@/components/widgets/widgets";
import { useAgentes } from "@/hooks/use-agentes";
import { usePode } from "@/hooks/use-permissoes";
import { chaveBase, useGravarBase } from "./roteiro";

/*
 * Sugestões de atualização do roteiro a partir de um documento: a IA compara o documento com o roteiro do agente e
 * propõe as mudanças (agente/sugestoes_roteiro.py). Aqui a pessoa revisa cada uma (o que muda, linha a linha, com o
 * trecho do documento que justifica), escolhe, pode editar o texto e aplica: o roteiro ganha uma versão nova, com o
 * histórico para voltar atrás. Nada muda no agente antes de aplicar.
 * Os exemplos aprovados na Calibração que contradizem o documento aparecem à parte, com o botão para tirar de uso.
 *
 * Modo "Atualizar com IA" (modoAjuste): no lugar do documento, a pessoa escreve a informação nova numa caixa (ex.: "na
 * promoção, o aluno pode escolher qualquer pós") e a IA acha onde ela entra; a revisão e a aplicação são as mesmas.
 */

const MINIMO_AJUSTE = 10;

const ROTULO_TIPO: Record<SugestaoRoteiro["tipo"], { rotulo: string; tom: "info" | "sucesso" | "erro" }> = {
  alterar: { rotulo: "Alterar seção", tom: "info" },
  nova: { rotulo: "Seção nova", tom: "sucesso" },
  remover: { rotulo: "Tirar seção", tom: "erro" },
};

type Revisao = { escolhida: boolean; texto: string; titulo: string; editando: boolean };

export function PainelSugestoes({
  documento = null,
  dono,
  aoFechar,
  modoAjuste = false,
  aberto: abertoAjuste = false,
}: {
  /** A versão do documento a comparar; null fecha o painel (no modo de documento). */
  documento?: { id: number; nome: string; versao: number } | null;
  /** O dono do documento: um agente ou uma base compartilhada (base_<id>). No modo de ajuste, o agente. */
  dono: string;
  aoFechar: () => void;
  /** Atualizar com IA: a pessoa escreve a informação nova em vez de comparar um documento. */
  modoAjuste?: boolean;
  /** Só no modo de ajuste: o painel aberto. */
  aberto?: boolean;
}) {
  const agentes = useAgentes();
  const aberto = modoAjuste ? abertoAjuste : !!documento;
  const [textoAjuste, setTextoAjuste] = useState("");
  const daBase = !modoAjuste && dono.startsWith("base_");
  // Direto pela rota (e não pelo hook de bases.tsx, que importa documentos.tsx, que importa este arquivo).
  const bases = useQuery({
    queryKey: ["conhecimento-bases", "todas"],
    queryFn: () => api<{ bases: BaseCompartilhada[] }>("/conhecimento/bases"),
    enabled: daBase,
  });
  const baseDoc = daBase ? bases.data?.bases.find((b) => b.dono === dono) : undefined;
  // O documento de uma base sugere para um dos agentes em que ela vale; o de um agente, para ele.
  const opcoes = daBase ? agentes.filter((a) => baseDoc?.geral || baseDoc?.agentes.includes(a.id)) : agentes.filter((a) => a.id === dono);
  const [alvo, setAlvo] = useState(dono);
  const agente = daBase ? (opcoes.some((a) => a.id === alvo) ? alvo : (opcoes[0]?.id ?? "")) : dono;
  const nomeAgente = agentes.find((a) => a.id === agente)?.nome ?? agente;

  const roteiro = useQuery({
    queryKey: chaveBase(agente),
    queryFn: () => api<Base>(`/base?agente=${encodeURIComponent(agente)}`),
    enabled: aberto && !!agente,
  });
  const gerar = useMutation({
    mutationFn: () =>
      modoAjuste
        ? api<SugestoesRoteiro>("/conhecimento/sugestoes-roteiro", {
            method: "POST",
            body: JSON.stringify({ agente, texto: textoAjuste.trim() }),
          })
        : api<SugestoesRoteiro>(`/conhecimento/documentos/${documento!.id}/sugestoes-roteiro`, {
            method: "POST",
            body: JSON.stringify({ agente: daBase ? agente : null }),
          }),
  });
  const gravar = useGravarBase(agente);
  const podeEditar = usePode()("editar_conhecimento");
  const [revisoes, setRevisoes] = useState<Record<number, Revisao>>({});
  const [observacao, setObservacao] = useState("");

  // Cada sugestão começa escolhida, menos as com aviso e as de mensagem automática.
  const gerarSugestoes = () => {
    gerar.reset();
    setRevisoes({});
    gerar.mutate(undefined, {
      onSuccess: (r) => {
        setRevisoes(
          Object.fromEntries(
            r.sugestoes.map((s) => [
              s.id,
              { escolhida: !s.avisos.length && !s.mensagem_automatica, texto: s.texto_novo, titulo: s.titulo, editando: false },
            ]),
          ),
        );
        setObservacao(
          modoAjuste
            ? `Atualizado com IA: ${textoAjuste.trim().slice(0, 120)}`
            : `Atualizado a partir de ${r.documento.nome} v${r.documento.versao}`,
        );
      },
    });
  };
  // Documento: abrir (ou trocar de agente) gera as sugestões. Ajuste: abrir começa com a caixa vazia.
  useEffect(() => {
    if (modoAjuste) {
      if (aberto) {
        gerar.reset();
        setRevisoes({});
        setTextoAjuste("");
      }
    } else if (documento && agente) gerarSugestoes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documento?.id, agente, aberto]);
  const podeGerar = !gerar.isPending && !!agente && (!modoAjuste || textoAjuste.trim().length >= MINIMO_AJUSTE);

  const dados = gerar.data;
  const desatualizado = !!dados && !!roteiro.data && roteiro.data.versao !== dados.versao_roteiro;
  const escolhidas = (dados?.sugestoes ?? []).filter((s) => revisoes[s.id]?.escolhida);
  const mudar = (id: number, campos: Partial<Revisao>) => setRevisoes((r) => ({ ...r, [id]: { ...r[id], ...campos } }));

  const aplicar = () => {
    if (!roteiro.data || !dados) return;
    const mudancas: MudancaRoteiro[] = escolhidas.map((s) => ({
      tipo: s.tipo,
      titulo: s.tipo === "nova" ? revisoes[s.id].titulo : s.titulo,
      depoisDe: s.depois_de,
      texto: revisoes[s.id].texto,
    }));
    const novo = juntar(aplicarMudancas(dividir(roteiro.data.conteudo), mudancas));
    const titulos = escolhidas.map((s) => s.titulo).join(", ");
    gravar.mutate({ conteudo: novo, observacao: `${observacao.trim()}: ${titulos}`.slice(0, 300) }, { onSuccess: aoFechar });
  };

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={(a) => !a && aoFechar()}
      largura="2xl"
      rotulo={`Roteiro de ${nomeAgente}`}
      icone={<Wand2 />}
      titulo={modoAjuste ? "Atualizar com IA" : "Sugestões do documento"}
      descricao={
        modoAjuste ? (
          <>
            Escreva a informação nova ou a correção. A IA acha onde ela entra no roteiro e mostra a mudança; nada muda no agente antes de
            aplicar, e o Histórico guarda a versão anterior.
          </>
        ) : (
          documento && (
            <>
              O que <span className="font-medium text-foreground">{documento.nome}</span> (versão {documento.versao}) muda no roteiro,
              sugerido pela IA. Revise cada mudança: nada muda no agente antes de aplicar, e o Histórico guarda a versão anterior.
            </>
          )
        )
      }
      rodape={
        <>
          <Input
            className="mr-auto max-w-md"
            placeholder="O que mudou? (aparece no histórico)"
            value={observacao}
            maxLength={200}
            onChange={(e) => setObservacao(e.target.value)}
          />
          {(!modoAjuste || dados) && (
            <Button variant="outline" disabled={!podeGerar} onClick={gerarSugestoes}>
              <RefreshCw /> Gerar de novo
            </Button>
          )}
          <Button
            disabled={!escolhidas.length || desatualizado || gravar.isPending || !podeEditar || !roteiro.data}
            title={podeEditar ? undefined : "Sem a permissão Editar conhecimento"}
            onClick={aplicar}
          >
            {gravar.isPending ? <Loader2 className="animate-spin" /> : <Check />} Aplicar {escolhidas.length || ""}{" "}
            {escolhidas.length === 1 ? "mudança" : "mudanças"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {daBase && opcoes.length > 1 && (
          <Pills rotulo="Roteiro de" value={agente} onChange={setAlvo} options={opcoes.map((a) => ({ value: a.id, label: a.nome }))} />
        )}
        {daBase && !opcoes.length && bases.data && (
          <p className="text-sm text-muted-foreground">Esta base não vale para nenhum agente: escolha os agentes dela em Bases compartilhadas.</p>
        )}

        {modoAjuste && (
          <SecaoPainel titulo="O que mudou?">
            <Textarea
              rows={4}
              autoFocus
              placeholder="Ex.: Na promoção Compre 1, Ganhe outra, o aluno pode escolher qualquer pós-graduação, sem restrição."
              value={textoAjuste}
              maxLength={4000}
              onChange={(e) => setTextoAjuste(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="mr-auto text-xs text-muted-foreground">
                Escreva como contaria para alguém do time: uma informação nova, uma correção ou algo que deixou de valer.
              </p>
              <Button disabled={!podeGerar} onClick={gerarSugestoes}>
                {gerar.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} {dados ? "Gerar de novo" : "Gerar sugestão"}
              </Button>
            </div>
          </SecaoPainel>
        )}

        {gerar.isPending && (
          <div className="flex items-center gap-3 rounded-lg border bg-card/60 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {modoAjuste ? `Procurando onde isso entra no roteiro de ${nomeAgente}.` : `Lendo o documento e o roteiro de ${nomeAgente}.`} Leva de
            30 segundos a 2 minutos.
          </div>
        )}
        {gerar.isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {(gerar.error as Error).message}
          </div>
        )}

        {dados && (
          <>
            {desatualizado && (
              <Aviso>
                O roteiro mudou depois destas sugestões (agora na versão {roteiro.data?.versao}). Gere de novo antes de aplicar.
              </Aviso>
            )}
            <SecaoPainel titulo="Resumo">
              <p className="text-sm">{dados.resumo || "—"}</p>
            </SecaoPainel>
            {dados.alertas.length > 0 && (
              <SecaoPainel titulo="Para decidir" contagem={dados.alertas.length}>
                <ul className="space-y-1.5">
                  {dados.alertas.map((a) => (
                    <li key={a}>
                      <Aviso>{a}</Aviso>
                    </li>
                  ))}
                </ul>
              </SecaoPainel>
            )}
            {dados.exemplos_conflitantes?.length > 0 && <ExemplosConflitantes exemplos={dados.exemplos_conflitantes} />}
            <SecaoPainel titulo="Mudanças sugeridas" contagem={dados.sugestoes.length}>
              {dados.sugestoes.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {modoAjuste ? "A IA não achou nada a mudar no roteiro com essa informação." : "O documento não muda nada no roteiro."}
                </p>
              )}
              <ul className="space-y-3">
                {dados.sugestoes.map((s) =>
                  revisoes[s.id] ? <CartaoSugestao key={s.id} s={s} revisao={revisoes[s.id]} mudar={(c) => mudar(s.id, c)} /> : null,
                )}
              </ul>
            </SecaoPainel>
          </>
        )}
      </div>
    </PainelLateral>
  );
}

/** Exemplos aprovados que contradizem o documento: não mudam com o roteiro e puxariam o agente para a resposta antiga. */
function ExemplosConflitantes({ exemplos }: { exemplos: SugestoesRoteiro["exemplos_conflitantes"] }) {
  const qc = useQueryClient();
  const podeCalibrar = usePode()("aprovar_calibracao");
  const [fora, setFora] = useState<Set<number>>(new Set());
  const alternar = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      api(`/conhecimento/exemplos/${id}/ativo`, { method: "POST", body: JSON.stringify({ ativo }) }),
    onSuccess: (_, { id, ativo }) => {
      setFora((f) => {
        const novo = new Set(f);
        if (ativo) novo.delete(id);
        else novo.add(id);
        return novo;
      });
      qc.invalidateQueries({ queryKey: ["calibracao-exemplos"] });
      toast.success(ativo ? `Exemplo #${id} de volta ao uso` : `Exemplo #${id} fora de uso`, {
        description: ativo ? undefined : "Não foi apagado: volta pela Calibração → Exemplos que o agente usa.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível alterar o exemplo", { description: e.message }),
  });
  return (
    <SecaoPainel titulo="Exemplos da Calibração que contradizem o documento" contagem={exemplos.length}>
      <p className="mb-2 text-xs text-muted-foreground">
        O agente imita estes exemplos quando o aluno pergunta algo parecido, e eles não mudam com o roteiro. Tirar de uso não apaga.
      </p>
      <ul className="space-y-2">
        {exemplos.map((e) => {
          const desativado = fora.has(e.id);
          return (
            <li key={e.id} className={cn("rounded-lg border bg-card/60 px-4 py-3 text-sm", desativado && "opacity-60")}>
              <div className="flex flex-wrap items-start gap-3">
                <BookMarked className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">Exemplo #{e.id}</span>
                    {desativado && <Chip>fora de uso</Chip>}
                  </div>
                  <p className="text-xs text-muted-foreground">Aluno: “{e.mensagem}”</p>
                  <p className="line-clamp-3 text-xs text-muted-foreground">Resposta aprovada: “{e.resposta}”</p>
                  <Aviso>{e.motivo}</Aviso>
                </div>
                <Button
                  size="sm"
                  variant={desativado ? "ghost" : "outline"}
                  disabled={alternar.isPending || !podeCalibrar}
                  title={podeCalibrar ? undefined : "Sem a permissão Aprovar na Calibração"}
                  onClick={() => alternar.mutate({ id: e.id, ativo: desativado })}
                >
                  {desativado ? (
                    <>
                      <Undo2 /> Voltar ao uso
                    </>
                  ) : (
                    "Tirar de uso"
                  )}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </SecaoPainel>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-text">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function CartaoSugestao({ s, revisao, mudar }: { s: SugestaoRoteiro; revisao: Revisao; mudar: (c: Partial<Revisao>) => void }) {
  const linhas = useMemo(() => diferenca(s.texto_atual, s.tipo === "remover" ? "" : revisao.texto), [s, revisao.texto]);
  const editado = revisao.texto !== s.texto_novo;
  return (
    <li className={cn("rounded-lg border bg-card/60", revisao.escolhida && "border-primary/40")}>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <input
          type="checkbox"
          aria-label={`Aplicar a mudança em ${s.titulo}`}
          checked={revisao.escolhida}
          onChange={(e) => mudar({ escolhida: e.target.checked })}
          className="mt-1 size-4 cursor-pointer accent-[var(--color-primary)]"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tom={ROTULO_TIPO[s.tipo].tom}>{ROTULO_TIPO[s.tipo].rotulo}</Chip>
            {s.tipo === "nova" ? (
              <Input
                className="h-8 max-w-md font-semibold"
                aria-label="Título da seção nova"
                value={revisao.titulo}
                maxLength={160}
                onChange={(e) => mudar({ titulo: e.target.value })}
              />
            ) : (
              <span className="font-semibold">{s.titulo}</span>
            )}
            {s.tipo === "nova" && (
              <span className="text-xs text-muted-foreground">{s.depois_de ? `depois de “${s.depois_de}”` : "antes de “Sempre transferir”"}</span>
            )}
            {editado && <Chip>editada</Chip>}
          </div>
          <p className="text-sm">{s.motivo}</p>
          {s.trecho_documento && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <FileText className="mt-0.5 size-3.5 shrink-0" /> <span>“{s.trecho_documento}”</span>
            </p>
          )}
          {s.mensagem_automatica && <Aviso>Esta seção é uma mensagem automática: o sistema a envia como está escrita.</Aviso>}
          {s.avisos.map((a) => (
            <Aviso key={a}>{a}</Aviso>
          ))}
        </div>
        {s.tipo !== "remover" && (
          <Button size="sm" variant="ghost" onClick={() => mudar({ editando: !revisao.editando })}>
            <Pencil /> {revisao.editando ? "Ver diferença" : "Editar texto"}
          </Button>
        )}
      </div>
      <div className="border-t">
        {revisao.editando ? (
          <Textarea
            spellCheck={false}
            rows={16}
            className="num rounded-none border-0 bg-transparent p-4 text-[13px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
            value={revisao.texto}
            onChange={(e) => mudar({ texto: e.target.value })}
          />
        ) : (
          <Diferenca linhas={linhas} />
        )}
      </div>
    </li>
  );
}

/** As linhas que mudam, com duas de contexto em volta; trechos iguais longos viram "N linhas iguais". */
function Diferenca({ linhas }: { linhas: ReturnType<typeof diferenca> }) {
  const CONTEXTO = 2;
  const perto = linhas.map((_, i) =>
    linhas.slice(Math.max(0, i - CONTEXTO), i + CONTEXTO + 1).some((l) => l.tipo !== "igual"),
  );
  const blocos: ({ tipo: "linha"; i: number } | { tipo: "pulo"; n: number })[] = [];
  linhas.forEach((_, i) => {
    if (perto[i]) blocos.push({ tipo: "linha", i });
    else {
      const ultimo = blocos[blocos.length - 1];
      if (ultimo?.tipo === "pulo") ultimo.n++;
      else blocos.push({ tipo: "pulo", n: 1 });
    }
  });
  return (
    <div className="thin-scroll max-h-96 overflow-y-auto py-2 font-mono text-[12px] leading-relaxed">
      {blocos.map((b, k) =>
        b.tipo === "pulo" ? (
          <div key={k} className="px-4 py-1 text-[11px] text-muted-foreground">
            · · · {b.n} {b.n === 1 ? "linha igual" : "linhas iguais"}
          </div>
        ) : (
          <div
            key={k}
            className={cn(
              "px-4 whitespace-pre-wrap",
              linhas[b.i].tipo === "mais" && "bg-success/12 text-success",
              linhas[b.i].tipo === "menos" && "bg-destructive/10 text-destructive line-through decoration-destructive/40",
            )}
          >
            <span className="mr-2 select-none text-muted-foreground">{linhas[b.i].tipo === "mais" ? "+" : linhas[b.i].tipo === "menos" ? "−" : " "}</span>
            {linhas[b.i].texto || " "}
          </div>
        ),
      )}
    </div>
  );
}
