import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/*
 * O que espera cada área agora (GET /organizacao/atencao): tarefas para aceitar, em execução e em revisão. Aparece em
 * selos discretos na placa da sala do prédio e na lista de áreas (o 3D nunca é obrigatório).
 */

export interface AtencaoDaArea {
  aceite: number;
  execucao: number;
  revisao: number;
}
export type AtencaoPorArea = Record<string, AtencaoDaArea>;

/** Atualiza a cada 30 s. Só para quem é de uma organização (`ligado`). */
export function useAtencao(ligado: boolean) {
  return useQuery({
    queryKey: ["organizacao-atencao"],
    queryFn: () => api<{ areas: AtencaoPorArea }>("/organizacao/atencao"),
    enabled: ligado,
    refetchInterval: 30_000,
    retry: false,
    select: (d) => d.areas ?? {},
  });
}

const SELOS: { chave: keyof AtencaoDaArea; texto: (n: number) => string; classe: string }[] = [
  { chave: "aceite", texto: (n) => `${n} para aceitar`, classe: "bg-[#F4B800]/20 text-[#6B5000] dark:bg-[#F4B800]/20 dark:text-[#F4B800]" },
  { chave: "revisao", texto: (n) => `${n} em revisão`, classe: "bg-[#1A63D8]/12 text-[#1A4FA8] dark:bg-[#52A2FF]/20 dark:text-[#9CCBFF]" },
  { chave: "execucao", texto: (n) => `${n} em execução`, classe: "bg-[#22c55e]/15 text-[#166534] dark:bg-[#22c55e]/20 dark:text-[#86efac]" },
];

/** Os selos com os números maiores que zero; nada quando a área está em dia. */
export function SelosAtencao({ atencao, className }: { atencao?: AtencaoDaArea | null; className?: string }) {
  const visiveis = atencao ? SELOS.filter((s) => (atencao[s.chave] ?? 0) > 0) : [];
  if (!visiveis.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {visiveis.map((s) => (
        <span key={s.chave} className={cn("inline-flex items-center rounded-full px-1.5 py-px text-[10px] leading-tight font-medium", s.classe)}>
          {s.chave === "execucao" && <span aria-hidden="true" className="mr-1 size-1.5 animate-pulse rounded-full bg-[#22c55e]" />}
          {s.texto(atencao![s.chave])}
        </span>
      ))}
    </span>
  );
}
