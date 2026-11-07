import { createContext, useContext } from "react";

/**
 * O link da gestão (/painel/gestao/<código>): a Visão geral só de leitura, sem login. Dentro dele, os blocos
 * buscam as rotas públicas do link e escondem o que leva a outras telas ou mostra texto de conversa.
 */
export const ContextoGestao = createContext<string | null>(null);

/** O código do link da gestão, ou null no painel normal. */
export function useCodigoGestao(): string | null {
  return useContext(ContextoGestao);
}
