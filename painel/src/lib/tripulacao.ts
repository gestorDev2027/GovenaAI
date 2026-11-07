/*
 * A cor de cada agente na Central (personagem, telas e lista da tripulação). Vale a cor que o servidor
 * manda (a da fábrica); a tabela abaixo é só a reserva para quando ela não vem.
 */

export interface Tripulante {
  cor: string;
}

// Os agentes do código do GestorGov, nas cores da marca.
const DO_AGENTE: Record<string, string> = {
  onboarding: "#F4B800",
  compras: "#1A63D8",
  atencao_primaria: "#52A2FF",
  regulacao: "#0D1B38",
};

const LIVRES = ["#3ccf5a", "#f2b51e", "#ef3b3b", "#e83e8c"];

/** A cor do agente: a que veio do servidor (escolhida na fábrica); sem ela, a da tabela acima ou uma livre,
 * pela posição na lista de agentes. */
export function tripulante(id: string, agentes: { id: string; cor?: string | null }[] = []): Tripulante {
  const doServidor = agentes.find((a) => a.id === id)?.cor;
  if (doServidor) return { cor: doServidor };
  if (DO_AGENTE[id]) return { cor: DO_AGENTE[id] };
  const semCor = agentes.map((a) => a.id).filter((i) => !DO_AGENTE[i]);
  return { cor: LIVRES[Math.max(0, semCor.indexOf(id)) % LIVRES.length] };
}
