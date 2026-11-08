import { useQuery } from "@tanstack/react-query";
import { api, type Acesso, type Permissao, type PermissaoOrganizacao, type Rotulos } from "@/lib/api";
import { rotulosDe } from "@/lib/rotulos";

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

/** O que a pessoa pode fazer na organização dela (o dono pode tudo; o membro, o que o cargo dá). */
export function usePodeNaOrganizacao(): (permissao: PermissaoOrganizacao) => boolean {
  const organizacao = useAcesso().data?.organizacao;
  return (permissao) => !!organizacao && organizacao.permissoes.includes(permissao);
}

/**
 * Os nomes de tela do segmento da organização de quem está logado (setor ou departamento, servidor ou
 * funcionário...). `doServidor`: os rótulos que vieram no panorama, que valem por cima. Sem organização, o
 * padrão (Saúde pública).
 */
export function useRotulos(doServidor?: Partial<Rotulos> | null): Rotulos {
  const segmento = useAcesso().data?.organizacao?.segmento_id;
  return rotulosDe(segmento, doServidor);
}
