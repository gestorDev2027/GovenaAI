import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  UsersRound,
  Activity,
  Bell,
  Bot,
  Briefcase,
  MessagesSquare,
  BookOpen,
  Building2,
  ChartColumnBig,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  CircleHelp,
  FilePen,
  Gauge,
  Landmark,
  LayoutDashboard,
  Library,
  Map as Mapa,
  MonitorPlay,
  Network,
  Plug,
  Radio,
  Rocket,
  ScrollText,
  Search,
  UserCog,
  Workflow,
  Factory,
  ExternalLink,
  LayoutGrid,
  LogOut,
  MapPinned,
  Menu,
  Moon,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, sair, type Acesso, type Config, type Permissao, type PermissaoOrganizacao, type Rotulos } from "@/lib/api";
import { useDaPlataforma, usePode, usePodeNaOrganizacao, useRotulos } from "@/hooks/use-permissoes";
import { ROTULOS_SAUDE } from "@/lib/rotulos";
import { useUsuarios } from "@/hooks/use-usuarios";
import { useContagemAprovacoes } from "@/hooks/use-tarefas";
import { useTheme } from "@/hooks/use-theme";
import { Logo, LogoIcone } from "./logo";

/**
 * Casco do painel: menu lateral, barra do topo e o conteúdo.
 *
 * Em tela larga o menu é uma coluna de altura total, separada do conteúdo por uma borda fina; títulos
 * de seção em azul, caixa alta, e o item ativo com degradê e um marcador luminoso à esquerda. No
 * tablet (768–1024) fica recolhido e o botão redondo abre a gaveta; no celular vira barra fina com
 * gaveta. A gaveta reusa a mesma lista (duas listas em paralelo divergem no primeiro item acrescentado
 * num lugar só).
 */

/** novaAba: a tela abre em outra aba, fora do menu (ex.: Central de comando, em tela cheia). permissao: o item só
 * aparece para quem a tem (na plataforma); naOrganizacao: o item é da organização e pede essa permissão lá.
 * contagem: um número ao lado (ex.: pessoas esperando aprovação). */
type Item = {
  to: string;
  rotulo: string;
  icone: ComponentType<{ className?: string }>;
  novaAba?: boolean;
  permissao?: Permissao;
  naOrganizacao?: PermissaoOrganizacao;
  contagem?: number;
  /** Tela nova ainda vazia: o menu mostra "em breve". */
  emConstrucao?: boolean;
};
// O ícone da SEÇÃO só aparece no menu recolhido e nunca repete o de um item da própria seção.
// daPlataforma: a seção é da equipe GestorGov (aprovada no painel); as outras são da organização de quem entrou.
// soSemOrganizacao: a seção some para quem tem organização (as telas dela já estão nas seções da organização).
type Secao = {
  titulo: string;
  icone: ComponentType<{ className?: string }>;
  itens: Item[];
  daPlataforma?: boolean;
  soSemOrganizacao?: boolean;
};

// A organização de quem entrou (dono e membros, pelo cargo) e, para a equipe GestorGov, as visões da plataforma,
// o trabalho com os agentes e a configuração. Os nomes seguem o segmento (Cidade ou Mapa, Secretaria ou Escritório...).
// Repaginação de 12/11/2026 (telas de referência do dono): Painel e os módulos em cima, a operação no meio, as visões
// ao vivo (outra aba) e a gestão da organização embaixo. Os módulos novos entram "em construção" (sem números).
const secoesDo = (r: Rotulos): Secao[] => [
  {
    titulo: "Gestão",
    icone: Gauge,
    itens: [
      { to: "/", rotulo: "Painel", icone: LayoutDashboard, naOrganizacao: "ver_painel" },
      { to: "/telao", rotulo: "Telão", icone: MonitorPlay, naOrganizacao: "ver_painel", emConstrucao: true },
      { to: "/editais", rotulo: "Editais", icone: Library, naOrganizacao: "ver_painel", emConstrucao: true },
      { to: "/producao", rotulo: "Produção", icone: FilePen, naOrganizacao: "ver_painel", emConstrucao: true },
      { to: "/analises", rotulo: "Análises", icone: ChartColumnBig, naOrganizacao: "ver_painel", emConstrucao: true },
    ],
  },
  {
    titulo: "Operação",
    icone: Briefcase,
    itens: [
      { to: "/agentes", rotulo: "Agentes", icone: Bot, naOrganizacao: "ver_painel" },
      { to: "/cidade", rotulo: "Território", icone: MapPinned, naOrganizacao: "ver_painel" },
      { to: "/aprovacoes", rotulo: "Aprovações", icone: ClipboardCheck, naOrganizacao: "ver_painel" },
      { to: "/auditoria", rotulo: "Auditoria", icone: ScrollText, naOrganizacao: "ver_auditoria", emConstrucao: true },
      { to: "/chat", rotulo: "Chat com os agentes", icone: MessagesSquare, naOrganizacao: "ver_painel" },
    ],
  },
  {
    titulo: "Ao vivo",
    icone: Radio,
    itens: [
      { to: "/secretaria", rotulo: "Central ao vivo", icone: Building2, novaAba: true, naOrganizacao: "ver_painel" },
      { to: "/comando", rotulo: `Mapa da ${r.mapa.toLowerCase()}`, icone: Mapa, novaAba: true, naOrganizacao: "ver_painel" },
    ],
  },
  {
    titulo: r.organizacao,
    icone: Landmark,
    itens: [
      { to: "/processos", rotulo: "Atividades e processos", icone: Workflow, naOrganizacao: "ver_painel" },
      { to: "/cargos", rotulo: "Organograma e cargos", icone: Network, naOrganizacao: "ver_painel" },
      { to: "/equipe", rotulo: "Equipe e acessos", icone: UserCog, naOrganizacao: "gerenciar_equipe" },
      { to: "/integracoes", rotulo: "Integrações", icone: Plug, naOrganizacao: "gerenciar_integracoes" },
      { to: "/implantacao", rotulo: "Implantação", icone: Rocket, naOrganizacao: "gerenciar_cargos" },
    ],
  },
  {
    // Para a equipe GestorGov sem organização: as mesmas visões, sobre a organização padrão do servidor.
    titulo: "Visões",
    icone: LayoutGrid,
    daPlataforma: true,
    soSemOrganizacao: true,
    itens: [
      { to: "/", rotulo: "Painel", icone: LayoutDashboard },
      { to: "/cidade", rotulo: "Território", icone: MapPinned },
      { to: "/secretaria", rotulo: "Central ao vivo", icone: Building2, novaAba: true },
      { to: "/comando", rotulo: `Mapa da ${r.mapa.toLowerCase()}`, icone: Mapa, novaAba: true },
      { to: "/chat", rotulo: "Chat com os agentes", icone: Bot, permissao: "usar_chat" },
    ],
  },
  {
    titulo: "Configuração",
    icone: SlidersHorizontal,
    daPlataforma: true,
    itens: [
      { to: "/fabrica", rotulo: "Fábrica de agentes", icone: Factory, permissao: "editar_agentes" },
      { to: "/base", rotulo: "Conhecimento", icone: BookOpen },
      { to: "/observabilidade", rotulo: "Observabilidade", icone: Activity, permissao: "ver_banco" },
      { to: "/usuarios", rotulo: "Usuários e permissões", icone: UsersRound, permissao: "gerenciar_usuarios" },
    ],
  },
];
const TODOS_OS_ITENS = secoesDo(ROTULOS_SAUDE).flatMap((s) => s.itens);
const FERRAMENTAS = [{ href: "https://os.agno.com", rotulo: "AgentOS (Agno)" }];
const CHAVE = "gestorgov.sidebar.recolhido";
const JANELA_LARGA = "(min-width: 1024px)";

/** A marca do GestorGov: usada também na tela de entrada. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return compact ? <LogoIcone /> : <Logo />;
}

function usarJanelaLarga(): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const q = window.matchMedia(JANELA_LARGA);
      q.addEventListener("change", avisar);
      return () => q.removeEventListener("change", avisar);
    },
    () => window.matchMedia(JANELA_LARGA).matches,
  );
}

function usarCaminho(): string {
  return useRouterState({ select: (s) => s.location.pathname });
}

/** Só um item aceso. As rotas do painel são todas de primeiro nível (sem filhas). */
function usarAtivo() {
  const caminho = usarCaminho().replace(/\/+$/, "") || "/";
  return (item: Item) => (TODOS_OS_ITENS.some((i) => i.to === caminho) ? item.to === caminho : false);
}

export function AppShell({ children }: { children: ReactNode }) {
  const [recolhido, setRecolhido] = useState(() => {
    try {
      return localStorage.getItem(CHAVE) === "true";
    } catch {
      return false;
    }
  });
  const [gaveta, setGaveta] = useState(false);
  const largo = usarJanelaLarga();
  const recolhidoNaTela = recolhido || !largo;
  const caminho = usarCaminho();
  const ativo = usarAtivo();

  useEffect(() => setGaveta(false), [caminho]); // navegar fecha a gaveta

  function alternar() {
    setRecolhido((r) => {
      try {
        localStorage.setItem(CHAVE, String(!r));
      } catch {
        /* sem armazenamento: vale só nesta aba */
      }
      return !r;
    });
  }

  return (
    <div className="bi-shell flex h-svh w-full overflow-hidden bg-background text-foreground">
      {/* Celular: barra fina */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-sidebar-border/70 bg-sidebar/95 px-3 text-sidebar-foreground backdrop-blur-xl md:hidden">
        <Link to="/" aria-label="GestorGov — painel">
          <Logo sobreEscuro />
        </Link>
        <div className="flex items-center gap-1">
          <Sino sobreEscuro />
          <button
            type="button"
            onClick={() => setGaveta(true)}
            aria-label="Abrir menu"
            className="grid size-9 place-items-center rounded-lg transition-colors outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>

      <Gaveta aberta={gaveta} aoFechar={() => setGaveta(false)}>
        <div className="shrink-0 px-3 pt-3">
          <BuscaGeral sobreEscuro />
        </div>
        <Conteudo recolhido={false} ativo={ativo} />
      </Gaveta>

      {/* Telas largas: a coluna do menu, de altura total */}
      <div
        className={cn(
          "relative z-40 hidden shrink-0 transition-[width] duration-200 md:block",
          recolhidoNaTela ? "w-[72px]" : "w-[248px]",
        )}
      >
        <nav
          aria-label="Navegação do painel"
          className="flex h-full flex-col border-r border-sidebar-border/70 bg-sidebar text-sidebar-foreground"
        >
          <div
            className={cn(
              "group/logo flex h-16 shrink-0 items-center",
              recolhidoNaTela ? "justify-center px-1" : "px-4",
            )}
          >
            <Link
              to="/"
              aria-label="GestorGov — painel"
              className="inline-flex rounded-lg p-0.5 transition-transform duration-300 outline-none group-hover/logo:scale-[1.03] focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              {recolhidoNaTela ? <LogoIcone /> : <Logo sobreEscuro />}
            </Link>
          </div>
          <Conteudo recolhido={recolhidoNaTela} ativo={ativo} />
        </nav>

        <button
          type="button"
          onClick={largo ? alternar : () => setGaveta(true)}
          aria-label={!largo ? "Abrir menu" : recolhido ? "Expandir menu" : "Recolher menu"}
          aria-expanded={largo ? !recolhido : gaveta}
          className="absolute top-[52px] -right-3 z-10 hidden size-6 place-items-center rounded-full bg-warning text-warning-foreground shadow-md ring-2 ring-background transition-[filter] outline-none hover:brightness-105 focus-visible:ring-sidebar-ring md:grid"
        >
          {recolhidoNaTela ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
        </button>
      </div>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden pt-14 md:pt-0">
        <div className="aurora-bg" aria-hidden="true" />
        <BarraDoTopo />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}

/* ───────── Barra do topo: a organização e quem está conectado ───────── */

function BarraDoTopo() {
  const acesso = useQuery({ queryKey: ["acesso"], queryFn: () => api<Acesso>("/acesso"), staleTime: Infinity });
  const usuario = acesso.data?.usuario;
  const org = acesso.data?.organizacao;
  const r = useRotulos();
  const nome = usuario?.nome || usuario?.email || "Acesso local";
  const iniciais = nome
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  const { podeVerPainel } = useSecoes();
  const daPlataforma = useDaPlataforma();
  return (
    <div className="relative z-30 hidden h-16 shrink-0 items-center gap-4 border-b border-border bg-card/70 px-6 backdrop-blur-xl md:flex">
      <div className="hidden min-w-0 flex-1 lg:block">
        <p className="truncate text-sm font-semibold">
          {org?.organizacao ? [org.organizacao, [org.cidade, org.uf].filter(Boolean).join("-")].filter(Boolean).join(" · ") : "GestorGov"}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {org ? `${r.organizacao} · ${org.situacao_organizacao === "ativo" ? "implantação concluída" : "implantação em andamento"}` : "Plataforma"}
        </p>
      </div>
      <div className="min-w-0 flex-1 lg:max-w-md">
        <BuscaGeral />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {(podeVerPainel || daPlataforma) && <SeloAoVivo />}
        <Sino />
        <div className="flex items-center gap-2.5 rounded-full border border-border bg-background/60 py-1 pr-1 pl-1 xl:pr-4">
          <span aria-hidden="true" className="relative grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {iniciais || "G"}
            <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-success ring-2 ring-background" />
          </span>
          <span className="hidden min-w-0 flex-col leading-tight xl:flex">
            <span className="max-w-40 truncate text-sm font-semibold">{nome}</span>
            <span className="max-w-40 truncate text-[11px] text-muted-foreground">
              {org ? (org.papel === "dono" ? `Dono da ${r.organizacao_curta}` : org.cargo ?? "Membro") : usuario?.papel ?? "Plataforma"}
            </span>
          </span>
          <span className="sr-only xl:hidden">{nome}</span>
        </div>
      </div>
    </div>
  );
}

/* ───────── Selo "ao vivo": abre a Central ao vivo (o prédio com os agentes) em outra aba ───────── */

function SeloAoVivo() {
  return (
    <a
      href="/painel/secretaria"
      target="_blank"
      rel="noopener"
      title="Abrir a Central ao vivo em outra aba"
      className="inline-flex h-8 items-center gap-2 rounded-full border border-success/35 bg-success/10 px-3 text-xs font-semibold text-success transition-colors outline-none hover:bg-success/16 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden="true" className="pulse-live size-2 rounded-full bg-success" />
      Ao vivo
      <span className="sr-only">(abre a Central ao vivo em outra aba)</span>
    </a>
  );
}

/* ───────── Busca geral: as telas que a pessoa pode abrir (Ctrl+K) ───────── */

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function BuscaGeral({ sobreEscuro = false }: { sobreEscuro?: boolean }) {
  const { secoes } = useSecoes();
  const navegar = useNavigate();
  const [texto, setTexto] = useState("");
  const [aberta, setAberta] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const campo = useRef<HTMLInputElement>(null);
  const caixa = useRef<HTMLDivElement>(null);

  const resultados = useMemo(() => {
    const vistos = new Set<string>();
    const todos: (Item & { secao: string })[] = [];
    for (const s of secoes)
      for (const i of s.itens) {
        if (vistos.has(i.to)) continue;
        vistos.add(i.to);
        todos.push({ ...i, secao: s.titulo });
      }
    const q = semAcento(texto.trim());
    return q ? todos.filter((i) => semAcento(`${i.rotulo} ${i.secao}`).includes(q)) : todos;
  }, [secoes, texto]);

  // Ctrl+K (ou ⌘K) leva à busca de qualquer tela do painel. A da gaveta não escuta: a do topo já escuta.
  useEffect(() => {
    if (sobreEscuro) return;
    function tecla(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        campo.current?.focus();
        setAberta(true);
      }
    }
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [sobreEscuro]);

  useEffect(() => {
    if (!aberta) return;
    function fora(e: PointerEvent) {
      if (!caixa.current?.contains(e.target as Node)) setAberta(false);
    }
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [aberta]);

  useEffect(() => setMarcado(0), [texto]);

  function abrir(item: Item) {
    setAberta(false);
    setTexto("");
    campo.current?.blur();
    if (item.novaAba) window.open(`/painel${item.to}`, "_blank", "noopener");
    else void navegar({ to: item.to });
  }

  const listaId = sobreEscuro ? "busca-geral-gaveta" : "busca-geral";
  const visiveis = resultados.slice(0, 10);
  return (
    <div ref={caixa} className="relative">
      <Search
        aria-hidden="true"
        className={cn("pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2", sobreEscuro ? "text-sidebar-foreground/55" : "text-muted-foreground")}
      />
      <input
        ref={campo}
        type="search"
        role="combobox"
        aria-expanded={aberta}
        aria-controls={listaId}
        aria-autocomplete="list"
        aria-activedescendant={aberta && visiveis[marcado] ? `${listaId}-${marcado}` : undefined}
        aria-label="Buscar no painel"
        placeholder="Buscar no painel"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAberta(true);
        }}
        onFocus={() => setAberta(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setAberta(false);
            return;
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setAberta(true);
            const n = visiveis.length || 1;
            setMarcado((m) => (m + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
          }
          if (e.key === "Enter" && visiveis[marcado]) {
            e.preventDefault();
            abrir(visiveis[marcado]);
          }
        }}
        className={cn(
          "h-9 w-full rounded-lg border pr-14 pl-9 text-sm transition-colors outline-none focus-visible:ring-2 [&::-webkit-search-cancel-button]:hidden",
          sobreEscuro
            ? "border-sidebar-border bg-sidebar-accent/60 text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus-visible:ring-sidebar-ring"
            : "border-border bg-background/60 placeholder:text-muted-foreground focus-visible:ring-ring",
        )}
      />
      {!sobreEscuro && (
        <kbd aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          Ctrl K
        </kbd>
      )}
      {aberta && (
        <ul
          id={listaId}
          role="listbox"
          aria-label="Telas do painel"
          className="thin-scroll absolute inset-x-0 top-full z-50 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95"
        >
          {visiveis.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">Nenhuma tela com esse nome.</li>}
          {visiveis.map((item, i) => {
            const Icone = item.icone;
            return (
              <li
                key={item.to}
                id={`${listaId}-${i}`}
                role="option"
                aria-selected={i === marcado}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => abrir(item)}
                onMouseEnter={() => setMarcado(i)}
                className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm", i === marcado && "bg-secondary")}
              >
                <Icone aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.rotulo}</span>
                <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
                  {item.emConstrucao ? "em breve" : item.novaAba ? "outra aba" : item.secao}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ───────── Sino: o que espera por você (aprovações e, na plataforma, acessos pendentes) ───────── */

function Sino({ sobreEscuro = false }: { sobreEscuro?: boolean }) {
  const { pendentes, aprovacoes, podeVerPainel } = useSecoes();
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const total = aprovacoes + pendentes;
  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-label={total ? `Notificações: ${total} esperando você` : "Notificações"}
        className={cn(
          "relative grid size-9 shrink-0 place-items-center rounded-lg transition-colors outline-none focus-visible:ring-2",
          sobreEscuro
            ? "hover:bg-sidebar-accent focus-visible:ring-sidebar-ring"
            : "border border-border bg-background/60 text-muted-foreground hover:text-foreground focus-visible:ring-ring",
        )}
      >
        <Bell className="size-[18px]" />
        {total > 0 && (
          <span aria-hidden="true" className="num absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[10px] font-bold text-warning-foreground">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>
      <MenuFlutuante aberto={aberto} aoFechar={() => setAberto(false)} ancora={botao} rotulo="Notificações" papel="dialog" abaixo>
        <p className="px-2 py-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Notificações</p>
        <div className="flex flex-col gap-0.5 pb-1">
          {podeVerPainel && (
            <Link
              to="/aprovacoes"
              data-item-menu
              onClick={() => setAberto(false)}
              className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm outline-none hover:bg-secondary focus:bg-secondary"
            >
              <ClipboardCheck aria-hidden="true" className="size-4 shrink-0 text-warning-text" />
              <span className="min-w-0 flex-1">
                {aprovacoes ? `${aprovacoes} ${aprovacoes === 1 ? "tarefa espera" : "tarefas esperam"} a sua decisão` : "Nenhuma tarefa esperando você"}
              </span>
            </Link>
          )}
          {pendentes > 0 && (
            <Link
              to="/usuarios"
              data-item-menu
              onClick={() => setAberto(false)}
              className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm outline-none hover:bg-secondary focus:bg-secondary"
            >
              <UsersRound aria-hidden="true" className="size-4 shrink-0 text-primary-text" />
              <span className="min-w-0 flex-1">
                {pendentes} {pendentes === 1 ? "pessoa espera" : "pessoas esperam"} acesso ao painel
              </span>
            </Link>
          )}
          {!podeVerPainel && pendentes === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">Nada esperando por você agora.</p>}
        </div>
      </MenuFlutuante>
    </>
  );
}

/* ───────── Lista, ferramenta externa e rodapé (os mesmos no cartão e na gaveta) ───────── */

/** As seções e os itens que a pessoa pode usar, com as contagens (Usuários: quantos esperam aprovação; Aprovações:
 * quantas tarefas esperam por ela). O menu, a busca e o sino usam a mesma lista. */
function useSecoes() {
  const acesso = useQuery({ queryKey: ["acesso"], queryFn: () => api<Acesso>("/acesso"), staleTime: Infinity });
  const org = acesso.data?.organizacao;
  const r = useRotulos();
  const pode = usePode();
  const daPlataforma = useDaPlataforma();
  const podeNaOrganizacao = usePodeNaOrganizacao();
  const temOrganizacao = !!org;
  const usuarios = useUsuarios(daPlataforma && pode("gerenciar_usuarios"));
  const pendentes = usuarios.data?.usuarios.filter((u) => u.situacao === "pendente").length ?? 0;
  const aprovacoes = useContagemAprovacoes(temOrganizacao && podeNaOrganizacao("ver_painel"));
  const secoes = secoesDo(r)
    .filter((s) => (s.daPlataforma ? daPlataforma && !(s.soSemOrganizacao && temOrganizacao) : temOrganizacao))
    .map((s) => ({
      ...s,
      itens: s.itens
        .filter((i) => (i.naOrganizacao ? podeNaOrganizacao(i.naOrganizacao) : !i.permissao || pode(i.permissao)))
        .map((i) => (i.to === "/usuarios" ? { ...i, contagem: pendentes } : i.to === "/aprovacoes" ? { ...i, contagem: aprovacoes } : i)),
    }))
    .filter((s) => s.itens.length);
  return { secoes, pendentes, aprovacoes, temOrganizacao, podeVerPainel: temOrganizacao && podeNaOrganizacao("ver_painel") };
}

function Conteudo({ recolhido, ativo }: { recolhido: boolean; ativo: (i: Item) => boolean }) {
  const { theme, toggle } = useTheme();
  const acesso = useQuery({ queryKey: ["acesso"], queryFn: () => api<Acesso>("/acesso"), staleTime: Infinity });
  const usuario = acesso.data?.usuario;
  const org = acesso.data?.organizacao;
  const r = useRotulos();
  const organizacao = org?.organizacao || "GestorGov";
  const quem = usuario?.email ?? (acesso.data?.requer_chave ? "acesso pela chave" : "acesso local, sem login");
  const { secoes } = useSecoes();

  return (
    <>
      <div
        className={cn(
          "scrollbar-none flex flex-1 flex-col overflow-y-auto py-3",
          recolhido ? "gap-1.5 px-2" : "gap-3 px-2",
        )}
      >
        {secoes.map((secao, i) => (
          <SecaoDoMenu key={secao.titulo} secao={secao} ativo={ativo} recolhido={recolhido} primeira={i === 0} />
        ))}

        <div className={cn("mt-2 flex flex-col gap-0.5 pt-2", recolhido ? "items-center" : "border-t border-sidebar-border/70")}>
          {FERRAMENTAS.map((f) => (
            <a
              key={f.href}
              href={f.href}
              target="_blank"
              rel="noreferrer"
              title={recolhido ? f.rotulo : undefined}
              className={cn(
                "group/item flex h-10 items-center rounded-xl text-sm font-medium text-sidebar-foreground/70 transition-all outline-none hover:bg-sidebar-accent hover:text-white focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                recolhido ? "w-10 justify-center px-0" : "gap-3 px-3",
              )}
            >
              <ExternalLink className="size-[18px] shrink-0 text-sidebar-foreground/55 transition-transform duration-200 group-hover/item:scale-110 group-hover/item:text-white" />
              {!recolhido && <span className="truncate">{f.rotulo}</span>}
            </a>
          ))}
        </div>
      </div>

      {/* Rodapé: quem está conectado, tema, ajuda e sair */}
      <div className={cn("flex shrink-0 flex-col gap-2 border-t border-sidebar-border/70 p-2", recolhido && "items-center")}>
        <div
          className={cn(
            "group/user flex min-w-0 items-center rounded-xl transition-colors",
            recolhido ? "justify-center p-1" : "gap-2.5 p-2 hover:bg-sidebar-accent",
          )}
          title={recolhido ? quem : undefined}
        >
          <span
            aria-hidden="true"
            className="bg-gradient-brand grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white shadow-[0_6px_16px_-8px_color-mix(in_oklab,var(--color-primary)_70%,transparent)]"
          >
            {(usuario?.nome || organizacao).charAt(0).toUpperCase()}
          </span>
          {!recolhido && (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-xs font-semibold text-white">{usuario?.nome || organizacao}</span>
              <span className="truncate text-[10px] text-sidebar-foreground/60">
                {org ? (org.papel === "dono" ? `Dono da ${r.organizacao_curta}` : org.cargo ?? "Sem cargo") : quem}
              </span>
            </span>
          )}
        </div>

        <div className={cn("flex items-center gap-1.5", recolhido && "flex-col")}>
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
            title={theme === "dark" ? "Tema claro" : "Tema escuro"}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/50 text-xs font-medium text-sidebar-foreground/75 transition-colors outline-none hover:border-sidebar-ring/60 hover:text-white focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              recolhido ? "size-9 justify-center" : "flex-1 justify-start px-3",
            )}
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {/* O rótulo diz para onde o clique leva. */}
            {!recolhido && <span>{theme === "dark" ? "Tema claro" : "Tema escuro"}</span>}
          </button>
          <BotaoAjuda />
          {acesso.data?.requer_chave && (
            <button
              type="button"
              onClick={sair}
              aria-label="Sair"
              title="Sair"
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground/75 transition-colors outline-none hover:border-destructive/40 hover:bg-destructive/20 hover:text-white focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <LogOut className="size-4" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/* ───────── Seção aberta: título azul em caixa alta, recolhível ───────── */

function SecaoDoMenu({
  secao,
  ativo,
  recolhido,
  primeira = false,
}: {
  secao: Secao;
  ativo: (i: Item) => boolean;
  recolhido: boolean;
  primeira?: boolean;
}) {
  const temAtivo = secao.itens.some(ativo);
  const [aberta, setAberta] = useState(true);
  useEffect(() => {
    if (temAtivo) setAberta(true); // a seção do item ativo nunca fica fechada
  }, [temAtivo]);

  if (recolhido) return <SecaoRecolhida secao={secao} ativo={ativo} temAtivo={temAtivo} />;

  return (
    <div className={cn(!primeira && "mt-1")}>
      <button
        type="button"
        onClick={() => setAberta((a) => !a)}
        aria-expanded={aberta}
        title={`${aberta ? "Recolher" : "Expandir"} ${secao.titulo}`}
        className="flex w-full items-center justify-between rounded-md px-3 pt-1 pb-1.5 text-left text-[10px] font-bold tracking-[0.18em] text-sidebar-foreground/45 uppercase transition-colors outline-none hover:text-sidebar-foreground/80 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <span className="flex-1 text-left">{secao.titulo}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 transition-transform duration-300", aberta ? "" : "-rotate-90")}
        />
      </button>
      <div className={cn("grid transition-[grid-template-rows] duration-300 ease-in-out", aberta ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className="flex flex-col gap-0.5">
            {secao.itens.map((item) => (
              <ItemMenu key={item.to} item={item} ativo={ativo(item)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Item do menu: h-10, ícone de 18px que cresce no hover; o ativo é uma pílula azul (como nas referências).
const ITEM_BASE =
  "group/item relative flex h-10 items-center justify-start gap-3 overflow-hidden rounded-xl px-3 text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";
const ITEM_INATIVO = "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-white";
const ITEM_ATIVO = "bg-primary font-semibold text-white shadow-[0_10px_24px_-10px_rgba(26,99,216,0.9)]";

function IconeDoItem({ icone: Icone, ativo }: { icone: Item["icone"]; ativo: boolean }) {
  return (
    <Icone
      className={cn(
        "size-[18px] shrink-0 transition-transform duration-200 group-hover/item:scale-110",
        ativo ? "text-white" : "text-sidebar-foreground/55 group-hover/item:text-white",
      )}
    />
  );
}

function ItemMenu({ item, ativo }: { item: Item; ativo: boolean }) {
  if (item.novaAba) {
    return (
      <a
        href={`/painel${item.to}`}
        target="_blank"
        rel="noopener"
        title={`${item.rotulo} (abre em outra aba)`}
        className={cn(ITEM_BASE, ITEM_INATIVO)}
      >
        <IconeDoItem icone={item.icone} ativo={false} />
        <span className="truncate">{item.rotulo}</span>
        <ExternalLink className="ml-auto size-3.5 shrink-0 opacity-50" />
      </a>
    );
  }
  return (
    <Link to={item.to} aria-current={ativo ? "page" : undefined} className={cn(ITEM_BASE, ativo ? ITEM_ATIVO : ITEM_INATIVO)}>
      <IconeDoItem icone={item.icone} ativo={ativo} />
      <span className="truncate">{item.rotulo}</span>
      {item.emConstrucao && (
        <span
          title="Em construção"
          className={cn(
            "ml-auto shrink-0 rounded px-1.5 py-px text-[10px] font-semibold",
            ativo ? "bg-white/20 text-white" : "bg-sidebar-accent text-sidebar-foreground/60",
          )}
        >
          em breve
        </span>
      )}
      {!!item.contagem && (
        <span title="Esperando aprovação" className="num ml-auto rounded-md bg-warning px-1.5 text-[11px] font-semibold text-warning-foreground">
          {item.contagem}
        </span>
      )}
    </Link>
  );
}

/* ───────── Seção recolhida: um ícone que abre a lista ao lado ───────── */

function SecaoRecolhida({ secao, ativo, temAtivo }: { secao: Secao; ativo: (i: Item) => boolean; temAtivo: boolean }) {
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const Icone = secao.icone;
  return (
    <div className="flex justify-center">
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={secao.titulo}
        title={secao.titulo}
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-lg transition-all outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          temAtivo
            ? "bg-primary text-white"
            : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-white",
          aberto && !temAtivo && "bg-sidebar-accent text-white",
        )}
      >
        <Icone className="size-5 shrink-0" />
      </button>
      <MenuFlutuante aberto={aberto} aoFechar={() => setAberto(false)} ancora={botao} rotulo={secao.titulo}>
        <p className="px-2 py-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{secao.titulo}</p>
        {secao.itens.map((item) => {
          const IconeItem = item.icone;
          if (item.novaAba) {
            return (
              <a
                key={item.to}
                href={`/painel${item.to}`}
                target="_blank"
                rel="noopener"
                role="menuitem"
                data-item-menu
                onClick={() => setAberto(false)}
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors outline-none hover:bg-secondary focus:bg-secondary"
              >
                <IconeItem className="size-4 shrink-0" />
                <span className="truncate">{item.rotulo}</span>
                <ExternalLink className="ml-auto size-3 shrink-0 opacity-60" />
              </a>
            );
          }
          return (
            <Link
              key={item.to}
              to={item.to}
              role="menuitem"
              data-item-menu
              onClick={() => setAberto(false)}
              aria-current={ativo(item) ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors outline-none hover:bg-secondary focus:bg-secondary",
                ativo(item) && "font-medium text-sidebar-primary",
              )}
            >
              <IconeItem className="size-4 shrink-0" />
              <span className="truncate">{item.rotulo}</span>
              {item.emConstrucao && <span className="ml-auto text-2xs text-muted-foreground">em breve</span>}
            </Link>
          );
        })}
      </MenuFlutuante>
    </div>
  );
}

/* ───────── Menu suspenso ancorado (sem biblioteca): Esc, clique fora e setas ───────── */

function MenuFlutuante({
  aberto,
  aoFechar,
  ancora,
  rotulo,
  papel = "menu",
  abaixo = false,
  children,
}: {
  aberto: boolean;
  aoFechar: () => void;
  ancora: RefObject<HTMLElement | null>;
  rotulo: string;
  papel?: "menu" | "dialog";
  /** Abre embaixo da âncora, alinhado à direita (barra do topo); sem isso, ao lado (menu lateral). */
  abaixo?: boolean;
  children: ReactNode;
}) {
  const painel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Quem chama passa uma função nova a cada render; a referência evita reabrir o efeito (e roubar o foco).
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  useEffect(() => {
    if (!aberto) {
      setPos(null);
      return;
    }
    function posicionar() {
      const r = ancora.current?.getBoundingClientRect();
      const caixa = painel.current;
      if (!r || !caixa) return;
      const largura = caixa.offsetWidth;
      const altura = caixa.offsetHeight;
      if (abaixo) {
        setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - largura, window.innerWidth - largura - 8)) });
        return;
      }
      const top = Math.max(8, Math.min(r.top, window.innerHeight - altura - 8));
      const left = r.right + 8 + largura <= window.innerWidth - 8 ? r.right + 8 : Math.max(8, r.left - largura - 8);
      setPos({ top, left });
    }
    posicionar();
    const primeiro = painel.current?.querySelector<HTMLElement>("[data-item-menu]");
    (primeiro ?? painel.current)?.focus();
    function fora(e: PointerEvent) {
      const alvo = e.target as Node;
      if (!painel.current?.contains(alvo) && !ancora.current?.contains(alvo)) fechar.current();
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") {
        fechar.current();
        ancora.current?.focus();
        return;
      }
      const itens = [...(painel.current?.querySelectorAll<HTMLElement>("[data-item-menu]") ?? [])];
      if (!itens.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const atual = itens.indexOf(document.activeElement as HTMLElement);
      const proximo =
        e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (atual + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
      itens[proximo].focus();
    }
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto, ancora, abaixo]);

  if (!aberto) return null;
  // No <body>: dentro da barra do topo (que tem backdrop-filter), `position: fixed` seria relativo a ela.
  return createPortal(
    <div
      ref={painel}
      role={papel}
      aria-label={rotulo}
      tabIndex={-1}
      style={pos ?? undefined}
      className={cn(
        "fixed z-50 w-64 max-w-[calc(100vw-16px)] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none animate-in fade-in-0 zoom-in-95",
        pos ? "visible" : "invisible",
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ───────── Ajuda sobre o menu (e qual agente e modelo estão no ar) ───────── */

function BotaoAjuda() {
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const config = useQuery({ queryKey: ["config"], queryFn: () => api<Config>("/config"), staleTime: 5 * 60_000 });
  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-label="Ajuda sobre o menu"
        title="Ajuda sobre o menu"
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl border border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground/75 transition-colors outline-none hover:border-sidebar-ring/60 hover:text-white focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          aberto && "border-sidebar-ring/60 text-white",
        )}
      >
        <CircleHelp className="size-4" />
      </button>
      <MenuFlutuante aberto={aberto} aoFechar={() => setAberto(false)} ancora={botao} rotulo="Ajuda sobre o menu" papel="dialog">
        <p className="px-2 py-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Como usar o menu</p>
        <ul className="space-y-1.5 px-2 pt-1 pb-2 text-xs leading-relaxed">
          <li>O botão amarelo na borda recolhe o menu e deixa só os ícones; a escolha fica gravada neste navegador.</li>
          <li>Recolhido, cada ícone é uma seção: clique para ver as telas dela.</li>
          <li>Aberto, clique no título de uma seção para recolhê-la.</li>
          <li>O botão de tema diz para qual tema ele leva.</li>
        </ul>
        {config.data && (
          <p className="border-t border-border px-2 pt-2 pb-1 text-xs text-muted-foreground">
            <span className="mr-1 inline-block size-1.5 rounded-full bg-success align-middle" />
            {config.data.agente} · <span className="num">{config.data.modelo}</span> · raciocínio {config.data.raciocinio}
          </p>
        )}
      </MenuFlutuante>
    </>
  );
}

/* ───────── Gaveta (celular e tablet): a mesma lista, deslizando da esquerda ───────── */

function Gaveta({ aberta, aoFechar, children }: { aberta: boolean; aoFechar: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!aberta) return;
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [aberta, aoFechar]);
  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navegação">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px] animate-in fade-in-0" onClick={aoFechar} />
      <div className="absolute inset-y-0 left-0 flex w-full flex-col border-r border-border bg-sidebar text-sidebar-foreground shadow-xl animate-in slide-in-from-left sm:max-w-sm">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
          <Logo sobreEscuro />
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar menu"
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
