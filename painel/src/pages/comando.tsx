import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Bot,
  Building2,
  Command,
  Eye,
  EyeOff,
  LayoutDashboard,
  Moon,
  MapPin,
  MessagesSquare,
  Search,
  Sun,
  Sunset,
  Users,
} from "lucide-react";
import { api, type AgentePainel } from "@/lib/api";
import { useAcesso } from "@/hooks/use-permissoes";
import { cn } from "@/lib/utils";
import { SimboloGestorGov } from "@/components/layout/logo";
import { MapaCidade, type UnidadeNoMapa } from "@/components/mapa/mapa-cidade";
import { Janela, type Geometria } from "@/components/comando/janela";
import { Slideover } from "@/components/comando/slideover";
import { Paleta, type Comando } from "@/components/comando/paleta";

/*
 * Central de comando do GestorGov: o mapa da cidade em tela inteira e, por cima, janelas flutuantes (arrastar,
 * redimensionar, minimizar), slide-overs para ver e editar sem sair, a paleta de comandos (Ctrl+K) e o modo foco
 * (F), que esconde tudo e deixa só o mapa. As janelas abertas ficam guardadas neste navegador.
 */

interface TipoUnidade {
  id: string;
  nome: string;
  cor: string | null;
  ordem: number | null;
}
interface Unidade {
  id: string;
  tipo_id: string | null;
  cnes: string | null;
  nome: string;
  nome_fantasia: string | null;
  endereco: string | null;
  bairro: string | null;
  telefone: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  gestao: string | null;
  confirmada: boolean | null;
}
interface Atividade {
  id: string;
  nome: string;
  descricao: string;
  tipo: "rotina" | "sob_demanda";
  frequencia: string;
  entregavel: string | null;
}
interface Setor {
  id: string;
  nome: string;
  descricao: string | null;
  responsavel: { nome: string; email: string; cargo: string | null } | null;
  atividades: Atividade[];
  agentes: { agente_id: string }[];
}
interface Panorama {
  municipio: { nome: string; uf: string; latitude: string | number | null; longitude: string | number | null; situacao: string | null } | null;
  setores?: Setor[];
  unidades?: Unidade[];
}

type Painel = "unidades" | "setores" | "agentes" | "alertas";
type Detalhe = { tipo: "unidade" | "setor" | "agente"; id: string } | null;

const PAINEIS: Record<Painel, { titulo: string; icone: ComponentType<{ className?: string }>; padrao: Geometria }> = {
  unidades: { titulo: "Unidades de saúde", icone: MapPin, padrao: { x: 24, y: 96, w: 340, h: 460 } },
  setores: { titulo: "Setores da Secretaria", icone: Building2, padrao: { x: 380, y: 96, w: 360, h: 420 } },
  agentes: { titulo: "Agentes de IA", icone: Bot, padrao: { x: 24, y: 580, w: 340, h: 300 } },
  alertas: { titulo: "Alertas", icone: Bell, padrao: { x: 760, y: 96, w: 340, h: 300 } },
}
const FREQUENCIA: Record<string, string> = {
  a_cada_hora: "a cada hora",
  diaria: "diária",
  semanal: "semanal",
  mensal: "mensal",
  sob_demanda: "sob demanda",
};
const VINCULO: Record<string, string> = { publica: "Pública (municipal)", conveniada: "Conveniada ao SUS" };
const LUZES = [
  { id: "day", rotulo: "Dia", icone: Sun },
  { id: "dusk", rotulo: "Entardecer", icone: Sunset },
  { id: "night", rotulo: "Noite", icone: Moon },
] as const;

function lerAbertos(): Painel[] {
  try {
    const salvo = JSON.parse(localStorage.getItem("gestorgov.comando.abertos") ?? "null");
    if (Array.isArray(salvo)) return salvo.filter((p): p is Painel => p in PAINEIS);
  } catch {
    /* sem armazenamento */
  }
  return ["unidades", "setores"];
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
  const agentes = useQuery({ queryKey: ["agentes-visiveis"], queryFn: () => api<{ agentes: AgentePainel[] }>("/agentes"), staleTime: 60_000 });
  // Os alertas dos cargos (metas, entregas e pendências) entram com a fila de aprovações do CompanyOS.
  const alertas: { nivel: "alto" | "medio" | "baixo"; texto: string }[] = [];

  const [abertos, setAbertos] = useState<Painel[]>(lerAbertos);
  const [foco, setFoco] = useState(false);
  const [paleta, setPaleta] = useState(false);
  const [luz, setLuz] = useState<"day" | "dusk" | "night">("dusk");
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Detalhe>(null);

  useEffect(() => {
    document.title = "Central de comando · GestorGov";
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
  const setores = panorama.data?.setores ?? [];
  const listaAgentes = agentes.data?.agentes ?? [];
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
      { id: "foco", titulo: foco ? "Sair do modo foco" : "Modo foco (esconder tudo)", grupo: "Tela", icone: foco ? Eye : EyeOff, dica: "F", executar: () => setFoco((f) => !f) },
      ...LUZES.map((l) => ({ id: `luz-${l.id}`, titulo: `Mapa: ${l.rotulo.toLowerCase()}`, grupo: "Tela", icone: l.icone, executar: () => setLuz(l.id) })),
      ...unidades.map((u) => ({
        id: `unidade-${u.id}`,
        titulo: u.nome_fantasia || u.nome,
        grupo: "Unidades",
        icone: MapPin,
        dica: tipos.get(u.tipo_id ?? "")?.nome,
        executar: () => verUnidade(u.id),
      })),
      ...setores.map((s) => ({
        id: `setor-${s.id}`,
        titulo: s.nome,
        grupo: "Setores",
        icone: Building2,
        dica: s.responsavel?.nome,
        executar: () => setDetalhe({ tipo: "setor", id: s.id }),
      })),
      ...listaAgentes.map((a) => ({
        id: `agente-${a.id}`,
        titulo: a.nome,
        grupo: "Agentes",
        icone: Bot,
        dica: "conversar",
        executar: () => setDetalhe({ tipo: "agente", id: a.id }),
      })),
      { id: "painel", titulo: "Ir para o Painel", grupo: "Navegar", icone: LayoutDashboard, executar: () => navegar({ to: "/" }) },
      { id: "chat", titulo: "Conversar com os agentes", grupo: "Navegar", icone: MessagesSquare, executar: () => navegar({ to: "/chat" }) },
    ],
    [abertos, alternar, foco, unidades, setores, listaAgentes, tipos, verUnidade, navegar],
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
          imersivo
          luz={luz}
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
            aria-label="Central de comando"
            className="absolute top-4 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-[#0D1B38]/85 p-1.5 pl-3 text-white shadow-[0_18px_50px_-15px_rgba(0,0,0,0.6)] backdrop-blur-md"
          >
            <Link to="/" aria-label="Voltar ao painel" className="flex items-center gap-2 rounded-full pr-2 outline-none focus-visible:ring-2 focus-visible:ring-white">
              <SimboloGestorGov sobreEscuro className="size-7" />
              <span className="hidden flex-col leading-tight sm:flex">
                <span className="text-sm font-bold">Central de comando</span>
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
            {LUZES.map((l) => (
              <BotaoBarra key={l.id} rotulo={`Mapa: ${l.rotulo.toLowerCase()}`} ativo={luz === l.id} onClick={() => setLuz(l.id)}>
                <l.icone className="size-4" />
              </BotaoBarra>
            ))}
            <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
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
            <Janela id="unidades" titulo={PAINEIS.unidades.titulo} icone={MapPin} padrao={PAINEIS.unidades.padrao} aoFechar={() => alternar("unidades")}>
              <ListaUnidades unidades={unidades} tipos={tipos} selecionada={selecionada} aoEscolher={verUnidade} />
            </Janela>
          )}
          {abertos.includes("setores") && (
            <Janela id="setores" titulo={PAINEIS.setores.titulo} icone={Building2} padrao={PAINEIS.setores.padrao} aoFechar={() => alternar("setores")}>
              <ul className="divide-y divide-border">
                {setores.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setDetalhe({ tipo: "setor", id: s.id })} className="w-full px-4 py-2.5 text-left hover:bg-muted/50">
                      <span className="block text-sm font-medium">{s.nome}</span>
                      <span className="block text-xs text-muted-foreground">
                        {s.responsavel?.nome ?? "sem responsável"} · {s.atividades.length} atividades · {s.agentes.length ? "com agente" : "sem agente"}
                      </span>
                    </button>
                  </li>
                ))}
                {setores.length === 0 && <Vazio>Os setores aparecem depois da implantação.</Vazio>}
              </ul>
            </Janela>
          )}
          {abertos.includes("agentes") && (
            <Janela id="agentes" titulo={PAINEIS.agentes.titulo} icone={Bot} padrao={PAINEIS.agentes.padrao} aoFechar={() => alternar("agentes")}>
              <ul className="divide-y divide-border">
                {listaAgentes.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => setDetalhe({ tipo: "agente", id: a.id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
                      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full text-white" style={{ background: a.cor ?? "#1A63D8" }}>
                        <Bot className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{a.nome}</span>
                        <span className="block truncate text-xs text-muted-foreground">{a.area ?? a.cargo}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {listaAgentes.length === 0 && <Vazio>Nenhum agente publicado.</Vazio>}
              </ul>
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
          aoFechar={() => setDetalhe(null)}
        />
      )}
      {detalhe?.tipo === "setor" && (
        <DetalheSetor
          setor={setores.find((s) => s.id === detalhe.id)}
          agentes={listaAgentes}
          aoFechar={() => setDetalhe(null)}
          aoVerAgente={(id) => setDetalhe({ tipo: "agente", id })}
        />
      )}
      {detalhe?.tipo === "agente" && (
        <DetalheAgente
          agente={listaAgentes.find((a) => a.id === detalhe.id)}
          setor={setores.find((s) => s.agentes.some((x) => x.agente_id === detalhe.id))}
          aoFechar={() => setDetalhe(null)}
          aoConversar={(id) => navegar({ to: "/chat", search: { agente: id } })}
        />
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

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function DetalheUnidade({ unidade, tipo, aoFechar }: { unidade?: Unidade; tipo?: TipoUnidade; aoFechar: () => void }) {
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
      <dl className="space-y-3">
        <Dado rotulo="Vínculo">{unidade.gestao ? VINCULO[unidade.gestao] ?? unidade.gestao : null}</Dado>
        <Dado rotulo="Endereço">{[unidade.endereco, unidade.bairro].filter(Boolean).join(" · ")}</Dado>
        <Dado rotulo="Telefone">{unidade.telefone}</Dado>
        <Dado rotulo="CNES">{unidade.cnes}</Dado>
        <Dado rotulo="Situação no cadastro">{unidade.confirmada ? "Confirmada" : "A confirmar com a secretaria"}</Dado>
      </dl>
      <div className="mt-5 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Em breve nesta ficha</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          <li>A equipe da unidade (gerente, enfermagem, farmácia)</li>
          <li>Estoque de insumos e medicamentos, com mínimo e validade</li>
          <li>Procedimentos e produção do dia</li>
          <li>O agente da unidade, que conversa com a equipe e reporta à superintendência</li>
        </ul>
      </div>
    </Slideover>
  );
}

function DetalheSetor({
  setor,
  agentes,
  aoFechar,
  aoVerAgente,
}: {
  setor?: Setor;
  agentes: AgentePainel[];
  aoFechar: () => void;
  aoVerAgente: (id: string) => void;
}) {
  if (!setor) return null;
  const agente = agentes.find((a) => setor.agentes.some((x) => x.agente_id === a.id));
  const rotinas = setor.atividades.filter((a) => a.tipo === "rotina");
  const pedidos = setor.atividades.filter((a) => a.tipo !== "rotina");
  return (
    <Slideover titulo={setor.nome} subtitulo={setor.descricao ?? undefined} aoFechar={aoFechar}>
      <dl className="space-y-3">
        <Dado rotulo="Responsável (aprova as entregas)">
          {setor.responsavel ? `${setor.responsavel.nome}${setor.responsavel.cargo ? ` · ${setor.responsavel.cargo}` : ""}` : "Sem responsável"}
        </Dado>
      </dl>
      {agente && (
        <button
          type="button"
          onClick={() => aoVerAgente(agente.id)}
          className="mt-4 flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:border-primary/40"
        >
          <span className="grid size-9 place-items-center rounded-full text-white" style={{ background: agente.cor ?? "#1A63D8" }}>
            <Bot className="size-4" />
          </span>
          <span>
            <span className="block text-sm font-medium">{agente.nome}</span>
            <span className="block text-xs text-muted-foreground">Agente do setor</span>
          </span>
        </button>
      )}
      <h3 className="mt-5 mb-2 text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Rotinas ({rotinas.length})</h3>
      <ul className="space-y-2">
        {rotinas.map((a) => (
          <li key={a.id} className="rounded-xl bg-muted/50 p-3">
            <p className="text-sm font-medium">{a.nome}</p>
            <p className="text-xs text-muted-foreground">
              {FREQUENCIA[a.frequencia] ?? a.frequencia}
              {a.entregavel ? ` · entrega: ${a.entregavel}` : ""}
            </p>
          </li>
        ))}
        {rotinas.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma rotina.</p>}
      </ul>
      <h3 className="mt-5 mb-2 text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Pedidos sob demanda ({pedidos.length})</h3>
      <ul className="space-y-2">
        {pedidos.map((a) => (
          <li key={a.id} className="rounded-xl bg-muted/50 p-3">
            <p className="text-sm font-medium">{a.nome}</p>
            <p className="text-xs text-muted-foreground">{a.descricao}</p>
          </li>
        ))}
        {pedidos.length === 0 && <p className="text-xs text-muted-foreground">Nenhum pedido sob demanda.</p>}
      </ul>
    </Slideover>
  );
}

function DetalheAgente({
  agente,
  setor,
  aoFechar,
  aoConversar,
}: {
  agente?: AgentePainel;
  setor?: Setor;
  aoFechar: () => void;
  aoConversar: (id: string) => void;
}) {
  if (!agente) return null;
  return (
    <Slideover
      titulo={agente.nome}
      subtitulo={agente.cargo ?? agente.area}
      aoFechar={aoFechar}
      rodape={
        <button
          type="button"
          onClick={() => aoConversar(agente.id)}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:brightness-110"
        >
          <MessagesSquare className="size-4" /> Conversar com o agente
        </button>
      }
    >
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl text-white" style={{ background: agente.cor ?? "#1A63D8" }}>
          <Bot className="size-6" />
        </span>
        <div className="text-sm">
          <p className="font-medium">{agente.area ?? "Agente"}</p>
          <p className="text-xs text-muted-foreground">{setor ? `Setor: ${setor.nome}` : "Sem setor"}</p>
        </div>
      </div>
      {setor && (
        <dl className="mt-5 space-y-3">
          <Dado rotulo="Quem aprova o que ele entrega">{setor.responsavel?.nome ?? "Sem responsável"}</Dado>
          <Dado rotulo="Rotinas">{`${setor.atividades.filter((a) => a.tipo === "rotina").length} rotinas e ${setor.atividades.filter((a) => a.tipo !== "rotina").length} pedidos sob demanda`}</Dado>
        </dl>
      )}
      <p className="mt-5 flex items-center gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
        <Users className="size-4 shrink-0" />
        Os fluxos (rotinas no Scheduler do Agno) e as tarefas (CompanyOS) deste agente entram aqui na próxima etapa.
      </p>
    </Slideover>
  );
}
