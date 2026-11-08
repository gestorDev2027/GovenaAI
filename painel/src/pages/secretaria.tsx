import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Building2, Building, Loader2, MapPin, Maximize2, MessagesSquare, Minus, Plus, Users } from "lucide-react";
import { api, type AgentePainel, type EventoCentral } from "@/lib/api";
import { useAcesso } from "@/hooks/use-permissoes";
import { useCentralAoVivo } from "@/hooks/use-central-ao-vivo";
import { cn } from "@/lib/utils";
import { fmtDataHora } from "@/lib/formato";
import { ROTULO_FERRAMENTA } from "@/components/chat/anexos";
import { SimboloGestorGov } from "@/components/layout/logo";
import { Janela } from "@/components/comando/janela";
import { Slideover } from "@/components/comando/slideover";
import type { ApiCamera } from "@/components/central/escritorio";
import type { SelecaoPredio } from "@/components/central/predio-secretaria";

/*
 * Secretaria virtual: o prédio da Secretaria de Saúde pelo cadastro da prefeitura. Cada setor é uma sala, com o
 * agente do setor na mesa e o responsável na placa; no centro, o CCO. Tudo nasce na implantação. Quando um agente
 * trabalha (ao vivo: agente/ao_vivo.py → /secretaria/eventos), o rosto dele muda. A janela "Setores" é a mesma
 * informação em lista (o 3D nunca é obrigatório). O mapa da cidade (Central de comando) fica com as unidades.
 */

const Cena = lazy(() => import("@/components/central/predio-secretaria"));

interface Setor {
  id: string;
  nome: string;
  descricao?: string | null;
  responsavel: { nome: string; email?: string | null; cargo: string | null } | null;
  agentes: { agente_id: string }[];
  atividades: { id: string; nome: string; tipo: "rotina" | "sob_demanda"; frequencia: string }[];
}
interface Panorama {
  municipio: { nome: string; uf: string } | null;
  setores?: Setor[];
}

const LARGURA_PAINEL = 440;

export function Secretaria3D() {
  const acesso = useAcesso().data;
  const daPrefeitura = !!acesso?.prefeitura;
  const panorama = useQuery({
    queryKey: ["gestao-panorama", daPrefeitura],
    queryFn: () => api<Panorama>(daPrefeitura ? "/prefeitura/panorama" : "/gestao/panorama"),
  });
  const visiveis = useQuery({ queryKey: ["agentes-visiveis"], queryFn: () => api<{ agentes: AgentePainel[] }>("/agentes"), staleTime: 60_000 });
  const aoVivo = useCentralAoVivo();
  const camera = useRef<ApiCamera | null>(null);
  const [aberto, setAberto] = useState(false);
  const [selecao, setSelecao] = useState<SelecaoPredio>(null);
  const [setoresAbertos, setSetoresAbertos] = useState(true);

  useEffect(() => {
    document.title = "Secretaria virtual · GestorGov";
  }, []);

  const agentes = useMemo(() => visiveis.data?.agentes ?? [], [visiveis.data]);
  const setores = panorama.data?.setores ?? [];
  const mun = panorama.data?.municipio;
  const selecionar = (s: SelecaoPredio) => {
    setSelecao(s);
    if (s) setAberto(true);
  };
  const painelAberto = !!selecao;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0D1B38] text-white">
      {setores.length > 0 ? (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-sm text-white/70">
              <Loader2 className="size-5 animate-spin" />
            </div>
          }
        >
          <Cena
            setores={setores}
            agentes={agentes}
            eventos={aoVivo.eventos}
            inicio={aoVivo.inicio}
            selecao={selecao}
            aoSelecionar={selecionar}
            margemDireita={painelAberto ? LARGURA_PAINEL + 24 : 0}
            api={camera}
            aberto={aberto}
            aoAbrir={() => setAberto(true)}
          />
        </Suspense>
      ) : (
        <div className="grid h-full place-items-center text-sm text-white/70">
          {panorama.isLoading ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <span className="max-w-sm text-center">
              A secretaria ainda não tem setores. Eles são criados na{" "}
              <Link to="/implantacao" className="underline">
                implantação
              </Link>
              , e cada um vira uma sala deste prédio, com o seu agente.
            </span>
          )}
        </div>
      )}

      {/* Barra flutuante */}
      <nav
        aria-label="Secretaria virtual"
        className="absolute top-4 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-[#0D1B38]/85 p-1.5 pl-3 shadow-[0_18px_50px_-15px_rgba(0,0,0,0.6)] backdrop-blur-md"
      >
        <Link to="/" aria-label="Voltar ao painel" className="flex items-center gap-2 rounded-full pr-2 outline-none focus-visible:ring-2 focus-visible:ring-white">
          <SimboloGestorGov sobreEscuro className="size-7" />
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-sm font-bold">Secretaria virtual</span>
            <span className="text-[10px] text-white/60">{mun ? `${mun.nome}-${mun.uf}` : "GestorGov"}</span>
          </span>
        </Link>
        <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
        <Botao rotulo={aberto ? "Fechar o prédio (vista de fora)" : "Abrir o prédio"} ativo={aberto} onClick={() => setAberto((a) => !a)}>
          {aberto ? <Building className="size-4" /> : <Building2 className="size-4" />}
        </Botao>
        <Botao rotulo="Setores" ativo={setoresAbertos} onClick={() => setSetoresAbertos((s) => !s)}>
          <Users className="size-4" />
        </Botao>
        <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
        <Botao rotulo="Aproximar" onClick={() => camera.current?.aproximar(0.8)}>
          <Plus className="size-4" />
        </Botao>
        <Botao rotulo="Afastar" onClick={() => camera.current?.aproximar(1.25)}>
          <Minus className="size-4" />
        </Botao>
        <Botao rotulo="Ver tudo" onClick={() => camera.current?.centralizar()}>
          <Maximize2 className="size-4" />
        </Botao>
        <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
        <Link
          to="/comando"
          className="flex h-9 items-center gap-2 rounded-full bg-white/10 px-3 text-xs text-white/85 outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white"
        >
          <MapPin className="size-3.5" /> Cidade
        </Link>
      </nav>

      <span
        className={cn(
          "absolute top-6 right-5 z-[90] hidden items-center gap-1.5 rounded-full bg-[#0D1B38]/70 px-3 py-1 text-[11px] backdrop-blur-md md:flex",
          aoVivo.conectado ? "text-white/80" : "text-white/50",
        )}
      >
        <span className={cn("size-1.5 rounded-full", aoVivo.conectado ? "bg-[#22c55e]" : "bg-white/40")} />
        {aoVivo.conectado ? "Ao vivo" : "Conectando"}
      </span>

      {setoresAbertos && (
        <Janela id="secretaria-setores" titulo="Setores da secretaria" icone={Users} padrao={{ x: 24, y: 96, w: 340, h: 460 }} aoFechar={() => setSetoresAbertos(false)}>
          <ul className="divide-y divide-border">
            {setores.map((s) => {
              const agente = s.agentes[0]?.agente_id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={!agente}
                    onClick={() => agente && selecionar({ tipo: "agente", id: agente })}
                    className="w-full px-4 py-2.5 text-left outline-none hover:bg-secondary focus-visible:bg-secondary disabled:cursor-default"
                  >
                    <span className="block text-sm font-medium text-foreground">{s.nome}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s.responsavel?.nome ?? "sem responsável"} · {agente ? "com agente" : "sem agente"}
                    </span>
                  </button>
                </li>
              );
            })}
            {!setores.length && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Os setores aparecem depois da implantação.</li>}
          </ul>
        </Janela>
      )}

      {selecao?.tipo === "agente" && (
        <PainelAgente
          agente={agentes.find((a) => a.id === selecao.id)}
          setores={setores.filter((s) => s.agentes.some((a) => a.agente_id === selecao.id))}
          eventos={aoVivo.eventos.filter((e) => e.agente === selecao.id)}
          aoFechar={() => setSelecao(null)}
        />
      )}
      {selecao?.tipo === "setor" && (
        <PainelSetor
          setor={setores.find((s) => s.id === selecao.id)}
          agentes={agentes}
          eventos={aoVivo.eventos}
          aoVerAgente={(id) => selecionar({ tipo: "agente", id })}
          aoFechar={() => setSelecao(null)}
        />
      )}
      {selecao?.tipo === "cco" && (
        <Slideover titulo="CCO · Centro de Comando e Operações" subtitulo="O que a secretaria inteira está fazendo agora" aoFechar={() => setSelecao(null)}>
          <ListaEventos eventos={aoVivo.eventos} agentes={agentes} />
        </Slideover>
      )}
    </div>
  );
}

function Botao({ rotulo, ativo, onClick, children }: { rotulo: string; ativo?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      aria-pressed={ativo}
      className={cn(
        "grid size-9 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white",
        ativo ? "bg-[#1A63D8] text-white" : "text-white/80 hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}

const ROTULO_EVENTO: Record<EventoCentral["tipo"], string> = {
  mensagem: "Recebeu uma mensagem",
  pensando: "Pensando",
  ferramenta: "Usou uma ferramenta",
  respondeu: "Respondeu",
  transferiu: "Passou para a equipe",
  encerrou: "Encerrou a conversa",
  guardrail: "Barrou um pedido fora das regras",
  erro: "Erro",
  boas_vindas: "Boas-vindas",
};

function ListaEventos({ eventos, agentes }: { eventos: EventoCentral[]; agentes?: AgentePainel[] }) {
  const recentes = [...eventos].reverse().slice(0, 30);
  if (!recentes.length) return <p className="text-sm text-muted-foreground">Nada por enquanto. O que acontecer a partir de agora aparece aqui.</p>;
  return (
    <ul className="space-y-2">
      {recentes.map((e) => (
        <li key={e.id} className="rounded-lg border border-border px-3 py-2 text-sm">
          <span className="font-medium">
            {e.tipo === "ferramenta" && e.ferramenta ? ROTULO_FERRAMENTA[e.ferramenta] ?? e.ferramenta : ROTULO_EVENTO[e.tipo]}
          </span>
          <span className="block text-xs text-muted-foreground">
            {agentes ? `${agentes.find((a) => a.id === e.agente)?.nome ?? e.agente} · ` : ""}
            {e.contato ? `${e.contato} · ` : ""}
            {fmtDataHora(e.quando)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PainelAgente({
  agente,
  setores,
  eventos,
  aoFechar,
}: {
  agente?: AgentePainel;
  setores: Setor[];
  eventos: EventoCentral[];
  aoFechar: () => void;
}) {
  if (!agente) return null;
  return (
    <Slideover
      titulo={agente.nome}
      subtitulo={agente.cargo ?? agente.area}
      aoFechar={aoFechar}
      rodape={
        <Link
          to="/chat"
          search={{ agente: agente.id }}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessagesSquare className="size-4" /> Conversar com {agente.nome}
        </Link>
      }
    >
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
            <Users className="size-3.5" /> Setores
          </h3>
          {setores.length ? (
            <ul className="space-y-1.5 text-sm">
              {setores.map((s) => (
                <li key={s.id}>
                  {s.nome}
                  <span className="text-xs text-muted-foreground"> · {s.responsavel?.nome ?? "sem responsável"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Ainda não está ligado a um setor.</p>
          )}
        </section>
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
            <Bot className="size-3.5" /> O que está fazendo
          </h3>
          <ListaEventos eventos={eventos} />
        </section>
      </div>
    </Slideover>
  );
}

const FREQUENCIA: Record<string, string> = {
  a_cada_hora: "a cada hora",
  diaria: "diária",
  semanal: "semanal",
  mensal: "mensal",
  sob_demanda: "sob demanda",
};

function PainelSetor({
  setor,
  agentes,
  eventos,
  aoVerAgente,
  aoFechar,
}: {
  setor?: Setor;
  agentes: AgentePainel[];
  eventos: EventoCentral[];
  aoVerAgente: (id: string) => void;
  aoFechar: () => void;
}) {
  if (!setor) return null;
  const doSetor = new Set(setor.agentes.map((a) => a.agente_id));
  return (
    <Slideover titulo={setor.nome} subtitulo={setor.descricao ?? undefined} aoFechar={aoFechar}>
      <div className="space-y-5">
        <section className="space-y-1 text-sm">
          <h3 className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Responsável</h3>
          <p>{setor.responsavel ? `${setor.responsavel.nome}${setor.responsavel.cargo ? ` · ${setor.responsavel.cargo}` : ""}` : "Ainda sem responsável."}</p>
        </section>
        <section className="space-y-2">
          <h3 className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Agente</h3>
          {setor.agentes.length ? (
            setor.agentes.map((a) => (
              <button key={a.agente_id} type="button" onClick={() => aoVerAgente(a.agente_id)} className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-secondary">
                <Bot className="size-4" /> {agentes.find((x) => x.id === a.agente_id)?.nome ?? a.agente_id}
              </button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Ainda sem agente.</p>
          )}
        </section>
        <section className="space-y-2">
          <h3 className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Atividades · {setor.atividades.length}</h3>
          <ul className="space-y-1.5 text-sm">
            {setor.atividades.map((a) => (
              <li key={a.id}>
                {a.nome}
                <span className="text-xs text-muted-foreground"> · {a.tipo === "rotina" ? `rotina ${FREQUENCIA[a.frequencia] ?? a.frequencia}` : "sob demanda"}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-2">
          <h3 className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Ao vivo</h3>
          <ListaEventos eventos={eventos.filter((e) => doSetor.has(e.agente))} agentes={agentes} />
        </section>
      </div>
    </Slideover>
  );
}
