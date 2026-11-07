import { useQuery } from "@tanstack/react-query";
import { api, type Acesso, type Permissao } from "@/lib/api";

export const useAcesso = () => useQuery({ queryKey: ["acesso"], queryFn: () => api<Acesso>("/acesso"), staleTime: Infinity });

/**
 * O que a pessoa conectada pode fazer, para esconder ou desabilitar o resto na tela (o servidor confere de
 * novo e responde 403). Sem login com o Google (chave de acesso ou servidor local), vale tudo, como no
 * servidor; o dono também pode tudo.
 */
export function usePode(): (permissao: Permissao) => boolean {
  const usuario = useAcesso().data?.usuario;
  return (permissao) => !usuario || usuario.papel === "dono" || (usuario.permissoes ?? []).includes(permissao);
}
