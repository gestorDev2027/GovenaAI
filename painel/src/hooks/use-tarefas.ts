/** As tarefas que esperam uma pessoa: usadas pela tela de Aprovações e pelo contador do menu (fora da tela, para o
 * menu não carregar o pacote inteiro das Aprovações). */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Tarefa } from "@/pages/aprovacoes";

export type Passo = "aceitar" | "acoes" | "revisar";

/** Em que passo a tarefa espera uma pessoa (ou nenhum). */
export function passoDa(t: Tarefa): Passo | null {
  if (t.situacao === "backlog") return "aceitar";
  if (t.situacao === "in_progress" && t.aguardando_aprovacao) return "acoes";
  if (t.situacao === "in_review") return "revisar";
  return null;
}

/** As tarefas que esperam uma pessoa (atualiza a cada 30 s). O menu usa para o contador. */
export function useTarefasAbertas(ligado = true) {
  return useQuery({
    queryKey: ["organizacao-tarefas", "abertas"],
    queryFn: () => api<{ tarefas: Tarefa[] }>("/organizacao/tarefas?situacao=abertas"),
    enabled: ligado,
    // Enquanto um agente trabalha numa tarefa, a cada 5 s (a pausa ou a entrega aparecem logo); parado, a cada 30 s.
    refetchInterval: (q) => ((q.state.data as { tarefas: Tarefa[] } | undefined)?.tarefas.some((t) => t.andamento === "rodando") ? 5_000 : 30_000),
  });
}

/** Quantas tarefas esperam uma decisão sua. */
export function useContagemAprovacoes(ligado = true): number {
  const abertas = useTarefasAbertas(ligado);
  return (abertas.data?.tarefas ?? []).filter((t) => t.posso_decidir && passoDa(t)).length;
}
