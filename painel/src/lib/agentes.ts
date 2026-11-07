/** Área de quem não tem uma definida no perfil (a mesma do servidor). */
export const SEM_AREA = "Outros";

/** Agrupa por área, em ordem alfabética, com "Outros" por último; dentro da área, a ordem recebida. */
export function porArea<T extends { area?: string }>(lista: T[]): { area: string; itens: T[] }[] {
  const grupos = new Map<string, T[]>();
  for (const item of lista) {
    const area = item.area || SEM_AREA;
    grupos.set(area, [...(grupos.get(area) ?? []), item]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => (a === SEM_AREA ? 1 : b === SEM_AREA ? -1 : a.localeCompare(b, "pt-BR")))
    .map(([area, itens]) => ({ area, itens }));
}
