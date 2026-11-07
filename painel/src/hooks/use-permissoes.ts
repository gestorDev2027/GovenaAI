import { useQuery } from "@tanstack/react-query";
import { api, type Acesso, type Permissao, type PermissaoPrefeitura } from "@/lib/api";

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

/** É da equipe da plataforma (GestorGov), aprovada? Sem login (servidor local aberto ou chave), também. */
export function useDaPlataforma(): boolean {
  const usuario = useAcesso().data?.usuario;
  return !usuario || usuario.situacao === "ativo";
}

/** O que a pessoa pode fazer na prefeitura dela (o dono pode tudo; o membro, o que o cargo dá). */
export function usePodeNaPrefeitura(): (permissao: PermissaoPrefeitura) => boolean {
  const prefeitura = useAcesso().data?.prefeitura;
  return (permissao) => !!prefeitura && prefeitura.permissoes.includes(permissao);
}
