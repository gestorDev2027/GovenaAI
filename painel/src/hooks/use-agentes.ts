import { useOpcoesCalibracao } from "@/components/calibracao/avaliar-resposta";
import type { AgentePainel, EquipePainel } from "@/lib/api";

export { porArea, SEM_AREA } from "@/lib/agentes";

/** Os agentes do AgentOS como aparecem no painel (nome, cargo e área). */
export function useAgentes(): AgentePainel[] {
  return useOpcoesCalibracao().data?.agentes ?? [];
}

/** As equipes publicadas (vários agentes no mesmo canal), para o chat de teste. */
export function useEquipesPublicadas(): EquipePainel[] {
  return useOpcoesCalibracao().data?.equipes ?? [];
}
