import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronRight, FileText, ListChecks, Loader2, ScrollText, Sparkles } from "lucide-react";
import { api, type DetalhesUso, type UsoCalibracao } from "@/lib/api";
import { fmtDataHora, fmtInt } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/tabela";
import { IndicadoresPainel, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";

/*
 * "Usou 2 trechos · 1 exemplo": o que entrou no contexto de uma resposta do agente. O selo abre um
 * painel com o conteúdo de cada trecho e exemplo, na ordem de semelhança com a mensagem do aluno.
 */

function plural(n: number, um: string, varios: string) {
  return `${fmtInt(n)} ${n === 1 ? um : varios}`;
}

/** Distância do cosseno → "87% parecido" (0 = idêntico, 1 = sem relação). */
function semelhanca(distancia: number | undefined) {
  return distancia == null ? null : Math.max(0, Math.min(1, 1 - distancia));
}

function Semelhanca({ valor }: { valor: number | null }) {
  if (valor == null) return null;
  const pct = Math.round(valor * 100);
  return (
    <span className="flex items-center gap-1.5" title="Semelhança com a mensagem do aluno">
      <span className="h-1 w-14 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", pct >= 70 ? "bg-success" : pct >= 50 ? "bg-primary" : "bg-warning")} style={{ width: `${pct}%` }} />
      </span>
      <span className="num font-mono text-[11px] text-muted-foreground">{pct}%</span>
    </span>
  );
}

/** Texto longo que começa recolhido em algumas linhas. */
function TextoRecolhivel({ texto, linhas = 6 }: { texto: string; linhas?: number }) {
  const [aberto, setAberto] = useState(false);
  const longo = texto.length > 420 || texto.split("\n").length > linhas;
  return (
    <div>
      <p
        className={cn("text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90", !aberto && longo && "line-clamp-6")}
      >
        {texto}
      </p>
      {longo && (
        <button type="button" onClick={() => setAberto((v) => !v)} className="mt-1 text-xs font-semibold text-primary hover:underline">
          {aberto ? "Mostrar menos" : "Mostrar tudo"}
        </button>
      )}
    </div>
  );
}

function CartaoItem({ icone, titulo, extra, children }: { icone: ReactNode; titulo: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <article className="rounded-xl border border-border bg-background/40 p-3.5 transition-colors hover:border-primary/30">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5">{icone}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{titulo}</span>
        {extra}
      </header>
      {children}
    </article>
  );
}

function PainelUso({ uso, aberto, aoMudar }: { uso: UsoCalibracao; aberto: boolean; aoMudar: (v: boolean) => void }) {
  const idsTrechos = [...(uso.trechos ?? []), ...(uso.roteiro ?? [])];
  const idsExemplos = (uso.exemplos ?? []).map(([id]) => id);
  const detalhes = useQuery({
    queryKey: ["conhecimento", "uso", idsTrechos, idsExemplos],
    queryFn: () =>
      api<DetalhesUso>(`/conhecimento/uso?trechos=${idsTrechos.join(",")}&exemplos=${idsExemplos.join(",")}`),
    enabled: aberto,
    staleTime: 5 * 60_000,
  });
  const dist = uso.distancias ?? {};
  const documentos = detalhes.data?.trechos.filter((t) => !t.roteiro) ?? [];
  const roteiro = detalhes.data?.trechos.filter((t) => t.roteiro) ?? [];
  const exemplos = detalhes.data?.exemplos ?? [];
  const valores = Object.values(dist).map((d) => 1 - d);
  const media = valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;

  const cartaoTrecho = (t: DetalhesUso["trechos"][number]) => (
    <CartaoItem
      key={t.id}
      icone={t.roteiro ? <ScrollText /> : <FileText />}
      titulo={t.roteiro ? t.secao || "Roteiro" : t.documento}
      extra={
        <>
          <Semelhanca valor={semelhanca(dist[`t${t.id}`])} />
          <Chip>v{t.versao}</Chip>
          {!t.ativo && <Chip tom="alerta">Fora do contexto hoje</Chip>}
        </>
      }
    >
      {!t.roteiro && t.secao && <p className="mb-1.5 font-mono text-[11px] text-muted-foreground">{t.secao}</p>}
      <TextoRecolhivel texto={t.conteudo} />
    </CartaoItem>
  );

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={aoMudar}
      rotulo="Contexto da resposta"
      icone={<BookOpen />}
      titulo="O que o agente consultou"
      descricao="Trechos e exemplos que entraram nas instruções desta resposta, do mais ao menos parecido com a mensagem do aluno."
      largura="lg"
      destaque={
        <IndicadoresPainel
          itens={[
            { rotulo: "Trechos de documentos", valor: fmtInt(uso.trechos?.length ?? 0), icone: <FileText /> },
            ...(uso.roteiro?.length ? [{ rotulo: "Seções do roteiro", valor: fmtInt(uso.roteiro.length), icone: <ScrollText /> }] : []),
            { rotulo: "Exemplos aprovados", valor: fmtInt(uso.exemplos?.length ?? 0), icone: <ListChecks /> },
            ...(media != null
              ? [{ rotulo: "Semelhança média", valor: `${Math.round(media * 100)}%`, barra: media, tom: (media >= 0.7 ? "sucesso" : "primario") as "sucesso" | "primario" }]
              : []),
          ]}
        />
      }
      rodape={
        <Link
          to="/base"
          className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          Abrir Conhecimento <ChevronRight className="size-4" />
        </Link>
      }
    >
      {detalhes.isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Buscando os trechos…
        </div>
      )}
      {detalhes.isError && <p className="py-10 text-center text-sm text-destructive">{(detalhes.error as Error).message}</p>}
      {detalhes.data && (
        <div className="space-y-7">
          {documentos.length > 0 && (
            <SecaoPainel titulo="Trechos de documentos" contagem={documentos.length}>
              <div className="space-y-2.5">{documentos.map(cartaoTrecho)}</div>
            </SecaoPainel>
          )}
          {roteiro.length > 0 && (
            <SecaoPainel titulo="Seções do roteiro" contagem={roteiro.length}>
              <div className="space-y-2.5">{roteiro.map(cartaoTrecho)}</div>
            </SecaoPainel>
          )}
          {exemplos.length > 0 && (
            <SecaoPainel titulo="Exemplos aprovados" contagem={exemplos.length}>
              <div className="space-y-2.5">
                {exemplos.map((e) => (
                  <CartaoItem
                    key={e.id}
                    icone={<Sparkles />}
                    titulo={`Exemplo #${e.id}`}
                    extra={
                      <>
                        <Semelhanca valor={semelhanca(dist[`e${e.id}`])} />
                        <Chip>v{e.versao}</Chip>
                        {!e.ativo && <Chip tom="alerta">Desativado hoje</Chip>}
                      </>
                    }
                  >
                    <div className="space-y-2.5">
                      {e.contexto && (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-semibold">Antes: </span>
                          {e.contexto}
                        </p>
                      )}
                      <div className="rounded-lg bg-muted/50 px-3 py-2">
                        <div className="mb-0.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">Aluno</div>
                        <p className="text-sm whitespace-pre-wrap">{e.mensagem}</p>
                      </div>
                      <div className="rounded-lg border border-success/25 bg-success/5 px-3 py-2">
                        <div className="mb-0.5 font-mono text-[10px] tracking-wider text-success uppercase">Resposta aprovada</div>
                        <TextoRecolhivel texto={e.resposta_ideal} />
                      </div>
                      {e.observacao && (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-semibold">Observação da equipe: </span>
                          {e.observacao}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Aprovado por {e.aprovado_por} em {fmtDataHora(e.criado_em)}
                      </p>
                    </div>
                  </CartaoItem>
                ))}
              </div>
            </SecaoPainel>
          )}
          {!documentos.length && !roteiro.length && !exemplos.length && (
            <p className="py-10 text-center text-sm text-muted-foreground">Esses trechos e exemplos não existem mais na base.</p>
          )}
        </div>
      )}
    </PainelLateral>
  );
}

export function UsoNaResposta({ uso }: { uso?: UsoCalibracao | null }) {
  const [aberto, setAberto] = useState(false);
  const exemplos = uso?.exemplos?.length ?? 0;
  const trechos = uso?.trechos?.length ?? 0;
  const roteiro = uso?.roteiro?.length ?? 0;
  if (!uso || (!exemplos && !trechos && !roteiro)) return null;
  const partes = [
    trechos && plural(trechos, "trecho de documento", "trechos de documentos"),
    roteiro && plural(roteiro, "seção do roteiro", "seções do roteiro"),
    exemplos && plural(exemplos, "exemplo aprovado", "exemplos aprovados"),
  ].filter(Boolean);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="group inline-flex w-fit items-center gap-1.5 rounded-full border border-transparent bg-muted px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
        title="Ver o que o agente consultou nesta resposta"
      >
        <BookOpen className="size-3.5" /> usou {partes.join(" · ")}
        <ChevronRight className="size-3 transition-transform group-hover:translate-x-0.5" />
      </button>
      <PainelUso uso={uso} aberto={aberto} aoMudar={setAberto} />
    </>
  );
}
