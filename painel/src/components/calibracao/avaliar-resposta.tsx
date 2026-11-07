import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { api, type AvaliacaoHumana, type OpcoesCalibracao } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/fields";
import { usePode } from "@/hooks/use-permissoes";

const ROTULO_SITUACAO = { pendente: "aguardando curadoria", aprovada: "aprovada", recusada: "recusada" } as const;

export function useOpcoesCalibracao() {
  return useQuery({
    queryKey: ["calibracao-opcoes"],
    queryFn: () => api<OpcoesCalibracao>("/calibracao/opcoes"),
    staleTime: 5 * 60_000,
  });
}

/** Avaliações da conversa, por resposta (uma consulta por conversa, compartilhada pelas respostas). */
export function useAvaliacoesDaConversa(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["calibracao-conversa", sessionId],
    queryFn: () =>
      api<{ por_resposta: Record<string, AvaliacaoHumana[]> }>(`/calibracao/conversa/${encodeURIComponent(sessionId!)}`),
    enabled: Boolean(sessionId),
  });
}

/**
 * 👍 / 👎 em uma resposta do agente. O 👎 abre o formulário: o que errou, comentário e como deveria
 * ser. Tudo vai para a fila da Calibração; só passa a valer depois de aprovado por um curador.
 */
/** 👍/👎 só para quem tem a permissão "Avaliar respostas". */
export function AvaliarResposta(props: { sessionId: string; runId: string; origem: "chat_teste" | "conversa" }) {
  const pode = usePode();
  return pode("avaliar") ? <AvaliarRespostaPermitida {...props} /> : null;
}

function AvaliarRespostaPermitida({
  sessionId,
  runId,
  origem,
}: {
  sessionId: string;
  runId: string;
  origem: "chat_teste" | "conversa";
}) {
  const qc = useQueryClient();
  const opcoes = useOpcoesCalibracao();
  const daConversa = useAvaliacoesDaConversa(sessionId);
  const minha = daConversa.data?.por_resposta[runId]?.find((a) => a.avaliador === opcoes.data?.voce);
  const [aberto, setAberto] = useState(false);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [comentario, setComentario] = useState("");
  const [ideal, setIdeal] = useState("");

  const enviar = useMutation({
    mutationFn: (nota: 1 | -1) =>
      api("/calibracao/avaliacoes", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          run_id: runId,
          nota,
          origem,
          ...(nota === -1 ? { problemas, comentario, resposta_ideal: ideal } : {}),
        }),
      }),
    onSuccess: (_, nota) => {
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["calibracao-conversa", sessionId] });
      qc.invalidateQueries({ queryKey: ["calibracao-resumo"] });
      qc.invalidateQueries({ queryKey: ["calibracao-fila"] });
      toast.success(nota === 1 ? "Resposta marcada como boa" : "Avaliação enviada", {
        description: "Ela entra na fila da Calibração e vale depois de aprovada.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível avaliar", { description: e.message }),
  });

  const revisada = minha && minha.situacao !== "pendente";

  function abrirNegativa() {
    if (minha?.nota === -1) {
      setProblemas(minha.problemas);
      setComentario(minha.comentario ?? "");
      setIdeal(minha.resposta_ideal ?? "");
    }
    setAberto((a) => !a);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 text-muted-foreground">
        <button
          type="button"
          title="Boa resposta"
          aria-label="Boa resposta"
          disabled={enviar.isPending || revisada}
          onClick={() => enviar.mutate(1)}
          className={cn(
            "rounded-md p-1.5 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
            minha?.nota === 1 && "text-success",
          )}
        >
          <ThumbsUp className="size-3.5" />
        </button>
        <button
          type="button"
          title="Resposta com problema"
          aria-label="Resposta com problema"
          disabled={enviar.isPending || revisada}
          onClick={abrirNegativa}
          className={cn(
            "rounded-md p-1.5 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
            (minha?.nota === -1 || aberto) && "text-destructive",
          )}
        >
          <ThumbsDown className="size-3.5" />
        </button>
        {enviar.isPending && <Loader2 className="size-3.5 animate-spin" />}
        {minha && (
          <span className="ml-1 font-mono text-[11px] tracking-tight uppercase">
            sua avaliação: {ROTULO_SITUACAO[minha.situacao]}
          </span>
        )}
      </div>

      {aberto && (
        <div className="max-w-xl space-y-3 rounded-xl border bg-card/60 p-3">
          <div className="text-xs font-semibold">O que estava errado?</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(opcoes.data?.problemas ?? {}).map(([chave, rotulo]) => {
              const ativo = problemas.includes(chave);
              return (
                <button
                  key={chave}
                  type="button"
                  onClick={() => setProblemas((l) => (ativo ? l.filter((p) => p !== chave) : [...l, chave]))}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    ativo ? "border-destructive/50 bg-destructive/10 text-destructive" : "hover:bg-muted",
                  )}
                >
                  {rotulo}
                </button>
              );
            })}
          </div>
          <Textarea
            placeholder="Comentário (opcional): o que faltou, o que sobrou, qual regra não seguiu"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            maxLength={2000}
          />
          <Textarea
            placeholder="Como a resposta deveria ser (é o que mais ajuda: vira o gabarito depois de aprovado)"
            value={ideal}
            onChange={(e) => setIdeal(e.target.value)}
            maxLength={4000}
            className="min-h-24"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={enviar.isPending || !(problemas.length || comentario.trim() || ideal.trim())}
              onClick={() => enviar.mutate(-1)}
            >
              Enviar avaliação
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
