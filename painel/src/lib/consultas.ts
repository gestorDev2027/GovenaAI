/**
 * O cache das consultas do painel (TanStack Query): quanto tempo cada tipo de dado vale, o que fica guardado entre
 * recargas e o que as rotas pré-carregam quando o mouse passa no menu.
 *
 * - Padrão: 30 s fresco (voltar a uma tela não pede tudo de novo) e 10 min na memória depois de sair dela.
 * - Catálogo (tipos de área e de unidade, segmentos) e `/acesso`: mudam pouco; ficam frescos por mais tempo.
 * - Tarefas e aprovações: frescas por pouco tempo e atualizadas ao voltar para a aba (já têm `refetchInterval`).
 * - Entre recargas, no `localStorage`, só o catálogo e o `/acesso` (quem está logado e o que pode). Nada de dados de
 *   pacientes, conversas ou chaves: a chave de acesso nem passa pelo cache (ver lib/api.ts).
 */
import { QueryClient, type Query } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import { ErroAcesso, api, type Acesso } from "@/lib/api";

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * SEGUNDO,
      gcTime: 10 * MINUTO,
      refetchOnWindowFocus: false,
      retry: (falhas, erro) => !(erro instanceof ErroAcesso) && falhas < 2,
    },
  },
});

// Dados que quase não mudam: o catálogo vem das migrations (muda com o deploy, e o `buster` limpa o guardado).
for (const chave of [["gestao-catalogo"], ["gestao-catalogo-publico"], ["usuarios-opcoes"], ["fabrica-opcoes"]]) {
  queryClient.setQueryDefaults(chave, { staleTime: HORA, gcTime: 12 * HORA });
}
// Quem está logado: as telas já pedem com staleTime Infinity; aqui só o tempo na memória (para ser guardado).
queryClient.setQueryDefaults(["acesso"], { gcTime: 12 * HORA });
// Tarefas, aprovações e os selos das salas: mudam o tempo todo; ao voltar para a aba, atualizam.
for (const chave of [["organizacao-tarefas"], ["organizacao-atencao"]]) {
  queryClient.setQueryDefaults(chave, { staleTime: 5 * SEGUNDO, refetchOnWindowFocus: true });
}

/** As únicas consultas guardadas entre recargas. */
const GUARDADAS = new Set(["acesso", "gestao-catalogo", "gestao-catalogo-publico"]);

/** localStorage que não derruba o painel quando o navegador não deixa guardar (aba anônima, cota cheia). */
const armazenamento = {
  getItem: (chave: string) => {
    try {
      return localStorage.getItem(chave);
    } catch {
      return null;
    }
  },
  setItem: (chave: string, valor: string) => {
    try {
      localStorage.setItem(chave, valor);
    } catch {
      /* sem armazenamento: o cache vale só nesta aba */
    }
  },
  removeItem: (chave: string) => {
    try {
      localStorage.removeItem(chave);
    } catch {
      /* idem */
    }
  },
};

export const persistencia: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister: createAsyncStoragePersister({ storage: armazenamento, key: "gestorgov-cache" }),
  // Cada build tem a sua versão: depois do deploy, o que estava guardado é descartado.
  buster: import.meta.env.VITE_VERSAO ?? "dev",
  maxAge: 12 * HORA,
  dehydrateOptions: {
    shouldDehydrateQuery: (q: Query) => q.state.status === "success" && GUARDADAS.has(String(q.queryKey[0])),
    shouldDehydrateMutation: () => false,
    // O token do Mapbox (público, mas é um token) não vai para o armazenamento: volta na conferência do /acesso.
    serializeData: (dados: unknown) => {
      if (dados && typeof dados === "object" && "mapbox_token" in dados) {
        const { mapbox_token: _token, ...resto } = dados as Acesso;
        return resto;
      }
      return dados;
    },
  },
};

/** Depois de restaurar o guardado, o `/acesso` é conferido de novo em segundo plano (a tela abre na hora com o
 * guardado; se a sessão caiu ou o cargo mudou, a resposta nova corrige). */
export function aoRestaurar() {
  void queryClient.invalidateQueries({ queryKey: ["acesso"] });
}

// ───────── Pré-carga das telas (loaders das rotas, chamados também ao passar o mouse no menu) ─────────
// As chaves e os caminhos são os mesmos das telas: o que vier daqui é o que a tela usaria.

const acesso = () => queryClient.ensureQueryData({ queryKey: ["acesso"], queryFn: () => api<Acesso>("/acesso"), staleTime: Infinity });

function pre(queryKey: unknown[], caminho: string) {
  void queryClient.prefetchQuery({ queryKey, queryFn: () => api(caminho) });
}

export const preCarregar = {
  cidade: () => {
    pre(["gestao-catalogo"], "/implantacao/catalogo");
    void acesso()
      .then((a) => {
        const daOrganizacao = !!a?.organizacao;
        pre(["gestao-panorama", daOrganizacao], daOrganizacao ? "/organizacao/panorama" : "/gestao/panorama");
      })
      .catch(() => undefined);
  },
  aprovacoes: () => pre(["organizacao-tarefas", "abertas"], "/organizacao/tarefas?situacao=abertas"),
  cargos: () => pre(["organizacao-cargos"], "/organizacao/cargos"),
  equipe: () => pre(["organizacao-equipe"], "/organizacao/equipe"),
  agentes: () => pre(["organizacao-agentes"], "/organizacao/agentes"),
  processos: () => {
    pre(["organizacao-agentes"], "/organizacao/agentes");
    pre(["organizacao-atividades"], "/organizacao/atividades");
  },
};
