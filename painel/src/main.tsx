import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Toaster } from "sonner";
import "./styles.css";
import { ErroAcesso } from "@/lib/api";
import { AppShell } from "@/components/layout/app-shell";
import { AccessGate } from "@/components/layout/access-gate";
import { ExigePermissao } from "@/components/layout/exige-permissao";
import { VisaoGeral } from "@/pages/visao-geral";
import { Conversas } from "@/pages/conversas";
import { Chat } from "@/pages/chat";
import { BaseConhecimento } from "@/pages/base";
import { Calibracao } from "@/pages/calibracao";
import { Fabrica } from "@/pages/fabrica";
import { Usuarios } from "@/pages/usuarios";
import { Observabilidade } from "@/pages/observabilidade";
import { Central } from "@/pages/central";
import { PainelGestao } from "@/pages/gestao";
import { Cidade } from "@/pages/cidade";
import { Inicio } from "@/pages/inicio";
import { Entrar } from "@/pages/entrar";
import { Cadastro } from "@/pages/cadastro";
import { PaginaImplantacao } from "@/pages/implantacao";
import { Cargos } from "@/pages/cargos";
import { Equipe } from "@/pages/equipe";
import { AceitarConvite } from "@/pages/convite";
import { Navigate } from "@tanstack/react-router";
import { useAcesso } from "@/hooks/use-permissoes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (falhas, erro) => !(erro instanceof ErroAcesso) && falhas < 2,
    },
  },
});

const raiz = createRootRoute({ component: Outlet });

// Tudo o que exige login. O link da gestão (/gestao/<código>) fica fora: abre sem login, só com o código.
const protegido = createRoute({
  getParentRoute: () => raiz,
  id: "protegido",
  component: () => (
    <AccessGate>
      <Outlet />
    </AccessGate>
  ),
});

// As telas do painel, com o menu lateral. A Central ao vivo fica fora: abre em outra aba, em tela cheia.
const painel = createRoute({
  getParentRoute: () => protegido,
  id: "painel",
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

/** A tela inicial: o Painel para a equipe GestorGov; a Cidade para quem é só da prefeitura. */
function Inicial() {
  const acesso = useAcesso().data;
  if (acesso?.usuario && acesso.usuario.situacao !== "ativo" && acesso.prefeitura) return <Navigate to="/cidade" />;
  return <VisaoGeral />;
}

const rotas = [
  createRoute({ getParentRoute: () => painel, path: "/", component: Inicial }),
  createRoute({ getParentRoute: () => painel, path: "/cidade", component: Cidade }),
  createRoute({ getParentRoute: () => painel, path: "/cargos", component: Cargos }),
  createRoute({ getParentRoute: () => painel, path: "/equipe", component: Equipe }),
  createRoute({
    getParentRoute: () => painel,
    path: "/conversas",
    validateSearch: (s: Record<string, unknown>): { id?: string; status?: string; aba?: string } => ({
      id: typeof s.id === "string" ? s.id : undefined,
      status: typeof s.status === "string" ? s.status : undefined,
      // A aba da coluna do servidor: o link abre onde parou.
      aba: typeof s.aba === "string" ? s.aba : undefined,
    }),
    component: Conversas,
  }),
  createRoute({
    getParentRoute: () => painel,
    path: "/chat",
    // ?agente=sdr abre o chat de teste já com esse agente (o botão da Central usa).
    validateSearch: (s: Record<string, unknown>): { agente?: string } => ({
      agente: typeof s.agente === "string" ? s.agente : undefined,
    }),
    component: () => <ExigePermissao permissao="usar_chat" ouNaPrefeitura="ver_painel"><Chat /></ExigePermissao>,
  }),
  createRoute({
    getParentRoute: () => painel,
    path: "/base",
    // ?agente=<id> abre a base desse agente (a fábrica usa).
    validateSearch: (s: Record<string, unknown>): { agente?: string } => ({
      agente: typeof s.agente === "string" ? s.agente : undefined,
    }),
    component: BaseConhecimento,
  }),
  createRoute({
    getParentRoute: () => painel,
    path: "/usuarios",
    component: () => <ExigePermissao permissao="gerenciar_usuarios"><Usuarios /></ExigePermissao>,
  }),
  createRoute({
    getParentRoute: () => painel,
    path: "/calibracao",
    // ?avaliacao=<id> abre a avaliação aprovada (os casos de teste da fábrica usam).
    validateSearch: (s: Record<string, unknown>): { avaliacao?: number } => ({
      avaliacao: Number.isInteger(Number(s.avaliacao)) && Number(s.avaliacao) > 0 ? Number(s.avaliacao) : undefined,
    }),
    component: Calibracao,
  }),
  createRoute({
    getParentRoute: () => painel,
    path: "/fabrica",
    // ?agente=<id>&secao=<seção> abre o agente no painel lateral da fábrica, já na seção.
    // ?aba=equipes|canal|skills|ferramentas|chaves|hosts abre o Canal WhatsApp ou a lista das equipes, das skills, das ferramentas HTTP, das chaves ou dos hosts.
    validateSearch: (s: Record<string, unknown>): { agente?: string; secao?: string; aba?: string } => ({
      agente: typeof s.agente === "string" ? s.agente : undefined,
      secao: typeof s.secao === "string" ? s.secao : undefined,
      aba: typeof s.aba === "string" ? s.aba : undefined,
    }),
    component: () => <ExigePermissao permissao="editar_agentes"><Fabrica /></ExigePermissao>,
  }),
  createRoute({
    getParentRoute: () => painel,
    path: "/observabilidade",
    validateSearch: (s: Record<string, unknown>): { grupo?: string; tabela?: string } => ({
      grupo: typeof s.grupo === "string" ? s.grupo : undefined,
      tabela: typeof s.tabela === "string" ? s.tabela : undefined,
    }),
    component: () => <ExigePermissao permissao="ver_banco"><Observabilidade /></ExigePermissao>,
  }),
];

const router = createRouter({
  routeTree: raiz.addChildren([
    protegido.addChildren([
      painel.addChildren(rotas),
      createRoute({ getParentRoute: () => protegido, path: "/central", component: Central }),
    ]),
    createRoute({ getParentRoute: () => raiz, path: "/gestao/$codigo", component: PainelGestao }),
    // Páginas públicas: a landing page, entrar e cadastrar. A implantação exige conta (a própria página confere).
    createRoute({ getParentRoute: () => raiz, path: "/inicio", component: Inicio }),
    createRoute({ getParentRoute: () => raiz, path: "/entrar", component: Entrar }),
    createRoute({ getParentRoute: () => raiz, path: "/cadastro", component: Cadastro }),
    createRoute({ getParentRoute: () => raiz, path: "/implantacao", component: PaginaImplantacao }),
    createRoute({ getParentRoute: () => raiz, path: "/convite/$token", component: AceitarConvite }),
  ]),
  basepath: "/painel",
  defaultNotFoundComponent: () => <div className="p-6 text-sm text-muted-foreground">Página não encontrada.</div>,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  </StrictMode>,
);
