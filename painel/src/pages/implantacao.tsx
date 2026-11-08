import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Building2, Check, Landmark, LayoutDashboard, Loader2, LogOut, MapPinned, SendHorizontal, Users } from "lucide-react";
import { api, ErroAcesso, sair, type Acesso } from "@/lib/api";
import { fmtInt } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Slideover } from "@/components/comando/slideover";
import { GerenciarUnidades } from "@/components/unidades/gerenciar-unidades";
import { MapaCidade, type UnidadeNoMapa } from "@/components/mapa/mapa-cidade";
import type { ApiCamera } from "@/components/central/escritorio";
import type { SelecaoPredio } from "@/components/central/predio-secretaria";
import { useAgentes } from "@/hooks/use-agentes";
import { useCentralAoVivo } from "@/hooks/use-central-ao-vivo";
import { PageLoader } from "@/components/widgets/widgets";

/*
 * Implantação da prefeitura: a primeira tela de quem se cadastra. Chat com o Assistente de Implantação à
 * esquerda e, à direita, o quadro que se monta a cada resposta, a partir do panorama que a rota devolve. A ordem:
 * município, setores (cada um vira uma sala do prédio), atividades, responsáveis, agentes (os robôs sentam nas
 * salas) e, por último, as unidades de saúde no mapa real da cidade, cada uma com o seu prédio e o agente. Embaixo,
 * as mesmas informações em lista (o 3D nunca é obrigatório). Vale para quem ainda espera a aprovação do painel.
 */

interface Unidade {
  id: string;
  nome: string;
  nome_fantasia?: string | null;
  tipo_id: string | null;
  confirmada: boolean | null;
  latitude: string | number | null;
  longitude: string | number | null;
  agente_id?: string | null;
}
interface Setor {
  id: string;
  nome: string;
  responsavel: { nome: string } | null;
  atividades: unknown[];
  agentes: { agente_id: string }[];
}
interface Panorama {
  municipio: { nome: string; uf: string; codigo_ibge: string; situacao: string | null; latitude: string | number | null; longitude: string | number | null };
  secretaria: { secretario_nome: string | null } | null;
  setores: Setor[];
  unidades: Unidade[];
  onboarding: { etapa: string | null } | null;
}
interface Implantacao {
  conta: { email: string; nome: string };
  boas_vindas: string;
  historico: { papel: "contato" | "agente"; texto: string }[];
  municipio_id: string | null;
  panorama: Panorama | null;
}
interface TipoUnidade {
  id: string;
  nome: string;
  cor: string | null;
  ordem: number | null;
}

const ETAPAS = [
  ["municipio", "Município"],
  ["setores", "Setores"],
  ["atividades", "Atividades"],
  ["responsaveis", "Responsáveis"],
  ["agentes", "Agentes"],
  ["unidades", "Unidades de saúde"],
  ["revisao", "Revisão"],
] as const;
// Até os agentes, o quadro mostra o prédio; das unidades em diante, a cidade.
const ETAPAS_DO_PREDIO = new Set(["setores", "atividades", "responsaveis", "agentes"]);
const Predio = lazy(() => import("@/components/central/predio-secretaria"));

type Mensagem = { papel: "contato" | "agente"; texto: string };

export function PaginaImplantacao() {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const acesso = useQuery({ queryKey: ["acesso"], queryFn: () => api<Acesso>("/acesso"), staleTime: Infinity });
  const dados = useQuery({ queryKey: ["implantacao"], queryFn: () => api<Implantacao>("/implantacao"), retry: false });
  const catalogo = useQuery({
    queryKey: ["gestao-catalogo-publico"],
    queryFn: () => api<{ tipos_unidade: TipoUnidade[] }>("/implantacao/catalogo"),
    staleTime: Infinity,
    retry: false,
  });
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [panorama, setPanorama] = useState<Panorama | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Implantação · GestorGov";
  }, []);
  useEffect(() => {
    if (dados.error instanceof ErroAcesso) navegar({ to: "/entrar" });
  }, [dados.error, navegar]);
  useEffect(() => {
    if (!dados.data) return;
    setMensagens([{ papel: "agente", texto: dados.data.boas_vindas }, ...dados.data.historico]);
    setPanorama(dados.data.panorama);
  }, [dados.data]);
  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens, enviando]);

  async function enviar(e?: FormEvent) {
    e?.preventDefault();
    const mensagem = texto.trim();
    if (!mensagem || enviando) return;
    setErro(null);
    setTexto("");
    setMensagens((m) => [...m, { papel: "contato", texto: mensagem }]);
    setEnviando(true);
    try {
      const r = await api<{ resposta: string | null; panorama: Panorama | null }>("/implantacao/mensagem", {
        method: "POST",
        body: JSON.stringify({ mensagem }),
      });
      if (r.resposta) setMensagens((m) => [...m, { papel: "agente", texto: r.resposta as string }]);
      setPanorama(r.panorama);
      qc.invalidateQueries({ queryKey: ["gestao-panorama"] });
      qc.invalidateQueries({ queryKey: ["acesso"] });
      qc.invalidateQueries({ queryKey: ["agentes-visiveis"] });
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "O assistente não conseguiu responder agora.");
    } finally {
      setEnviando(false);
    }
  }

  function teclas(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  }

  if (dados.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6">
        <PageLoader className="h-64 w-full max-w-md" label="Abrindo a implantação" />
      </div>
    );
  }
  if (dados.isError && !(dados.error instanceof ErroAcesso)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6 text-center text-sm text-muted-foreground">
        {(dados.error as Error).message}
      </div>
    );
  }

  const aprovado = acesso.data?.usuario?.situacao === "ativo";
  const conta = dados.data?.conta;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Logo />
          <span className="hidden border-l border-border pl-4 text-sm font-semibold sm:inline">Implantação</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground md:inline">{conta?.email}</span>
          {aprovado && (
            <Link
              to="/"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LayoutDashboard className="size-4" /> Ir para o Painel
            </Link>
          )}
          <Button variant="ghost" size="sm" onClick={() => sair()}>
            <LogOut /> Sair
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Chat */}
        <section aria-label="Conversa com o Assistente de Implantação" className="flex min-h-0 flex-col border-r border-border bg-card">
          <div className="thin-scroll flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite">
            {mensagens.map((m, i) => (
              <Balao key={i} papel={m.papel} texto={m.texto} />
            ))}
            {enviando && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> O assistente está trabalhando…
              </div>
            )}
            <div ref={fim} />
          </div>
          <form onSubmit={enviar} className="border-t border-border p-3 sm:p-4">
            {erro && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {erro}
              </p>
            )}
            <div className="flex items-end gap-2">
              <label htmlFor="mensagem" className="sr-only">
                Mensagem para o assistente
              </label>
              <textarea
                id="mensagem"
                rows={2}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={teclas}
                placeholder="Escreva para o assistente (Enter envia, Shift+Enter quebra a linha)"
                className="min-h-11 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="lg" disabled={enviando || !texto.trim()} aria-label="Enviar">
                <SendHorizontal />
              </Button>
            </div>
          </form>
        </section>

        {/* Quadro */}
        <section aria-label="A secretaria sendo montada" className="thin-scroll hidden min-h-0 overflow-y-auto p-5 lg:block">
          <Quadro panorama={panorama} tipos={catalogo.data?.tipos_unidade ?? []} token={acesso.data?.mapbox_token ?? null} />
        </section>
      </div>
    </div>
  );
}

function Balao({ papel, texto }: Mensagem) {
  const agente = papel === "agente";
  return (
    <div className={cn("flex gap-3", !agente && "flex-row-reverse")}>
      <span
        aria-hidden="true"
        className={cn("grid size-8 shrink-0 place-items-center rounded-full", agente ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground")}
      >
        {agente ? <Bot className="size-4" /> : <Users className="size-4" />}
      </span>
      <div
        className={cn(
          "max-w-[85%] rounded-md px-4 py-3 text-sm leading-relaxed",
          agente ? "border border-border bg-background" : "bg-accent text-accent-foreground",
        )}
      >
        <span className="sr-only">{agente ? "Assistente: " : "Você: "}</span>
        <TextoSimples texto={texto} />
      </div>
    </div>
  );
}

/** Negrito com **, listas com "- " e quebras de linha: o que o assistente usa. */
function TextoSimples({ texto }: { texto: string }) {
  const negrito = (linha: string) =>
    linha.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
      parte.startsWith("**") && parte.endsWith("**") ? <strong key={i}>{parte.slice(2, -2)}</strong> : <Fragment key={i}>{parte}</Fragment>,
    );
  return (
    <>
      {texto.split("\n").map((linha, i) => {
        const item = linha.match(/^\s*[-*•]\s+(.*)$/);
        if (item)
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span aria-hidden="true">•</span>
              <span>{negrito(item[1])}</span>
            </div>
          );
        return linha.trim() ? <p key={i}>{negrito(linha)}</p> : <div key={i} className="h-2" />;
      })}
    </>
  );
}

function Quadro({ panorama, tipos, token }: { panorama: Panorama | null; tipos: TipoUnidade[]; token: string | null }) {
  const [conferindo, setConferindo] = useState(false);
  const aConferir = panorama?.unidades.filter((u) => !u.confirmada).length ?? 0;
  const porTipo = useMemo(() => {
    const mapa = new Map(tipos.map((t) => [t.id, t]));
    const contagem = new Map<string, number>();
    for (const u of panorama?.unidades ?? []) contagem.set(u.tipo_id ?? "outro", (contagem.get(u.tipo_id ?? "outro") ?? 0) + 1);
    return [...contagem]
      .map(([id, n]) => ({ id, n, nome: mapa.get(id)?.nome ?? id, cor: mapa.get(id)?.cor ?? "#424E6B", ordem: mapa.get(id)?.ordem ?? 99 }))
      .sort((a, b) => a.ordem - b.ordem);
  }, [panorama, tipos]);
  const etapa = panorama ? (panorama.municipio.situacao === "ativo" ? "concluido" : panorama.onboarding?.etapa ?? "setores") : "municipio";
  const indice = etapa === "concluido" ? ETAPAS.length : Math.max(0, ETAPAS.findIndex(([id]) => id === etapa));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ol className="surface-card flex flex-wrap gap-x-4 gap-y-2 p-4" aria-label="Etapas da implantação">
        {ETAPAS.map(([id, rotulo], i) => (
          <li key={id} className="flex items-center gap-1.5 text-xs" aria-current={i === indice ? "step" : undefined}>
            <span
              className={cn(
                "num grid size-5 place-items-center rounded-full text-[10px] font-bold",
                i < indice ? "bg-success text-success-foreground" : i === indice ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {i < indice ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={cn(i === indice ? "font-semibold text-foreground" : "text-muted-foreground")}>{rotulo}</span>
          </li>
        ))}
      </ol>

      {panorama && <Vista panorama={panorama} tipos={tipos} token={token} etapa={etapa} />}

      {!panorama ? (
        <Bloco icone={<MapPinned className="size-5" />} titulo="Sua cidade aparece aqui">
          <p className="text-sm text-muted-foreground">
            Diga ao assistente o CEP da prefeitura ou o nome da cidade e a UF. Depois vêm os setores (o prédio da secretaria vai subindo aqui), os
            agentes e, por último, as unidades de saúde no mapa da cidade.
          </p>
        </Bloco>
      ) : (
        <>
          <Bloco icone={<Landmark className="size-5" />} titulo={`${panorama.municipio.nome}-${panorama.municipio.uf}`}>
            <p className="text-sm text-muted-foreground">
              Código IBGE {panorama.municipio.codigo_ibge}
              {panorama.secretaria?.secretario_nome ? ` · Secretário(a): ${panorama.secretaria.secretario_nome}` : ""}
            </p>
          </Bloco>
          <Bloco icone={<Users className="size-5" />} titulo={`Setores · ${fmtInt(panorama.setores.length)}`}>
            {panorama.setores.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {panorama.setores.map((s) => (
                  <li key={s.id} className="rounded-md border border-border bg-background px-3 py-2">
                    <div className="text-sm font-medium">{s.nome}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtInt(s.atividades.length)} atividades · {s.responsavel?.nome ?? "sem responsável"} · {s.agentes.length ? "com agente" : "sem agente"}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">O assistente propõe os setores logo depois do município: cada um vira uma sala do prédio.</p>
            )}
          </Bloco>
          <Bloco icone={<Building2 className="size-5" />} titulo={`Unidades de saúde · ${fmtInt(panorama.unidades.length)}`}>
            {porTipo.length ? (
              <ul className="flex flex-wrap gap-2">
                {porTipo.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 text-xs">
                    <span aria-hidden="true" className="size-2 rounded-full" style={{ background: t.cor }} />
                    {t.nome}
                    <span className="num font-semibold">{fmtInt(t.n)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">As unidades de saúde são a última etapa: entram no mapa da cidade, cada uma com o seu prédio.</p>
            )}
            {panorama.unidades.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {aConferir
                    ? `${aConferir} de ${panorama.unidades.length} a conferir: endereço, ponto no mapa e foto da fachada. A equipe pode dividir o trabalho.`
                    : "Todas as unidades estão conferidas."}
                </p>
                <Button size="sm" variant={aConferir ? "default" : "outline"} onClick={() => setConferindo(true)}>
                  Conferir unidades
                </Button>
              </div>
            )}
          </Bloco>
          {conferindo && (
            <Slideover titulo="Unidades de saúde" subtitulo="Confira cada unidade e cadastre as que faltam (o CEP busca o endereço)" aoFechar={() => setConferindo(false)}>
              <GerenciarUnidades />
            </Slideover>
          )}
        </>
      )}
    </div>
  );
}

function Bloco({ icone, titulo, children }: { icone: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <section className="surface-card p-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden="true" className="text-primary-text">
          {icone}
        </span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/** O desenho do quadro: o prédio da secretaria (setores e agentes) ou a cidade (unidades). Dá para trocar à mão. */
function Vista({ panorama, tipos, token, etapa }: { panorama: Panorama; tipos: TipoUnidade[]; token: string | null; etapa: string }) {
  const agentes = useAgentes();
  const aoVivo = useCentralAoVivo();
  const camera = useRef<ApiCamera | null>(null);
  const [selecao, setSelecao] = useState<SelecaoPredio>(null);
  const sugerida: "predio" | "cidade" = ETAPAS_DO_PREDIO.has(etapa) || (etapa === "municipio" && panorama.setores.length > 0) ? "predio" : "cidade";
  const [escolhida, setEscolhida] = useState<"predio" | "cidade" | null>(null);
  useEffect(() => setEscolhida(null), [sugerida]); // etapa nova: volta a vista dela
  const vista = escolhida ?? sugerida;
  const cores = useMemo(() => new Map(tipos.map((t) => [t.id, t.cor ?? "#424E6B"])), [tipos]);
  const noMapa: UnidadeNoMapa[] = useMemo(
    () =>
      panorama.unidades
        .filter((u) => u.latitude != null && u.longitude != null)
        .map((u) => ({
          id: u.id,
          nome: u.nome_fantasia || u.nome,
          tipo: u.tipo_id ?? "outro",
          cor: cores.get(u.tipo_id ?? "") ?? "#424E6B",
          latitude: Number(u.latitude),
          longitude: Number(u.longitude),
          agente: !!u.agente_id,
        })),
    [panorama.unidades, cores],
  );
  const mun = panorama.municipio;
  const centro = mun.latitude != null && mun.longitude != null ? ([Number(mun.latitude), Number(mun.longitude)] as [number, number]) : null;

  return (
    <section className="surface-card overflow-hidden" aria-label="A secretaria sendo montada">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {vista === "predio" ? "Secretaria virtual: cada setor é uma sala, com o seu agente" : "Cidade: cada unidade de saúde com o seu prédio e o agente"}
        </span>
        <div role="tablist" aria-label="Vista" className="flex rounded-full bg-muted p-0.5 text-xs">
          {(
            [
              ["predio", "Secretaria"],
              ["cidade", "Cidade"],
            ] as const
          ).map(([id, rotulo]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={vista === id}
              onClick={() => setEscolhida(id)}
              className={cn("rounded-full px-3 py-1", vista === id ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground")}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>
      <div className="relative h-[360px] bg-[#0D1B38]">
        {vista === "predio" ? (
          panorama.setores.length ? (
            <Suspense fallback={<div className="grid h-full place-items-center text-white/70"><Loader2 className="size-5 animate-spin" /></div>}>
              <Predio
                setores={panorama.setores}
                agentes={agentes}
                eventos={aoVivo.eventos}
                inicio={aoVivo.inicio}
                selecao={selecao}
                aoSelecionar={setSelecao}
                margemDireita={0}
                api={camera}
                aberto
                aoAbrir={() => undefined}
              />
            </Suspense>
          ) : (
            <p className="grid h-full place-items-center px-6 text-center text-sm text-white/70">O prédio sobe quando os setores forem confirmados: cada setor, uma sala.</p>
          )
        ) : token ? (
          <MapaCidade token={token} unidades={noMapa} centro={centro} satelite predios className="h-full w-full" />
        ) : (
          <p className="grid h-full place-items-center px-6 text-center text-sm text-white/70">Defina o MAPBOX_TOKEN no servidor para ver o mapa da cidade.</p>
        )}
      </div>
    </section>
  );
}
