import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { Toaster } from "sonner";
import "./styles.css";
import { aoRestaurar, persistencia, preCarregar, queryClient } from "@/lib/consultas";
import { AppShell } from "@/components/layout/app-shell";
import { AccessGate } from "@/components/layout/access-gate";
import { ExigePermissao } from "@/components/layout/exige-permissao";

// Cada tela num pacote próprio, baixado na primeira visita (ou antes, quando o mouse passa no link: preload "intent").
const Chat = lazyRouteComponent(() => import("@/pages/chat"), "Chat");
const BaseConhecimento = lazyRouteComponent(() => import("@/pages/base"), "BaseConhecimento");
const Fabrica = lazyRouteComponent(() => import("@/pages/fabrica"), "Fabrica");
const Usuarios = lazyRouteComponent(() => import("@/pages/usuarios"), "Usuarios");
const Observabilidade = lazyRouteComponent(() => import("@/pages/observabilidade"), "Observabilidade");
const Cidade = lazyRouteComponent(() => import("@/pages/cidade"), "Cidade");
const Inicio = lazyRouteComponent(() => import("@/pages/inicio"), "Inicio");
const Entrar = lazyRouteComponent(() => import("@/pages/entrar"), "Entrar");
const Cadastro = lazyRouteComponent(() => import("@/pages/cadastro"), "Cadastro");
const PaginaImplantacao = lazyRouteComponent(() => import("@/pages/implantacao"), "PaginaImplantacao");
const Cargos = lazyRouteComponent(() => import("@/pages/cargos"), "Cargos");
const Equipe = lazyRouteComponent(() => import("@/pages/equipe"), "Equipe");
const AgentesDaOrganizacao = lazyRouteComponent(() => import("@/pages/agentes"), "AgentesDaOrganizacao");
const Aprovacoes = lazyRouteComponent(() => import("@/pages/aprovacoes"), "Aprovacoes");
const Processos = lazyRouteComponent(() => import("@/pages/processos"), "Processos");
const Integracoes = lazyRouteComponent(() => import("@/pages/integracoes"), "Integracoes");
const AceitarConvite = lazyRouteComponent(() => import("@/pages/convite"), "AceitarConvite");
const RedefinirSenha = lazyRouteComponent(() => import("@/pages/redefinir-senha"), "RedefinirSenha");
const ColaborarNaImplantacao = lazyRouteComponent(() => import("@/pages/colaborar"), "ColaborarNaImplantacao");
const CentralDeComando = lazyRouteComponent(() => import("@/pages/comando"), "CentralDeComando");
const Secretaria3D = lazyRouteComponent(() => import("@/pages/secretaria"), "Secretaria3D");
const Unidade3D = lazyRouteComponent(() => import("@/pages/unidade"), "Unidade3D");
const PainelGeral = lazyRouteComponent(() => import("@/pages/painel"), "PainelGeral");
// Os módulos novos da repaginação (12/11/2026): entram vazios, "em construção", num pacote só.
const Telao = lazyRouteComponent(() => import("@/pages/modulos"), "Telao");
const Editais = lazyRouteComponent(() => import("@/pages/modulos"), "Editais");
const Producao = lazyRouteComponent(() => import("@/pages/modulos"), "Producao");
const Analises = lazyRouteComponent(() => import("@/pages/modulos"), "Analises");
const Auditoria = lazyRouteComponent(() => import("@/pages/modulos"), "Auditoria");

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

const rotas = [
  // A tela inicial é o Painel (a visão geral com os números do cadastro).
  createRoute({ getParentRoute: () => painel, path: "/", component: PainelGeral, loader: preCarregar.painel }),
  createRoute({ getParentRoute: () => painel, path: "/telao", component: Telao, loader: () => Telao.preload?.() }),
  createRoute({ getParentRoute: () => painel, path: "/editais", component: Editais, loader: () => Editais.preload?.() }),
  createRoute({ getParentRoute: () => painel, path: "/producao", component: Producao, loader: () => Producao.preload?.() }),
  createRoute({ getParentRoute: () => painel, path: "/analises", component: Analises, loader: () => Analises.preload?.() }),
  createRoute({
    getParentRoute: () => painel,
    path: "/auditoria",
    loader: () => Auditoria.preload?.(),
    component: () => <ExigePermissao ouNaOrganizacao="ver_auditoria"><Auditoria /></ExigePermissao>,
  }),
  createRoute({ getParentRoute: () => painel, path: "/cidade", component: Cidade, loader: preCarregar.cidade }),
  createRoute({ getParentRoute: () => painel, path: "/cargos", component: Cargos, loader: preCarregar.cargos }),
  createRoute({ getParentRoute: () => painel, path: "/equipe", component: Equipe, loader: preCarregar.equipe }),
  createRoute({ getParentRoute: () => painel, path: "/agentes", component: AgentesDaOrganizacao, loader: preCarregar.agentes }),
  createRoute({ getParentRoute: () => painel, path: "/aprovacoes", component: Aprovacoes, loader: preCarregar.aprovacoes }),
  createRoute({ getParentRoute: () => painel, path: "/processos", component: Processos, loader: preCarregar.processos }),
  createRoute({ getParentRoute: () => painel, path: "/integracoes", component: Integracoes, loader: () => Integracoes.preload?.() }),
  createRoute({
    getParentRoute: () => painel,
    path: "/chat",
    // ?agente=<id> abre o chat já com esse agente (a Central de comando usa).
    validateSearch: (s: Record<string, unknown>): { agente?: string } => ({
      agente: typeof s.agente === "string" ? s.agente : undefined,
    }),
    loader: () => Chat.preload?.(),
    component: () => <ExigePermissao permissao="usar_chat" ouNaOrganizacao="ver_painel"><Chat /></ExigePermissao>,
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
    loader: () => Usuarios.preload?.(),
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
    loader: () => Fabrica.preload?.(),
    component: () => <ExigePermissao permissao="editar_agentes"><Fabrica /></ExigePermissao>,
  }),
  createRoute({
    getParentRoute: () => painel,
    path: "/observabilidade",
    validateSearch: (s: Record<string, unknown>): { grupo?: string; tabela?: string } => ({
      grupo: typeof s.grupo === "string" ? s.grupo : undefined,
      tabela: typeof s.tabela === "string" ? s.tabela : undefined,
    }),
    loader: () => Observabilidade.preload?.(),
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
    // O link de redefinir a senha (gerado em Usuários): a pessoa cria a senha nova e entra.
    createRoute({ getParentRoute: () => raiz, path: "/redefinir-senha/$token", component: RedefinirSenha }),
    // O link da implantação compartilhada: um colaborador entra com o código de segurança e continua a implantação.
    createRoute({ getParentRoute: () => raiz, path: "/colaborar/$token", component: ColaborarNaImplantacao }),
  ]),
  basepath: "/painel",
  // Ao passar o mouse (ou focar pelo teclado) num link, baixa o pacote da tela e os dados dela (loaders acima).
  defaultPreload: "intent",
  // Quem decide se os dados ainda valem é o cache do TanStack Query (lib/consultas.ts), não o router.
  defaultPreloadStaleTime: 0,
  defaultNotFoundComponent: () => <div className="p-6 text-sm text-muted-foreground">Página não encontrada.</div>,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={persistencia} onSuccess={aoRestaurar}>
      <RouterProvider router={router} />
      <Toaster richColors position="top-right" />
    </PersistQueryClientProvider>
  </StrictMode>,
);
