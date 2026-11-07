import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Brain, ChevronRight, Cpu, Loader2, MessageSquare, Route, Timer, Wrench } from "lucide-react";
import { api, type RastreamentoConversa, type RespostaRastreada } from "@/lib/api";
import { fmtDataHora, fmtInt, fmtSegundos } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/tabela";
import { IndicadoresPainel, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import { UsoNaResposta } from "@/components/conhecimento/uso";
import { StatusBadge } from "@/components/widgets/widgets";
import { ROTULO_FERRAMENTA } from "@/pages/conversas";
import { TextoComLinks } from "@/pages/chat";

/*
 * Rastreamento de uma conversa: por que o agente respondeu o que respondeu. Para cada mensagem do aluno, o
 * resumo do raciocínio do modelo, as ferramentas (argumentos e resultado), o contexto que entrou nas instruções
 * (histórico do WhatsApp, trechos, exemplos), as chamadas ao modelo com tempo e tokens; e, da conversa inteira,
 * o que o Learning registrou (resumo da sessão com o plano, perfil e memórias do aluno). Só leitura.
 */

const ROTULO_CAMPO: Record<string, string> = {
  name: "Nome",
  preferred_name: "Como prefere ser chamado",
  curso: "Curso",
  email_matricula: "E-mail da matrícula",
  aparelho: "Aparelho",
  situacao_acesso: "Situação do acesso",
};

export function PainelRastreamento({ id, nome, aoFechar, aoVoltar }: { id: string; nome?: string; aoFechar: () => void; aoVoltar?: () => void }) {
  const consulta = useQuery({
    queryKey: ["rastreamento", id],
    queryFn: () => api<RastreamentoConversa>(`/conversas/${encodeURIComponent(id)}/rastreamento`),
  });
  const r = consulta.data;
  const respostas = r?.respostas ?? [];
  const tempos = respostas.map((x) => x.duracao_s).filter((v): v is number => v != null);
  const tokens = respostas.reduce((soma, x) => soma + (x.tokens?.entrada ?? 0) + (x.tokens?.saida ?? 0), 0);
  const chamadas = respostas.reduce((soma, x) => soma + x.chamadas_modelo.length, 0);

  return (
    <PainelLateral
      aberto
      aoMudar={(aberto) => !aberto && aoFechar()}
      largura="xl"
      icone={<Route />}
      rotulo="Rastreamento da conversa"
      titulo={nome || r?.nome || "Aluno sem nome"}
      descricao={r?.status ? <StatusBadge status={r.status} /> : undefined}
      destaque={
        <IndicadoresPainel
          itens={[
            { rotulo: "Respostas", valor: fmtInt(respostas.length), icone: <MessageSquare /> },
            { rotulo: "Tempo médio", valor: tempos.length ? fmtSegundos(tempos.reduce((a, b) => a + b, 0) / tempos.length) : "—", icone: <Timer /> },
            { rotulo: "Tokens", valor: fmtInt(tokens), detalhe: `${fmtInt(chamadas)} chamadas ao modelo`, icone: <Cpu /> },
          ]}
        />
      }
      rodape={
        aoVoltar && (
          <button
            type="button"
            onClick={aoVoltar}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted"
          >
            <ArrowLeft className="size-3.5" /> Voltar à conversa
          </button>
        )
      }
    >
      {consulta.isLoading && (
        <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Montando o rastreamento…
        </p>
      )}
      {consulta.isError && <p className="py-4 text-xs text-destructive">{(consulta.error as Error).message}</p>}
      {r && (
        <div className="space-y-6">
          <SecaoPainel titulo="Resumo da sessão (Learning)">
            {r.resumo?.summary || r.resumo?.goal ? (
              <div className="space-y-3 text-[13px] leading-relaxed">
                {r.resumo.goal && (
                  <p>
                    <span className="font-semibold">Objetivo: </span>
                    {r.resumo.goal}
                  </p>
                )}
                {!!r.resumo.plan?.length && (
                  <div>
                    <p className="mb-1 font-semibold">Plano</p>
                    <ol className="list-decimal space-y-0.5 pl-5">
                      {r.resumo.plan.map((passo, i) => (
                        <li key={i} className={cn(r.resumo?.progress?.includes(passo) && "text-muted-foreground line-through")}>
                          {passo}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {r.resumo.summary && <p className="whitespace-pre-wrap text-muted-foreground">{r.resumo.summary}</p>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">O Learning ainda não registrou esta conversa (ele grava em segundo plano, depois de cada resposta).</p>
            )}
          </SecaoPainel>

          {(r.perfil && Object.keys(r.perfil).length > 0) || r.memorias?.length ? (
            <SecaoPainel titulo="O que o agente sabe do aluno">
              {r.perfil && (
                <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                  {Object.entries(r.perfil).map(([campo, valor]) => (
                    <div key={campo} className="min-w-0">
                      <dt className="text-muted-foreground">{ROTULO_CAMPO[campo] ?? campo}</dt>
                      <dd className="truncate font-medium" title={String(valor)}>
                        {String(valor)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {!!r.memorias?.length && (
                <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {r.memorias.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              )}
            </SecaoPainel>
          ) : null}

          {r.acoes.some((a) => a.tipo === "transferencia") && (
            <SecaoPainel titulo="Transferência">
              {r.acoes
                .filter((a) => a.tipo === "transferencia")
                .map((a, i) => (
                  <div key={i} className="space-y-1 rounded-xl border border-primary/30 bg-primary/8 px-3 py-2 text-xs leading-relaxed">
                    <p className="font-semibold">
                      {a.categoria}
                      {a.registrado_em && <span className="font-normal text-muted-foreground"> · {fmtDataHora(a.registrado_em)}</span>}
                    </p>
                    {a.motivo && <p>{a.motivo}</p>}
                    {a.resumo && <p className="text-muted-foreground">Resumo: {a.resumo}</p>}
                  </div>
                ))}
            </SecaoPainel>
          )}

          <SecaoPainel titulo="Resposta por resposta" contagem={respostas.length}>
            {respostas.length === 0 && <p className="text-xs text-muted-foreground">O aluno ainda não respondeu: só as boas-vindas foram enviadas.</p>}
            <div className="space-y-2">
              {respostas.map((x, i) => (
                <CartaoResposta key={x.run_id} x={x} numero={i + 1} aberto={i === respostas.length - 1} />
              ))}
            </div>
          </SecaoPainel>
        </div>
      )}
    </PainelLateral>
  );
}

function CartaoResposta({ x, numero, aberto }: { x: RespostaRastreada; numero: number; aberto: boolean }) {
  const ctx = x.contexto ?? {};
  return (
    <details open={aberto} className="group rounded-xl border border-border bg-background/40">
      <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">
            <span className="text-muted-foreground">{numero}. </span>
            {x.aluno || "(anexo)"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {x.quando && <span className="text-[11px] text-muted-foreground">{fmtDataHora(x.quando)}</span>}
            {x.duracao_s != null && <Chip>{fmtSegundos(x.duracao_s)}</Chip>}
            {x.tokens && <Chip>{fmtInt((x.tokens.entrada ?? 0) + (x.tokens.saida ?? 0))} tokens</Chip>}
            {ctx.whatsapp && <Chip tom="info">WhatsApp da equipe</Chip>}
            {ctx.trechos && <Chip tom="primario">Trechos da base</Chip>}
            {ctx.exemplos && <Chip tom="sucesso">Exemplos aprovados</Chip>}
            {ctx.roteiro && <Chip tom="primario">Roteiro</Chip>}
            {x.ferramentas.map((f, j) => (
              <Chip key={j} tom={f.erro ? "erro" : "neutro"}>
                {ROTULO_FERRAMENTA[f.nome] ?? f.nome}
              </Chip>
            ))}
          </div>
        </div>
      </summary>
      <div className="space-y-4 border-t border-border px-3 py-3">
        <Bloco icone={<MessageSquare className="size-3.5" />} titulo="Mensagem do aluno">
          <p className="text-[13px] whitespace-pre-wrap">{x.aluno || "(anexo sem texto)"}</p>
        </Bloco>
        <Bloco icone={<Brain className="size-3.5" />} titulo="Raciocínio do modelo" nota="resumo escrito pelo Gemini, em inglês">
          {x.raciocinio ? (
            <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{x.raciocinio.replaceAll("**", "")}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Não registrado nesta resposta (anterior ao registro do raciocínio).</p>
          )}
        </Bloco>
        {x.ferramentas.length > 0 && (
          <Bloco icone={<Wrench className="size-3.5" />} titulo="Ferramentas">
            <div className="space-y-2">
              {x.ferramentas.map((f, j) => (
                <div key={j} className="rounded-lg border border-border">
                  <p className="border-b border-border px-2.5 py-1.5 font-mono text-[11px] font-semibold">
                    {f.nome}
                    {f.argumentos && Object.keys(f.argumentos).length > 0 && (
                      <span className="font-normal text-muted-foreground"> {JSON.stringify(f.argumentos)}</span>
                    )}
                  </p>
                  {f.resultado && (
                    <pre className="thin-scroll max-h-48 overflow-auto px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap break-all text-muted-foreground">
                      {f.resultado}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </Bloco>
        )}
        {ctx.whatsapp_texto && (
          <Bloco icone={<MessageSquare className="size-3.5" />} titulo="Histórico do WhatsApp que o agente recebeu">
            <pre className="thin-scroll max-h-48 overflow-auto rounded-lg bg-muted/40 px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
              {ctx.whatsapp_texto}
            </pre>
          </Bloco>
        )}
        <UsoNaResposta uso={x.calibracao} />
        {x.chamadas_modelo.length > 0 && (
          <Bloco icone={<Cpu className="size-3.5" />} titulo="Chamadas ao modelo">
            <div className="space-y-1 text-[11px]">
              {x.chamadas_modelo.map((c, j) => (
                <p key={j} className={cn("font-mono", c.erro && "text-destructive")}>
                  {j + 1}. {c.modelo ?? "modelo"} · {c.duracao_ms != null ? fmtSegundos(c.duracao_ms / 1000) : "—"} · entrada {fmtInt(c.tokens_entrada ?? 0)}
                  {c.tokens_cache ? ` (cache ${fmtInt(c.tokens_cache)})` : ""} · saída {fmtInt(c.tokens_saida ?? 0)}
                </p>
              ))}
            </div>
          </Bloco>
        )}
        <Bloco icone={<Route className="size-3.5" />} titulo="Resposta enviada">
          <div className="rounded-xl border border-border bg-background/60 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
            {x.resposta ? <TextoComLinks texto={x.resposta} /> : <span className="text-muted-foreground">(sem resposta)</span>}
          </div>
        </Bloco>
      </div>
    </details>
  );
}

function Bloco({ icone, titulo, nota, children }: { icone: ReactNode; titulo: string; nota?: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {icone} {titulo}
        {nota && <span className="font-normal tracking-normal normal-case">· {nota}</span>}
      </p>
      {children}
    </div>
  );
}
