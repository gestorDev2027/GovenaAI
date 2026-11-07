import { useQuery } from "@tanstack/react-query";
import { api, type AgentePainel, type EquipePainel } from "@/lib/api";

export { porArea, SEM_AREA } from "@/lib/agentes";

/** Os agentes publicados que quem está logado pode ver (a prefeitura vê só os dela). */
function useVisiveis() {
  return useQuery({
    queryKey: ["agentes-visiveis"],
    queryFn: () => api<{ agentes: AgentePainel[]; equipes: EquipePainel[] }>("/agentes"),
    staleTime: 5 * 60_000,
  });
}

/** Os agentes do AgentOS como aparecem no painel (nome, cargo e área). */
export function useAgentes(): AgentePainel[] {
  return useVisiveis().data?.agentes ?? [];
}

/** As equipes publicadas (vários agentes no mesmo canal), para o chat de teste. */
export function useEquipesPublicadas(): EquipePainel[] {
  return useVisiveis().data?.equipes ?? [];
}
