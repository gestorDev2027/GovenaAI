/** Como um acontecimento ao vivo (/secretaria/eventos) aparece em texto: usado na Central ao vivo e no Painel. */
import { ROTULO_FERRAMENTA } from "@/components/chat/anexos";
import type { EventoCentral } from "@/lib/api";

const ROTULO_EVENTO: Record<EventoCentral["tipo"], string> = {
  mensagem: "Recebeu uma mensagem",
  pensando: "Pensando",
  ferramenta: "Usou uma ferramenta",
  respondeu: "Respondeu",
  transferiu: "Passou para a equipe",
  encerrou: "Encerrou a conversa",
  guardrail: "Barrou um pedido fora das regras",
  erro: "Erro",
  boas_vindas: "Boas-vindas",
};

export function rotuloDoEvento(e: EventoCentral): string {
  if (e.tipo === "ferramenta" && e.ferramenta) return ROTULO_FERRAMENTA[e.ferramenta] ?? e.ferramenta;
  return ROTULO_EVENTO[e.tipo];
}
