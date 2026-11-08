import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Building2, Check, Copy, Landmark, LayoutDashboard, Loader2, LogOut, MapPinned, Share2, Timer, Users } from "lucide-react";
import { Input } from "@/components/ui/fields";
import { api, ErroAcesso, sair, type Acesso, type CampoSegmento, type PanoramaOrganizacao, type Rotulos } from "@/lib/api";
import { fasesDaImplantacao, rotulosDe, totemDe } from "@/lib/rotulos";
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
 * Implantação da organização (uma Secretaria de Saúde ou uma empresa): a primeira tela de quem se cadastra. Chat com
 * o Assistente de Implantação à esquerda e, à direita, o quadro que se monta a cada resposta, a partir do panorama que
 * a rota devolve. A ordem: o segmento e o cadastro da organização, as áreas (setores ou departamentos; cada uma vira
 * uma sala do prédio), atividades, cargos, responsáveis, agentes (os robôs sentam nas salas), quem tem acesso e, por
 * último, as unidades no mapa, cada uma com o seu prédio e o agente. Embaixo, as mesmas informações em lista (o 3D
 * nunca é obrigatório). Os nomes de tela vêm do segmento (segmento.rotulos) e os campos do cadastro, de
 * segmento.campos. Vale para quem ainda espera a aprovação do painel.
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
type Panorama = PanoramaOrganizacao<Unidade>;
interface Implantacao {
  conta: { email: string; nome: string };
  boas_vindas: string;
  historico: { papel: "contato" | "agente"; texto: string }[];
  organizacao_id: string | null;
  panorama: Panorama | null;
}
interface TipoUnidade {
  id: string;
  nome: string;
  cor: string | null;
  ordem: number | null;
}

// Das áreas à equipe, o quadro mostra o prédio; nas unidades, o mapa.
const ETAPAS_DO_PREDIO = new Set(["areas", "atividades", "cargos", "responsaveis", "agentes", "equipe"]);
const Predio = lazy(() => import("@/components/central/predio-secretaria"));

/** `segundos`: quanto o assistente trabalhou nesta resposta (só nas respostas desta visita). */
type Mensagem = { papel: "contato" | "agente"; texto: string; segundos?: number };

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
  const [desde, setDesde] = useState<number | null>(null);
  const [agora, setAgora] = useState(Date.now());
  const fim = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (desde == null) return;
    const relogio = setInterval(() => setAgora(Date.now()), 500);
    return () => clearInterval(relogio);
  }, [desde]);

  useEffect(() => {
    document.title = "Implantação · GestorGov";
  }, []);
  useEffect(() => {
    if (dados.error instanceof ErroAcesso) navegar({ to: "/entrar" });
  }, [dados.error, navegar]);
  useEffect(() => {
    if (!dados.data) return;
    setMensagens([{ papel: "agente", texto: dados.data.boas_vindas }, ...dados.data.historico]);
    setPanorama(dados.data.panorama?.organizacao ? dados.data.panorama : null);
  }, [dados.data]);
  // Sempre no fim da conversa: na primeira vez, direto; depois, suave. O cartão de respostas rápidas muda a altura.
  const primeiraRolagem = useRef(true);
  useEffect(() => {
    const lista = fim.current?.parentElement;
    if (!lista) return;
    lista.scrollTo({ top: lista.scrollHeight, behavior: primeiraRolagem.current ? "auto" : "smooth" });
    if (mensagens.length) primeiraRolagem.current = false;
  }, [mensagens, enviando]);

  async function enviar(e?: FormEvent, pronta?: string) {
    e?.preventDefault();
    const mensagem = (pronta ?? texto).trim();
    if (!mensagem || enviando) return;
    setErro(null);
    if (!pronta) setTexto("");
    setMensagens((m) => [...m, { papel: "contato", texto: mensagem }]);
    setEnviando(true);
    const comeco = Date.now();
    setDesde(comeco);
    setAgora(comeco);
    try {
      const r = await api<{ resposta: string | null; panorama: Panorama | null }>("/implantacao/mensagem", {
        method: "POST",
        body: JSON.stringify({ mensagem }),
      });
      const segundos = Math.max(1, Math.round((Date.now() - comeco) / 1000));
      if (r.resposta) setMensagens((m) => [...m, { papel: "agente", texto: r.resposta as string, segundos }]);
      setPanorama(r.panorama?.organizacao ? r.panorama : null);
      qc.invalidateQueries({ queryKey: ["gestao-panorama"] });
      qc.invalidateQueries({ queryKey: ["acesso"] });
      qc.invalidateQueries({ queryKey: ["agentes-visiveis"] });
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "O assistente não conseguiu responder agora.");
    } finally {
      setEnviando(false);
      setDesde(null);
      caixa.current?.focus();
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
  const ultima = mensagens.at(-1);
  // Respostas rápidas quando o assistente termina numa pergunta (como os cartões do Replit). Antes do registro, as
  // primeiras dizem o segmento (Secretaria de Saúde ou empresa).
  const rapidas =
    enviando || ultima?.papel !== "agente"
      ? []
      : !panorama
        ? RESPOSTAS_INICIAIS
        : ultima.texto.trim().endsWith("?")
          ? RESPOSTAS_RAPIDAS
          : [];
  const org = panorama?.organizacao;
  const local = org ? [org.cidade, org.uf].filter(Boolean).join("-") : "";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#F6F7F9] text-foreground dark:bg-[#0A1328]">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/inicio" aria-label="GestorGov — início" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo className="[&_svg]:size-7" />
          </Link>
          <span className="h-5 w-px bg-border" aria-hidden="true" />
          <span className="truncate text-sm font-medium">Implantação</span>
          {org && (
            <span className="hidden truncate rounded-full bg-card px-2.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border sm:inline">
              {[org.sigla || org.nome, local].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {panorama && <Compartilhar />}
          <span className="hidden text-xs text-muted-foreground md:inline">{conta?.email}</span>
          {aprovado && (
            <Link
              to="/"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LayoutDashboard className="size-4" /> Painel
            </Link>
          )}
          <Button variant="ghost" size="sm" onClick={() => sair()}>
            <LogOut /> Sair
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-0 lg:gap-1">
        {/* O chat: uma coluna fina */}
        <section aria-label="Conversa com o Assistente de Implantação" className="flex min-h-0 w-full flex-col lg:w-[420px] lg:shrink-0">
          <div className="thin-scroll relative flex-1 space-y-6 overflow-y-auto px-5 pt-4 pb-6" aria-live="polite">
            {mensagens.map((m, i) => (m.papel === "agente" ? <RespostaDoAssistente key={i} m={m} /> : <MensagemDoServidor key={i} texto={m.texto} />))}
            {enviando && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Trabalhando{desde ? ` · ${Math.max(0, Math.round((agora - desde) / 1000))} s` : ""}
              </div>
            )}
            <div ref={fim} />
          </div>

          <form onSubmit={enviar} className="px-3 pb-3">
            {erro && (
              <p role="alert" className="mb-2 px-1 text-sm text-destructive">
                {erro}
              </p>
            )}
            {rapidas.length > 0 && (
              <div className="mb-2 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <p className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">Responder rápido</p>
                <ul>
                  {rapidas.map((r, n) => (
                    <li key={r}>
                      <button
                        type="button"
                        onClick={() => void enviar(undefined, r)}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm outline-none hover:bg-secondary focus-visible:bg-secondary"
                      >
                        <span className="grid size-5 shrink-0 place-items-center rounded-md border border-border text-[11px] font-semibold text-muted-foreground">{n + 1}</span>
                        {r}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-2xl border border-border bg-card shadow-sm transition-shadow focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_rgba(26,99,216,0.12)]">
              <label htmlFor="mensagem" className="sr-only">
                Mensagem para o assistente
              </label>
              <textarea
                ref={caixa}
                id="mensagem"
                rows={2}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={teclas}
                placeholder="Mensagem para o assistente…"
                className="block max-h-40 min-h-12 w-full resize-none bg-transparent px-4 pt-3 text-[15px] outline-none placeholder:text-muted-foreground"
              />
              <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
                <span className="text-[11px] text-muted-foreground">Enter envia · Shift+Enter quebra a linha</span>
                <button
                  type="submit"
                  disabled={enviando || !texto.trim()}
                  aria-label="Enviar"
                  className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground"
                >
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </div>
          </form>
        </section>

        {/* O canvas: o que a conversa vai montando */}
        <section aria-label="A organização sendo montada" className="hidden min-h-0 flex-1 pr-3 pb-3 lg:flex">
          <Canvas panorama={panorama} tipos={catalogo.data?.tipos_unidade ?? []} token={acesso.data?.mapbox_token ?? null} />
        </section>
      </div>
    </div>
  );
}

const RESPOSTAS_RAPIDAS = ["Sim, pode seguir", "Quero ajustar antes"];
const RESPOSTAS_INICIAIS = ["É uma Secretaria de Saúde", "É uma empresa"];

function RespostaDoAssistente({ m }: { m: Mensagem }) {
  return (
    <div className="space-y-2">
      <div className="text-[15px] leading-relaxed text-foreground">
        <span className="sr-only">Assistente: </span>
        <TextoSimples texto={m.texto} />
      </div>
      {m.segundos != null && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Timer className="size-3.5" /> Trabalhou por {m.segundos} s
        </p>
      )}
    </div>
  );
}

function MensagemDoServidor({ texto }: { texto: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-[#E3ECFB] px-4 py-2 text-[15px] leading-relaxed text-[#0D1B38] dark:bg-[#1A63D8]/25 dark:text-white">
        <span className="sr-only">Você: </span>
        {texto}
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
              <span aria-hidden="true" className="text-muted-foreground">•</span>
              <span>{negrito(item[1])}</span>
            </div>
          );
        return linha.trim() ? <p key={i}>{negrito(linha)}</p> : <div key={i} className="h-2" />;
      })}
    </>
  );
}

type Aba = "predio" | "cidade" | "resumo";

/** O canvas: a barra fina (vistas e progresso) e, embaixo, a vista inteira. */
function Canvas({ panorama, tipos, token }: { panorama: Panorama | null; tipos: TipoUnidade[]; token: string | null }) {
  const r = rotulosDe(panorama?.segmento.id, panorama?.segmento.rotulos);
  const ETAPAS = fasesDaImplantacao(r);
  const etapa: string = panorama
    ? panorama.organizacao.situacao === "ativo"
      ? "concluido"
      : panorama.fase ?? panorama.onboarding?.etapa ?? "organizacao"
    : "organizacao";
  const indice = etapa === "concluido" ? ETAPAS.length : Math.max(0, ETAPAS.findIndex(([id]) => id === etapa));
  const sugerida: Aba = ETAPAS_DO_PREDIO.has(etapa) ? "predio" : etapa === "organizacao" || etapa === "revisao" || etapa === "concluido" ? "resumo" : "cidade";
  const [escolhida, setEscolhida] = useState<Aba | null>(null);
  useEffect(() => setEscolhida(null), [sugerida]); // etapa nova: volta a vista dela
  const aba = escolhida ?? sugerida;
  const rotuloEtapa = etapa === "concluido" ? "Concluída" : ETAPAS[indice]?.[1] ?? "";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-2">
        <div role="tablist" aria-label="Vista" className="flex items-center gap-0.5">
          {(
            [
              ["predio", r.predio.split(" ")[0], Building2],
              ["cidade", r.mapa, MapPinned],
              ["resumo", "Resumo", Users],
            ] as const
          ).map(([id, rotulo, Icone]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={aba === id}
              onClick={() => setEscolhida(id)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                aba === id ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icone className="size-4" /> {rotulo}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2.5 pr-1" aria-label="Etapas da implantação">
          <ol className="hidden items-center gap-1 xl:flex">
            {ETAPAS.map(([id, rotulo], i) => (
              <li key={id} title={rotulo} aria-current={i === indice ? "step" : undefined}>
                <span
                  className={cn(
                    "block h-1.5 rounded-full transition-all",
                    i < indice ? "w-5 bg-success" : i === indice ? "w-8 bg-primary" : "w-5 bg-muted",
                  )}
                />
              </li>
            ))}
          </ol>
          <span className="text-xs text-muted-foreground">
            {etapa === "concluido" ? "Implantação concluída" : `Etapa ${indice + 1} de ${ETAPAS.length} · `}
            {etapa !== "concluido" && <span className="font-medium text-foreground">{rotuloEtapa}</span>}
          </span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {!panorama ? (
          <div className="grid h-full place-items-center p-8">
            <div className="max-w-md space-y-4 text-center">
              <Building2 className="mx-auto size-8 text-primary-text" />
              <p className="text-base font-semibold">A sua organização aparece aqui</p>
              <p className="text-sm text-muted-foreground">
                Primeiro, diga ao assistente o que você vai implantar. Depois vêm o cadastro, as áreas (o prédio vai subindo aqui), os agentes e, por último,
                as unidades no mapa.
              </p>
              <div className="grid gap-2 text-left sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-background p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Landmark className="size-4 text-primary-text" /> Secretaria de Saúde
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Setores, servidores e as unidades de saúde do município (UBS, UPA, CAPS...), com o CNES.</p>
                </div>
                <div className="rounded-xl border border-border bg-background p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Building2 className="size-4 text-primary-text" /> Empresa
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Departamentos, funcionários e as unidades da empresa (matriz, filiais, lojas, depósitos).</p>
                </div>
              </div>
            </div>
          </div>
        ) : aba === "resumo" ? (
          <div className="thin-scroll h-full overflow-y-auto p-4">
            <Resumo panorama={panorama} tipos={tipos} rotulos={r} etapas={ETAPAS} />
          </div>
        ) : (
          <Vista panorama={panorama} tipos={tipos} token={token} aba={aba} rotulos={r} />
        )}
        {panorama && etapa !== "concluido" && aba !== "resumo" && (
          <Checklist titulo={rotuloEtapa} itens={panorama.pendencias?.[etapa as keyof NonNullable<Panorama["pendencias"]>] ?? []} />
        )}
      </div>
    </div>
  );
}

/** O valor de um campo do cadastro: coluna de `organizacao` ou, com "dados.", chave de `dados_segmento`. */
function valorDoCampo(org: Panorama["organizacao"], campo: CampoSegmento): string | null {
  const bruto = campo.chave.startsWith("dados.")
    ? org.dados_segmento?.[campo.chave.slice(6)]
    : (org as unknown as Record<string, unknown>)[campo.chave];
  if (bruto == null || bruto === "") return null;
  const texto = String(bruto);
  if (campo.tipo === "cnpj") return fmtCnpj(texto);
  if (campo.tipo === "cep") return texto.length === 8 ? `${texto.slice(0, 5)}-${texto.slice(5)}` : texto;
  if (campo.tipo === "inteiro" && !Number.isNaN(Number(texto))) return fmtInt(Number(texto));
  return texto;
}

/** As listas (a versão acessível do canvas): o cadastro (pelos campos do segmento), as áreas e as unidades. */
function Resumo({ panorama, tipos, rotulos: r, etapas }: { panorama: Panorama; tipos: TipoUnidade[]; rotulos: Rotulos; etapas: [string, string][] }) {
  const [conferindo, setConferindo] = useState(false);
  const org = panorama.organizacao;
  const aConferir = panorama.unidades.filter((u) => !u.confirmada).length;
  // Os campos do cadastro, agrupados (Prefeitura, Secretaria, Secretário(a)... ou Empresa, Sede, Diretor(a)).
  const grupos = useMemo(() => {
    const mapa = new Map<string, CampoSegmento[]>();
    for (const c of panorama.segmento.campos) mapa.set(c.grupo || r.organizacao, [...(mapa.get(c.grupo || r.organizacao) ?? []), c]);
    return [...mapa];
  }, [panorama.segmento.campos, r.organizacao]);
  const porTipo = useMemo(() => {
    const mapa = new Map(tipos.map((t) => [t.id, t]));
    const contagem = new Map<string, number>();
    for (const u of panorama.unidades) contagem.set(u.tipo_id ?? "outro", (contagem.get(u.tipo_id ?? "outro") ?? 0) + 1);
    return [...contagem]
      .map(([id, n]) => ({ id, n, nome: mapa.get(id)?.nome ?? id, cor: mapa.get(id)?.cor ?? "#424E6B", ordem: mapa.get(id)?.ordem ?? 99 }))
      .sort((a, b) => a.ordem - b.ordem);
  }, [panorama, tipos]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Fases panorama={panorama} etapas={etapas} />
      <p className="text-xs text-muted-foreground">
        {panorama.segmento.nome} · {org.nome || r.organizacao}
        {org.cidade ? ` · ${org.cidade}${org.uf ? `-${org.uf}` : ""}` : ""}
        {org.codigo_ibge ? ` · IBGE ${org.codigo_ibge}` : ""}
      </p>
      {grupos.map(([grupo, campos], i) => (
        <Bloco key={grupo} icone={i === 0 ? <Landmark className="size-5" /> : <Building2 className="size-5" />} titulo={grupo}>
          <Dados linhas={campos.map((c) => [c.rotulo, valorDoCampo(org, c), c.obrigatorio])} />
        </Bloco>
      ))}
      <Bloco icone={<Users className="size-5" />} titulo={`${r.Areas} · ${fmtInt(panorama.areas.length)}`}>
        {panorama.areas.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {panorama.areas.map((s) => (
              <li key={s.id} className="rounded-lg border border-border bg-background px-3 py-2">
                <div className="text-sm font-medium">{s.nome}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtInt(s.atividades.length)} atividades · {s.responsavel?.nome ?? "sem responsável"} · {s.agentes.length ? "com agente" : "sem agente"}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">O assistente propõe os {r.areas} logo depois do cadastro: cada um vira uma sala do prédio.</p>
        )}
      </Bloco>
      <Bloco icone={<Building2 className="size-5" />} titulo={`${r.Unidades} · ${fmtInt(panorama.unidades.length)}`}>
        {porTipo.length ? (
          <ul className="flex flex-wrap gap-2">
            {porTipo.map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1 text-xs">
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: t.cor }} />
                {t.nome}
                <span className="num font-semibold">{fmtInt(t.n)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">As {r.unidades} são a última etapa: entram no mapa, cada uma com a sua visão 3D.</p>
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
        <Slideover titulo={r.Unidades} subtitulo="Confira cada unidade e cadastre as que faltam (o CEP busca o endereço)" aoFechar={() => setConferindo(false)}>
          <GerenciarUnidades />
        </Slideover>
      )}
    </div>
  );
}

function Bloco({ icone, titulo, children }: { icone: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-4">
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

/** A vista do canvas: o prédio da organização (áreas e agentes) ou o mapa (unidades). */
function Vista({
  panorama,
  tipos,
  token,
  aba,
  rotulos: r,
}: {
  panorama: Panorama;
  tipos: TipoUnidade[];
  token: string | null;
  aba: "predio" | "cidade";
  rotulos: Rotulos;
}) {
  const agentes = useAgentes();
  const aoVivo = useCentralAoVivo();
  const camera = useRef<ApiCamera | null>(null);
  const [selecao, setSelecao] = useState<SelecaoPredio>(null);
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
        })),
    [panorama.unidades, cores],
  );
  const org = panorama.organizacao;
  const centro = org.latitude != null && org.longitude != null ? ([Number(org.latitude), Number(org.longitude)] as [number, number]) : null;

  if (aba === "predio")
    return panorama.areas.length ? (
      <div className="absolute inset-0 bg-[#0D1B38]">
        <Suspense fallback={<div className="grid h-full place-items-center text-white/70"><Loader2 className="size-5 animate-spin" /></div>}>
          <Predio
            areas={panorama.areas}
            agentes={agentes}
            nomePredio={org.sigla || org.nome || r.organizacao}
            rotuloCentro={r.centro}
            totem={totemDe(r)}
            eventos={aoVivo.eventos}
            inicio={aoVivo.inicio}
            selecao={selecao}
            aoSelecionar={setSelecao}
            margemDireita={0}
            api={camera}
            aberto
            tetoDeVidro
            aoAbrir={() => undefined}
          />
        </Suspense>
      </div>
    ) : (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-sm space-y-3">
          <Building2 className="mx-auto size-8 text-primary-text" />
          <p className="text-base font-semibold">O prédio sobe com os {r.areas}</p>
          <p className="text-sm text-muted-foreground">Quando você confirmar os {r.areas}, cada um vira uma sala deste prédio, e depois cada sala ganha o seu agente.</p>
        </div>
      </div>
    );
  return token ? (
    <MapaCidade token={token} unidades={noMapa} centro={centro} zoom={org.zoom_mapa ?? null} satelite className="absolute inset-0 h-full w-full" />
  ) : (
    <p className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">Defina o MAPBOX_TOKEN no servidor para ver o mapa.</p>
  );
}

const fmtCnpj = (c?: string | null) =>
  c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : (c ?? null);

/** Os dados de um bloco do Resumo; o obrigatório que falta aparece como "a preencher"; o opcional, como "—". */
function Dados({ linhas }: { linhas: [string, string | null | undefined, boolean?][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {linhas.map(([rotulo, valor, obrigatorio = true]) => (
        <div key={rotulo}>
          <dt className="text-xs text-muted-foreground">
            {rotulo}
            {!obrigatorio && <span className="text-muted-foreground/70"> (opcional)</span>}
          </dt>
          <dd className={cn("text-sm", !valor && obrigatorio && "text-warning", !valor && !obrigatorio && "text-muted-foreground")}>
            {valor || (obrigatorio ? "a preencher" : "—")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** As fases da implantação, com o que falta em cada uma. */
function Fases({ panorama, etapas: ETAPAS }: { panorama: Panorama; etapas: [string, string][] }) {
  const atual: string | undefined = panorama.organizacao.situacao === "ativo" ? "concluido" : panorama.fase;
  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold">Fases da implantação</h2>
      <ol className="space-y-2">
        {ETAPAS.map(([id, rotulo], i) => {
          const falta = panorama.pendencias?.[id as keyof NonNullable<Panorama["pendencias"]>] ?? [];
          const feita = atual === "concluido" || (falta.length === 0 && ETAPAS.findIndex(([e]) => e === atual) > i);
          return (
            <li key={id} className="flex items-start gap-3 text-sm">
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                  feita ? "bg-success text-white" : id === atual ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {feita ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cn(id === atual ? "font-semibold" : feita ? "text-foreground" : "text-muted-foreground")}>{rotulo}</span>
                {id === atual && falta.length > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    Falta: {falta.slice(0, 4).join(" · ")}
                    {falta.length > 4 ? ` e mais ${falta.length - 4}` : ""}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** O que falta na fase atual, por cima da vista (some quando a fase está completa). */
function Checklist({ titulo, itens }: { titulo: string; itens: string[] }) {
  if (!itens.length) return null;
  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-10 w-72 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
      <p className="text-xs font-semibold">
        {titulo} <span className="font-normal text-muted-foreground">· falta {itens.length}</span>
      </p>
      <ul className="mt-2 space-y-1">
        {itens.slice(0, 6).map((item) => (
          <li key={item} className="flex items-start gap-2 text-xs text-muted-foreground">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
            {item}
          </li>
        ))}
        {itens.length > 6 && <li className="text-xs text-muted-foreground">e mais {itens.length - 6}…</li>}
      </ul>
    </div>
  );
}

/** Compartilhar a implantação: o link e o código de segurança (só aparecem uma vez). */
function Compartilhar() {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<{ link: string; codigo: string; validade_dias: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  async function gerar() {
    setErro(null);
    setGerando(true);
    try {
      setDados(await api<{ link: string; codigo: string; validade_dias: number }>("/organizacao/implantacao/link", { method: "POST" }));
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível gerar o link.");
    } finally {
      setGerando(false);
    }
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)} className="h-8">
        <Share2 /> Compartilhar
      </Button>
      {aberto && (
        <Slideover titulo="Compartilhar a implantação" subtitulo="Para outra pessoa da organização continuar daqui" aoFechar={() => { setAberto(false); setDados(null); }}>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Quem receber o link e o código entra com a própria conta, passa a fazer parte da organização e continua a implantação de onde parou.
              Mande o link e o código por canais diferentes (por exemplo, o link por e-mail e o código por telefone).
            </p>
            {!dados ? (
              <Button onClick={gerar} disabled={gerando}>
                {gerando ? <Loader2 className="animate-spin" /> : <Share2 />} Gerar link e código
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Link (vale {dados.validade_dias} dias)</p>
                  <div className="flex gap-2">
                    <Input readOnly value={dados.link} className="h-9 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
                    <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(dados.link)}>
                      <Copy /> Copiar
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Código de segurança</p>
                  <p className="font-mono text-2xl font-semibold tracking-[0.35em]">{dados.codigo}</p>
                  <p className="text-xs text-muted-foreground">O código só aparece agora. Cinco códigos errados cancelam o link.</p>
                </div>
              </div>
            )}
            {erro && <p role="alert" className="text-destructive">{erro}</p>}
          </div>
        </Slideover>
      )}
    </>
  );
}
