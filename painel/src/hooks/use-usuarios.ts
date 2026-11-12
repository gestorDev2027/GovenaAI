/** Os usuários do painel: a tela de Usuários e o contador de pendentes do menu (fora da tela, para o menu não
 * carregar o pacote inteiro da tela). */
import { useQuery } from "@tanstack/react-query";
import { api, type UsuarioPainel } from "@/lib/api";

export const useUsuarios = (habilitado = true) =>
  useQuery({
    queryKey: ["usuarios"],
    queryFn: () => api<{ usuarios: UsuarioPainel[]; voce: string }>("/usuarios"),
    enabled: habilitado,
    refetchInterval: 60_000,
  });
