import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Building2, Building, ClipboardCheck, Loader2, MapPin, Maximize2, MessagesSquare, Minus, Plus, Users } from "lucide-react";
import { api, type AgentePainel, type EventoCentral, type RespostaPanorama, type Rotulos } from "@/lib/api";
import { useAcesso, useRotulos } from "@/hooks/use-permissoes";
import { totemDe } from "@/lib/rotulos";
import { useCentralAoVivo } from "@/hooks/use-central-ao-vivo";
import { cn } from "@/lib/utils";
import { fmtDataHora } from "@/lib/formato";
import { rotuloDoEvento } from "@/lib/eventos";
import { BarraPalco, BotaoPalco, DivisorPalco, LinkPalco } from "@/components/palco/barra-palco";
import { Janela } from "@/components/comando/janela";
import { Slideover } from "@/components/comando/slideover";
import type { ApiCamera } from "@/components/central/escritorio";
import type { SelecaoPredio } from "@/components/central/predio-secretaria";
import { SelosAtencao, useAtencao, type AtencaoDaArea } from "@/components/central/atencao";

/*
 * O prédio virtual (a Secretaria virtual) pelo cadastro da organização. Cada
 * área é uma sala, com o agente da área na mesa e o responsável na placa; no centro, o CCO (ou a sala de comando).
 * Tudo nasce na implantação. Quando um agente trabalha (ao vivo: agente/ao_vivo.py → /secretaria/eventos), o rosto
 * dele muda. Cada placa mostra o que espera a área (para aceitar, em revisão, em execução; /organizacao/atencao).
 * A janela das áreas é a mesma informação em lista, com os mesmos números (o 3D nunca é obrigatório). O mapa (Central de
 * comando) fica com as unidades.
 */

const Cena = lazy(() => import("@/components/central/predio-secretaria"));

interface Area {
  id: string;
  nome: string;
  descricao?: string | null;
  responsavel: { nome: string; email?: string | null; cargo?: string | null } | null;
  agentes: { agente_id: string }[];
  atividades: { id: string; nome: string; tipo?: string | null; frequencia?: string | null }[];
}

const LARGURA_PAINEL = 440;

export function Secretaria3D() {
  const acesso = useAcesso().data;
  const daOrganizacao = !!acesso?.organizacao;
  const panorama = useQuery({
    queryKey: ["gestao-panorama", daOrganizacao],
    queryFn: () => api<RespostaPanorama>(daOrganizacao ? "/organizacao/panorama" : "/gestao/panorama"),
  });
  const pan = panorama.data?.organizacao ? panorama.data : null;
  const r = useRotulos(pan?.segmento.rotulos);
  const visiveis = useQuery({ queryKey: ["agentes-visiveis"], queryFn: () => api<{ agentes: AgentePainel[] }>("/agentes"), staleTime: 60_000 });
  const aoVivo = useCentralAoVivo();
  const atencao = useAtencao(daOrganizacao).data;
  const camera = useRef<ApiCamera | null>(null);
  const [aberto, setAberto] = useState(false);
  const [selecao, setSelecao] = useState<SelecaoPredio>(null);
  const [areasAbertas, setAreasAbertas] = useState(true);

  useEffect(() => {
    document.title = `${r.predio} · GestorGov`;
  }, [r.predio]);

  const agentes = useMemo(() => visiveis.data?.agentes ?? [], [visiveis.data]);
  const areas: Area[] = pan?.areas ?? [];
  const org = pan?.organizacao;
  const local = org ? [org.cidade, org.uf].filter(Boolean).join("-") : "";
  const selecionar = (s: SelecaoPredio) => {
    setSelecao(s);
    if (s) setAberto(true);
  };
  const painelAberto = !!selecao;

  return (
    <div className="fixed inset-0 overflow-hidden bg-palco text-palco-foreground">
      {areas.length > 0 ? (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-sm text-palco-foreground/70">
              <Loader2 className="size-5 animate-spin" />
            </div>
          }
        >
          <Cena
            areas={areas}
            agentes={agentes}
            nomePredio={org?.sigla || org?.nome || r.organizacao}
            rotuloCentro={r.centro}
            totem={totemDe(r)}
            eventos={aoVivo.eventos}
            inicio={aoVivo.inicio}
            selecao={selecao}
            aoSelecionar={selecionar}
            margemDireita={painelAberto ? LARGURA_PAINEL + 24 : 0}
            api={camera}
            aberto={aberto}
            aoAbrir={() => setAberto(true)}
            atencao={atencao}
          />
        </Suspense>
      ) : (
        <div className="grid h-full place-items-center text-sm text-palco-foreground/70">
          {panorama.isLoading ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <span className="max-w-sm text-center">
              A {r.organizacao_curta} ainda não tem {r.areas}. Eles são criados na{" "}
              <Link to="/implantacao" className="underline">
                implantação
              </Link>
              , e cada um vira uma sala deste prédio, com o seu agente.
            </span>
          )}
        </div>
      )}

      <BarraPalco
        rotulo={r.predio}
        titulo={r.predio}
        subtitulo={org ? [org.sigla || org.nome, local].filter(Boolean).join(" · ") : "Gestor GOV"}
      >
        <BotaoPalco rotulo={aberto ? "Fechar o prédio (vista de fora)" : "Abrir o prédio"} ativo={aberto} onClick={() => setAberto((a) => !a)}>
          {aberto ? <Building className="size-4" /> : <Building2 className="size-4" />}
        </BotaoPalco>
        <BotaoPalco rotulo={r.Areas} ativo={areasAbertas} onClick={() => setAreasAbertas((s) => !s)}>
          <Users className="size-4" />
        </BotaoPalco>
        <DivisorPalco />
        <BotaoPalco rotulo="Aproximar" onClick={() => camera.current?.aproximar(0.8)}>
          <Plus className="size-4" />
        </BotaoPalco>
        <BotaoPalco rotulo="Afastar" onClick={() => camera.current?.aproximar(1.25)}>
          <Minus className="size-4" />
        </BotaoPalco>
        <BotaoPalco rotulo="Ver tudo" onClick={() => camera.current?.centralizar()}>
          <Maximize2 className="size-4" />
        </BotaoPalco>
        <DivisorPalco />
        <LinkPalco to="/comando">
          <MapPin className="size-3.5" /> {r.mapa}
        </LinkPalco>
      </BarraPalco>

      <span
        className={cn(
          "absolute top-6 right-5 z-[90] hidden items-center gap-1.5 rounded-full bg-palco-barra px-3 py-1 text-[11px] backdrop-blur-md md:flex",
          aoVivo.conectado ? "text-palco-foreground/80" : "text-palco-foreground/50",
        )}
      >
        <span className={cn("size-1.5 rounded-full", aoVivo.conectado ? "bg-success" : "bg-palco-foreground/40")} />
        {aoVivo.conectado ? "Ao vivo" : "Conectando"}
      </span>

      {areasAbertas && (
        <Janela id="secretaria-setores" titulo={`${r.Areas} da ${r.organizacao_curta}`} icone={Users} padrao={{ x: 24, y: 96, w: 340, h: 460 }} aoFechar={() => setAreasAbertas(false)}>
          <ul className="divide-y divide-border">
            {areas.map((s) => {
              const agente = s.agentes[0]?.agente_id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => selecionar(agente ? { tipo: "agente", id: agente } : { tipo: "area", id: s.id })}
                    className="w-full px-4 py-2.5 text-left outline-none hover:bg-secondary focus-visible:bg-secondary disabled:cursor-default"
                  >
                    <span className="block text-sm font-medium text-foreground">{s.nome}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s.responsavel?.nome ?? "sem responsável"} · {agente ? "com agente" : "sem agente"}
                    </span>
                    <SelosAtencao atencao={atencao?.[s.id]} className="mt-1" />
                  </button>
                </li>
              );
            })}
            {!areas.length && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Os {r.areas} aparecem depois da implantação.</li>}
          </ul>
        </Janela>
      )}

      {selecao?.tipo === "agente" && (
        <PainelAgente
          agente={agentes.find((a) => a.id === selecao.id)}
          areas={areas.filter((s) => s.agentes.some((a) => a.agente_id === selecao.id))}
          rotulos={r}
          eventos={aoVivo.eventos.filter((e) => e.agente === selecao.id)}
          aoFechar={() => setSelecao(null)}
        />
      )}
      {selecao?.tipo === "area" && (
        <PainelArea
          area={areas.find((s) => s.id === selecao.id)}
          atencao={atencao?.[selecao.id]}
          mostrarAprovacoes={daOrganizacao}
          agentes={agentes}
          eventos={aoVivo.eventos}
          aoVerAgente={(id) => selecionar({ tipo: "agente", id })}
          aoFechar={() => setSelecao(null)}
        />
      )}
      {selecao?.tipo === "cco" && (
        <Slideover
          titulo={r.centro === "CCO" ? "CCO · Centro de Comando e Operações" : r.centro}
          subtitulo={`O que a ${r.organizacao_curta} inteira está fazendo agora`}
          aoFechar={() => setSelecao(null)}
        >
          <ListaEventos eventos={aoVivo.eventos} agentes={agentes} />
        </Slideover>
      )}
    </div>
  );
}

function ListaEventos({ eventos, agentes }: { eventos: EventoCentral[]; agentes?: AgentePainel[] }) {
  const recentes = [...eventos].reverse().slice(0, 30);
  if (!recentes.length) return <p className="text-sm text-muted-foreground">Nada por enquanto. O que acontecer a partir de agora aparece aqui.</p>;
  return (
    <ul className="space-y-2">
      {recentes.map((e) => (
        <li key={e.id} className="rounded-lg border border-border px-3 py-2 text-sm">
          <span className="font-medium">
            {rotuloDoEvento(e)}
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
  areas,
  rotulos: r,
  eventos,
  aoFechar,
}: {
  agente?: AgentePainel;
  areas: Area[];
  rotulos: Rotulos;
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
            <Users className="size-3.5" /> {r.Areas}
          </h3>
          {areas.length ? (
            <ul className="space-y-1.5 text-sm">
              {areas.map((s) => (
                <li key={s.id}>
                  {s.nome}
                  <span className="text-xs text-muted-foreground"> · {s.responsavel?.nome ?? "sem responsável"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Ainda não está ligado a um {r.area}.</p>
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

function PainelArea({
  area: setor,
  atencao,
  mostrarAprovacoes,
  agentes,
  eventos,
  aoVerAgente,
  aoFechar,
}: {
  area?: Area;
  atencao?: AtencaoDaArea;
  mostrarAprovacoes: boolean;
  agentes: AgentePainel[];
  eventos: EventoCentral[];
  aoVerAgente: (id: string) => void;
  aoFechar: () => void;
}) {
  if (!setor) return null;
  const doSetor = new Set(setor.agentes.map((a) => a.agente_id));
  return (
    <Slideover
      titulo={setor.nome}
      subtitulo={setor.descricao ?? undefined}
      aoFechar={aoFechar}
      rodape={
        mostrarAprovacoes ? (
          <Link
            to="/aprovacoes"
            className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ClipboardCheck className="size-4" /> Ver em Aprovações
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-5">
        {mostrarAprovacoes && (
          <section className="space-y-2">
            <h3 className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Esperando</h3>
            {atencao && atencao.aceite + atencao.execucao + atencao.revisao > 0 ? (
              <SelosAtencao atencao={atencao} />
            ) : (
              <p className="text-sm text-muted-foreground">Nada esperando por uma pessoa agora.</p>
            )}
          </section>
        )}
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
                <span className="text-xs text-muted-foreground"> · {a.tipo === "rotina" ? `rotina ${FREQUENCIA[a.frequencia ?? ""] ?? a.frequencia ?? ""}` : "sob demanda"}</span>
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
