import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  Command,
  Eye,
  EyeOff,
  LayoutDashboard,
  MapPin,
  MessagesSquare,
  Search,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAcesso } from "@/hooks/use-permissoes";
import { cn } from "@/lib/utils";
import { SimboloGestorGov } from "@/components/layout/logo";
import { MapaCidade, type UnidadeNoMapa } from "@/components/mapa/mapa-cidade";
import { Janela, type Geometria } from "@/components/comando/janela";
import { Slideover } from "@/components/comando/slideover";
import { Paleta, type Comando } from "@/components/comando/paleta";
import { FichaUnidade, type UnidadeSaude } from "@/components/unidades/ficha-unidade";
import { GerenciarUnidades } from "@/components/unidades/gerenciar-unidades";

/*
 * Central de comando do GestorGov: o mapa da cidade com as unidades de saúde, em tela inteira, e, por cima, janelas flutuantes (arrastar,
 * redimensionar, minimizar), slide-overs para ver e editar sem sair, a paleta de comandos (Ctrl+K) e o modo foco
 * (F), que esconde tudo e deixa só o mapa. As janelas abertas ficam guardadas neste navegador.
 */

interface TipoUnidade {
  id: string;
  nome: string;
  cor: string | null;
  ordem: number | null;
}
type Unidade = UnidadeSaude;
interface Panorama {
  municipio: { nome: string; uf: string; latitude: string | number | null; longitude: string | number | null; situacao: string | null } | null;
  unidades?: Unidade[];
}

type Painel = "unidades" | "alertas";
type Detalhe = { tipo: "unidade"; id: string } | null;

const PAINEIS: Record<Painel, { titulo: string; icone: ComponentType<{ className?: string }>; padrao: Geometria }> = {
  unidades: { titulo: "Unidades de saúde", icone: MapPin, padrao: { x: 24, y: 96, w: 340, h: 460 } },
  alertas: { titulo: "Alertas das unidades", icone: Bell, padrao: { x: 380, y: 96, w: 340, h: 300 } },
}

function lerAbertos(): Painel[] {
  try {
    const salvo = JSON.parse(localStorage.getItem("gestorgov.comando.abertos") ?? "null");
    if (Array.isArray(salvo)) return salvo.filter((p): p is Painel => p in PAINEIS);
  } catch {
    /* sem armazenamento */
  }
  return ["unidades"];
}

export function CentralDeComando() {
  const navegar = useNavigate();
  const acesso = useAcesso().data;
  const token = acesso?.mapbox_token;
  const daPrefeitura = !!acesso?.prefeitura;
  const panorama = useQuery({
    queryKey: ["gestao-panorama", daPrefeitura],
    queryFn: () => api<Panorama>(daPrefeitura ? "/prefeitura/panorama" : "/gestao/panorama"),
  });
  const catalogo = useQuery({
    queryKey: ["gestao-catalogo"],
    queryFn: () => api<{ tipos_unidade: TipoUnidade[] }>("/implantacao/catalogo"),
    staleTime: Infinity,
  });
  // Os alertas dos cargos (metas, entregas e pendências) entram com a fila de aprovações do CompanyOS.
  const alertas: { nivel: "alto" | "medio" | "baixo"; texto: string }[] = [];

  const [abertos, setAbertos] = useState<Painel[]>(lerAbertos);
  const [foco, setFoco] = useState(false);
  const [paleta, setPaleta] = useState(false);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Detalhe>(null);
  const [conferir, setConferir] = useState(false);

  useEffect(() => {
    document.title = "Cidade · GestorGov";
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("gestorgov.comando.abertos", JSON.stringify(abertos));
    } catch {
      /* noop */
    }
  }, [abertos]);

  const alternar = useCallback((p: Painel) => setAbertos((a) => (a.includes(p) ? a.filter((x) => x !== p) : [...a, p])), []);
  const abrir = useCallback((p: Painel) => setAbertos((a) => (a.includes(p) ? a : [...a, p])), []);

  // Atalhos: Ctrl/⌘+K abre a paleta; F liga e desliga o modo foco (fora de campos de texto).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const digitando = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaleta((p) => !p);
      } else if (!digitando && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "f") {
        setFoco((f) => !f);
      }
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, []);

  const tipos = useMemo(() => new Map((catalogo.data?.tipos_unidade ?? []).map((t) => [t.id, t])), [catalogo.data]);
  const mun = panorama.data?.municipio;
  const unidades = useMemo(() => panorama.data?.unidades ?? [], [panorama.data]);
  const noMapa: UnidadeNoMapa[] = useMemo(
    () =>
      unidades
        .filter((u) => u.latitude != null && u.longitude != null)
        .map((u) => ({
          id: u.id,
          nome: u.nome_fantasia || u.nome,
          tipo: u.tipo_id ?? "outro",
          cor: tipos.get(u.tipo_id ?? "")?.cor ?? "#424E6B",
          latitude: Number(u.latitude),
          longitude: Number(u.longitude),
        })),
    [unidades, tipos],
  );

  const verUnidade = useCallback((id: string) => {
    setSelecionada(id);
    setDetalhe({ tipo: "unidade", id });
  }, []);

  const comandos: Comando[] = useMemo(
    () => [
      ...(Object.keys(PAINEIS) as Painel[]).map((p) => ({
        id: `painel-${p}`,
        titulo: `${abertos.includes(p) ? "Fechar" : "Abrir"} ${PAINEIS[p].titulo}`,
        grupo: "Janelas",
        icone: PAINEIS[p].icone,
        executar: () => alternar(p),
      })),
      { id: "conferir", titulo: "Conferir e cadastrar unidades", grupo: "Unidades", icone: MapPin, executar: () => setConferir(true) },
      { id: "foco", titulo: foco ? "Sair do modo foco" : "Modo foco (esconder tudo)", grupo: "Tela", icone: foco ? Eye : EyeOff, dica: "F", executar: () => setFoco((f) => !f) },
      ...unidades.map((u) => ({
        id: `unidade-${u.id}`,
        titulo: u.nome_fantasia || u.nome,
        grupo: "Unidades",
        icone: MapPin,
        dica: tipos.get(u.tipo_id ?? "")?.nome,
        executar: () => verUnidade(u.id),
      })),
      { id: "secretaria", titulo: "Abrir a Secretaria virtual (setores e agentes)", grupo: "Navegar", icone: Building2, executar: () => navegar({ to: "/secretaria" }) },
      { id: "painel", titulo: "Ir para o Painel", grupo: "Navegar", icone: LayoutDashboard, executar: () => navegar({ to: "/" }) },
      { id: "chat", titulo: "Conversar com os agentes", grupo: "Navegar", icone: MessagesSquare, executar: () => navegar({ to: "/chat" }) },
    ],
    [abertos, alternar, foco, unidades, tipos, verUnidade, navegar],
  );

  const centro = mun?.latitude != null && mun?.longitude != null ? ([Number(mun.latitude), Number(mun.longitude)] as [number, number]) : null;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0D1B38] text-foreground">
      {/* Base: o mapa da cidade */}
      {token ? (
        <MapaCidade
          token={token}
          unidades={noMapa}
          centro={centro}
          selecionada={selecionada}
          aoSelecionar={verUnidade}
          satelite
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-sm text-white/70">
          Defina o MAPBOX_TOKEN no servidor para ver o mapa da cidade.
        </div>
      )}

      {!foco && (
        <>
          {/* Barra flutuante */}
          <nav
            aria-label="Cidade"
            className="absolute top-4 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-[#0D1B38]/85 p-1.5 pl-3 text-white shadow-[0_18px_50px_-15px_rgba(0,0,0,0.6)] backdrop-blur-md"
          >
            <Link to="/" aria-label="Voltar ao painel" className="flex items-center gap-2 rounded-full pr-2 outline-none focus-visible:ring-2 focus-visible:ring-white">
              <SimboloGestorGov sobreEscuro className="size-7" />
              <span className="hidden flex-col leading-tight sm:flex">
                <span className="text-sm font-bold">Cidade</span>
                <span className="text-[10px] text-white/60">{mun ? `${mun.nome}-${mun.uf}` : "GestorGov"}</span>
              </span>
            </Link>
            <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
            {(Object.keys(PAINEIS) as Painel[]).map((p) => {
              const { titulo, icone: Icone } = PAINEIS[p];
              const aberto = abertos.includes(p);
              const n = p === "alertas" ? alertas.length : 0;
              return (
                <BotaoBarra key={p} rotulo={titulo} ativo={aberto} onClick={() => alternar(p)}>
                  <Icone className="size-4" />
                  {n > 0 && <span className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-[#F4B800] text-[9px] font-bold text-[#0D1B38]">{n}</span>}
                </BotaoBarra>
              );
            })}
            <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
            <Link
              to="/secretaria"
              className="flex h-9 items-center gap-2 rounded-full bg-white/10 px-3 text-xs text-white/85 outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white"
            >
              <Building2 className="size-3.5" /> Secretaria virtual
            </Link>
            <button
              type="button"
              onClick={() => setPaleta(true)}
              className="hidden h-9 items-center gap-2 rounded-full bg-white/10 px-3 text-xs text-white/80 outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white md:flex"
            >
              <Search className="size-3.5" /> Comandos
              <kbd className="flex items-center gap-0.5 rounded bg-white/10 px-1 text-[10px]">
                <Command className="size-2.5" />K
              </kbd>
            </button>
            <BotaoBarra rotulo="Modo foco (F)" onClick={() => setFoco(true)}>
              <EyeOff className="size-4" />
            </BotaoBarra>
          </nav>

          {/* Legenda dos tipos */}
          <div className="absolute bottom-6 left-4 z-[90] hidden max-w-[60vw] flex-wrap gap-1.5 rounded-2xl bg-[#0D1B38]/80 p-2 text-[11px] text-white backdrop-blur-md md:flex">
            {[...new Set(noMapa.map((u) => u.tipo))].map((t) => (
              <span key={t} className="flex items-center gap-1.5 rounded-full bg-white/8 px-2 py-1">
                <span className="size-2 rounded-full" style={{ background: tipos.get(t)?.cor ?? "#424E6B" }} />
                {tipos.get(t)?.nome ?? t}
              </span>
            ))}
          </div>

          {/* Janelas */}
          {abertos.includes("unidades") && (
            <Janela
              id="unidades"
              titulo={PAINEIS.unidades.titulo}
              icone={MapPin}
              padrao={PAINEIS.unidades.padrao}
              aoFechar={() => alternar("unidades")}
              acoes={
                <button
                  type="button"
                  onClick={() => setConferir(true)}
                  className="rounded-md px-2 py-1 text-xs font-medium text-primary-text hover:bg-primary/10"
                >
                  Conferir e cadastrar
                </button>
              }
            >
              <ListaUnidades unidades={unidades} tipos={tipos} selecionada={selecionada} aoEscolher={verUnidade} />
            </Janela>
          )}
          {abertos.includes("alertas") && (
            <Janela id="alertas" titulo={PAINEIS.alertas.titulo} icone={Bell} padrao={PAINEIS.alertas.padrao} aoFechar={() => alternar("alertas")}>
              <ul className="divide-y divide-border">
                {alertas.map((a, i) => (
                  <li key={i} className="px-4 py-2.5 text-sm">
                    <span className={cn("mr-2 inline-block size-2 rounded-full", a.nivel === "alto" ? "bg-destructive" : a.nivel === "medio" ? "bg-warning" : "bg-muted-foreground")} />
                    {a.texto}
                  </li>
                ))}
                {!alertas.length && <Vazio>Nenhum alerta agora. Os alertas de metas, entregas e pendências chegam com o Painel de gestão.</Vazio>}
              </ul>
            </Janela>
          )}
        </>
      )}

      {foco && (
        <button
          type="button"
          onClick={() => setFoco(false)}
          className="absolute bottom-6 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#0D1B38]/70 px-4 py-2 text-xs text-white/85 backdrop-blur-md hover:bg-[#0D1B38]/90"
        >
          <Eye className="size-3.5" /> Sair do modo foco (F)
        </button>
      )}

      {detalhe?.tipo === "unidade" && (
        <DetalheUnidade
          unidade={unidades.find((u) => u.id === detalhe.id)}
          tipo={tipos.get(unidades.find((u) => u.id === detalhe.id)?.tipo_id ?? "")}
          tipos={[...tipos.values()]}
          aoFechar={() => setDetalhe(null)}
        />
      )}
      {conferir && (
        <Slideover titulo="Unidades de saúde" subtitulo="Conferência e cadastro pela secretaria" aoFechar={() => setConferir(false)}>
          <GerenciarUnidades />
        </Slideover>
      )}
      {paleta && <Paleta comandos={comandos} aoFechar={() => setPaleta(false)} />}
      {/* abrir() fica disponível para os próximos painéis (fluxos, tarefas) abrirem uns aos outros */}
      <span hidden data-abrir={typeof abrir} />
    </div>
  );
}

function BotaoBarra({ rotulo, ativo, onClick, children }: { rotulo: string; ativo?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      aria-pressed={ativo}
      title={rotulo}
      className={cn(
        "relative grid size-9 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white",
        ativo ? "bg-[#1A63D8] text-white" : "text-white/75 hover:bg-white/10 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <li className="px-4 py-6 text-center text-xs text-muted-foreground">{children}</li>;
}

function ListaUnidades({
  unidades,
  tipos,
  selecionada,
  aoEscolher,
}: {
  unidades: Unidade[];
  tipos: Map<string, TipoUnidade>;
  selecionada: string | null;
  aoEscolher: (id: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const termo = busca.trim().toLowerCase();
  const lista = unidades
    .filter((u) => !termo || `${u.nome_fantasia ?? ""} ${u.nome} ${u.bairro ?? ""}`.toLowerCase().includes(termo))
    .sort((a, b) => (tipos.get(a.tipo_id ?? "")?.ordem ?? 99) - (tipos.get(b.tipo_id ?? "")?.ordem ?? 99));
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-border bg-card p-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar unidade ou bairro"
          aria-label="Buscar unidade ou bairro"
          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <ul className="divide-y divide-border">
        {lista.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              onClick={() => aoEscolher(u.id)}
              className={cn("flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/50", u.id === selecionada && "bg-primary/10")}
            >
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: tipos.get(u.tipo_id ?? "")?.cor ?? "#424E6B" }} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{u.nome_fantasia || u.nome}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {tipos.get(u.tipo_id ?? "")?.nome ?? "Unidade"} · {u.bairro ?? "sem bairro"}
                </span>
              </span>
            </button>
          </li>
        ))}
        {lista.length === 0 && <Vazio>Nenhuma unidade com "{busca}".</Vazio>}
      </ul>
    </div>
  );
}

function DetalheUnidade({ unidade, tipo, tipos, aoFechar }: { unidade?: Unidade; tipo?: TipoUnidade; tipos: TipoUnidade[]; aoFechar: () => void }) {
  const qc = useQueryClient();
  if (!unidade) return null;
  return (
    <Slideover
      titulo={unidade.nome_fantasia || unidade.nome}
      subtitulo={
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: tipo?.cor ?? "#424E6B" }} />
          {tipo?.nome ?? "Unidade de saúde"}
        </span>
      }
      aoFechar={aoFechar}
    >
      <FichaUnidade unidade={unidade} tipos={tipos} aoMudar={() => qc.invalidateQueries({ queryKey: ["gestao-panorama"] })} />
    </Slideover>
  );
}
