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
import { Chat } from "@/pages/chat";
import { BaseConhecimento } from "@/pages/base";
import { Fabrica } from "@/pages/fabrica";
import { Usuarios } from "@/pages/usuarios";
import { Observabilidade } from "@/pages/observabilidade";
import { Cidade } from "@/pages/cidade";
import { Inicio } from "@/pages/inicio";
import { Entrar } from "@/pages/entrar";
import { Cadastro } from "@/pages/cadastro";
import { PaginaImplantacao } from "@/pages/implantacao";
import { Cargos } from "@/pages/cargos";
import { Equipe } from "@/pages/equipe";
import { AceitarConvite } from "@/pages/convite";
import { CentralDeComando } from "@/pages/comando";
import { Secretaria3D } from "@/pages/secretaria";
import { Unidade3D } from "@/pages/unidade";
import { Navigate } from "@tanstack/react-router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (falhas, erro) => !(erro instanceof ErroAcesso) && falhas < 2,
    },
  },
});

const raiz = createRootRoute({ component: Outlet });

// Tudo o que exige login.
const protegido = createRoute({
  getParentRoute: () => raiz,
  id: "protegido",
  component: () => (
    <AccessGate>
      <Outlet />
    </AccessGate>
  ),
});

// As telas do painel, com o menu lateral. A Central de comando fica fora: abre em tela cheia.
const painel = createRoute({
  getParentRoute: () => protegido,
  id: "painel",
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

/** A tela inicial é a cidade (o Painel de gestão entra aqui quando existir). */
const Inicial = () => <Navigate to="/cidade" replace />;

const rotas = [
  createRoute({ getParentRoute: () => painel, path: "/", component: Inicial }),
  createRoute({ getParentRoute: () => painel, path: "/cidade", component: Cidade }),
  createRoute({ getParentRoute: () => painel, path: "/cargos", component: Cargos }),
  createRoute({ getParentRoute: () => painel, path: "/equipe", component: Equipe }),
  createRoute({
    getParentRoute: () => painel,
    path: "/chat",
    // ?agente=<id> abre o chat já com esse agente (a Central de comando usa).
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
    path: "/fabrica",
    // ?agente=<id>&secao=<seção> abre o agente no painel lateral da fábrica, já na seção.
    // ?aba=equipes|skills|ferramentas|chaves|hosts abre a lista das equipes, das skills, das ferramentas HTTP, das chaves ou dos hosts.
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
      // A Cidade: o mapa das unidades em tela inteira, com janelas flutuantes (abre em outra aba).
      createRoute({ getParentRoute: () => protegido, path: "/comando", component: CentralDeComando }),
      // A Secretaria virtual: o prédio com uma sala por setor e o agente dela, em tela inteira.
      createRoute({ getParentRoute: () => protegido, path: "/secretaria", component: Secretaria3D }),
      // Uma unidade de saúde em 3D: o prédio com as salas do tipo e o agente da unidade na gerência.
      createRoute({ getParentRoute: () => protegido, path: "/unidade/$id", component: Unidade3D }),
    ]),
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
