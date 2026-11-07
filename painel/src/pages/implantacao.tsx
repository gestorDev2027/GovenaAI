import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Building2, Check, Landmark, LayoutDashboard, Loader2, LogOut, MapPinned, SendHorizontal, Users } from "lucide-react";
import { api, ErroAcesso, sair, type Acesso } from "@/lib/api";
import { fmtInt } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/widgets/widgets";

/*
 * Implantação da prefeitura: a primeira tela de quem se cadastra. Chat com o Assistente de Implantação à
 * esquerda e, à direita, o quadro que se monta a cada resposta (município, unidades, setores, responsáveis e
 * agentes), a partir do panorama que a rota devolve. Vale para quem ainda espera a aprovação do painel.
 * O mapa e o prédio 3D entram neste quadro na próxima fase; a lista continua como versão acessível.
 */

interface Unidade {
  id: string;
  tipo_id: string | null;
}
interface Setor {
  id: string;
  nome: string;
  responsavel: { nome: string } | null;
  atividades: unknown[];
  agentes: unknown[];
}
interface Panorama {
  municipio: { nome: string; uf: string; codigo_ibge: string; situacao: string | null };
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
  ["unidades", "Unidades de saúde"],
  ["setores", "Setores"],
  ["atividades", "Atividades"],
  ["responsaveis", "Responsáveis"],
  ["agentes", "Agentes"],
  ["revisao", "Revisão"],
] as const;

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
          <Quadro panorama={panorama} tipos={catalogo.data?.tipos_unidade ?? []} />
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

function Quadro({ panorama, tipos }: { panorama: Panorama | null; tipos: TipoUnidade[] }) {
  const porTipo = useMemo(() => {
    const mapa = new Map(tipos.map((t) => [t.id, t]));
    const contagem = new Map<string, number>();
    for (const u of panorama?.unidades ?? []) contagem.set(u.tipo_id ?? "outro", (contagem.get(u.tipo_id ?? "outro") ?? 0) + 1);
    return [...contagem]
      .map(([id, n]) => ({ id, n, nome: mapa.get(id)?.nome ?? id, cor: mapa.get(id)?.cor ?? "#424E6B", ordem: mapa.get(id)?.ordem ?? 99 }))
      .sort((a, b) => a.ordem - b.ordem);
  }, [panorama, tipos]);
  const etapa = panorama ? (panorama.municipio.situacao === "ativo" ? "concluido" : panorama.onboarding?.etapa ?? "unidades") : "municipio";
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

      {!panorama ? (
        <Bloco icone={<MapPinned className="size-5" />} titulo="Sua cidade aparece aqui">
          <p className="text-sm text-muted-foreground">
            Diga ao assistente o CEP da prefeitura ou o nome da cidade e a UF. Assim que você confirmar, o município, as unidades de saúde e os setores
            vão aparecendo neste quadro.
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
              <p className="text-sm text-muted-foreground">O assistente importa as unidades do CNES na próxima etapa.</p>
            )}
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
              <p className="text-sm text-muted-foreground">Os setores aparecem depois das unidades.</p>
            )}
          </Bloco>
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
