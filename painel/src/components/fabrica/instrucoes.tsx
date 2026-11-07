import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, Eye, History, Lock, RotateCcw, Save, Undo2, X } from "lucide-react";
import { api, type InstrucoesAgente, type VersaoInstrucoes } from "@/lib/api";
import { MARCADORES } from "@/lib/fabrica";
import { fmtDataHora, fmtInt } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/fields";
import { EmptyState, PageLoader } from "@/components/widgets/widgets";
import { Alertas, AssistenteIA, Diferenca, type Rascunho } from "./assistente";

export const chaveInstrucoes = (agente: string) => ["fabrica-instrucoes", agente];

export function useInstrucoes(agente: string) {
  return useQuery({
    queryKey: chaveInstrucoes(agente),
    queryFn: () => api<InstrucoesAgente>(`/fabrica/agentes/${encodeURIComponent(agente)}/instrucoes`),
  });
}

/**
 * As instruções do agente: o modelo de texto que o servidor completa a cada mensagem. Os marcadores
 * aparecem como itens fixos, com o que cada um vira; sem o obrigatório, não dá para gravar. Cada
 * gravação é uma versão nova, e qualquer versão antiga pode ser vista e restaurada.
 */
export function InstrucoesDoAgente({ agente, aoMudarAlterado }: { agente: string; aoMudarAlterado: (alterado: boolean) => void }) {
  const qc = useQueryClient();
  const caminho = `/fabrica/agentes/${encodeURIComponent(agente)}/instrucoes`;
  const instrucoes = useInstrucoes(agente);
  const [texto, setTexto] = useState("");
  const [observacao, setObservacao] = useState("");
  const [vendo, setVendo] = useState<number | null>(null);
  const [proposta, setProposta] = useState<Rascunho<{ texto: string; resumo: string }> | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  const atual = instrucoes.data?.atual;
  useEffect(() => {
    if (atual) setTexto(atual.texto);
  }, [atual]);

  const alterado = atual ? texto !== atual.texto : false;
  useEffect(() => aoMudarAlterado(alterado), [alterado, aoMudarAlterado]);

  const faltando = MARCADORES.filter((m) => m.obrigatorio && !texto.includes(m.token));

  const versao = useQuery({
    queryKey: [...chaveInstrucoes(agente), vendo],
    queryFn: () => api<VersaoInstrucoes & { texto: string }>(`${caminho}/${vendo}`),
    enabled: vendo != null,
  });

  // O servidor devolve as instruções já com a versão nova.
  const aoGravar = (dados: InstrucoesAgente, mensagem: string) => {
    qc.setQueryData(chaveInstrucoes(agente), dados);
    qc.invalidateQueries({ queryKey: ["fabrica-agentes"] });
    setObservacao("");
    setVendo(null);
    toast.success(mensagem, { description: "O agente já usa estas instruções na próxima mensagem." });
  };

  const salvar = useMutation({
    mutationFn: () =>
      api<InstrucoesAgente>(caminho, { method: "PUT", body: JSON.stringify({ texto, observacao: observacao.trim() || null }) }),
    onSuccess: (dados) => aoGravar(dados, `Versão ${dados.atual.versao} salva`),
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });
  const restaurar = useMutation({
    mutationFn: (v: number) => api<InstrucoesAgente>(`${caminho}/${v}/restaurar`, { method: "POST" }),
    onSuccess: (dados, v) => aoGravar(dados, `Versão ${v} restaurada como versão ${dados.atual.versao}`),
    onError: (e: Error) => toast.error("Não foi possível restaurar", { description: e.message }),
  });

  /** Põe o marcador onde está o cursor (ou no fim, se o campo nunca recebeu foco). Os de bloco (@@…@@) ficam em linha própria. */
  const inserir = (token: string) => {
    const el = campo.current;
    const ini = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const bloco = token.startsWith("@@");
    const antes = bloco && ini > 0 && texto[ini - 1] !== "\n" ? "\n\n" : "";
    const depois = bloco && fim < texto.length && texto[fim] !== "\n" ? "\n\n" : "";
    const trecho = antes + token + depois;
    setTexto(texto.slice(0, ini) + trecho + texto.slice(fim));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + trecho.length, ini + trecho.length);
    });
  };

  if (instrucoes.isLoading) return <PageLoader className="h-[50vh]" label="Carregando as instruções" />;
  if (instrucoes.isError || !atual)
    return (
      <div className="surface-card">
        <EmptyState title="Não foi possível carregar as instruções">{(instrucoes.error as Error | null)?.message}</EmptyState>
      </div>
    );

  return (
    <div className="space-y-4">
      <AssistenteIA<{ texto: string; resumo: string }>
        tipo="instrucoes"
        titulo="Ajustar as instruções com IA"
        ajuda="Diga o que mudar. A IA reescreve o texto em edição e mostra a diferença; nada muda até você aplicar e salvar."
        placeholder="Ex.: deixe as respostas mais curtas, peça o CPF antes de consultar o cadastro e nunca prometa prazo de reembolso."
        agente={agente}
        atual={{ texto }}
        aoReceber={setProposta}
      />
      {proposta && (
        <div className="space-y-3 rounded-xl border border-primary/30 bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Proposta da IA</h3>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setProposta(null)}>
                Descartar
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setTexto(proposta.texto);
                  setProposta(null);
                  toast.success("Proposta aplicada no editor", { description: "Revise e salve a versão." });
                }}
              >
                <Check /> Aplicar no editor
              </Button>
            </div>
          </div>
          {proposta.resumo && <p className="text-xs whitespace-pre-line text-muted-foreground">{proposta.resumo}</p>}
          <Alertas itens={proposta.alertas ?? []} />
          <Diferenca antes={texto} depois={proposta.texto} />
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="surface-card flex min-w-0 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              {atual.versao === 0
                ? "Texto do código (nenhuma edição pelo painel ainda)"
                : `Versão ${atual.versao} · ${fmtDataHora(atual.em)}`}
              {atual.autor && ` · ${atual.autor}`}
            </span>
            <span className="num ml-auto">{fmtInt(texto.length)} caracteres</span>
            {alterado && <span className="font-semibold text-primary">Alterações não salvas</span>}
          </div>

          {/* Marcadores fixos: o que o servidor troca a cada mensagem */}
          <div className="flex flex-wrap gap-2 border-b bg-muted/30 px-4 py-3">
            {MARCADORES.map((m) => {
              const presente = texto.includes(m.token);
              return (
                <div
                  key={m.token}
                  className={cn(
                    "flex min-w-[15rem] flex-1 items-start gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs",
                    m.obrigatorio && !presente && "border-destructive/50 bg-destructive/5",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full",
                      presente
                        ? "bg-success/15 text-success"
                        : m.obrigatorio
                          ? "bg-destructive/15 text-destructive"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {presente ? <Check className="size-3" /> : <X className="size-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5">
                      <code className="num font-semibold">{m.token}</code>
                      {m.obrigatorio && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <Lock className="size-2.5" /> obrigatório
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground">{m.explicacao}</div>
                  </div>
                  {!presente && (
                    <Button size="sm" variant="outline" className="h-6 self-center px-2 text-[11px]" onClick={() => inserir(m.token)}>
                      Inserir
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {faltando.length > 0 && (
            <div className="flex items-center gap-2 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              Sem {faltando.map((m) => m.token).join(" e ")} o agente fica sem a base de conhecimento. Use "Inserir" ou desfaça a alteração.
            </div>
          )}

          <Textarea
            ref={campo}
            spellCheck={false}
            className="num min-h-[50vh] flex-1 resize-y rounded-none border-0 bg-transparent p-4 text-[13px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2 border-t p-3">
            <Input
              className="max-w-md"
              placeholder="O que mudou? (opcional, aparece no histórico)"
              value={observacao}
              maxLength={300}
              onChange={(e) => setObservacao(e.target.value)}
            />
            <div className="ml-auto flex gap-2">
              <Button variant="outline" disabled={!alterado} onClick={() => setTexto(atual.texto)}>
                <Undo2 /> Descartar
              </Button>
              <Button disabled={!alterado || faltando.length > 0 || salvar.isPending} onClick={() => salvar.mutate()}>
                <Save /> Salvar versão
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="surface-card p-4">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <History className="size-4" /> Versões
            </h2>
            <ul className="thin-scroll max-h-[46vh] space-y-2 overflow-y-auto text-xs">
              {(instrucoes.data?.versoes ?? []).map((v) => (
                <li
                  key={v.versao}
                  className={cn("rounded-lg bg-muted/50 px-3 py-2", v.versao === atual.versao && "ring-1 ring-primary/40")}
                >
                  <div className="flex items-center justify-between gap-2 font-semibold">
                    <span>
                      Versão {v.versao}
                      {v.versao === atual.versao && <span className="ml-1.5 font-normal text-primary">em uso</span>}
                    </span>
                    <span className="font-normal text-muted-foreground">{v.versao === 0 ? "código" : fmtDataHora(v.em)}</span>
                  </div>
                  {(v.observacao || v.autor) && (
                    <div className="mt-0.5 text-muted-foreground">{[v.observacao, v.autor].filter(Boolean).join(" · ")}</div>
                  )}
                  {v.versao !== atual.versao && (
                    <button
                      type="button"
                      onClick={() => setVendo(v.versao)}
                      className="mt-1 inline-flex items-center gap-1 font-semibold text-primary-text hover:underline"
                    >
                      <Eye className="size-3" /> Ver e restaurar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {vendo != null && (
            <div className="surface-card space-y-3 p-4 text-xs">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Versão {vendo}</h2>
                <button
                  type="button"
                  aria-label="Fechar"
                  onClick={() => setVendo(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              {versao.isLoading ? (
                <p className="text-muted-foreground">Carregando…</p>
              ) : versao.data ? (
                <pre className="thin-scroll num max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 text-[11px] whitespace-pre-wrap">
                  {versao.data.texto}
                </pre>
              ) : (
                <p className="text-destructive">{(versao.error as Error | null)?.message}</p>
              )}
              <p className="text-muted-foreground">Restaurar grava este texto como versão nova; o histórico continua.</p>
              <Button
                size="sm"
                variant="destructive"
                disabled={!versao.data || restaurar.isPending}
                onClick={() => {
                  if (alterado && !window.confirm("Há alterações não salvas nas instruções. Restaurar e descartá-las?")) return;
                  restaurar.mutate(vendo);
                }}
              >
                <RotateCcw /> Restaurar a versão {vendo}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
